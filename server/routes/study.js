const express = require('express');
const db = require('../db');
const { logSecurity, logAudit } = require('../auditLogger');
const { syncUserActiveSession } = require('../sessionSynchronizer');

const router = express.Router();

// Helper to check if user is authenticated and email is verified
async function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const user = await db.users.get(req.session.userId);
    if (!user || !user.emailVerified) {
      return res.status(403).json({
        error: 'Email verification required',
        message: 'You must verify your email address to access this feature.'
      });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database verification check failed' });
  }
}

// XP Progression Levels
function getLevelForXp(xp) {
  if (xp < 100) return 1;
  if (xp < 250) return 2;
  if (xp < 500) return 3;
  if (xp < 1000) return 4;
  let level = 4;
  let req = 1000;
  while (xp >= req) {
    level++;
    req += (level - 1) * 500;
  }
  return level;
}

function getXpRequiredForNextLevel(level) {
  if (level === 1) return 100;
  if (level === 2) return 250;
  if (level === 3) return 500;
  if (level === 4) return 1000;
  
  let req = 1000;
  for (let i = 5; i <= level; i++) {
    req += (i - 1) * 500;
  }
  return req;
}

// Consistency Score Calculation (0 - 100)
function calculateConsistencyScore(user, sessions, goals) {
  // 1. Streak Factor (25%): 5 pts per streak day, max 25
  const streakScore = Math.min(25, (user.currentStreak || 0) * 5);

  // 2. Weekly Study Frequency (25%): distinct study days in last 28 days
  const now = new Date();
  const past28Days = new Array(28).fill(0).map((_, i) => {
    const d = new Date();
    d.setDate(now.getDate() - i);
    return d.toISOString().split('T')[0];
  });
  
  const activeDays28 = user.activeDays || [];
  const studiedDaysIn28 = past28Days.filter(day => activeDays28.includes(day)).length;
  const frequencyScore = (studiedDaysIn28 / 28) * 25;

  // 3. Goal Completion Rate (30%): percentage of goals completed in last 30 days
  const past30DaysDate = new Date();
  past30DaysDate.setDate(now.getDate() - 30);
  const recentGoals = goals.filter(g => new Date(g.deadline) >= past30DaysDate);
  let goalScore = 30; // Default if no goals
  if (recentGoals.length > 0) {
    const completed = recentGoals.filter(g => g.completed).length;
    goalScore = (completed / recentGoals.length) * 30;
  }

  // 4. Study Distribution (20%): reward daily consistency over massive study bursts
  // We count the number of days studied in the last 7 days.
  const past7Days = new Array(7).fill(0).map((_, i) => {
    const d = new Date();
    d.setDate(now.getDate() - i);
    return d.toISOString().split('T')[0];
  });
  const studiedDaysIn7 = past7Days.filter(day => activeDays28.includes(day)).length;
  const distributionScore = (studiedDaysIn7 / 7) * 20;

  const total = Math.round(streakScore + frequencyScore + goalScore + distributionScore);
  return Math.min(100, Math.max(0, total));
}

// POST /api/study/session/start
router.post('/session/start', requireAuth, async (req, res) => {
  const { subject, timerMode, pomodoroPreset, studyDuration, breakDuration } = req.body;
  try {
    let user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user = await syncUserActiveSession(user);

    if (user.activeSession) {
      // Return existing active session to sync (multi-tab / crash recovery)
      return res.json({ activeSession: user.activeSession, message: 'Restored active study session.' });
    }

    const mode = timerMode === 'pomodoro' ? 'pomodoro' : 'normal';

    const currentSession = {
      startTime: new Date().toISOString(),
      subject: subject || 'Other',
      paused: false,
      accumulatedSeconds: 0,
      lastTickTime: new Date().toISOString(),
      timerMode: mode
    };

    if (mode === 'pomodoro') {
      currentSession.pomodoroPreset = pomodoroPreset || 'custom';
      currentSession.studyDuration = parseInt(studyDuration, 10) || 1500;
      currentSession.breakDuration = parseInt(breakDuration, 10) || 300;
      currentSession.state = 'study';
      currentSession.totalStudySeconds = 0;
      currentSession.totalBreakSeconds = 0;
      currentSession.cyclesCompleted = 0;
    }

    await db.users.update(user.id, { activeSession: currentSession });
    res.json({ activeSession: currentSession, message: 'Study session started.' });
  } catch (err) {
    console.error('Session start error:', err);
    res.status(500).json({ error: 'Server error starting study session' });
  }
});

