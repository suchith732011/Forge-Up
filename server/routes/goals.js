const express = require('express');
const db = require('../db');
const { logAudit } = require('../auditLogger');

const router = express.Router();

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

// XP progression levels matching study.js
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

// GET /api/goals
router.get('/', requireAuth, async (req, res) => {
  try {
    const list = await db.goals.listByUser(req.session.userId);
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: 'Server error fetching goals' });
  }
});

// POST /api/goals (Create goal)
router.post('/', requireAuth, async (req, res) => {
  const { title, description, deadline, type, targetMinutes } = req.body;

  if (!title || !deadline) {
    return res.status(400).json({ error: 'Title and deadline are required' });
  }

  try {
    const newGoal = await db.goals.create({
      userId: req.session.userId,
      title,
      description: description || '',
      deadline: new Date(deadline).toISOString(),
      type: type || 'custom', // 'daily' | 'weekly' | 'custom'
      targetMinutes: targetMinutes ? parseInt(targetMinutes, 10) : null,
      completedMinutes: 0,
      xpRewarded: type === 'daily' ? 40 : (type === 'weekly' ? 100 : 50)
    });

    await logAudit('GOAL_CREATE', req.session.userId, `Created goal: "${title}" (Type: ${newGoal.type})`);
    res.status(201).json(newGoal);
  } catch (err) {
    res.status(500).json({ error: 'Server error creating goal' });
  }
});

// PUT /api/goals/:id (Update / Toggle Completion)
router.put('/:id', requireAuth, async (req, res) => {
  const { completed } = req.body;

  try {
    const goal = await db.goals.get(req.params.id);
    if (!goal || goal.userId !== req.session.userId) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    const wasCompleted = goal.completed;
    const isCompleted = !!completed;

    const updateData = { completed: isCompleted };
    if (isCompleted && !wasCompleted) {
      updateData.completedDate = new Date().toISOString();
      if (goal.targetMinutes) {
        updateData.completedMinutes = goal.targetMinutes; // Set full progress
      }
    } else if (!isCompleted && wasCompleted) {
      updateData.completedDate = null;
    }

    const updated = await db.goals.update(req.params.id, updateData);

    let xpEarned = 0;
    let leveledUp = false;
    let currentLevel = 1;
    let unlockedAchievements = [];

    // Award XP if completed
    if (isCompleted && !wasCompleted) {
      xpEarned = goal.xpRewarded || 50;
      const user = await db.users.get(req.session.userId);
      if (user) {
        user.xp += xpEarned;
        user.seasonalXp += xpEarned;

        // Level Up check
        const newLevel = getLevelForXp(user.xp);
        leveledUp = newLevel > user.level;
        user.level = newLevel;
        currentLevel = user.level;

        // Check Goal Achievements
        const allGoals = await db.goals.listByUser(user.id);
        const totalCompleted = allGoals.filter(g => g.completed).length;
        const currentUnlockedIds = user.achievements.map(a => a.id);

        function unlockAchievement(id, title) {
          if (!currentUnlockedIds.includes(id)) {
            user.achievements.push({ id, unlockDate: new Date().toISOString() });
            unlockedAchievements.push({ id, title });
            
            let bonus = 50;
            if (id.includes('100')) bonus = 1000;
            else if (id.includes('25')) bonus = 250;
            user.xp += bonus;
            user.seasonalXp += bonus;
          }
        }

        if (totalCompleted >= 1) unlockAchievement('goals_1', 'First Goal Completed');
        if (totalCompleted >= 25) unlockAchievement('goals_25', '25 Goals Completed');
        if (totalCompleted >= 100) unlockAchievement('goals_100', '100 Goals Completed');

        await db.users.update(user.id, {
          xp: user.xp,
          seasonalXp: user.seasonalXp,
          level: user.level,
          achievements: user.achievements
        });

        await logAudit('GOAL_COMPLETE', user.id, `Completed goal: "${goal.title}" (+${xpEarned} XP)`);
      }
    }

    res.json({
      goal: updated,
      xpEarned,
      leveledUp,
      level: currentLevel,
      newlyUnlocked: unlockedAchievements
    });

  } catch (err) {
    console.error('Goal update error:', err);
    res.status(500).json({ error: 'Server error updating goal' });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const goal = await db.goals.get(req.params.id);
    if (!goal || goal.userId !== req.session.userId) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    await db.goals.delete(req.params.id);
    await logAudit('GOAL_DELETE', req.session.userId, `Deleted goal: "${goal.title}"`);
    res.json({ message: 'Goal deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error deleting goal' });
  }
});

module.exports = router;
