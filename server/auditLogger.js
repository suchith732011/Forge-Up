const fs = require('fs').promises;
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const SECURITY_LOG = path.join(LOGS_DIR, 'security.log');
const AUDIT_LOG = path.join(LOGS_DIR, 'audit.log');
const EMAIL_LOG = path.join(LOGS_DIR, 'emails.log');

async function ensureLogsDir() {
  await fs.mkdir(LOGS_DIR, { recursive: true });
}

async function writeLog(filePath, message) {
  try {
    await ensureLogsDir();
    const timestamp = new Date().toISOString();
    const formatted = `[${timestamp}] ${message}\n`;
    await fs.appendFile(filePath, formatted, 'utf8');
  } catch (err) {
    console.error(`Failed to write to log file: ${filePath}`, err);
  }
}

// Log a security event
async function logSecurity(action, usernameOrId, details, ip = '127.0.0.1') {
  const msg = `[${action}] [User: ${usernameOrId || 'N/A'}] [IP: ${ip}] - ${details}`;
  console.log(`[SECURITY] ${msg}`);
  await writeLog(SECURITY_LOG, msg);
}

// Log general app/audit event
async function logAudit(action, usernameOrId, details) {
  const msg = `[${action}] [User: ${usernameOrId || 'N/A'}] - ${details}`;
  console.log(`[AUDIT] ${msg}`);
  await writeLog(AUDIT_LOG, msg);
}

// Mock mail logging for verification/reset tokens
async function logMail(to, subject, content) {
  const msg = `TO: ${to}\nSUBJECT: ${subject}\nCONTENT:\n${content}\n----------------------------------------`;
  console.log(`[MOCK EMAIL SENT to ${to}] Subject: ${subject}`);
  await writeLog(EMAIL_LOG, msg);
}

module.exports = {
  logSecurity,
  logAudit,
  logMail
};
