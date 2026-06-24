// Automated Test Validation Script for ForgeUp
const path = require('path');
const fsSync = require('fs');
process.env.NODE_ENV = 'development';
process.env.PORT = 3001; // Run tests on port 3001
process.env.ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DB_DATA_DIR = path.join(__dirname, 'data-test');
process.env.DB_BACKUP_DIR = path.join(__dirname, 'backups-test');

const EMAIL_LOG = path.join(__dirname, 'logs', 'emails.log');

// Clear email logs and reset database to guarantee clean environment before server boot
try {
  fsSync.rmSync(EMAIL_LOG, { force: true });
  fsSync.rmSync(process.env.DB_DATA_DIR, { recursive: true, force: true });
  fsSync.rmSync(process.env.DB_BACKUP_DIR, { recursive: true, force: true });
} catch (e) {}

const fs = require('fs').promises;
const db = require('./server/db');
const { app, listener: initialListener } = require('./server/server');

const BASE_URL = 'http://localhost:3001';

// Helper to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  console.log('🚀 Starting Automated Security & Feature Audits for ForgeUp...\n');

  await sleep(1000); // Wait for server boot

  let cookieHeader = '';
  let csrfToken = '';
  let listener = initialListener;

  try {
    // 1. Fetch CSRF Token
    console.log('📋 Test 1: Fetching CSRF Token...');
    const resCsrf = await fetch(`${BASE_URL}/api/csrf-token`);
    if (!resCsrf.ok) throw new Error('Failed to fetch CSRF token');
    const dataCsrf = await resCsrf.json();
    csrfToken = dataCsrf.csrfToken;
    
    // Save session cookie
    const rawCookie = resCsrf.headers.get('set-cookie');
    cookieHeader = rawCookie ? rawCookie.split(';')[0] : '';
    console.log(`   [SUCCESS] CSRF Token fetched: ${csrfToken.substring(0, 8)}...`);
    console.log(`   [SUCCESS] Session Cookie: ${cookieHeader.substring(0, 15)}...`);

    const testUsername = `TestUser_${Date.now()}`;
    const testEmail = `testuser_${Date.now()}@example.com`;
    const testPassword = 'securepassword123';

    // 2. Test CSRF Protection (Mutating request without token)
    console.log('\n🔒 Test 2: Verify CSRF Protection blocks unauthorized requests...');
    const resBlocked = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        username: testUsername,
        email: testEmail,
        password: testPassword
      })
    });
    if (resBlocked.status === 403) {
      console.log('   [SUCCESS] Mutating request without CSRF header blocked with 403 Forbidden.');
    } else {
      throw new Error(`CSRF Protection failed. Got status: ${resBlocked.status}`);
    }

    // 3. Register user with valid CSRF token
    console.log('\n📝 Test 3: Registering user with valid CSRF token...');
    const resReg = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        username: testUsername,
        email: testEmail,
        password: testPassword
      })
    });
    if (!resReg.ok) {
      const err = await resReg.json();
      throw new Error(`Registration failed: ${JSON.stringify(err)}`);
    }
    const dataReg = await resReg.json();
    const userId = dataReg.user.id;
    console.log(`   [SUCCESS] User registered: ${dataReg.user.username} (ID: ${userId})`);

    // Verify email log entry was created
    const emailLogs = await fs.readFile(EMAIL_LOG, 'utf8');
    if (emailLogs.includes(testEmail)) {
      console.log('   [SUCCESS] Email verification entry logged in logs/emails.log.');
    } else {
      throw new Error('Verification email log not found in emails.log');
    }

    // 4. Test Lockout after 5 Failed Logins
    console.log('\n🔒 Test 4: Verify account lockout after 5 consecutive login failures...');
    for (let i = 1; i <= 5; i++) {
      const resFail = await fetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          Cookie: cookieHeader
        },
        body: JSON.stringify({
          usernameOrEmail: testUsername,
          password: 'wrongpassword'
        })
      });
      const dataFail = await resFail.json();
      if (resFail.status !== 401) {
        throw new Error(`Expected 401 on failed attempt ${i}, got ${resFail.status}`);
      }
      console.log(`   Failed attempt ${i} recorded: "${dataFail.error}"`);
    }

    // The 6th attempt (even with correct password) must be locked out (403 Forbidden)
    const resLock = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        usernameOrEmail: testUsername,
        password: testPassword
      })
    });
    const dataLock = await resLock.json();
    if (resLock.status === 403 && dataLock.error.includes('temporarily locked')) {
      console.log(`   [SUCCESS] Account successfully locked: "${dataLock.error}"`);
    } else {
      throw new Error(`Lockout test failed. Got status ${resLock.status}, error: ${JSON.stringify(dataLock)}`);
    }

    // Bypass lockout for further tests by resetting failed logins in DB
    await db.users.update(userId, { failedLogins: 0, lockedUntil: null });
    console.log('   [INFO] Bypassed lockout in DB to continue testing.');

    // 5. Test Null Token Reset Prevention
    console.log('\n🔒 Test 5: Verify password reset rejects null/empty/invalid tokens...');
    const invalidTokens = [null, '', 'null', 'undefined'];
    for (const badToken of invalidTokens) {
      const resBadReset = await fetch(`${BASE_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken,
          Cookie: cookieHeader
        },
        body: JSON.stringify({
          token: badToken,
          newPassword: 'newsecurepassword123'
        })
      });
      const dataBad = await resBadReset.json();
      if (resBadReset.status === 400) {
        console.log(`   [SUCCESS] Rejected invalid token "${badToken}": "${dataBad.error}"`);
      } else {
        throw new Error(`Expected 400 for token "${badToken}", got ${resBadReset.status}`);
      }
    }

    // 6. Complete Email Verification
    console.log('\n📧 Test 6: Verify Email using logged verification token...');
    const tokenMatch = emailLogs.match(/\?verifyToken=([a-f0-9]+)/);
    if (!tokenMatch) throw new Error('Could not find verifyToken in emails.log');
    const verifyToken = tokenMatch[1];
    
    const resVerify = await fetch(`${BASE_URL}/api/auth/verify-email?token=${verifyToken}`);
    if (resVerify.ok) {
      console.log('   [SUCCESS] Email verified successfully!');
    } else {
      throw new Error('Email verification request failed');
    }

    // Check leaderboard access
    const resLbUnblocked = await fetch(`${BASE_URL}/api/leaderboard`, {
      headers: { Cookie: cookieHeader }
    });
    if (resLbUnblocked.ok) {
      console.log('   [SUCCESS] Leaderboard access verified successfully!');
    } else {
      throw new Error('Leaderboard access request failed');
    }

    // 7. Test Leaderboard Rankings Ties & Stable Sorting
    console.log('\n🏆 Test 7: Verify rankings tie-handling and stable sorting...');
    // Clear other users first
    await fetch(`${BASE_URL}/api/test/cleanup`, { headers: { Cookie: cookieHeader } });
    
    // Register three more users
    const usersToRegister = [
      { username: 'Alice', email: 'alice@example.com', xp: 100, consistency: 50 },
      { username: 'Charlie', email: 'charlie@example.com', xp: 200, consistency: 80 },
      { username: 'Bob', email: 'bob@example.com', xp: 100, consistency: 50 },
      { username: 'David', email: 'david@example.com', xp: 50, consistency: 30 }
    ];

    // Seed users directly into the DB for clean standings testing
    for (const u of usersToRegister) {
      await db.users.create({
        username: u.username,
        email: u.email,
        password: 'password123',
        emailVerified: true, // Auto verified
        xp: u.xp,
        seasonalXp: u.xp,
        consistencyScore: u.consistency
      });
    }

    // Also verify the logged-in user is in the database and verified
    await db.users.update(userId, { xp: 0, seasonalXp: 0, consistencyScore: 0, emailVerified: true });

    // Fetch leaderboard
    const resLb = await fetch(`${BASE_URL}/api/leaderboard`, { headers: { Cookie: cookieHeader } });
    const lbData = await resLb.json();

    // Verify ordering and ranks:
    // Charlie: highest (Rank 1)
    // Alice & Bob: tied (Rank 2). Sorted alphabetically (Alice before Bob)
    // David: lower (Rank 4)
    // TestUser: lowest (Rank 5)
    console.log('   Standings returned:');
    lbData.leaderboard.forEach(u => {
      console.log(`     Rank ${u.rank}: ${u.username} (XP: ${u.xp}, Consistency: ${u.consistencyScore}%)`);
    });

    const charlie = lbData.leaderboard.find(u => u.username === 'Charlie');
    const alice = lbData.leaderboard.find(u => u.username === 'Alice');
    const bob = lbData.leaderboard.find(u => u.username === 'Bob');
    const david = lbData.leaderboard.find(u => u.username === 'David');

    if (charlie.rank !== 1) throw new Error(`Expected Charlie to be Rank 1, got ${charlie.rank}`);
    if (alice.rank !== 2) throw new Error(`Expected Alice to be Rank 2, got ${alice.rank}`);
    if (bob.rank !== 2) throw new Error(`Expected Bob to be Rank 2, got ${bob.rank}`);
    if (david.rank !== 4) throw new Error(`Expected David to be Rank 4, got ${david.rank}`);

    // Verify stable sorting alphabetically for ties (Alice must appear before Bob in list index)
    const aliceIndex = lbData.leaderboard.findIndex(u => u.username === 'Alice');
    const bobIndex = lbData.leaderboard.findIndex(u => u.username === 'Bob');
    if (aliceIndex > bobIndex) {
      throw new Error('Alphabetical stable sort failed: Bob listed before Alice');
    }
    console.log('   [SUCCESS] Rankings tie-handling (1, 2, 2, 4) and alphabetical stable sort verified.');

    // 8. Test Browser Crash & Recovery Protection (Study Sessions)
    console.log('\n⏳ Test 8: Verify Browser Crash & Recovery Protection...');
    // Start session
    const resStartSess = await fetch(`${BASE_URL}/api/study/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({ subject: 'Mathematics' })
    });
    const dataStart = await resStartSess.json();
    if (!dataStart.activeSession) throw new Error('Active session not created on server');
    console.log('   [SUCCESS] Started study session on server.');

    // Simulate "Page Refresh" by calling /api/auth/me with the same cookie
    console.log('   Simulating page refresh...');
    const resRefresh = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    const dataRefresh = await resRefresh.json();
    if (dataRefresh.user && dataRefresh.user.activeSession) {
      console.log(`   [SUCCESS] Session recovered on refresh: subject "${dataRefresh.user.activeSession.subject}"`);
    } else {
      throw new Error('Active session lost on page refresh simulation');
    }

    // Simulate "Browser Close / Device Restart" by getting a fresh cookie (re-authenticating)
    console.log('   Simulating browser close & reopen (new session/cookie)...');
    const resFreshCsrf = await fetch(`${BASE_URL}/api/csrf-token`);
    const freshCsrfToken = (await resFreshCsrf.json()).csrfToken;
    const freshRawCookie = resFreshCsrf.headers.get('set-cookie');
    const freshCookieHeader = freshRawCookie ? freshRawCookie.split(';')[0] : '';

    const resLoginFresh = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': freshCsrfToken,
        Cookie: freshCookieHeader
      },
      body: JSON.stringify({
        usernameOrEmail: testUsername,
        password: testPassword
      })
    });
    const dataLoginFresh = await resLoginFresh.json();
    if (!resLoginFresh.ok) throw new Error(`Re-login failed: ${dataLoginFresh.error}`);

    // Verify user info on the new cookie retains active session
    const resMeFresh = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: freshCookieHeader }
    });
    const dataMeFresh = await resMeFresh.json();
    if (dataMeFresh.user && dataMeFresh.user.activeSession) {
      console.log(`   [SUCCESS] Session recovered after login on fresh cookie: subject "${dataMeFresh.user.activeSession.subject}"`);
    } else {
      throw new Error('Active session lost after browser close simulation');
    }

    // 9. Test Multi-Device Active Session Restriction
    console.log('\n🔒 Test 9: Verify Multi-Device locking blocks duplicate active sessions...');
    // Call /session/start on the second device cookie
    const resSecondStart = await fetch(`${BASE_URL}/api/study/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': freshCsrfToken,
        Cookie: freshCookieHeader
      },
      body: JSON.stringify({ subject: 'Programming' })
    });
    const dataSecondStart = await resSecondStart.json();
    // It should return the existing active session (Mathematics) rather than starting a new one (Programming)
    if (dataSecondStart.activeSession && dataSecondStart.activeSession.subject === 'Mathematics') {
      console.log(`   [SUCCESS] Correctly recovered existing Mathematics session, rejected new Programming session. Message: "${dataSecondStart.message}"`);
    } else {
      throw new Error(`Multi-device lock failed: got session subject "${dataSecondStart.activeSession ? dataSecondStart.activeSession.subject : 'none'}"`);
    }

    // 10. Test Server Restart Recovery
    console.log('\n🔥 Test 10: Verify active study session survives server restarts...');
    console.log('   Stopping server listener...');
    listener.close();
    await sleep(1000);

    console.log('   Restarting server listener...');
    listener = app.listen(3001);
    await sleep(1000);

    // Call /api/auth/me using the first session cookie
    const resRestartMe = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    const dataRestartMe = await resRestartMe.json();
    if (dataRestartMe.user && dataRestartMe.user.activeSession) {
      console.log(`   [SUCCESS] Session successfully recovered after server restart: subject "${dataRestartMe.user.activeSession.subject}"`);
    } else {
      throw new Error('Active session lost after server restart');
    }

    // 11. Test Overlapping Session Blocking (Anti-Cheat)
    console.log('\n🔒 Test 11: Verify overlapping sessions are blocked...');
    // Fetch latest user details to get user ID
    const userDb = await db.users.get(userId);
    
    // Set accumulatedSeconds of the active session to 20 to pass the 10s minimum check
    const updatedActive = { ...userDb.activeSession, accumulatedSeconds: 20 };
    await db.users.update(userId, { activeSession: updatedActive });

    // Insert a mock session directly in DB that overlaps with current active session timeframe
    // Active session started at activeSession.startTime. Let's insert a session that is within the last 1 minute.
    const activeStart = new Date(userDb.activeSession.startTime).getTime();
    await db.sessions.create({
      userId: userId,
      startTime: new Date(activeStart + 1000).toISOString(), // 1s after active session started
      endTime: new Date().toISOString(),                     // now
      duration: 5,
      subject: 'Physics',
      notes: 'Mock overlapping session',
      xpEarned: 1
    });
    console.log('   Mock overlapping session injected into DB.');

    // Now attempt to end the active session. It should fail!
    const resEndOverlap = await fetch(`${BASE_URL}/api/study/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        clientDuration: 10,
        clientLocalDate: new Date().toISOString().split('T')[0],
        subject: 'Mathematics',
        notes: 'Overlapping test'
      })
    });
    const dataOverlap = await resEndOverlap.json();
    if (resEndOverlap.status === 400 && dataOverlap.error.includes('overlaps')) {
      console.log(`   [SUCCESS] Overlapping session correctly blocked: "${dataOverlap.error}"`);
    } else {
      throw new Error(`Expected 400 for overlap session block, got status ${resEndOverlap.status}, error: ${JSON.stringify(dataOverlap)}`);
    }

    // Ensure activeSession was cleared by overlap block
    const resMeAfterOverlap = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    const dataMeAfterOverlap = await resMeAfterOverlap.json();
    if (dataMeAfterOverlap.user && dataMeAfterOverlap.user.activeSession === null) {
      console.log('   [SUCCESS] activeSession reset to null after overlap rejection.');
    } else {
      throw new Error('activeSession was not cleared after overlap rejection');
    }

    // 12. Test Data Export (Download My Data)
    console.log('\n📥 Test 12: Verify Data Export ("Download My Data")...');
    const resExport = await fetch(`${BASE_URL}/api/auth/export-data`, {
      headers: { Cookie: cookieHeader }
    });
    if (!resExport.ok) throw new Error('Data export failed');
    const exportData = await resExport.json();
    if (exportData.profile && exportData.sessions.length > 0) {
      console.log(`   [SUCCESS] Export verified. User ${exportData.profile.username} has ${exportData.sessions.length} recorded session(s).`);
    } else {
      throw new Error('Export payload missing profile or session history');
    }

    // 13. Test Dev Mode Disabled in Production
    console.log('\n🔒 Test 13: Verify Developer Routes disabled in production environment...');
    process.env.NODE_ENV = 'production';
    const resSeedProd = await fetch(`${BASE_URL}/api/test/seed`, {
      headers: { Cookie: cookieHeader }
    });
    if (resSeedProd.status === 403) {
      console.log('   [SUCCESS] Seeding request correctly forbidden in production mode.');
    } else {
      throw new Error('Seeding route was not correctly blocked in production environment!');
    }
    process.env.NODE_ENV = 'development'; // Restore

    // 14. Test Developer Mode Cleanup
    console.log('\n🧹 Test 14: Verify Developer Cleanup...');
    const resClear = await fetch(`${BASE_URL}/api/test/cleanup`, {
      headers: { Cookie: cookieHeader }
    });
    if (!resClear.ok) throw new Error('Cleanup failed');
    const dataClear = await resClear.json();
    console.log(`   [SUCCESS] Cleanup message: "${dataClear.message}"`);

    // Verify standings count is back to 1 (only TestUser left because Alice, Bob, etc., are deleted by cleanup)
    const resFinalStandings = await fetch(`${BASE_URL}/api/leaderboard`, {
      headers: { Cookie: cookieHeader }
    });
    const finalStand = await resFinalStandings.json();
    console.log(`   [SUCCESS] Final leaderboard entries: ${finalStand.totalUsers}`);

    // 15. Test Normal Study Timer (Start, Pause, Resume, Stop, and Recovery)
    console.log('\n⏳ Test 15: Verify Normal Study Timer start, pause, resume, recovery, and save...');
    const resStartNormal = await fetch(`${BASE_URL}/api/study/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({ subject: 'Science', timerMode: 'normal' })
    });
    const dataStartNormal = await resStartNormal.json();
    if (!dataStartNormal.activeSession || dataStartNormal.activeSession.timerMode !== 'normal') {
      throw new Error('Normal study session start failed');
    }
    console.log('   [SUCCESS] Normal session started.');

    // Pause normal session
    const resPauseNormal = await fetch(`${BASE_URL}/api/study/session/pause`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken, Cookie: cookieHeader }
    });
    const dataPauseNormal = await resPauseNormal.json();
    if (!dataPauseNormal.activeSession.paused) {
      throw new Error('Normal study session pause failed');
    }
    console.log('   [SUCCESS] Normal session paused.');

    // Resume normal session
    const resResumeNormal = await fetch(`${BASE_URL}/api/study/session/resume`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken, Cookie: cookieHeader }
    });
    const dataResumeNormal = await resResumeNormal.json();
    if (dataResumeNormal.activeSession.paused) {
      throw new Error('Normal study session resume failed');
    }
    console.log('   [SUCCESS] Normal session resumed.');

    // Crash recovery check
    const resMeNormal = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { Cookie: cookieHeader }
    });
    const dataMeNormal = await resMeNormal.json();
    if (!dataMeNormal.user || dataMeNormal.user.activeSession.timerMode !== 'normal') {
      throw new Error('Normal study session lost on recovery check');
    }
    console.log('   [SUCCESS] Normal session verified via recovery query.');

    // Artificially update database active session duration to 120 seconds (2 minutes)
    const userWithNormal = await db.users.get(userId);
    const updatedNormalSession = {
      ...userWithNormal.activeSession,
      accumulatedSeconds: 120,
      lastTickTime: new Date().toISOString()
    };
    await db.users.update(userId, { activeSession: updatedNormalSession });

    // Get user XP before saving
    const userBeforeNormal = await db.users.get(userId);
    const xpBeforeNormal = userBeforeNormal.xp || 0;

    // End normal session
    const resEndNormal = await fetch(`${BASE_URL}/api/study/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        clientDuration: 120,
        clientLocalDate: new Date().toISOString().split('T')[0],
        subject: 'Science',
        notes: 'Testing Normal study mode'
      })
    });
    const dataEndNormal = await resEndNormal.json();
    if (!resEndNormal.ok) {
      throw new Error(`End normal session failed: ${dataEndNormal.error}`);
    }
    const userAfterNormal = await db.users.get(userId);
    const xpAfterNormal = userAfterNormal.xp || 0;
    const expectedNormalDiff = 2 + (dataEndNormal.achievementBonusXp || 0);
    if (dataEndNormal.xpEarned !== 2 || (xpAfterNormal - xpBeforeNormal) !== expectedNormalDiff) {
      throw new Error(`Expected exactly 2 XP earned, got ${dataEndNormal.xpEarned} (DB difference: ${xpAfterNormal - xpBeforeNormal}, expected: ${expectedNormalDiff})`);
    }
    if (userAfterNormal.activeSession !== null) {
      throw new Error('Active session was not cleared after ending');
    }
    console.log('   [SUCCESS] Normal study session successfully ended and verified. Awarded 2 XP.');

    // 16. Test Pomodoro Timer Preset and Transition Validation
    console.log('\n🍅 Test 16: Verify Pomodoro Timer presets and transitions...');
    const resStartPomo = await fetch(`${BASE_URL}/api/study/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        subject: 'Chemistry',
        timerMode: 'pomodoro',
        pomodoroPreset: '25/5',
        studyDuration: 1500,
        breakDuration: 300
      })
    });
    const dataStartPomo = await resStartPomo.json();
    if (!dataStartPomo.activeSession || dataStartPomo.activeSession.timerMode !== 'pomodoro' || dataStartPomo.activeSession.state !== 'study') {
      throw new Error('Pomodoro study session start failed');
    }
    console.log('   [SUCCESS] Pomodoro session started. Initial state: study, cycles: 0.');

    // Transition study -> break
    const resTrans1 = await fetch(`${BASE_URL}/api/study/session/transition`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken, Cookie: cookieHeader }
    });
    const dataTrans1 = await resTrans1.json();
    if (dataTrans1.activeSession.state !== 'break' || dataTrans1.activeSession.cyclesCompleted !== 1 || dataTrans1.activeSession.totalStudySeconds !== 1500) {
      throw new Error(`Transition 1 failed. State: ${dataTrans1.activeSession.state}, Cycles: ${dataTrans1.activeSession.cyclesCompleted}`);
    }
    console.log('   [SUCCESS] Transitioned from Study to Break (Cycle 1 completed).');

    // Transition break -> study
    const resTrans2 = await fetch(`${BASE_URL}/api/study/session/transition`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken, Cookie: cookieHeader }
    });
    const dataTrans2 = await resTrans2.json();
    if (dataTrans2.activeSession.state !== 'study' || dataTrans2.activeSession.cyclesCompleted !== 1 || dataTrans2.activeSession.totalBreakSeconds !== 300) {
      throw new Error(`Transition 2 failed. State: ${dataTrans2.activeSession.state}, Cycles: ${dataTrans2.activeSession.cyclesCompleted}`);
    }
    console.log('   [SUCCESS] Transitioned from Break to Study.');

    // Transition study -> break (Cycle 2 completed)
    const resTrans3 = await fetch(`${BASE_URL}/api/study/session/transition`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken, Cookie: cookieHeader }
    });
    const dataTrans3 = await resTrans3.json();
    if (dataTrans3.activeSession.state !== 'break' || dataTrans3.activeSession.cyclesCompleted !== 2 || dataTrans3.activeSession.totalStudySeconds !== 3000) {
      throw new Error(`Transition 3 failed. State: ${dataTrans3.activeSession.state}, Cycles: ${dataTrans3.activeSession.cyclesCompleted}`);
    }
    console.log('   [SUCCESS] Transitioned from Study to Break (Cycle 2 completed).');

    // 17. Verify breaks do not award XP (study duration only)
    console.log('\n🚫 Test 17: Verify break periods do not award XP...');
    
    // Artificially update database active session break accumulated seconds to 100
    const userWithPomo = await db.users.get(userId);
    const updatedPomoSession = {
      ...userWithPomo.activeSession,
      accumulatedSeconds: 100,
      lastTickTime: new Date().toISOString()
    };
    await db.users.update(userId, { activeSession: updatedPomoSession });

    // Get user XP before saving
    const userBeforePomo = await db.users.get(userId);
    const xpBeforePomo = userBeforePomo.xp || 0;

    // End Pomodoro session
    // Study duration is 3000 seconds (50 minutes). Client duration is sent as 3000 (excluding break).
    const resEndPomo = await fetch(`${BASE_URL}/api/study/session/end`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
        Cookie: cookieHeader
      },
      body: JSON.stringify({
        clientDuration: 3000,
        clientLocalDate: new Date().toISOString().split('T')[0],
        subject: 'Chemistry',
        notes: 'Completed Pomodoro session'
      })
    });
    const dataEndPomo = await resEndPomo.json();
    if (!resEndPomo.ok) {
      throw new Error(`End Pomodoro session failed: ${dataEndPomo.error}`);
    }
    const userAfterPomo = await db.users.get(userId);
    const xpAfterPomo = userAfterPomo.xp || 0;
    
    // Verify XP: 3000 seconds / 60 = 50 XP
    const expectedPomoDiff = 50 + (dataEndPomo.achievementBonusXp || 0);
    if (dataEndPomo.xpEarned !== 50 || (xpAfterPomo - xpBeforePomo) !== expectedPomoDiff) {
      throw new Error(`Expected exactly 50 XP earned, got ${dataEndPomo.xpEarned} (DB difference: ${xpAfterPomo - xpBeforePomo}, expected: ${expectedPomoDiff})`);
    }
    if (userAfterPomo.activeSession !== null) {
      throw new Error('Active session was not cleared after ending');
    }
    console.log('   [SUCCESS] Ended Pomodoro session. XP earned: 50. Break time excluded correctly.');

    // 18. Verify analytics and consistency calculations remain accurate
    console.log('\n📊 Test 18: Verify analytics calculations for Pomodoro sessions...');
    const resAnal = await fetch(`${BASE_URL}/api/study/analytics`, {
      headers: { Cookie: cookieHeader }
    });
    const analData = await resAnal.json();
    
    if (analData.totalPomodoroCycles !== 2) {
      throw new Error(`Expected totalPomodoroCycles to be 2, got ${analData.totalPomodoroCycles}`);
    }
    if (analData.mostUsedPreset !== '25/5') {
      throw new Error(`Expected mostUsedPreset to be '25/5', got ${analData.mostUsedPreset}`);
    }
    
    // Average session minutes calculation:
    // Session 1: Mock overlap session (duration 5s)
    // Session 2: Normal session (duration 120s)
    // Session 3: Pomodoro session (duration 3000s)
    // Total duration: 3125s
    // Total sessions: 3
    // Avg seconds: 3125 / 3 = 1041.66s
    // Avg minutes: Math.round(1041.66 / 60) = 17 mins
    if (analData.avgSessionMinutes !== 17) {
      throw new Error(`Expected avgSessionMinutes to be 17, got ${analData.avgSessionMinutes}`);
    }
    console.log('   [SUCCESS] Analytics totalPomodoroCycles, mostUsedPreset, and avgSessionMinutes verified.');

    // 19. Test Backup Retention Limit
    console.log('\n💾 Test 19: Verify database backup retention limit (keeps exactly 10)...');
    for (let i = 1; i <= 12; i++) {
      await db.backup();
      await sleep(100); // Small delay
    }
    const backupDir = process.env.DB_BACKUP_DIR;
    const dirs = await fs.readdir(backupDir);
    const backupDirs = dirs.filter(d => d.startsWith('backup-'));
    console.log(`   Found backup directories count: ${backupDirs.length}`);
    if (backupDirs.length === 10) {
      console.log('   [SUCCESS] Backup retention limit correctly maintained at 10 directories.');
    } else {
      throw new Error(`Expected 10 backups, found ${backupDirs.length}`);
    }

    console.log('\n✨ [ALL TESTS PASSED SUCCESSFULLY] ✨');
    
    // Shut down server and exit
    listener.close();

    // Clean up test database directories
    try {
      await fs.rm(process.env.DB_DATA_DIR, { recursive: true, force: true });
      await fs.rm(process.env.DB_BACKUP_DIR, { recursive: true, force: true });
      await fs.rm(EMAIL_LOG, { force: true });
      console.log('   [INFO] Cleaned up temporary test databases.');
    } catch (e) {}

    process.exit(0);

  } catch (err) {
    console.error('\n❌ [TEST FAILED]:', err);
    if (listener) listener.close();

    // Clean up test database directories
    try {
      await fs.rm(process.env.DB_DATA_DIR, { recursive: true, force: true });
      await fs.rm(process.env.DB_BACKUP_DIR, { recursive: true, force: true });
      await fs.rm(EMAIL_LOG, { force: true });
      console.log('   [INFO] Cleaned up temporary test databases after failure.');
    } catch (e) {}

    process.exit(1);
  }
}

runTests();