// POST /api/study/session/pause
router.post('/session/pause', requireAuth, async (req, res) => {
  try {
    let user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user = await syncUserActiveSession(user);

    const active = user.activeSession;
    if (!active) {
      return res.status(400).json({ error: 'No active study session' });
    }

    if (!active.paused) {
      const elapsedSinceLastTick = (Date.now() - new Date(active.lastTickTime).getTime()) / 1000;
      active.accumulatedSeconds += Math.max(0, elapsedSinceLastTick);
      active.paused = true;
      active.lastTickTime = new Date().toISOString();
      await db.users.update(user.id, { activeSession: active });
    }

    res.json({ activeSession: active, message: 'Study session paused.' });
  } catch (err) {
    console.error('Session pause error:', err);
    res.status(500).json({ error: 'Server error pausing study session' });
  }
});

// POST /api/study/session/resume
router.post('/session/resume', requireAuth, async (req, res) => {
  try {
    let user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user = await syncUserActiveSession(user);

    const active = user.activeSession;
    if (!active) {
      return res.status(400).json({ error: 'No active study session' });
    }

    if (active.paused) {
      active.paused = false;
      active.lastTickTime = new Date().toISOString();
      await db.users.update(user.id, { activeSession: active });
    }

    res.json({ activeSession: active, message: 'Study session resumed.' });
  } catch (err) {
    console.error('Session resume error:', err);
    res.status(500).json({ error: 'Server error resuming study session' });
  }
});

// POST /api/study/session/transition (Transitions between study and break in Pomodoro Mode)
router.post('/session/transition', requireAuth, async (req, res) => {
  try {
    let user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let active = user.activeSession;
    if (!active || active.timerMode !== 'pomodoro') {
      return res.status(400).json({ error: 'No active Pomodoro study session' });
    }

    // First catch up if there are any background changes
    user = await syncUserActiveSession(user);
    active = user.activeSession;

    // Explicitly transition state if requested
    const lastState = active.state || 'study';
    if (lastState === 'study') {
      active.totalStudySeconds += active.studyDuration;
      active.cyclesCompleted += 1;
      active.state = 'break';
    } else {
      active.totalBreakSeconds += active.breakDuration;
      active.state = 'study';
    }
    active.accumulatedSeconds = 0;
    active.lastTickTime = new Date().toISOString();

    await db.users.update(user.id, { activeSession: active });
    res.json({ activeSession: active, message: `Transitioned to ${active.state}.` });
  } catch (err) {
    console.error('Session transition error:', err);
    res.status(500).json({ error: 'Server error during state transition' });
  }
});

