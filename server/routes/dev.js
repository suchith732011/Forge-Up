const express = require('express');
const db = require('../db');
const { logSecurity, logAudit } = require('../auditLogger');

const router = express.Router();

// Middleware to block dev routes in production
router.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    logSecurity('DEV_ACCESS_BLOCKED', req.session.userId || 'Guest', 'Attempt to access developer endpoints in production mode', req.ip);
    return res.status(403).json({ error: 'Developer mode is disabled in production.' });
  }
  next();
});

// GET /api/test/seed (Create 30 mock ghost students)
router.get('/seed', async (req, res) => {
  try {
    const list = await db.users.list();
    const ghostExists = list.some(u => u.isGhost);
    if (ghostExists) {
      return res.status(400).json({ error: 'Test data already seeded. Run cleanup first.' });
    }

    const ghostNames = [
      'AlphaStudier', 'BetaBrain', 'GammaGeek', 'DeltaDoer', 'EpsilonExpert',
      'FocusFinder', 'GoalGetter', 'HabitHero', 'Intellect', 'JoyOfLearning',
      'KnowledgeKnight', 'ForgeLover', 'MindMaster', 'NerdNetwork', 'OwlObserver',
      'Pioneer', 'QuestCoder', 'ReadingRaptor', 'Scholarly', 'Thinker',
      'UniStudent', 'Visionary', 'WisdomSeeker', 'XenialLearner', 'YieldChamp',
      'ZenMaster', 'SprintStudier', 'SteadyLearner', 'HabitBuilder', 'ForgeUpFan'
    ];

    const seededUsers = [];
    const subjects = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Programming', 'History', 'Other'];

    for (let i = 0; i < ghostNames.length; i++) {
      const username = ghostNames[i];
      const email = `${username.toLowerCase()}@example.com`;
      const joinDate = new Date();
      joinDate.setDate(joinDate.getDate() - (10 + i * 2)); // Joined in the past

      // Streaks and XP variations
      const currentStreak = Math.floor(Math.random() * 25) + (i % 2 === 0 ? 3 : 0);
      const longestStreak = currentStreak + Math.floor(Math.random() * 10);
      const xp = Math.floor(Math.random() * 4500) + 120;
      const seasonalXp = Math.floor(xp * 0.6); // part of xp is seasonal
      
      // Calculate level
      let level = 1;
      if (xp >= 100) level = 2;
      if (xp >= 250) level = 3;
      if (xp >= 500) level = 4;
      if (xp >= 1000) {
        level = 4;
        let req = 1000;
        while (xp >= req) {
          level++;
          req += (level - 1) * 500;
        }
      }

      // Generate active days list
      const activeDays = [];
      const studyDaysCount = Math.min(30, currentStreak + Math.floor(Math.random() * 15));
      for (let d = 0; d < studyDaysCount; d++) {
        const date = new Date();
        date.setDate(date.getDate() - d);
        activeDays.push(date.toISOString().split('T')[0]);
      }

      const consistencyScore = Math.min(100, Math.floor(Math.random() * 40) + 50 + (currentStreak > 10 ? 10 : 0));

      // Create ghost user in DB
      const userObj = {
        username,
        email,
        password: 'seghostpassword123', // Doesn't need real hashing as we won't log in as ghosts
        joinDate: joinDate.toISOString(),
        level,
        xp,
        seasonalXp,
        currentStreak,
        longestStreak,
        consistencyScore,
        emailVerified: true, // Auto verified
        isGhost: true,
        activeDays,
        lastStudyDate: activeDays[0] || null,
        achievements: [
          { id: 'first_session', unlockDate: joinDate.toISOString() }
        ],
        settings: {
          profilePublic: Math.random() > 0.15, // 15% private profiles
          notificationsEnabled: true
        }
      };

      if (level > 2) userObj.achievements.push({ id: 'goals_1', unlockDate: joinDate.toISOString() });
      if (currentStreak >= 7) userObj.achievements.push({ id: 'streak_7', unlockDate: joinDate.toISOString() });
      if (consistencyScore >= 90) userObj.achievements.push({ id: 'consistency_master', unlockDate: joinDate.toISOString() });

      const created = await db.users.create(userObj);
      seededUsers.push(created);

      // Create some mock sessions
      const sessionCount = Math.floor(Math.random() * 5) + 2;
      for (let s = 0; s < sessionCount; s++) {
        const duration = Math.floor(Math.random() * 3600) + 600; // 10 to 60 mins
        const sessDate = new Date();
        sessDate.setDate(sessDate.getDate() - s);
        
        await db.sessions.create({
          userId: created.id,
          startTime: new Date(sessDate.getTime() - duration * 1000).toISOString(),
          endTime: sessDate.toISOString(),
          duration,
          subject: subjects[s % subjects.length],
          notes: `Studied ${subjects[s % subjects.length]} topic ${s + 1}`,
          xpEarned: Math.max(1, Math.round(duration / 60))
        });
      }

      // Create some mock goals
      const goalCount = Math.floor(Math.random() * 4) + 1;
      for (let g = 0; g < goalCount; g++) {
        const completed = g < goalCount - 1;
        const dl = new Date();
        dl.setDate(dl.getDate() + (g - 1));

        await db.goals.create({
          userId: created.id,
          title: `Study ${subjects[g % subjects.length]} assignment`,
          description: `Chapter ${g + 1} review questions`,
          deadline: dl.toISOString(),
          completed,
          completedDate: completed ? new Date(dl.getTime() - 12 * 3600000).toISOString() : null,
          type: 'custom',
          xpRewarded: 50
        });
      }
    }

    await logAudit('SEED_DATA', req.session.userId || 'System', `Seeded ${seededUsers.length} ghost student accounts`);
    res.json({ message: `Successfully seeded ${seededUsers.length} ghost student accounts and mock statistics.` });

  } catch (err) {
    console.error('Seeding error:', err);
    res.status(500).json({ error: 'Server error during seeding data' });
  }
});

// GET /api/test/cleanup (Delete all seeded ghost students)
router.get('/cleanup', async (req, res) => {
  try {
    const list = await db.users.list();
    const ghostUsers = list.filter(u => u.isGhost);

    if (ghostUsers.length === 0) {
      return res.json({ message: 'No ghost accounts found. Clean up complete.' });
    }

    let deletedCount = 0;
    for (const ghost of ghostUsers) {
      await db.sessions.deleteByUser(ghost.id);
      await db.goals.deleteByUser(ghost.id);
      await db.users.delete(ghost.id);
      deletedCount++;
    }

    await logAudit('CLEANUP_DATA', req.session.userId || 'System', `Cleared ${deletedCount} ghost student accounts`);
    res.json({ message: `Successfully removed ${deletedCount} ghost accounts and their associated sessions and goals.` });

  } catch (err) {
    console.error('Cleanup error:', err);
    res.status(500).json({ error: 'Server error during cleanup' });
  }
});

module.exports = router;
