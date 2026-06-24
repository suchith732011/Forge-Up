// Study session timer and wellness notifications controller
const StudyTimer = {
  timerInterval: null,
  startTime: null,
  totalElapsedSeconds: 0,
  pausedSeconds: 0,
  lastTickTime: null,
  isPaused: false,
  isActive: false,
  subject: 'Other',
  notes: '',

  // Study Mode variables
  timerMode: 'normal', // 'normal' | 'pomodoro'
  pomodoroState: 'study', // 'study' | 'break'
  pomodoroCyclesCompleted: 0,
  studyDuration: 1500,
  breakDuration: 300,
  currentPeriodElapsedSeconds: 0,
  totalStudySeconds: 0,
  totalBreakSeconds: 0,

  // Load state from localStorage on startup (recovers timers if user reloads)
  init() {
    const cached = localStorage.getItem('forgeup_active_timer');
    if (cached) {
      try {
        const state = JSON.parse(cached);
        const now = Date.now();
        const inactiveTime = (now - state.lastTickTime) / 1000;
        
        this.isActive = state.isActive;
        this.isPaused = state.isPaused;
        this.startTime = state.startTime;
        this.pausedSeconds = state.pausedSeconds;
        this.subject = state.subject || 'Other';
        this.notes = state.notes || '';
        this.timerMode = state.timerMode || 'normal';

        if (this.isActive) {
          if (this.timerMode === 'pomodoro') {
            this.pomodoroState = state.pomodoroState || 'study';
            this.pomodoroCyclesCompleted = state.pomodoroCyclesCompleted || 0;
            this.studyDuration = state.studyDuration || 1500;
            this.breakDuration = state.breakDuration || 300;
            this.totalStudySeconds = state.totalStudySeconds || 0;
            this.totalBreakSeconds = state.totalBreakSeconds || 0;
            
            let elapsed = state.currentPeriodElapsedSeconds || 0;
            if (!this.isPaused) {
              // Simulate background transitions during offline time
              let delta = inactiveTime;
              let pState = this.pomodoroState;
              let pElapsed = elapsed;
              let pCycles = this.pomodoroCyclesCompleted;
              let pTotalStudy = this.totalStudySeconds;
              let pTotalBreak = this.totalBreakSeconds;
              const studyDur = this.studyDuration;
              const breakDur = this.breakDuration;

              let periodDur = pState === 'study' ? studyDur : breakDur;
              let rem = periodDur - pElapsed;

              if (delta >= rem) {
                delta -= rem;
                if (pState === 'study') {
                  pTotalStudy += studyDur;
                  pCycles += 1;
                  pState = 'break';
                } else {
                  pTotalBreak += breakDur;
                  pState = 'study';
                }

                while (true) {
                  const nextDur = pState === 'study' ? studyDur : breakDur;
                  if (delta >= nextDur) {
                    delta -= nextDur;
                    if (pState === 'study') {
                      pTotalStudy += studyDur;
                      pCycles += 1;
                      pState = 'break';
                    } else {
                      pTotalBreak += breakDur;
                      pState = 'study';
                    }
                  } else {
                    pElapsed = delta;
                    break;
                  }
                }
              } else {
                pElapsed += delta;
              }

              this.pomodoroState = pState;
              this.currentPeriodElapsedSeconds = Math.round(pElapsed);
              this.pomodoroCyclesCompleted = pCycles;
              this.totalStudySeconds = Math.round(pTotalStudy);
              this.totalBreakSeconds = Math.round(pTotalBreak);
            } else {
              this.currentPeriodElapsedSeconds = elapsed;
            }
          } else {
            if (this.isPaused) {
              this.totalElapsedSeconds = state.totalElapsedSeconds;
            } else {
              this.totalElapsedSeconds = state.totalElapsedSeconds + inactiveTime;
            }
          }

          this.syncUI();
          if (!this.isPaused) {
            this.startTicking();
          }
        }
      } catch (err) {
        console.error('Error recovering timer state:', err);
        this.clearCache();
      }
    }
  },

  reset() {
    clearInterval(this.timerInterval);
    this.isActive = false;
    this.isPaused = false;
    this.startTime = null;
    this.totalElapsedSeconds = 0;
    this.pausedSeconds = 0;
    this.lastTickTime = null;
    this.subject = 'Other';
    this.notes = '';
    this.timerMode = 'normal';
    this.pomodoroState = 'study';
    this.pomodoroCyclesCompleted = 0;
    this.studyDuration = 1500;
    this.breakDuration = 300;
    this.currentPeriodElapsedSeconds = 0;
    this.totalStudySeconds = 0;
    this.totalBreakSeconds = 0;
    this.clearCache();
    this.syncUI();
  },

  syncWithServer(activeSession) {
    if (!activeSession) {
      if (this.isActive) {
        this.reset();
      }
      return;
    }

    this.isActive = true;
    this.isPaused = activeSession.paused;
    this.startTime = new Date(activeSession.startTime).getTime();
    this.subject = activeSession.subject || 'Other';
    this.timerMode = activeSession.timerMode || 'normal';

    const now = Date.now();
    const lastTick = new Date(activeSession.lastTickTime).getTime();

    if (this.timerMode === 'pomodoro') {
      this.pomodoroState = activeSession.state || 'study';
      this.pomodoroCyclesCompleted = activeSession.cyclesCompleted || 0;
      this.studyDuration = activeSession.studyDuration || 1500;
      this.breakDuration = activeSession.breakDuration || 300;
      this.totalStudySeconds = activeSession.totalStudySeconds || 0;
      this.totalBreakSeconds = activeSession.totalBreakSeconds || 0;

      let elapsed = activeSession.accumulatedSeconds;
      if (!activeSession.paused) {
        elapsed += (now - lastTick) / 1000;
        this.lastTickTime = now;
      } else {
        this.lastTickTime = lastTick;
      }
      this.currentPeriodElapsedSeconds = Math.max(0, elapsed);
    } else {
      let elapsed = activeSession.accumulatedSeconds;
      if (!activeSession.paused) {
        elapsed += (now - lastTick) / 1000;
        this.lastTickTime = now;
      } else {
        this.lastTickTime = lastTick;
      }
      this.totalElapsedSeconds = Math.max(0, elapsed);
    }

    this.cacheState();

    if (this.isActive && !this.isPaused) {
      this.startTicking();
    } else {
      clearInterval(this.timerInterval);
    }
    this.syncUI();
  },

  cacheState() {
    if (!this.isActive) {
      this.clearCache();
      return;
    }
    const state = {
      isActive: this.isActive,
      isPaused: this.isPaused,
      startTime: this.startTime,
      totalElapsedSeconds: this.totalElapsedSeconds,
      pausedSeconds: this.pausedSeconds,
      lastTickTime: Date.now(),
      subject: this.subject,
      notes: this.notes,
      timerMode: this.timerMode,
      pomodoroState: this.pomodoroState,
      pomodoroCyclesCompleted: this.pomodoroCyclesCompleted,
      studyDuration: this.studyDuration,
      breakDuration: this.breakDuration,
      currentPeriodElapsedSeconds: this.currentPeriodElapsedSeconds,
      totalStudySeconds: this.totalStudySeconds,
      totalBreakSeconds: this.totalBreakSeconds
    };
    localStorage.setItem('forgeup_active_timer', JSON.stringify(state));
  },

  clearCache() {
    localStorage.removeItem('forgeup_active_timer');
  },

  // START Session
  async start(subject, notes, options) {
    try {
      const mode = options ? options.timerMode : 'normal';
      const body = {
        subject,
        timerMode: mode
      };
      if (mode === 'pomodoro') {
        body.pomodoroPreset = options.pomodoroPreset || '25/5';
        body.studyDuration = options.studyDuration || 1500;
        body.breakDuration = options.breakDuration || 300;
      }

      const response = await fetch('/api/study/session/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.csrfToken
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to start session');
      }

      const resData = await response.json();
      this.notes = notes;
      this.syncWithServer(resData.activeSession);
      
      showToast('Study session started. Focus up! ⚡', 'success');
      requestNotificationPermission();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  // PAUSE Session
  async pause() {
    if (!this.isActive || this.isPaused) return;

    try {
      const response = await fetch('/api/study/session/pause', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.csrfToken
        }
      });

      if (!response.ok) throw new Error('Pause failed');

      const resData = await response.json();
      this.syncWithServer(resData.activeSession);
      showToast('Session paused.', 'warning');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  // RESUME Session
  async resume() {
    if (!this.isActive || !this.isPaused) return;

    try {
      const response = await fetch('/api/study/session/resume', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.csrfToken
        }
      });

      if (!response.ok) throw new Error('Resume failed');

      const resData = await response.json();
      this.syncWithServer(resData.activeSession);
      showToast('Resuming study session.', 'success');
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  // END Session
  async end() {
    if (!this.isActive) return;

    clearInterval(this.timerInterval);
    
    let duration = 0;
    if (this.timerMode === 'pomodoro') {
      if (!this.isPaused) {
        const delta = (Date.now() - this.lastTickTime) / 1000;
        this.currentPeriodElapsedSeconds += delta;
      }
      duration = Math.round(this.totalStudySeconds + (this.pomodoroState === 'study' ? this.currentPeriodElapsedSeconds : 0));
    } else {
      if (!this.isPaused) {
        this.totalElapsedSeconds += (Date.now() - this.lastTickTime) / 1000;
      }
      duration = Math.round(this.totalElapsedSeconds);
    }

    const year = new Date().getFullYear();
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const day = new Date().getDate().toString().padStart(2, '0');
    const clientLocalDate = `${year}-${month}-${day}`;

    try {
      const response = await fetch('/api/study/session/end', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.csrfToken
        },
        body: JSON.stringify({
          clientDuration: duration,
          clientLocalDate,
          subject: this.subject,
          notes: this.notes
        })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to save session');
      }

      const res = await response.json();
      
      let awardMsg = `Session completed! Studied for ${Math.round(duration / 60)} mins. Earned +${res.xpEarned} XP!`;
      if (res.achievementBonusXp > 0) {
        awardMsg += ` Bonus +${res.achievementBonusXp} XP for achievement unlock!`;
      }
      
      showToast(awardMsg, 'success');

      if (res.leveledUp) {
        showToast(`🎉 Level Up! You reached Level ${res.level}!`, 'success');
      }

      if (res.newlyUnlocked && res.newlyUnlocked.length > 0) {
        res.newlyUnlocked.forEach(ach => {
          showToast(`🏅 Achievement Unlocked: ${ach.title}!`, 'success');
        });
      }

      this.reset();

      if (window.App && typeof window.App.refreshData === 'function') {
        await window.App.refreshData();
      }
    } catch (err) {
      showToast(err.message, 'danger');
      if (this.isActive && !this.isPaused) {
        this.startTicking();
      }
    }
  },

  startTicking() {
    clearInterval(this.timerInterval);
    this.timerInterval = setInterval(async () => {
      const now = Date.now();
      const delta = (now - this.lastTickTime) / 1000;
      this.lastTickTime = now;

      if (this.timerMode === 'pomodoro') {
        this.currentPeriodElapsedSeconds += delta;
        
        const periodDuration = this.pomodoroState === 'study' ? this.studyDuration : this.breakDuration;
        if (this.currentPeriodElapsedSeconds >= periodDuration) {
          // Transition!
          clearInterval(this.timerInterval);
          playChime();
          
          const nextState = this.pomodoroState === 'study' ? 'break' : 'study';
          sendLocalNotification('Pomodoro Transition!', `Time for a ${nextState}! Take a breath.`);
          
          try {
            const response = await fetch('/api/study/session/transition', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': window.csrfToken
              }
            });
            if (response.ok) {
              const resData = await response.json();
              this.syncWithServer(resData.activeSession);
            } else {
              throw new Error('Transition sync failed');
            }
          } catch (err) {
            showToast(err.message, 'danger');
            // Fallback: transition locally if offline
            if (this.pomodoroState === 'study') {
              this.totalStudySeconds += this.studyDuration;
              this.pomodoroCyclesCompleted += 1;
              this.pomodoroState = 'break';
            } else {
              this.totalBreakSeconds += this.breakDuration;
              this.pomodoroState = 'study';
            }
            this.currentPeriodElapsedSeconds = 0;
            this.cacheState();
            this.syncUI();
            this.startTicking();
          }
          return;
        }
      } else {
        this.totalElapsedSeconds += delta;
        
        const totalMinutes = Math.floor(this.totalElapsedSeconds / 60);
        if (this.totalElapsedSeconds % 1500 < 1 && this.totalElapsedSeconds > 0) {
          sendLocalNotification('Interval Milestone Reached!', `You've studied for ${totalMinutes} minutes! Remember to sit upright and hydrate.`);
        }
      }

      this.syncUI();
      this.cacheState();
    }, 1000);
  },

  syncUI() {
    const digits = document.getElementById('timer-digits');
    const pill = document.getElementById('timer-subject-pill');
    const ring = document.getElementById('timer-ring-progress');
    const btnStart = document.getElementById('btn-timer-start');
    const btnPause = document.getElementById('btn-timer-pause');
    const btnResume = document.getElementById('btn-timer-resume');
    const btnEnd = document.getElementById('btn-timer-end');
    const setupPanel = document.getElementById('study-setup-panel');
    const indicator = document.getElementById('timer-status-indicator');
    const cyclesText = document.getElementById('timer-pomodoro-cycles');

    if (!digits) return;

    if (this.isActive) {
      setupPanel.classList.add('hidden');
      btnStart.classList.add('hidden');
      pill.classList.remove('hidden');
      pill.textContent = this.subject;

      if (this.timerMode === 'pomodoro') {
        indicator.classList.remove('hidden');
        cyclesText.classList.remove('hidden');
        cyclesText.textContent = `Cycles: ${this.pomodoroCyclesCompleted}`;

        const totalPeriodSecs = this.pomodoroState === 'study' ? this.studyDuration : this.breakDuration;
        const remainingSecs = Math.max(0, totalPeriodSecs - this.currentPeriodElapsedSeconds);

        const secs = Math.floor(remainingSecs % 60);
        const mins = Math.floor((remainingSecs / 60) % 60);
        const hours = Math.floor(remainingSecs / 3600);

        const fSecs = secs.toString().padStart(2, '0');
        const fMins = mins.toString().padStart(2, '0');
        const fHours = hours.toString().padStart(2, '0');

        if (remainingSecs >= 3600) {
          digits.textContent = `${fHours}:${fMins}:${fSecs}`;
        } else {
          digits.textContent = `${fMins}:${fSecs}`;
        }

        if (this.pomodoroState === 'study') {
          indicator.textContent = 'Focus Period';
          indicator.style.color = '#4F46E5'; // Indigo
          if (ring) {
            ring.style.stroke = '#4F46E5';
          }
        } else {
          indicator.textContent = 'On Break';
          indicator.style.color = '#10B981'; // Emerald
          if (ring) {
            ring.style.stroke = '#10B981';
          }
        }

        if (ring) {
          const pct = Math.min(100, (remainingSecs / totalPeriodSecs) * 100);
          const dashoffset = 283 - (pct / 100) * 283;
          ring.style.strokeDashoffset = dashoffset;
        }
      } else {
        indicator.classList.add('hidden');
        cyclesText.classList.add('hidden');
        if (ring) {
          ring.style.stroke = 'var(--color-primary)';
        }

        const secs = Math.floor(this.totalElapsedSeconds % 60);
        const mins = Math.floor((this.totalElapsedSeconds / 60) % 60);
        const hours = Math.floor(this.totalElapsedSeconds / 3600);

        const fSecs = secs.toString().padStart(2, '0');
        const fMins = mins.toString().padStart(2, '0');
        const fHours = hours.toString().padStart(2, '0');

        digits.textContent = `${fHours}:${fMins}:${fSecs}`;

        if (ring) {
          const targetSecs = 3600;
          const pct = Math.min(100, (this.totalElapsedSeconds / targetSecs) * 100);
          const dashoffset = 283 - (pct / 100) * 283;
          ring.style.strokeDashoffset = dashoffset;
        }
      }

      if (this.isPaused) {
        btnPause.classList.add('hidden');
        btnResume.classList.remove('hidden');
        btnEnd.classList.remove('hidden');
      } else {
        btnPause.classList.remove('hidden');
        btnResume.classList.add('hidden');
        btnEnd.classList.remove('hidden');
      }
    } else {
      setupPanel.classList.remove('hidden');
      btnStart.classList.remove('hidden');
      pill.classList.add('hidden');
      btnPause.classList.add('hidden');
      btnResume.classList.add('hidden');
      btnEnd.classList.add('hidden');
      indicator.classList.add('hidden');
      cyclesText.classList.add('hidden');
      if (ring) {
        ring.style.stroke = 'var(--color-primary)';
        ring.style.strokeDashoffset = 283;
      }
      digits.textContent = '00:00:00';
    }
  }
};