// POST /api/study/session/end (Saves session, calculates XP, check achievements)
router.post('/session/end', requireAuth, async (req, res) => {
  const { clientDuration, clientLocalDate, subject, notes } = req.body;

  if (!clientLocalDate) {
    return res.status(400).json({ error: 'Client local date YYYY-MM-DD is required for consistency tracking.' });
  }

  try {
    let user = await db.users.get(req.session.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    // Sync Pomodoro active session background transitions first
    user = await syncUserActiveSession(user);

    const active = user.activeSession;
    if (!active) {
      return res.status(400).json({ error: 'No active study session found on server. Start a session first.' });
    }

    // Calculate server-side duration based on timerMode
    let serverDuration = 0;
    if (active.timerMode === 'pomodoro') {
      let elapsedInPeriod = active.accumulatedSeconds;
      if (!active.paused) {
        elapsedInPeriod += (Date.now() - new Date(active.lastTickTime).getTime()) / 1000;
      }
      const currentPeriodStudySeconds = active.state === 'study' ? elapsedInPeriod : 0;
      serverDuration = Math.round(active.totalStudySeconds + currentPeriodStudySeconds);
    } else {
      let elapsed = active.accumulatedSeconds;
      if (!active.paused) {
        elapsed += (Date.now() - new Date(active.lastTickTime).getTime()) / 1000;
      }
      serverDuration = Math.round(elapsed);
    }

    // 1. Anti-Cheat: Validate client duration against server duration
    // Allow a buffer of 15 seconds or 2% for network delay
    const maxAllowedDuration = serverDuration + Math.max(15, serverDuration * 0.02);
    
    if (clientDuration > maxAllowedDuration) {
      await logSecurity(
        'SUSPICIOUS_XP_GAIN', 
        user.id, 
        `Cheating detected: submitted client duration ${clientDuration}s, server tracked ${serverDuration}s. Path: /api/study/session/end`,
        req.ip
      );
      await db.users.update(user.id, { activeSession: null }); // Reset anyway
      return res.status(403).json({ error: 'Session verification failed. Invalid session duration detected.' });
    }

    const duration = Math.min(clientDuration, serverDuration);

    if (duration < 10) {
      await db.users.update(user.id, { activeSession: null }); // Reset anyway
      return res.status(400).json({ error: 'Study session too short to record (must be at least 10 seconds).' });
    }

    // Block sessions exceeding 24 hours
    if (duration > 86400) {
      await db.users.update(user.id, { activeSession: null }); // Reset anyway
      return res.status(400).json({ error: 'Legitimate study session duration exceeds the 24-hour maximum limit.' });
    }

    // Verify client system date synchrony
    const serverDate = new Date();
    const clientDateObj = new Date(clientLocalDate + 'T12:00:00'); // Use mid-day to avoid offset shifts
    const diffDays = Math.abs(serverDate.getTime() - clientDateObj.getTime()) / (1000 * 3600 * 24);
    if (diffDays > 1.5) {
      return res.status(400).json({ error: 'Client system date is desynchronized from the server clock.' });
    }

    // 2. Anti-Cheat: Prevent overlapping sessions
    const userSessions = await db.sessions.listByUser(user.id);
    const startNew = new Date(active.startTime).getTime();
    const endNew = new Date().getTime();
    const hasOverlap = userSessions.some(s => {
      const startExist = new Date(s.startTime).getTime();
      const endExist = new Date(s.endTime).getTime();
      // Overlap condition: startA < endB && endA > startB
      return (startNew < endExist && endNew > startExist);
    });

    if (hasOverlap) {
      await logSecurity(
        'OVERLAPPING_SESSION',
        user.id,
        `Blocked study session due to timestamp overlap with previous recorded history`,
        req.ip
      );
      await db.users.update(user.id, { activeSession: null });
      return res.status(400).json({ error: 'Study session overlaps with an existing session in your history.' });
    }

    // Calculate XP: 1 minute = 1 XP (1 second = 1/60 XP). Minimum 1 XP if valid session.
    const xpEarned = Math.max(1, Math.round(duration / 60));

    // Save session
    const startTimeStr = active.startTime;
    const endTimeStr = new Date().toISOString();
    
    const newSession = await db.sessions.create({
      userId: user.id,
      startTime: startTimeStr,
      endTime: endTimeStr,
      duration,
      subject: subject || active.subject,
      notes: notes || '',
      xpEarned,
      timerMode: active.timerMode || 'normal',
      pomodoroPreset: active.timerMode === 'pomodoro' ? (active.pomodoroPreset || 'custom') : null,
      pomodoroCyclesCompleted: active.timerMode === 'pomodoro' ? (active.cyclesCompleted || 0) : 0
    });

    // Check targets and update goals targetMinutes progress
    const goals = await db.goals.listByUser(user.id);
    const updatedGoals = [];
    const durationMinutes = duration / 60;
    
    for (const goal of goals) {
      if (!goal.completed && (goal.type === 'daily' || goal.type === 'weekly') && goal.targetMinutes) {
        const completedMinutes = goal.completedMinutes + durationMinutes;
        const completed = completedMinutes >= goal.targetMinutes;
        const completedDate = completed ? new Date().toISOString() : null;

        const updated = await db.goals.update(goal.id, {
          completedMinutes,
          completed,
          completedDate
        });
        
        updatedGoals.push(updated);
        
        if (completed) {
          // Add goal completion XP immediately to user
          user.xp += goal.xpRewarded || 50;
          user.seasonalXp += goal.xpRewarded || 50;
          await logAudit('GOAL_COMPLETED', user.id, `Goal completed: "${goal.title}" (+${goal.xpRewarded} XP)`);
        }
      }
    }

    // Update streak based on clientLocalDate YYYY-MM-DD
    const activeDays = user.activeDays || [];
    let streakIncremented = false;

    if (!user.lastStudyDate) {
      // First session ever
      user.currentStreak = 1;
      user.longestStreak = 1;
      streakIncremented = true;
    } else {
      const lastStudy = new Date(user.lastStudyDate + 'T00:00:00Z');
      const currentStudy = new Date(clientLocalDate + 'T00:00:00Z');
      const diffTime = Math.abs(currentStudy.getTime() - lastStudy.getTime());
      const diffDaysCount = Math.round(diffTime / (1000 * 60 * 60 * 24));

      if (diffDaysCount === 1) {
        // Yesterday was last study day: increment streak
        user.currentStreak += 1;
        if (user.currentStreak > user.longestStreak) {
          user.longestStreak = user.currentStreak;
        }
        streakIncremented = true;
      } else if (diffDaysCount > 1) {
        // Broken streak: reset to 1
        user.currentStreak = 1;
        streakIncremented = true;
      }
      // If diffDaysCount === 0, user already studied today, streak remains unchanged.
    }

    user.lastStudyDate = clientLocalDate;
    if (!activeDays.includes(clientLocalDate)) {
      activeDays.push(clientLocalDate);
    }
    user.activeDays = activeDays;

    // Apply session XP
    user.xp += xpEarned;
    user.seasonalXp += xpEarned;

    // Recalculate Level
    const newLevel = getLevelForXp(user.xp);
    const leveledUp = newLevel > user.level;
    user.level = newLevel;

    // Recalculate Consistency Score
    const allSessions = await db.sessions.listByUser(user.id);
    const allGoals = await db.goals.listByUser(user.id);
    user.consistencyScore = calculateConsistencyScore(user, allSessions, allGoals);

    // Achievements unlocking logic
    const unlockedAchievements = [];
    const currentUnlockedIds = user.achievements.map(a => a.id);

    // Helper to push new achievements
    function unlockAchievement(id, title) {
      if (!currentUnlockedIds.includes(id)) {
        user.achievements.push({ id, unlockDate: new Date().toISOString() });
        unlockedAchievements.push({ id, title });
      }
    }

    // A. Study Achievements
    unlockAchievement('first_session', 'First Study Session');
    
    const totalMinutes = allSessions.reduce((acc, s) => acc + (s.duration / 60), 0) + (duration / 60);
    const totalHours = totalMinutes / 60;
    
    if (totalHours >= 10) unlockAchievement('hours_10', '10 Hours Studied');
    if (totalHours >= 50) unlockAchievement('hours_50', '50 Hours Studied');
    if (totalHours >= 100) unlockAchievement('hours_100', '100 Hours Studied');
    if (totalHours >= 500) unlockAchievement('hours_500', '500 Hours Studied');

    // B. Streak Achievements
    if (user.currentStreak >= 7) unlockAchievement('streak_7', '7-Day Streak');
    if (user.currentStreak >= 30) unlockAchievement('streak_30', '30-Day Streak');
    if (user.currentStreak >= 100) unlockAchievement('streak_100', '100-Day Streak');
    if (user.currentStreak >= 365) unlockAchievement('streak_365', '365-Day Streak');

    // C. Goal Achievements
    const completedGoalsCount = allGoals.filter(g => g.completed).length + updatedGoals.filter(g => g.completed).length;
    if (completedGoalsCount >= 1) unlockAchievement('goals_1', 'First Goal Completed');
    if (completedGoalsCount >= 25) unlockAchievement('goals_25', '25 Goals Completed');
    if (completedGoalsCount >= 100) unlockAchievement('goals_100', '100 Goals Completed');

    // D. Consistency Achievements
    const now = new Date();
    const past7Days = new Array(7).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(now.getDate() - i);
      return d.toISOString().split('T')[0];
    });
    const studiedDaysIn7 = past7Days.filter(day => activeDays.includes(day)).length;

    const past28Days = new Array(28).fill(0).map((_, i) => {
      const d = new Date();
      d.setDate(now.getDate() - i);
      return d.toISOString().split('T')[0];
    });
    const studiedDaysIn28 = past28Days.filter(day => activeDays.includes(day)).length;

    if (user.consistencyScore >= 90) unlockAchievement('consistency_master', 'Consistency Master');
    
    // Weekly Champion (studied 7 distinct days in past 7 calendar days)
    if (studiedDaysIn7 === 7) unlockAchievement('weekly_champion', 'Weekly Champion');
    
    // Monthly Champion (studied >= 25 distinct days in past 28 days)
    if (studiedDaysIn28 >= 25) unlockAchievement('monthly_champion', 'Monthly Champion');

    // Add bonus XP for achievements unlocked!
    let achievementBonusXp = 0;
    unlockedAchievements.forEach(ach => {
      let bonus = 50;
      if (ach.id.includes('365')) bonus = 5000;
      else if (ach.id.includes('100')) bonus = 1000;
      else if (ach.id.includes('500') || ach.id.includes('30') || ach.id.includes('monthly')) bonus = 500;
      else if (ach.id.includes('25') || ach.id.includes('hours_50') || ach.id.includes('weekly')) bonus = 250;
      
      achievementBonusXp += bonus;
      user.xp += bonus;
      user.seasonalXp += bonus;
    });

    // Save user update (activeSession is cleared now!)
    await db.users.update(user.id, {
      xp: user.xp,
      seasonalXp: user.seasonalXp,
      level: user.level,
      currentStreak: user.currentStreak,
      longestStreak: user.longestStreak,
      lastStudyDate: user.lastStudyDate,
      activeDays: user.activeDays,
      consistencyScore: user.consistencyScore,
      achievements: user.achievements,
      activeSession: null
    });

    await logAudit('SESSION_END', user.id, `Completed study session of ${duration}s on ${subject || 'Other'} (+${xpEarned} XP)`);

    res.json({
      session: newSession,
      xpEarned,
      achievementBonusXp,
      newlyUnlocked: unlockedAchievements,
      leveledUp,
      level: user.level,
      xpRequired: getXpRequiredForNextLevel(user.level),
      xp: user.xp,
      consistencyScore: user.consistencyScore,
      streak: user.currentStreak
    });
  } catch (err) {
    console.error('Session end save error:', err);
    res.status(500).json({ error: 'Server error during ending study session' });
  }
});

