const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { logSecurity, logAudit, logMail } = require('../auditLogger');
const { syncUserActiveSession } = require('../sessionSynchronizer');

const router = express.Router();

// Helper to check if user is authenticated
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// GET /api/auth/me
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  let user = await db.users.get(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.json({ user: null });
  }
  
  // Catch up Pomodoro active sessions if any
  user = await syncUserActiveSession(user);
  
  const { password, emailVerificationToken, passwordResetToken, ...safeUser } = user;
  res.json({ user: safeUser });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password are required' });
  }

  // Simple validation
  if (username.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    const existing = await db.users.getByUsernameOrEmail(username);
    const existingEmail = await db.users.getByUsernameOrEmail(email);
    if (existing || existingEmail) {
      return res.status(400).json({ error: 'Username or email already registered' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await db.users.create({
      username,
      email,
      password: hashedPassword,
      settings: {
        profilePublic: true,
        notificationsEnabled: true
      }
    });

    // Write verification token mail to email.log
    const verifyUrl = `${req.protocol}://${req.get('host')}/?verifyToken=${newUser.emailVerificationToken}`;
    await logMail(
      newUser.email,
      'Verify Your ForgeUp Account',
      `Welcome to ForgeUp, ${newUser.username}!\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nThis link will expire in 1 hour.`
    );

    await logAudit('REGISTER', newUser.id, `User registered successfully with email ${newUser.email}`);
    
    // Log them in immediately after register
    req.session.userId = newUser.id;
    const { password: _, emailVerificationToken: __, ...safeUser } = newUser;
    
    res.status(201).json({ user: safeUser, message: 'Registration successful! Verification email sent.' });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { usernameOrEmail, password } = req.body;

  if (!usernameOrEmail || !password) {
    return res.status(400).json({ error: 'Username/email and password are required' });
  }

  try {
    const user = await db.users.getByUsernameOrEmail(usernameOrEmail);
    if (!user) {
      await logSecurity('LOGIN_FAILED', null, `Failed login attempt for unknown user: ${usernameOrEmail}`, req.ip);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account lockout
    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      const minutesLeft = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      await logSecurity('LOGIN_LOCKED', user.id, `Attempt to log into locked account for user: ${user.username}`, req.ip);
      return res.status(403).json({ error: `Account is temporarily locked. Try again in ${minutesLeft} minutes.` });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // Increment failed logins
      const failed = (user.failedLogins || 0) + 1;
      let updateData = { failedLogins: failed };
      
      if (failed >= 5) {
        updateData.lockedUntil = Date.now() + 10 * 60 * 1000; // 10 minute lock
        updateData.failedLogins = 0; // Reset
        await logSecurity('ACCOUNT_LOCKED', user.id, `User ${user.username} locked due to 5 consecutive login failures`, req.ip);
      } else {
        await logSecurity('LOGIN_FAILED', user.id, `Failed password for user: ${user.username} (Attempt ${failed}/5)`, req.ip);
      }

      await db.users.update(user.id, updateData);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Success login
    await db.users.update(user.id, {
      failedLogins: 0,
      lockedUntil: null
    });

    req.session.userId = user.id;
    await logAudit('LOGIN', user.id, `User logged in successfully`, req.ip);

    const { password: _, emailVerificationToken: __, passwordResetToken: ___, ...safeUser } = user;
    res.json({ user: safeUser, message: 'Logged in successfully' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  req.session.destroy(async (err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('forgeup.sid');
    await logAudit('LOGOUT', userId, 'User logged out');
    res.json({ message: 'Logged out successfully' });
  });
});

// POST /api/auth/change-password
router.post('/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  try {
    const user = await db.users.get(req.session.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      await logSecurity('PASSWORD_CHANGE_FAIL', user.id, 'Failed password change: current password incorrect', req.ip);
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.users.update(user.id, { password: hashedPassword });
    await logAudit('PASSWORD_CHANGE_SUCCESS', user.id, 'User changed password successfully');

    res.json({ message: 'Password changed successfully' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/verify-email (Handles clicking link from email log)
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.trim() === '' || token === 'null' || token === 'undefined') {
    return res.status(400).send('<h1>Invalid Verification Token</h1><p>The verification link is invalid or malformed.</p>');
  }

  try {
    const users = await db.users.list();
    const rawUser = users.find(u => u.emailVerificationToken === token);

    if (!rawUser) {
      return res.status(400).json({ error: 'Invalid verification token' });
    }

    if (rawUser.emailVerificationExpires < Date.now()) {
      return res.status(400).json({ error: 'Verification token has expired. Please request a new one.' });
    }

    await db.users.update(rawUser.id, {
      emailVerified: true,
      emailVerificationToken: null,
      emailVerificationExpires: null
    });

    await logAudit('EMAIL_VERIFIED', rawUser.id, 'Email verification completed');
    res.send('<h1>Email Verified!</h1><p>Your email has been successfully verified. You can now close this tab and return to ForgeUp.</p><script>setTimeout(() => { window.location.href = "/"; }, 3000);</script>');
  } catch (err) {
    console.error('Email verification error:', err);
    res.status(500).json({ error: 'Server error during email verification' });
  }
});

// POST /api/auth/resend-verification
router.post('/resend-verification', requireAuth, async (req, res) => {
  try {
    const user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.emailVerified) return res.status(400).json({ error: 'Email already verified' });

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hr

    await db.users.update(user.id, {
      emailVerificationToken: token,
      emailVerificationExpires: expires
    });

    const verifyUrl = `${req.protocol}://${req.get('host')}/api/auth/verify-email?token=${token}`;
    await logMail(
      user.email,
      'Verify Your ForgeUp Account',
      `Hello ${user.username},\n\nPlease verify your email by clicking the link below:\n${verifyUrl}\n\nThis link will expire in 1 hour.`
    );

    res.json({ message: 'Verification link sent to email!' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email address is required' });

  try {
    const user = await db.users.getByUsernameOrEmail(email);
    if (!user) {
      // Return 200 even if email doesn't exist for security (so we don't disclose registered emails)
      return res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 3600000; // 1 hour

    await db.users.update(user.id, {
      passwordResetToken: token,
      passwordResetExpires: expires
    });

    const resetUrl = `${req.protocol}://${req.get('host')}/?resetToken=${token}`;
    await logMail(
      user.email,
      'Reset Your ForgeUp Password',
      `Hello ${user.username},\n\nYou requested a password reset. Reset your password by clicking the link below:\n${resetUrl}\n\nIf you did not request this, please ignore this email.`
    );

    res.json({ message: 'If an account exists with that email, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || typeof token !== 'string' || token.trim() === '' || token === 'null' || token === 'undefined' || !newPassword) {
    return res.status(400).json({ error: 'Valid token and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    const users = await db.users.list();
    const rawUser = users.find(u => u.passwordResetToken === token);

    if (!rawUser) {
      return res.status(400).json({ error: 'Invalid password reset token' });
    }

    if (rawUser.passwordResetExpires < Date.now()) {
      return res.status(400).json({ error: 'Password reset token has expired' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await db.users.update(rawUser.id, {
      password: hashedPassword,
      passwordResetToken: null,
      passwordResetExpires: null
    });

    await logAudit('PASSWORD_RESET', rawUser.id, 'User password reset via token');
    res.json({ message: 'Password reset successfully! You can now log in.' });
  } catch (err) {
    console.error('Password reset error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/auth/export-data (Download My Data)
router.get('/export-data', requireAuth, async (req, res) => {
  try {
    const user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const sessions = await db.sessions.listByUser(user.id);
    const goals = await db.goals.listByUser(user.id);

    const exportPayload = {
      exportedAt: new Date().toISOString(),
      profile: {
        username: user.username,
        email: user.email,
        joinDate: user.joinDate,
        level: user.level,
        xp: user.xp,
        seasonalXp: user.seasonalXp,
        currentStreak: user.currentStreak,
        longestStreak: user.longestStreak,
        consistencyScore: user.consistencyScore,
        achievements: user.achievements
      },
      sessions,
      goals
    };

    await logAudit('DATA_EXPORT', user.id, 'User exported all data');
    res.setHeader('Content-disposition', `attachment; filename=forgeup_data_${user.username}.json`);
    res.setHeader('Content-type', 'application/json');
    res.write(JSON.stringify(exportPayload, null, 2), 'utf-8');
    res.end();
  } catch (err) {
    console.error('Data export error:', err);
    res.status(500).json({ error: 'Server error during data export' });
  }
});

// POST /api/auth/delete-account
router.post('/delete-account', requireAuth, async (req, res) => {
  const userId = req.session.userId;
  try {
    const user = await db.users.get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Delete matching sessions, goals, logs and finally the user
    await db.sessions.deleteByUser(userId);
    await db.goals.deleteByUser(userId);
    await db.auditLogs.deleteByUser(userId);
    await db.users.delete(userId);

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({ error: 'Account deleted, but session clear failed' });
      }
      res.clearCookie('forgeup.sid');
      console.log(`[DELETE_ACCOUNT] User ${user.username} deleted permanently`);
      res.json({ message: 'Account and all associated personal data have been permanently deleted.' });
    });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Server error during account deletion' });
  }
});

// POST /api/auth/settings (Change leaderboard privacy or notifications)
router.post('/settings', requireAuth, async (req, res) => {
  const { profilePublic, notificationsEnabled } = req.body;
  
  try {
    const user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newSettings = {
      profilePublic: profilePublic !== undefined ? !!profilePublic : user.settings.profilePublic,
      notificationsEnabled: notificationsEnabled !== undefined ? !!notificationsEnabled : user.settings.notificationsEnabled
    };

    const updated = await db.users.update(user.id, { settings: newSettings });
    res.json({ settings: updated.settings, message: 'Settings updated successfully' });
  } catch (err) {
    console.error('Settings update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
