require('dotenv').config();
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const { logSecurity } = require('./auditLogger');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Initialize DB schedules (backup scheduler)
db.initBackupScheduler();

// Trust first proxy in production (needed for secure cookies behind reverse proxy)
if (isProd) {
  app.set('trust proxy', 1);
}

// 1. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"], // Allow Chart.js and app logic
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://*"],
        connectSrc: ["'self'"],
        "upgrade-insecure-requests": isProd ? [] : null
      }
    },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false
  })
);

// 2. CORS setup
app.use(
  cors({
    origin: true,
    credentials: true
  })
);

// 3. Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 4. Session management with FileStore
const sessionDirectory = process.env.DB_DATA_DIR
  ? path.join(path.resolve(process.env.DB_DATA_DIR), 'sessions')
  : path.join(__dirname, '..', 'sessions');
// Ensure session directory exists recursively
const fsSync = require('fs');
if (!fsSync.existsSync(sessionDirectory)) {
  fsSync.mkdirSync(sessionDirectory, { recursive: true });
}
app.use(
  session({
    store: new FileStore({
      path: sessionDirectory,
      retries: 2,
      ttl: 86400 // 1 day
    }),
    secret: process.env.SESSION_SECRET || 'forgeup-fallback-secret-key-12345',
    name: 'forgeup.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProd, // Secure cookie in production
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    }
  })
);

// 5. CSRF Token Protection Middleware
app.use((req, res, next) => {
  // Generate token if not exists in session
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }

  // Exempt GET, HEAD, OPTIONS from validation
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Get token from headers
  const token = req.headers['x-csrf-token'];
  if (!token || token !== req.session.csrfToken) {
    logSecurity('CSRF_ATTEMPT', req.session.userId || 'Guest', `Blocked mutating request to ${req.path} due to missing or invalid CSRF token`, req.ip);
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }

  next();
});

// CSRF token provider endpoint
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.session.csrfToken });
});

// 6. Rate Limiters
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Limit each IP to 200 requests per window
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 15, // Limit each IP to 15 login/registration/reset requests per window
  message: { error: 'Too many attempts. Please try again in 10 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

// 7. Route Handlers (APIs)
const authRouter = require('./routes/auth');
const studyRouter = require('./routes/study');
const goalsRouter = require('./routes/goals');
const leaderboardRouter = require('./routes/leaderboard');
const devRouter = require('./routes/dev');

app.use('/api/auth', authRouter);
app.use('/api/study', studyRouter);
app.use('/api/goals', goalsRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/test', devRouter);

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Fallback to SPA index.html for unknown routes (to support client routing if any, otherwise standard single page)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Start Server
const listener = app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`ForgeUp Server is running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`========================================`);
});

module.exports = { app, listener };
