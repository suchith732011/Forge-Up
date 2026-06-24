const fs = require('fs').promises;
const path = require('path');
const nodemailer = require('nodemailer');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const SECURITY_LOG = path.join(LOGS_DIR, 'security.log');
const AUDIT_LOG = path.join(LOGS_DIR, 'audit.log');
const EMAIL_LOG = path.join(LOGS_DIR, 'emails.log');

// Configure SMTP transporter if credentials are provided
const smtpConfigured = !!(
  process.env.SMTP_HOST &&
  process.env.SMTP_PORT &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS
);

let transporter = null;
if (smtpConfigured) {
  const isSecure = parseInt(process.env.SMTP_PORT, 10) === 465;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: isSecure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
  console.log(`[SMTP] Nodemailer configured for host: ${process.env.SMTP_HOST}`);
} else {
  console.log('[SMTP] Nodemailer not configured. Falling back to mock email logs.');
}

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

// Log/send mail for verification/reset tokens
async function logMail(to, subject, content) {
  const msg = `TO: ${to}\nSUBJECT: ${subject}\nCONTENT:\n${content}\n----------------------------------------`;
  
  // Always write to email.log to ensure offline/local tests (validate.js) continue to pass
  await writeLog(EMAIL_LOG, msg);

  if (smtpConfigured && transporter) {
    try {
      console.log(`[SMTP] Sending real email to ${to} Subject: "${subject}"...`);
      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"ForgeUp" <no-reply@forgeup.com>',
        to,
        subject,
        text: content,
        html: content.replace(/\n/g, '<br>')
      });
      console.log(`[SMTP] Real email successfully sent to ${to}`);
    } catch (err) {
      console.error(`[SMTP ERROR] Failed to send email to ${to}:`, err);
      await logSecurity('EMAIL_SEND_FAILED', to, `Failed to send real email: ${err.message}`);
    }
  } else {
    console.log(`[MOCK EMAIL SENT to ${to}] Subject: ${subject}`);
  }
}

module.exports = {
  logSecurity,
  logAudit,
  logMail
};