// Audio synthesizer for transition sound alert
function playChime() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const playTone = (freq, duration, startTime) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      gainNode.gain.setValueAtTime(0.1, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };
    const now = audioCtx.currentTime;
    playTone(523.25, 0.4, now);
    playTone(659.25, 0.5, now + 0.15);
  } catch (err) {
    console.error('Audio chime failed:', err);
  }
}

// Browser notifications wrapper
function requestNotificationPermission() {
  if ('Notification' in window) {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }
}

function sendLocalNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, {
      body,
      icon: '/favicon.ico'
    });
  }
  showToast(`${title}: ${body}`, 'info');
}

// Wellness tips rotator
const wellnessTips = [
  "Stretch your arms and release tension in your shoulders.",
  "Look away from the screen! Focus on an object 20 feet away for 20 seconds.",
  "Stay hydrated! Take a quick sip of water.",
  "Correct your posture. Sit up straight and keep your feet flat.",
  "Inhale deeply for 4 seconds, hold for 4, exhale for 4. Clear your mind.",
  "Remember: Consistency wins! Small study increments daily form long-term memories."
];
let tipIndex = 0;

function nextWellnessTip() {
  tipIndex = (tipIndex + 1) % wellnessTips.length;
  const tipText = document.getElementById('wellness-tip-text');
  if (tipText) {
    tipText.style.opacity = 0;
    setTimeout(() => {
      tipText.textContent = wellnessTips[tipIndex];
      tipText.style.opacity = 1;
    }, 200);
  }
}

window.StudyTimer = StudyTimer;
window.nextWellnessTip = nextWellnessTip;