// GET /api/study/analytics
router.get('/analytics', requireAuth, async (req, res) => {
  try {
    const user = await db.users.get(req.session.userId);
    const sessions = await db.sessions.listByUser(req.session.userId);
    const goals = await db.goals.listByUser(req.session.userId);

    // Calculate details for graphics
    // 1. Daily study minutes (last 7 days)
    const now = new Date();
    const dailyMinutes = [];
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(now.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const daySessions = sessions.filter(s => s.startTime.startsWith(dateStr));
      const mins = daySessions.reduce((acc, s) => acc + (s.duration / 60), 0);
      dailyMinutes.push({ date: dateStr, minutes: Math.round(mins) });
    }

    // 2. Weekly study minutes (last 4 weeks)
    const weeklyMinutes = [];
    for (let i = 3; i >= 0; i--) {
      const startOfWeek = new Date();
      startOfWeek.setDate(now.getDate() - (i * 7 + now.getDay()));
      startOfWeek.setHours(0,0,0,0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 7);

      const weekSessions = sessions.filter(s => {
        const d = new Date(s.startTime);
        return d >= startOfWeek && d < endOfWeek;
      });
      const mins = weekSessions.reduce((acc, s) => acc + (s.duration / 60), 0);
      weeklyMinutes.push({ weekStart: startOfWeek.toISOString().split('T')[0], minutes: Math.round(mins) });
    }

    // 3. Monthly study minutes (last 6 months)
    const monthlyMinutes = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(now.getMonth() - i);
      const monthLabel = d.toLocaleString('default', { month: 'short' });
      const year = d.getFullYear();
      const monthNum = d.getMonth();

      const monthSessions = sessions.filter(s => {
        const sd = new Date(s.startTime);
        return sd.getMonth() === monthNum && sd.getFullYear() === year;
      });
      const mins = monthSessions.reduce((acc, s) => acc + (s.duration / 60), 0);
      monthlyMinutes.push({ month: `${monthLabel} ${year}`, minutes: Math.round(mins) });
    }

    // 4. Heatmap Contribution Calendar (past 365 days of active study days)
    // Returns active study dates and their minutes
    const heatmap = {};
    sessions.forEach(s => {
      const dateStr = s.startTime.split('T')[0];
      heatmap[dateStr] = (heatmap[dateStr] || 0) + (s.duration / 60);
    });
    const formattedHeatmap = Object.keys(heatmap).map(date => ({
      date,
      count: Math.ceil(heatmap[date])
    }));

    // 5. Subject distribution minutes
    const subjects = {};
    sessions.forEach(s => {
      const sub = s.subject || 'Other';
      subjects[sub] = (subjects[sub] || 0) + (s.duration / 60);
    });
    const subjectDistribution = Object.keys(subjects).map(sub => ({
      subject: sub,
      minutes: Math.round(subjects[sub])
    }));

    const pomodoroSessions = sessions.filter(s => s.timerMode === 'pomodoro');
    const totalPomodoroCycles = pomodoroSessions.reduce((acc, s) => acc + (s.pomodoroCyclesCompleted || 0), 0);

    let avgSessionMinutes = 0;
    if (sessions.length > 0) {
      const totalSeconds = sessions.reduce((acc, s) => acc + s.duration, 0);
      avgSessionMinutes = Math.round((totalSeconds / sessions.length) / 60);
    }

    const presetCounts = {};
    let mostUsedPreset = 'N/A';
    let maxCount = 0;
    pomodoroSessions.forEach(s => {
      if (s.pomodoroPreset) {
        presetCounts[s.pomodoroPreset] = (presetCounts[s.pomodoroPreset] || 0) + 1;
        if (presetCounts[s.pomodoroPreset] > maxCount) {
          maxCount = presetCounts[s.pomodoroPreset];
          mostUsedPreset = s.pomodoroPreset;
        }
      }
    });

    res.json({
      daily: dailyMinutes,
      weekly: weeklyMinutes,
      monthly: monthlyMinutes,
      heatmap: formattedHeatmap,
      subjects: subjectDistribution,
      lifetimeHours: Math.round(sessions.reduce((acc, s) => acc + (s.duration / 3600), 0) * 10) / 10,
      goalsCompletedRate: goals.length ? Math.round((goals.filter(g => g.completed).length / goals.length) * 100) : 0,
      consistencyTrend: user.consistencyScore,
      totalPomodoroCycles,
      avgSessionMinutes,
      mostUsedPreset
    });

  } catch (err) {
    console.error('Analytics fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
