const db = require('./db');

/**
 * Synchronizes and catches up the user's active study session if it's in Pomodoro mode
 * and is ticking. Resolves transition states mathematically based on elapsed time.
 * @param {object} user - The user object from the database.
 * @returns {Promise<object>} The caught up user object (updated in the DB if transitions occurred).
 */
async function syncUserActiveSession(user) {
  if (!user || !user.activeSession) return user;
  const active = user.activeSession;
  if (active.timerMode !== 'pomodoro' || active.paused) return user;

  const now = Date.now();
  const lastTick = new Date(active.lastTickTime).getTime();
  let delta = (now - lastTick) / 1000;
  if (delta <= 0) return user;

  let state = active.state || 'study';
  let accumulatedSeconds = active.accumulatedSeconds || 0;
  let totalStudySeconds = active.totalStudySeconds || 0;
  let totalBreakSeconds = active.totalBreakSeconds || 0;
  let cyclesCompleted = active.cyclesCompleted || 0;
  const studyDuration = active.studyDuration || 1500;
  const breakDuration = active.breakDuration || 300;
  let hasTransitioned = false;

  let periodDuration = state === 'study' ? studyDuration : breakDuration;
  let remaining = periodDuration - accumulatedSeconds;

  if (delta < remaining) {
    // No transition, we do not need to perform a database write just for simple elapsed seconds ticks.
    // However, we can return the current runtime calculation values.
    return user;
  }

  // At least one transition happened!
  hasTransitioned = true;
  delta -= remaining;

  if (state === 'study') {
    totalStudySeconds += studyDuration;
    cyclesCompleted += 1;
    state = 'break';
  } else {
    totalBreakSeconds += breakDuration;
    state = 'study';
  }

  // Loop transitions to simulate background time
  while (true) {
    const nextDuration = state === 'study' ? studyDuration : breakDuration;
    if (delta >= nextDuration) {
      delta -= nextDuration;
      if (state === 'study') {
        totalStudySeconds += studyDuration;
        cyclesCompleted += 1;
        state = 'break';
      } else {
        totalBreakSeconds += breakDuration;
        state = 'study';
      }
    } else {
      accumulatedSeconds = delta;
      break;
    }
  }

  const updatedActive = {
    ...active,
    state,
    accumulatedSeconds: Math.round(accumulatedSeconds),
    totalStudySeconds: Math.round(totalStudySeconds),
    totalBreakSeconds: Math.round(totalBreakSeconds),
    cyclesCompleted,
    lastTickTime: new Date(now).toISOString()
  };

  // Persist updated session in database
  const updatedUser = await db.users.update(user.id, { activeSession: updatedActive });
  return updatedUser;
}

module.exports = {
  syncUserActiveSession
};
