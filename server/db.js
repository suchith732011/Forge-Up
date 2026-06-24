const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// Setup file paths
const DATA_DIR = process.env.DB_DATA_DIR
  ? path.resolve(process.env.DB_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const BACKUP_DIR = process.env.DB_BACKUP_DIR
  ? path.resolve(process.env.DB_BACKUP_DIR)
  : path.join(__dirname, '..', 'backups');

const FILE_PATHS = {
  users: path.join(DATA_DIR, 'users.json'),
  sessions: path.join(DATA_DIR, 'sessions.json'),
  goals: path.join(DATA_DIR, 'goals.json'),
  auditLogs: path.join(DATA_DIR, 'audit_logs.json')
};

// Encryption config
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  if (key.length !== 64) {
    // Generate fallback key to prevent server crash, but print warning
    console.warn('WARNING: ENCRYPTION_KEY is not 32 bytes (64 hex characters). Using generated fallback key.');
    return crypto.createHash('sha256').update(key).digest('hex');
  }
  return key;
}

function encrypt(text) {
  if (!text) return '';
  try {
    const keyHex = getEncryptionKey();
    const key = Buffer.from(keyHex, 'hex');
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  } catch (err) {
    console.error('Encryption failed:', err);
    throw new Error('Data encryption failed');
  }
}

function decrypt(cipherText) {
  if (!cipherText) return '';
  try {
    const keyHex = getEncryptionKey();
    const key = Buffer.from(keyHex, 'hex');
    const parts = cipherText.split(':');
    if (parts.length !== 3) return '';
    const [ivHex, encryptedHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err);
    return '[Decryption Failed]';
  }
}

// Memory locks to ensure atomic file writing
const locks = {};
async function acquireLock(collection) {
  while (locks[collection]) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  locks[collection] = true;
}
function releaseLock(collection) {
  locks[collection] = false;
}

// Core database reading/writing functions
async function readCollection(name) {
  await acquireLock(name);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const filePath = FILE_PATHS[name];
    try {
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      if (err.code === 'ENOENT') {
        // If file doesn't exist, create with empty array
        await fs.writeFile(filePath, '[]', 'utf8');
        return [];
      }
      throw err;
    }
  } finally {
    releaseLock(name);
  }
}

async function writeCollection(name, data) {
  await acquireLock(name);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const filePath = FILE_PATHS[name];
    const tempPath = `${filePath}.tmp`;
    const content = JSON.stringify(data, null, 2);
    // Write atomic: write to temp file then rename
    await fs.writeFile(tempPath, content, 'utf8');
    await fs.rename(tempPath, filePath);
  } finally {
    releaseLock(name);
  }
}

// Database Abstraction Class API
class UsersCollection {
  async list() {
    const list = await readCollection('users');
    return list.map(u => ({ ...u, email: decrypt(u.email) }));
  }

  async get(id) {
    const list = await this.list();
    return list.find(u => u.id === id) || null;
  }

  async getByUsernameOrEmail(usernameOrEmail) {
    const list = await this.list();
    const query = usernameOrEmail.toLowerCase();
    return list.find(u => u.username.toLowerCase() === query || u.email.toLowerCase() === query) || null;
  }

  async create(user) {
    const list = await readCollection('users');
    const newUser = {
      id: crypto.randomUUID(),
      username: user.username,
      email: encrypt(user.email.toLowerCase()),
      password: user.password,
      joinDate: new Date().toISOString(),
      level: 1,
      xp: 0,
      seasonalXp: 0,
      currentStreak: 0,
      longestStreak: 0,
      consistencyScore: 0,
      achievements: [],
      settings: {
        profilePublic: true,
        notificationsEnabled: true,
        ...user.settings
      },
      emailVerified: true,
      emailVerificationToken: crypto.randomBytes(32).toString('hex'),
      emailVerificationExpires: Date.now() + 3600000, // 1 hour
      passwordResetToken: null,
      passwordResetExpires: null,
      failedLogins: 0,
      lockedUntil: null,
      lastStudyDate: null,
      activeDays: [],
      activeSession: null,
      ...user
    };
    list.push(newUser);
    await writeCollection('users', list);
    return { ...newUser, email: user.email.toLowerCase() };
  }

  async update(id, updateData) {
    const list = await readCollection('users');
    const idx = list.findIndex(u => u.id === id);
    if (idx === -1) return null;

    const current = list[idx];
    const dataToSave = { ...updateData };

    if (dataToSave.email) {
      dataToSave.email = encrypt(dataToSave.email.toLowerCase());
    }

    list[idx] = { ...current, ...dataToSave };
    await writeCollection('users', list);
    return { ...list[idx], email: decrypt(list[idx].email) };
  }

  async delete(id) {
    const list = await readCollection('users');
    const filtered = list.filter(u => u.id !== id);
    await writeCollection('users', filtered);
    return true;
  }
}

class SessionsCollection {
  async list() {
    return await readCollection('sessions');
  }

  async listByUser(userId) {
    const list = await this.list();
    return list.filter(s => s.userId === userId);
  }

