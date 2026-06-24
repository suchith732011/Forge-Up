// Main Client SPA Router and Action Controller for ForgeUp
const App = {
  currentUser: null,
  activeView: 'home',
  currentChartPeriod: 'daily',
  analyticsData: null,

  async init() {
    // 1. Get CSRF Token
    await this.fetchCsrfToken();

    // 2. Initial Theme Load
    this.initTheme();

    // 3. Check for verification or reset tokens in URL
    this.checkUrlParams();

    // 4. Check developer mode toggle (?dev=true)
    this.checkDevMode();

    // 5. Fetch auth user
    await this.fetchUser();

    // 5. Initialize study timer recovery
    window.StudyTimer.init();

    // 6. Load data (standings, goals, sessions)
    await this.refreshData();

    // Restore last selected study mode
    const savedMode = localStorage.getItem('forgeup_last_study_mode') || 'normal';
    const studyModeSelect = document.getElementById('study-mode');
    if (studyModeSelect) {
      studyModeSelect.value = savedMode;
      const pomodoroOpts = document.getElementById('pomodoro-options');
      if (savedMode === 'pomodoro') {
        pomodoroOpts.classList.remove('hidden');
      } else {
        pomodoroOpts.classList.add('hidden');
      }
    }

    // 8. Bind all dynamic event listeners
    this.setupEventListeners();
  },

  setupEventListeners() {
    const bindClick = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    const bindSubmit = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('submit', fn);
    };

    // 1. Auth Tabs
    bindClick('auth-tab-login', () => switchAuthTab('login'));
    bindClick('auth-tab-register', () => switchAuthTab('register'));

    // 2. Auth Forms
    bindSubmit('form-login', handleLogin);
    bindSubmit('form-register', handleRegister);
    bindSubmit('form-forgot', handleForgotPassword);
    bindSubmit('form-reset', handleResetPassword);

    // 3. Auth links
    bindClick('link-forgot-password', (e) => showForgotPassword(e));
    bindClick('link-back-to-login', () => switchAuthTab('login'));
    bindClick('register-link-tos', (e) => showToS(e));
    bindClick('register-link-privacy', (e) => showPrivacy(e));

    // 4. Sidebar Nav links
    bindClick('nav-home', (e) => { e.preventDefault(); navigateTo('home'); });
    bindClick('nav-study', (e) => { e.preventDefault(); navigateTo('study'); });
    bindClick('nav-leaderboard', (e) => { e.preventDefault(); navigateTo('leaderboard'); });
    bindClick('nav-achievements', (e) => { e.preventDefault(); navigateTo('achievements'); });
    bindClick('nav-profile', (e) => { e.preventDefault(); navigateTo('profile'); });

    // 5. Theme toggle
    const themeBtn = document.getElementById('theme-toggle-btn');
    if (themeBtn) themeBtn.addEventListener('click', () => toggleTheme());

    // 6. Sidebar User Pill
    const userPills = document.querySelectorAll('.user-pill');
    userPills.forEach(pill => {
      pill.addEventListener('click', () => navigateTo('profile'));
    });

    // 7. Verification Banner link
    bindClick('link-resend-verification', (e) => { e.preventDefault(); resendVerificationEmail(); });

    // 8. Dashboard Chart Period Buttons
    bindClick('btn-chart-daily', () => loadDashboardChart('daily'));
    bindClick('btn-chart-weekly', () => loadDashboardChart('weekly'));
    bindClick('btn-chart-monthly', () => loadDashboardChart('monthly'));

    // 9. Show Target modal
    bindClick('btn-show-create-target', () => showCreateTargetModal());

    // 10. Study Timer Controls
    bindClick('btn-timer-start', () => startStudySession());
    bindClick('btn-timer-pause', () => pauseStudySession());
    bindClick('btn-timer-resume', () => resumeStudySession());
    bindClick('btn-timer-end', () => endStudySession());

    // 11. Next Wellness Tip button
    bindClick('btn-next-wellness-tip', () => nextWellnessTip());

    // 12. Leaderboard Tab buttons
    bindClick('btn-lb-alltime', () => loadLeaderboard('alltime'));
    bindClick('btn-lb-seasonal', () => loadLeaderboard('seasonal'));

    // 13. Profile page actions
    bindClick('btn-profile-how-works', () => showHowItWorksModal());
    bindClick('btn-profile-logout', () => handleLogout());

    // 14. Settings / Password Forms
    bindSubmit('form-settings', handleSaveSettings);
    bindSubmit('form-change-password', handleChangePassword);

    // 15. Download / Delete actions
    bindClick('btn-download-data', () => downloadUserData());
    bindClick('btn-delete-account', () => deleteUserAccount());

    // 16. Footer Links
    bindClick('footer-link-privacy', (e) => showPrivacy(e));
    bindClick('footer-link-tos', (e) => showToS(e));
    bindClick('footer-link-how-works', (e) => showHowItWorksModal(e));
    bindClick('auth-link-privacy', (e) => showPrivacy(e));
    bindClick('auth-link-tos', (e) => showToS(e));
    bindClick('auth-link-privacy-blocked', (e) => showPrivacy(e));
    bindClick('auth-link-tos-blocked', (e) => showToS(e));

    // 16b. Verification Block Actions
    bindClick('btn-resend-blocked-verification', () => resendVerificationEmail());
    bindClick('btn-logout-blocked-verification', () => handleLogout());

    // 17. Modal Close buttons
    bindClick('btn-close-create-target', () => closeCreateTargetModal());
    bindClick('btn-close-how-works', () => closeHowItWorksModal());
    bindClick('btn-close-privacy', () => closePrivacyModal());
    bindClick('btn-close-tos', () => closeToSModal());

    // 18. Target creation form & inputs
    bindSubmit('form-create-target', handleCreateTarget);
    const targetTypeSelect = document.getElementById('target-type');
    if (targetTypeSelect) {
      targetTypeSelect.addEventListener('change', () => toggleTargetTypeFields());
    }

    // 20. Study Mode Selector & Preset logic
    const studyModeSelect = document.getElementById('study-mode');
    if (studyModeSelect) {
      studyModeSelect.addEventListener('change', () => {
        const mode = studyModeSelect.value;
        const pomodoroOpts = document.getElementById('pomodoro-options');
        if (mode === 'pomodoro') {
          pomodoroOpts.classList.remove('hidden');
        } else {
          pomodoroOpts.classList.add('hidden');
        }
        localStorage.setItem('forgeup_last_study_mode', mode);
      });
    }

    const pomodoroPresetSelect = document.getElementById('pomodoro-preset');
    if (pomodoroPresetSelect) {
      pomodoroPresetSelect.addEventListener('change', () => {
        const preset = pomodoroPresetSelect.value;
        const customTimes = document.getElementById('pomodoro-custom-times');
        if (preset === 'custom') {
          customTimes.classList.remove('hidden');
        } else {
          customTimes.classList.add('hidden');
        }
      });
    }

    // 19. Dev Tools
    bindClick('btn-dev-seed', () => triggerSeedData());
    bindClick('btn-dev-cleanup', () => triggerCleanupData());

    // 21. Toggle Passwords
    const bindPasswordToggle = (toggleId, inputId) => {
      const checkbox = document.getElementById(toggleId);
      const input = document.getElementById(inputId);
      if (checkbox && input) {
        checkbox.addEventListener('change', () => {
          input.type = checkbox.checked ? 'text' : 'password';
        });
      }
    };
    bindPasswordToggle('toggle-login-password', 'login-password');
    bindPasswordToggle('toggle-register-password', 'register-password');
    bindPasswordToggle('toggle-reset-new-password', 'reset-new-password');
    bindPasswordToggle('toggle-change-pwd-current', 'change-pwd-current');
    bindPasswordToggle('toggle-change-pwd-new', 'change-pwd-new');
  },

  async fetchCsrfToken() {
    try {
      const res = await fetch('/api/csrf-token');
      const data = await res.json();
      window.csrfToken = data.csrfToken;
    } catch (err) {
      console.error('Failed to retrieve CSRF token:', err);
    }
  },

  initTheme() {
    const cached = localStorage.getItem('forgeup_theme') || 'light';
    document.documentElement.setAttribute('data-theme', cached);
  },

  checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('resetToken');
    const verifyToken = params.get('verifyToken');

    if (resetToken) {
      // Toggle to password reset form
      this.showAuthView();
      switchAuthTab('reset');
      window.resetPasswordToken = resetToken;
      // Clean query param
      window.history.replaceState({}, document.title, "/");
    } else if (verifyToken) {
      // Direct call verify email
      fetch(`/api/auth/verify-email?token=${verifyToken}`)
        .then(res => res.text())
        .then(html => {
          document.body.innerHTML = html;
        });
    }
  },

  checkDevMode() {
    const params = new URLSearchParams(window.location.search);
    const isDev = params.get('dev') === 'true';
    const panel = document.getElementById('dev-control-panel');
    if (isDev && panel) {
      panel.classList.remove('hidden');
    }
  },

  async fetchUser() {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      
      if (data.user) {
        this.currentUser = data.user;
        this.showAppShell();
        window.StudyTimer.syncWithServer(this.currentUser.activeSession);
        await this.refreshData();
      } else {
        this.currentUser = null;
        this.showAuthView();
      }
    } catch (err) {
      console.error('User fetch failed:', err);
      this.showAuthView();
    }
  },

  showAuthView() {
    document.getElementById('view-auth').classList.remove('hidden');
    document.getElementById('view-verification').classList.add('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  },

  showAppShell() {
    document.getElementById('view-auth').classList.add('hidden');
    document.getElementById('view-verification').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    
    // Update user details in navigation sidebar
    const namePill = document.getElementById('username-pill');
    const lvlPill = document.getElementById('level-pill');
    const avatarPill = document.getElementById('avatar-pill');

    if (namePill) namePill.textContent = this.currentUser.username;
    if (lvlPill) lvlPill.textContent = `Level ${this.currentUser.level}`;
    if (avatarPill) avatarPill.textContent = this.currentUser.username[0].toUpperCase();

    // Toggle verification banner (kept hidden since verification is optional)
    const banner = document.getElementById('verification-banner');
    if (banner) {
      banner.classList.add('hidden');
    }
  },

  setupRouter() {
    // Check if hash matches view
    const hash = window.location.hash.replace('#', '');
    if (['home', 'study', 'leaderboard', 'achievements', 'profile'].includes(hash)) {
      this.navigateTo(hash);
    }
  },

  navigateTo(viewName) {
    this.activeView = viewName;
    window.location.hash = viewName;

    // Toggle active view panel
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.remove('active');
    });
    const activePanel = document.getElementById(`view-${viewName}`);
    if (activePanel) activePanel.classList.add('active');

    // Toggle active nav links
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
      item.classList.remove('active');
    });
    const activeLink = document.getElementById(`nav-${viewName}`);
    if (activeLink) activeLink.classList.add('active');

    this.refreshView(viewName);
  },

  async refreshData() {
    if (!this.currentUser) return;
    try {
      // Reload user profile info from server
      const resMe = await fetch('/api/auth/me');
      const dataMe = await resMe.json();
      if (dataMe.user) {
        this.currentUser = dataMe.user;
        this.showAppShell();
        window.StudyTimer.syncWithServer(this.currentUser.activeSession);
      }



      // Fetch goals & sessions analytics
      const resAnal = await fetch('/api/study/analytics');
      this.analyticsData = await resAnal.json();

      this.refreshView(this.activeView);
    } catch (err) {
      console.error('Data refresh error:', err);
    }
  },

  refreshView(viewName) {
    switch (viewName) {
      case 'home':
        this.renderHomeView();
        break;
      case 'study':
        this.renderStudyView();
        break;
      case 'leaderboard':
        this.renderLeaderboardView();
        break;
      case 'achievements':
        this.renderAchievementsView();
        break;
      case 'profile':
        this.renderProfileView();
        break;
    }
  },

  /* --------------------------------------------------
     Render View Methods
     -------------------------------------------------- */
  renderHomeView() {
    // Welcome message
    const msg = document.getElementById('welcome-message');
    if (msg) msg.textContent = `Hello, ${this.currentUser.username}!`;

    // Streak
    document.getElementById('dash-streak').textContent = this.currentUser.currentStreak || 0;

    // Level Stats
    document.getElementById('stat-level').textContent = `Level ${this.currentUser.level}`;
    document.getElementById('stat-consistency').textContent = `${this.currentUser.consistencyScore || 0}%`;

    const xp = this.currentUser.xp || 0;
    const reqXp = getXpRequiredForNextLevel(this.currentUser.level);
    const prevLevelXp = this.currentUser.level === 1 ? 0 : getXpRequiredForNextLevel(this.currentUser.level - 1);
    
    // Level progress filled
    const xpDiff = xp - prevLevelXp;
    const levelInterval = reqXp - prevLevelXp;
    const xpPct = Math.min(100, Math.max(0, (xpDiff / levelInterval) * 100));
    
    document.getElementById('stat-xp-details').textContent = `${xp} / ${reqXp} XP`;
    document.getElementById('stat-xp-fill').style.width = `${xpPct}%`;

    // Daily study stats
    let todayMinutes = 0;
    if (this.analyticsData && this.analyticsData.daily) {
      const todayStr = new Date().toISOString().split('T')[0];
      const todayObj = this.analyticsData.daily.find(d => d.date === todayStr);
      todayMinutes = todayObj ? todayObj.minutes : 0;
    }
    document.getElementById('stat-today-time').textContent = `${todayMinutes}m`;

    let weekMinutes = 0;
    if (this.analyticsData && this.analyticsData.daily) {
      weekMinutes = this.analyticsData.daily.reduce((acc, d) => acc + d.minutes, 0);
    }
    const weekHours = Math.floor(weekMinutes / 60);
    const weekRemMins = weekMinutes % 60;
    document.getElementById('stat-week-time').textContent = `${weekHours}h ${weekRemMins}m`;

    // Charts & Heatmaps
    this.renderHomeChart();
    if (this.analyticsData && this.analyticsData.heatmap) {
      window.Charts.renderHeatmap('heatmap-container', this.analyticsData.heatmap);
    }

    // Render Targets list
    this.renderTargetsWidget();

    // Render Milestones
    this.renderMilestones();
  },

  renderHomeChart() {
    if (!this.analyticsData) return;
    const period = this.currentChartPeriod; // 'daily', 'weekly', 'monthly'
    let chartData = [];
    let xKey = '';
    let yKey = 'minutes';

    if (period === 'daily') {
      chartData = this.analyticsData.daily || [];
      xKey = 'date';
    } else if (period === 'weekly') {
      chartData = this.analyticsData.weekly || [];
      xKey = 'weekStart';
    } else if (period === 'monthly') {
      chartData = this.analyticsData.monthly || [];
      xKey = 'month';
    }

    window.Charts.renderBarChart('analytics-svg-chart', chartData, xKey, yKey, 'm');
  },

  async renderTargetsWidget() {
    const container = document.getElementById('targets-list-container');
    if (!container) return;

    try {
      const res = await fetch('/api/goals');
      const goals = await res.json();
      container.innerHTML = '';

      if (goals.length === 0) {
        container.innerHTML = '<p class="placeholder-text">No active study targets. Create one to bolster your Consistency Score!</p>';
        return;
      }

      goals.forEach(goal => {
        const item = document.createElement('div');
        item.className = `target-item ${goal.completed ? 'target-completed' : ''}`;
        
        let desc = goal.description || '';
        if (goal.targetMinutes) {
          const comp = Math.round(goal.completedMinutes || 0);
          desc += ` (Progress: ${comp}/${goal.targetMinutes} mins)`;
        }

        const dateStr = new Date(goal.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

        item.innerHTML = `
          <div class="target-main">
            <span class="target-title-text">${goal.title}</span>
            <span class="target-meta">${desc} • Due ${dateStr}</span>
          </div>
          <div class="target-actions">
            ${!goal.completed ? `<button class="btn btn-xs btn-success" onclick="App.toggleGoal('${goal.id}', true)">✓ Done</button>` : ''}
            <button class="btn btn-xs btn-outline text-danger" onclick="App.deleteGoal('${goal.id}')">×</button>
          </div>
        `;
        container.appendChild(item);
      });
    } catch (err) {
      container.innerHTML = '<p class="placeholder-text text-danger">Error loading study targets.</p>';
    }
  },

  renderMilestones() {
    const container = document.getElementById('milestones-container');
    if (!container) return;
    container.innerHTML = '';

    // Calculate progression details to the next key level threshold
    const xp = this.currentUser.xp || 0;
    const req = getXpRequiredForNextLevel(this.currentUser.level);
    const xpLeft = req - xp;

    // Define standard milestones list
    const milestones = [
      { title: `Reach Level ${this.currentUser.level + 1}`, goal: req, current: xp, unit: 'XP' },
      { title: 'Study for 10 Hours (Total)', goal: 600, current: (this.analyticsData ? this.analyticsData.lifetimeHours * 60 : 0), unit: 'm' },
      { title: 'Next Streak Milestone', goal: this.currentUser.currentStreak >= 7 ? 30 : 7, current: this.currentUser.currentStreak || 0, unit: 'd' }
    ];

    milestones.forEach(m => {
      const pct = Math.min(100, Math.max(0, (m.current / m.goal) * 100));
      const milesDiv = document.createElement('div');
      milesDiv.className = 'milestone-item';
      milesDiv.innerHTML = `
        <div class="milestone-header">
          <span class="milestone-title-text">${m.title}</span>
          <span class="milestone-progress-text">${Math.round(m.current)}/${m.goal} ${m.unit}</span>
        </div>
        <div class="stat-progress-bar"><div class="stat-progress-fill" style="width: ${pct}%"></div></div>
      `;
      container.appendChild(milesDiv);
    });
  },

  renderStudyView() {
    // Check if there is an active running study session on the client timer
    window.StudyTimer.syncUI();

    // Render recent sessions list
    const container = document.getElementById('session-history-container');
    if (!container) return;

    fetch('/api/study/analytics')
      .then(res => res.json())
      .then(data => {
        // Fetch sessions using me / analytics
        container.innerHTML = '';
        
        // Since we want recent sessions list, let's fetch matching sessions from history
        // Fetch list directly
        fetch('/api/auth/export-data')
          .then(res => res.json())
          .then(exportData => {
            const sessions = exportData.sessions || [];
            if (sessions.length === 0) {
              container.innerHTML = '<p class="placeholder-text">No recorded study sessions yet.</p>';
              return;
            }

            // Show latest 5
            const sorted = sessions.sort((a,b) => new Date(b.startTime) - new Date(a.startTime)).slice(0, 5);
            sorted.forEach(s => {
              const div = document.createElement('div');
              div.className = 'history-item';
              const dateStr = new Date(s.startTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
              const notes = s.notes ? `<div class="text-muted" style="font-size: 0.75rem; margin-top: 0.25rem;">Note: ${s.notes}</div>` : '';
              
              div.innerHTML = `
                <div class="history-main">
                  <span class="history-subject">${s.subject || 'Other'}</span>
                  <span class="history-meta">${Math.round(s.duration / 60)} mins • ${dateStr}</span>
                  ${notes}
                </div>
                <span class="history-xp">+${s.xpEarned} XP</span>
              `;
              container.appendChild(div);
            });
          });
      });
  },

  async renderLeaderboardView() {
    const tbody = document.getElementById('leaderboard-tbody');
    const lockedView = document.getElementById('leaderboard-locked-view');
    const activeView = document.getElementById('leaderboard-active-view');
    const type = document.getElementById('btn-lb-seasonal').classList.contains('active') ? 'seasonal' : 'alltime';

    if (!tbody) return;
    tbody.innerHTML = '';

    try {
      const res = await fetch(`/api/leaderboard?type=${type}`);
      
      if (res.status === 403) {
        // Email unverified block
        lockedView.classList.remove('hidden');
        activeView.classList.add('hidden');
        document.getElementById('leaderboard-lock-message').textContent = 'Please verify your email address to access the leaderboard features.';
        return;
      }

      if (!res.ok) throw new Error('Failed to load standings');
      const data = await res.json();

      lockedView.classList.add('hidden');
      activeView.classList.remove('hidden');

      if (data.leaderboard.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="placeholder-text">No registered students found on leaderboard.</td></tr>';
        return;
      }

      data.leaderboard.forEach(row => {
        const tr = document.createElement('tr');
        if (row.isSelf) tr.className = 'row-self';

        const rankDisplay = row.rank <= 3 
          ? `<span class="rank-badge rank-${row.rank}">${row.rank}</span>` 
          : `<span class="rank-badge">${row.rank}</span>`;

        const avatarChar = row.username[0].toUpperCase();
        
        let statsRow = '';
        if (row.isPublic || row.isSelf) {
          statsRow = `
            <td>Level ${row.level} (${row.xp} XP)</td>
            <td>🔥 ${row.streak} days</td>
            <td>${row.consistencyScore}%</td>
            <td>${Math.round(row.studyMins / 60)} hours</td>
          `;
        } else {
          statsRow = `
            <td class="text-muted">🔒 Masked</td>
            <td class="text-muted">🔒 Masked</td>
            <td class="text-muted">🔒 Masked</td>
            <td class="text-muted">🔒 Masked</td>
          `;
        }

        tr.innerHTML = `
          <td>${rankDisplay}</td>
          <td>
            <div class="lb-student-cell">
              <div class="lb-avatar">${avatarChar}</div>
              <strong>${row.username}</strong> ${row.isSelf ? '<span class="text-muted">(You)</span>' : ''}
            </div>
          </td>
          ${statsRow}
        `;
        tbody.appendChild(tr);
      });
    } catch (err) {
      lockedView.classList.remove('hidden');
      activeView.classList.add('hidden');
      document.getElementById('leaderboard-lock-message').textContent = 'An error occurred loading leaderboard standings.';
    }
  },

  renderAchievementsView() {
    const container = document.getElementById('achievements-container');
    if (!container) return;
    container.innerHTML = '';

    // Static catalog of achievements
    const catalog = [
      { id: 'first_session', title: 'First Study Session', desc: 'Complete your first study session.', badge: '⚡', category: 'Study' },
      { id: 'hours_10', title: '10 Hours Studied', desc: 'Accumulate 10 total hours of study time.', badge: '📚', category: 'Study' },
      { id: 'hours_50', title: '50 Hours Studied', desc: 'Accumulate 50 total hours of study time.', badge: '📖', category: 'Study' },
      { id: 'hours_100', title: '100 Hours Studied', desc: 'Accumulate 100 total hours of study time.', badge: '🎓', category: 'Study' },
      { id: 'hours_500', title: '500 Hours Studied', desc: 'Accumulate 500 total hours of study time.', badge: '👑', category: 'Study' },
      
      { id: 'streak_7', title: '7-Day Streak', desc: 'Maintain a study streak for 7 consecutive days.', badge: '🔥', category: 'Streak' },
      { id: 'streak_30', title: '30-Day Streak', desc: 'Maintain a study streak for 30 consecutive days.', badge: '🌋', category: 'Streak' },
      { id: 'streak_100', title: '100-Day Streak', desc: 'Maintain a study streak for 100 consecutive days.', badge: '🌠', category: 'Streak' },
      { id: 'streak_365', title: '365-Day Streak', desc: 'Maintain a study streak for 365 consecutive days.', badge: '🌌', category: 'Streak' },

      { id: 'consistency_master', title: 'Consistency Master', desc: 'Reach a Consistency Score of 90+.', badge: '🏆', category: 'Consistency' },
      { id: 'weekly_champion', title: 'Weekly Champion', desc: 'Study every day for an entire calendar week.', badge: '🎖️', category: 'Consistency' },
      { id: 'monthly_champion', title: 'Monthly Champion', desc: 'Study 25 days in a 28-day window.', badge: '👑', category: 'Consistency' },
      
      { id: 'goals_1', title: 'First Goal Completed', desc: 'Finish your first study target.', badge: '✅', category: 'Goals' },
      { id: 'goals_25', title: '25 Goals Completed', desc: 'Finish 25 study targets.', badge: '🎯', category: 'Goals' },
      { id: 'goals_100', title: '100 Goals Completed', desc: 'Finish 100 study targets.', badge: '🔮', category: 'Goals' }
    ];

    const unlocked = this.currentUser.achievements || [];
    const unlockedMap = {};
    unlocked.forEach(u => {
      unlockedMap[u.id] = u.unlockDate;
    });

    catalog.forEach(ach => {
      const isUnlocked = !!unlockedMap[ach.id];
      const card = document.createElement('div');
      card.className = `ach-card ${isUnlocked ? '' : 'locked'}`;

      let meta = `<span class="text-danger">Locked</span>`;
      if (isUnlocked) {
        const uDate = new Date(unlockedMap[ach.id]).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        meta = `<span class="text-success">Unlocked ${uDate}</span>`;
      }

      card.innerHTML = `
        <div class="ach-badge">${ach.badge}</div>
        <div class="ach-details">
          <span class="ach-title font-outfit">${ach.title}</span>
          <span class="ach-desc">${ach.desc}</span>
          <span class="ach-meta">${meta}</span>
        </div>
      `;
      container.appendChild(card);
    });
  },

  renderProfileView() {
    document.getElementById('profile-name').textContent = this.currentUser.username;
    
    const joinDate = new Date(this.currentUser.joinDate).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    document.getElementById('profile-join-date').textContent = `Joined: ${joinDate}`;

    document.getElementById('profile-avatar-char').textContent = this.currentUser.username[0].toUpperCase();
    document.getElementById('profile-lvl-badge').textContent = `Level ${this.currentUser.level}`;

    // Verification Badge
    const verifyBadge = document.getElementById('profile-verified-badge');
    if (this.currentUser.emailVerified) {
      verifyBadge.textContent = 'Verified Student';
      verifyBadge.className = 'badge badge-verified';
    } else {
      verifyBadge.textContent = 'Unverified';
      verifyBadge.className = 'badge btn-outline text-danger';
    }

    // Dynamic metrics
    document.getElementById('prof-consistency').textContent = `${this.currentUser.consistencyScore || 0}%`;
    document.getElementById('prof-active-days').textContent = this.currentUser.activeDays ? this.currentUser.activeDays.length : 0;
    
    const hrs = this.analyticsData ? this.analyticsData.lifetimeHours : 0;
    document.getElementById('prof-study-hours').textContent = `${hrs} hours`;
    document.getElementById('prof-longest-streak').textContent = `${this.currentUser.longestStreak || 0} days`;

    const pomodoroCycles = this.analyticsData ? this.analyticsData.totalPomodoroCycles : 0;
    const avgMins = this.analyticsData ? this.analyticsData.avgSessionMinutes : 0;
    const favPreset = this.analyticsData ? this.analyticsData.mostUsedPreset : 'N/A';

    document.getElementById('prof-pomodoro-cycles').textContent = pomodoroCycles || 0;
    document.getElementById('prof-avg-duration').textContent = `${avgMins || 0} mins`;
    document.getElementById('prof-fav-preset').textContent = favPreset || 'N/A';

    // Toggles state
    document.getElementById('settings-public-visibility').checked = this.currentUser.settings.profilePublic !== false;
    document.getElementById('settings-notifications').checked = this.currentUser.settings.notificationsEnabled !== false;
  },

  /* --------------------------------------------------
     Goal APIs and Handlers
     -------------------------------------------------- */
  async toggleGoal(id, completed) {
    try {
      const res = await fetch(`/api/goals/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': window.csrfToken
        },
        body: JSON.stringify({ completed })
      });

      if (!res.ok) throw new Error('Failed to update goal');
      const data = await res.json();
      
      showToast(`Goal completed! +${data.xpEarned} XP!`, 'success');
      if (data.leveledUp) {
        showToast(`🎉 Leveled Up! Reached Level ${data.level}!`, 'success');
      }

      await this.refreshData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  },

  async deleteGoal(id) {
    if (!confirm('Are you sure you want to delete this study target?')) return;
    try {
      const res = await fetch(`/api/goals/${id}`, {
        method: 'DELETE',
        headers: {
          'x-csrf-token': window.csrfToken
        }
      });

      if (!res.ok) throw new Error('Failed to delete goal');
      showToast('Target deleted.', 'success');
      await this.refreshData();
    } catch (err) {
      showToast(err.message, 'danger');
    }
  }
};

// Global helper to show toast notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let emoji = '✨';
  if (type === 'success') emoji = '✅';
  else if (type === 'danger') emoji = '❌';
  else if (type === 'warning') emoji = '⚠️';
  else if (type === 'info') emoji = 'ℹ️';

  toast.innerHTML = `<span>${emoji}</span><div>${message}</div>`;
  container.appendChild(toast);

  // Auto remove toast
  setTimeout(() => {
    toast.style.transform = 'translateX(100%)';
    toast.style.opacity = 0;
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Level requirements matching backend
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

/* --------------------------------------------------
   Frontend Action Handlers (Auth, Register, etc.)
   -------------------------------------------------- */

function switchAuthTab(tab) {
  const loginForm = document.getElementById('form-login');
  const regForm = document.getElementById('form-register');
  const forgotForm = document.getElementById('form-forgot');
  const resetForm = document.getElementById('form-reset');

  const tabLoginBtn = document.getElementById('auth-tab-login');
  const tabRegBtn = document.getElementById('auth-tab-register');

  // Hide all
  loginForm.classList.add('hidden');
  regForm.classList.add('hidden');
  forgotForm.classList.add('hidden');
  resetForm.classList.add('hidden');

  if (tab === 'login') {
    loginForm.classList.remove('hidden');
    tabLoginBtn.classList.add('active');
    tabRegBtn.classList.remove('active');
  } else if (tab === 'register') {
    regForm.classList.remove('hidden');
    tabRegBtn.classList.add('active');
    tabLoginBtn.classList.remove('active');
  } else if (tab === 'forgot') {
    forgotForm.classList.remove('hidden');
    tabRegBtn.classList.remove('active');
    tabLoginBtn.classList.remove('active');
  } else if (tab === 'reset') {
    resetForm.classList.remove('hidden');
    tabRegBtn.classList.remove('active');
    tabLoginBtn.classList.remove('active');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameOrEmail = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ usernameOrEmail, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');

    showToast('Welcome back to ForgeUp! 🔥', 'success');
    App.currentUser = data.user;
    App.showAppShell();
    window.StudyTimer.syncWithServer(App.currentUser.activeSession);
    await App.refreshData();
    App.navigateTo('home');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleRegister(e) {
  e.preventDefault();
  const username = document.getElementById('register-username').value;
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ username, email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');

    showToast('Registration successful! Check verification email in logs. 📧', 'success');
    App.currentUser = data.user;
    App.showAppShell();
    window.StudyTimer.syncWithServer(App.currentUser.activeSession);
    await App.refreshData();
    App.navigateTo('home');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function showForgotPassword(e) {
  e.preventDefault();
  switchAuthTab('forgot');
}

async function handleForgotPassword(e) {
  e.preventDefault();
  const email = document.getElementById('forgot-email').value;

  try {
    const res = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    showToast(data.message || 'If an account exists, a recovery link has been sent.', 'success');
    switchAuthTab('login');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleResetPassword(e) {
  e.preventDefault();
  const newPassword = document.getElementById('reset-new-password').value;
  const token = window.resetPasswordToken;

  try {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ token, newPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password reset failed');

    showToast('Password reset successfully! You can now log in.', 'success');
    switchAuthTab('login');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function resendVerificationEmail() {
  try {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: {
        'x-csrf-token': window.csrfToken
      }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Verification email resent. Check logs! 📧', 'success');
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Global Nav trigger shortcut
function navigateTo(view) {
  App.navigateTo(view);
}

// Chart toggle periods
function loadDashboardChart(period) {
  App.currentChartPeriod = period;
  
  // Set active tab styling
  document.querySelectorAll('.chart-toggles button').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-chart-${period}`).classList.add('active');

  App.renderHomeChart();
}

function loadLeaderboard(type) {
  document.querySelectorAll('.leaderboard-tabs button').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-lb-${type}`).classList.add('active');

  App.renderLeaderboardView();
}

/* --------------------------------------------------
   Active Study Timer actions
   -------------------------------------------------- */
function startStudySession() {
  const subject = document.getElementById('study-subject').value;
  const notes = document.getElementById('study-notes').value;
  const timerMode = document.getElementById('study-mode').value;
  
  let pomodoroPreset = null;
  let studyDuration = 0;
  let breakDuration = 0;

  if (timerMode === 'pomodoro') {
    pomodoroPreset = document.getElementById('pomodoro-preset').value;
    if (pomodoroPreset === '25/5') {
      studyDuration = 25 * 60;
      breakDuration = 5 * 60;
    } else if (pomodoroPreset === '50/10') {
      studyDuration = 50 * 60;
      breakDuration = 10 * 60;
    } else if (pomodoroPreset === '90/20') {
      studyDuration = 90 * 60;
      breakDuration = 20 * 60;
    } else if (pomodoroPreset === 'custom') {
      const customStudy = parseInt(document.getElementById('pomodoro-custom-study').value, 10) || 25;
      const customBreak = parseInt(document.getElementById('pomodoro-custom-break').value, 10) || 5;
      studyDuration = customStudy * 60;
      breakDuration = customBreak * 60;
    }
  }

  window.StudyTimer.start(subject, notes, {
    timerMode,
    pomodoroPreset,
    studyDuration,
    breakDuration
  });
}

function pauseStudySession() {
  window.StudyTimer.pause();
}

function resumeStudySession() {
  window.StudyTimer.resume();
}

function endStudySession() {
  window.StudyTimer.end();
}

/* --------------------------------------------------
   Targets (Goals) modal & creations
   -------------------------------------------------- */
function showCreateTargetModal() {
  document.getElementById('modal-create-target').classList.remove('hidden');
}
function closeCreateTargetModal() {
  document.getElementById('modal-create-target').classList.add('hidden');
}
function toggleTargetTypeFields() {
  const type = document.getElementById('target-type').value;
  const timeField = document.getElementById('target-time-field');
  if (type === 'custom') {
    timeField.classList.add('hidden');
  } else {
    timeField.classList.remove('hidden');
  }
}

async function handleCreateTarget(e) {
  e.preventDefault();
  const title = document.getElementById('target-title').value;
  const description = document.getElementById('target-desc').value;
  const type = document.getElementById('target-type').value;
  const targetMinutes = document.getElementById('target-minutes').value;
  const deadline = document.getElementById('target-deadline').value;

  try {
    const res = await fetch('/api/goals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({
        title,
        description,
        type,
        targetMinutes: targetMinutes ? parseInt(targetMinutes, 10) : null,
        deadline
      })
    });

    if (!res.ok) throw new Error('Goal creation failed');
    showToast('Study target created!', 'success');
    closeCreateTargetModal();
    document.getElementById('form-create-target').reset();
    await App.refreshData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

/* --------------------------------------------------
   Settings Forms and Action APIs
   -------------------------------------------------- */
async function handleSaveSettings(e) {
  e.preventDefault();
  const profilePublic = document.getElementById('settings-public-visibility').checked;
  const notificationsEnabled = document.getElementById('settings-notifications').checked;

  try {
    const res = await fetch('/api/auth/settings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ profilePublic, notificationsEnabled })
    });

    if (!res.ok) throw new Error('Settings update failed');
    showToast('Settings saved successfully.', 'success');
    await App.refreshData();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('change-pwd-current').value;
  const newPassword = document.getElementById('change-pwd-new').value;

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': window.csrfToken
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Password update failed');

    showToast('Password updated successfully.', 'success');
    document.getElementById('form-change-password').reset();
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

function downloadUserData() {
  window.open('/api/auth/export-data', '_blank');
}

async function deleteUserAccount() {
  if (!confirm('WARNING: Deleting your account is permanent and cannot be undone. All your stats, sessions, and goals will be completely erased. Are you sure you want to proceed?')) return;
  
  try {
    const res = await fetch('/api/auth/delete-account', {
      method: 'POST',
      headers: {
        'x-csrf-token': window.csrfToken
      }
    });

    if (!res.ok) throw new Error('Account deletion failed');
    showToast('Account permanently deleted. Goodbye!', 'success');
    
    if (window.StudyTimer) {
      window.StudyTimer.reset();
    }
    
    // Refresh page back to login
    setTimeout(() => {
      window.location.reload();
    }, 2000);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

async function handleLogout() {
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'x-csrf-token': window.csrfToken
      }
    });
    if (!res.ok) throw new Error('Logout failed');
    showToast('Logged out successfully.', 'success');
    
    if (window.StudyTimer) {
      window.StudyTimer.reset();
    }
    
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  } catch (err) {
    showToast(err.message, 'danger');
  }
}

// Theme logic
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('forgeup_theme', next);
}

// Dev data triggers
async function triggerSeedData() {
  const status = document.getElementById('dev-status');
  status.textContent = 'Seeding...';
  try {
    const res = await fetch('/api/test/seed');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    status.textContent = 'Successfully Seeded 30 users!';
    showToast(data.message, 'success');
    await App.refreshData();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    showToast(err.message, 'danger');
  }
}

async function triggerCleanupData() {
  const status = document.getElementById('dev-status');
  status.textContent = 'Clearing...';
  try {
    const res = await fetch('/api/test/cleanup');
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    status.textContent = 'Successfully Cleared!';
    showToast(data.message, 'success');
    await App.refreshData();
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
    showToast(err.message, 'danger');
  }
}

/* Modals views */
function showHowItWorksModal() { document.getElementById('modal-how-works').classList.remove('hidden'); }
function closeHowItWorksModal() { document.getElementById('modal-how-works').classList.add('hidden'); }

function showPrivacy(e) { if(e) e.preventDefault(); document.getElementById('modal-privacy').classList.remove('hidden'); }
function closePrivacyModal() { document.getElementById('modal-privacy').classList.add('hidden'); }

function showToS(e) { if(e) e.preventDefault(); document.getElementById('modal-tos').classList.remove('hidden'); }
function closeToSModal() { document.getElementById('modal-tos').classList.add('hidden'); }

// Run init
window.addEventListener('DOMContentLoaded', () => {
  App.init();
});

window.App = App;
