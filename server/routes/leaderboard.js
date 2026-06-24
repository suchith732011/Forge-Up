const express = require('express');
const db = require('../db');

const router = express.Router();

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

// GET /api/leaderboard
router.get('/', requireAuth, async (req, res) => {
  try {
    const currentUser = await db.users.get(req.session.userId);
    if (!currentUser) return res.status(404).json({ error: 'User not found' });

    const { type } = req.query; // 'alltime' or 'seasonal'
    const isSeasonal = type === 'seasonal';

    const users = await db.users.list();
    const allSessions = await db.sessions.list();

    const now = new Date();
    const currentMonthStr = now.toISOString().substring(0, 7); // 'YYYY-MM'

    // Compute metrics for all users
    const userMetricsList = [];

    // Find max values for normalization
    let maxStudyMins = 0;
    let maxStreak = 0;

    // Calculate baseline stats
    for (const u of users) {
      const uSessions = allSessions.filter(s => s.userId === u.id);
      
      // Filter sessions for seasonal if active
      const activeSessions = isSeasonal
        ? uSessions.filter(s => s.startTime.startsWith(currentMonthStr))
        : uSessions;

      const studyMins = activeSessions.reduce((acc, s) => acc + (s.duration / 60), 0);
      const streak = u.currentStreak || 0;

      if (studyMins > maxStudyMins) maxStudyMins = studyMins;
      if (streak > maxStreak) maxStreak = streak;

      userMetricsList.push({
        user: u,
        studyMins,
        streak,
        achievementsCount: u.achievements ? u.achievements.length : 0
      });
    }

    const totalAchievements = 14; // We have 14 distinct achievement IDs

    // Calculate composite ranking score
    const rankedUsers = userMetricsList.map(item => {
      const u = item.user;

      // Normalize metrics (0 - 100)
      const consistencyScore = u.consistencyScore || 0;
      const studyScore = maxStudyMins > 0 ? (item.studyMins / maxStudyMins) * 100 : 0;
      const streakScore = maxStreak > 0 ? (item.streak / maxStreak) * 100 : 0;
      const achievementScore = (item.achievementsCount / totalAchievements) * 100;

      // Ranking formula: 40% Consistency, 30% Study Time, 20% Streak, 10% Achievements
      const rankScore = (consistencyScore * 0.40) + (studyScore * 0.30) + (streakScore * 0.20) + (achievementScore * 0.10);

      const isSelf = u.id === req.session.userId;
      const isPublic = u.settings && u.settings.profilePublic !== false;

      // Privacy mask: If hidden and not self, hide sensitive details
      return {
        id: u.id,
        username: u.username,
        isSelf,
        isPublic,
        // Fields visible to others only if public
        level: (isPublic || isSelf) ? u.level : null,
        consistencyScore: (isPublic || isSelf) ? Math.round(consistencyScore) : null,
        studyMins: (isPublic || isSelf) ? Math.round(item.studyMins) : null,
        streak: (isPublic || isSelf) ? item.streak : null,
        achievementsCount: (isPublic || isSelf) ? item.achievementsCount : null,
        xp: (isPublic || isSelf) ? (isSeasonal ? u.seasonalXp : u.xp) : null,
        rankScore
      };
    });

    // Sort descending by rankScore, stable sort alphabetically by username if equal
    rankedUsers.sort((a, b) => {
      if (Math.abs(b.rankScore - a.rankScore) < 1e-9) {
        return a.username.localeCompare(b.username);
      }
      return b.rankScore - a.rankScore;
    });

    // Assign rank positions (including ties)
    let currentRank = 1;
    let prevScore = null;
    for (let i = 0; i < rankedUsers.length; i++) {
      const score = rankedUsers[i].rankScore;
      if (i > 0 && score < prevScore) {
        currentRank = i + 1;
      }
      rankedUsers[i].rank = currentRank;
      prevScore = score;
      
      // Clean up score for UI transmission
      delete rankedUsers[i].rankScore;
    }

    res.json({
      leaderboard: rankedUsers,
      totalUsers: users.length,
      currentMonthLabel: now.toLocaleString('default', { month: 'long', year: 'numeric' })
    });

  } catch (err) {
    console.error('Leaderboard fetch error:', err);
    res.status(500).json({ error: 'Server error loading leaderboard' });
  }
});

module.exports = router;