  async get(id) {
    const list = await this.list();
    return list.find(s => s.id === id) || null;
  }

  async create(session) {
    const list = await readCollection('sessions');
    const newSession = {
      id: crypto.randomUUID(),
      userId: session.userId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      subject: session.subject || 'Other',
      notes: session.notes || '',
      xpEarned: session.xpEarned || 0,
      ...session
    };
    list.push(newSession);
    await writeCollection('sessions', list);
    return newSession;
  }

  async deleteByUser(userId) {
    const list = await readCollection('sessions');
    const filtered = list.filter(s => s.userId !== userId);
    await writeCollection('sessions', filtered);
    return true;
  }
}

class GoalsCollection {
  async list() {
    return await readCollection('goals');
  }

  async listByUser(userId) {
    const list = await this.list();
    return list.filter(g => g.userId === userId);
  }

  async get(id) {
    const list = await this.list();
    return list.find(g => g.id === id) || null;
  }

  async create(goal) {
    const list = await readCollection('goals');
    const newGoal = {
      id: crypto.randomUUID(),
      userId: goal.userId,
      title: goal.title,
      description: goal.description || '',
      deadline: goal.deadline,
      completed: false,
      completedDate: null,
      type: goal.type || 'custom', // 'daily' | 'weekly' | 'custom'
      targetMinutes: goal.targetMinutes || null,
      completedMinutes: goal.completedMinutes || 0,
      xpRewarded: goal.xpRewarded || 0,
      ...goal
    };
    list.push(newGoal);
    await writeCollection('goals', list);
    return newGoal;
  }

  async update(id, updateData) {
    const list = await readCollection('goals');
    const idx = list.findIndex(g => g.id === id);
    if (idx === -1) return null;

    list[idx] = { ...list[idx], ...updateData };
    await writeCollection('goals', list);
    return list[idx];
  }

  async delete(id) {
    const list = await readCollection('goals');
    const filtered = list.filter(g => g.id !== id);
    await writeCollection('goals', filtered);
    return true;
  }

  async deleteByUser(userId) {
    const list = await readCollection('goals');
    const filtered = list.filter(g => g.userId !== userId);
    await writeCollection('goals', filtered);
    return true;
  }
}

class AuditLogsCollection {
  async list() {
    return await readCollection('auditLogs');
  }

  async log(entry) {
    const list = await readCollection('auditLogs');
    const newLog = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      userId: entry.userId || null,
      username: entry.username || null,
      action: entry.action,
      details: entry.details,
      ip: entry.ip || '127.0.0.1'
    };
    list.push(newLog);
    await writeCollection('auditLogs', list);
    return newLog;
  }

  async deleteByUser(userId) {
    const list = await readCollection('auditLogs');
    const filtered = list.filter(l => l.userId !== userId);
    await writeCollection('auditLogs', filtered);
    return true;
  }
}

// Database backup function
async function backupDatabase() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupSubdir = path.join(BACKUP_DIR, `backup-${timestamp}`);
    await fs.mkdir(backupSubdir, { recursive: true });

    // Copy all active DB json files
    for (const [key, srcPath] of Object.entries(FILE_PATHS)) {
      try {
        const destPath = path.join(backupSubdir, `${key}.json`);
        await fs.copyFile(srcPath, destPath);
      } catch (err) {
        if (err.code !== 'ENOENT') {
          console.error(`Error backing up file ${key}:`, err);
        }
      }
    }
    console.log(`[DB BACKUP] Completed database backup at ${backupSubdir}`);

    // Retention check: keep only 10 most recent backups
    try {
      const dirs = await fs.readdir(BACKUP_DIR);
      const backupDirs = dirs
        .filter(d => d.startsWith('backup-'))
        .map(d => ({ name: d, path: path.join(BACKUP_DIR, d) }));

      // Sort descending (newest first)
      backupDirs.sort((a, b) => b.name.localeCompare(a.name));

      if (backupDirs.length > 10) {
        const toDelete = backupDirs.slice(10);
        for (const old of toDelete) {
          await fs.rm(old.path, { recursive: true, force: true });
          console.log(`[DB BACKUP] Purged old backup beyond retention limit: ${old.name}`);
        }
      }
    } catch (err) {
      console.error('[DB BACKUP] Failed during backup retention cleanup:', err);
    }

    return true;
  } catch (err) {
    console.error('[DB BACKUP] Backup failed:', err);
    return false;
  }
}

// Database setup: Initialize Backup scheduler
function initBackupScheduler() {
  const intervalMinutes = parseInt(process.env.BACKUP_INTERVAL_MINUTES || '60', 10);
  if (isNaN(intervalMinutes) || intervalMinutes <= 0) return;

  setInterval(async () => {
    console.log('[SCHEDULER] Running automatic database backup...');
    await backupDatabase();
  }, intervalMinutes * 60 * 1000);
}

// Export database API singleton
const db = {
  users: new UsersCollection(),
  sessions: new SessionsCollection(),
  goals: new GoalsCollection(),
  auditLogs: new AuditLogsCollection(),
  backup: backupDatabase,
  initBackupScheduler
};

module.exports = db;
