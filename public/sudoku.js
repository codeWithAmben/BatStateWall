// BatStateU Sudoku Arena & Live Community Rankings
// Works alongside window.BatStateWall (exposed by app.js) inside an isolated module scope.

(function initBatStateSudoku() {
  const MAX_UNDO_STEPS = 120;
  const SOUND_STORAGE_KEY = 'batstate_sudoku_muted';

  // ==================== Procedural Web Audio Micro-SFX ====================
  const SudokuAudio = {
    ctx: null,
    muted: false,

    init() {
      try {
        this.muted = window.localStorage.getItem(SOUND_STORAGE_KEY) === '1';
      } catch {
        this.muted = false;
      }
    },

    ensureContext() {
      if (this.muted) {
        return null;
      }
      if (!this.ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) {
          return null;
        }
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    },

    tone(freq, duration = 0.06, type = 'sine', volume = 0.04, delay = 0) {
      const ctx = this.ensureContext();
      if (!ctx) {
        return;
      }
      const start = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + duration + 0.02);
    },

    playSelect() {
      this.tone(420, 0.03, 'triangle', 0.015);
    },

    playPlace(combo = 1) {
      const boost = Math.min(combo, 6) * 24;
      this.tone(520 + boost, 0.055, 'sine', 0.04);
    },

    playNote() {
      this.tone(680, 0.035, 'triangle', 0.02);
    },

    playErase() {
      this.tone(280, 0.045, 'sine', 0.025);
    },

    playMistake() {
      this.tone(185, 0.14, 'sawtooth', 0.045);
      this.tone(145, 0.16, 'sawtooth', 0.04, 0.08);
    },

    playHint() {
      this.tone(660, 0.08, 'sine', 0.035);
      this.tone(880, 0.1, 'sine', 0.04, 0.07);
    },

    playUnitComplete() {
      [523.25, 659.25, 783.99].forEach((freq, idx) => {
        this.tone(freq, 0.11, 'triangle', 0.045, idx * 0.055);
      });
    },

    playVictory() {
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        this.tone(freq, 0.18, 'triangle', 0.055, idx * 0.09);
      });
    },
  };

  SudokuAudio.init();

  // ==================== DOM References ====================
  const openSudokuBtn = document.getElementById('open-sudoku-btn');
  const sidebarPlayBtn = document.getElementById('sidebar-play-sudoku-btn');
  const mobilePlayBtn = document.getElementById('mobile-play-sudoku-btn');

  const sidebarRankingsTabs = document.getElementById('sidebar-rankings-tabs');
  const sidebarRankingsList = document.getElementById('sidebar-rankings-list');
  const sidebarMyRankEl = document.getElementById('sidebar-my-rank');
  const openRankingsBtn = document.getElementById('open-rankings-btn');
  const mobileOpenRankingsBtn = document.getElementById('mobile-open-rankings-btn');

  const sudokuModal = document.getElementById('sudoku-modal');
  const closeSudokuBtn = document.getElementById('close-sudoku-modal');
  const sudokuModeBadge = document.getElementById('sudoku-mode-badge');
  const sudokuPauseBtn = document.getElementById('sudoku-pause-btn');
  const sudokuSoundBtn = document.getElementById('sudoku-sound-btn');
  const soundOnIcon = sudokuSoundBtn?.querySelector('.sound-on-icon');
  const soundOffIcon = sudokuSoundBtn?.querySelector('.sound-off-icon');
  const sudokuModeTabs = document.getElementById('sudoku-mode-tabs');

  const timerEl = document.getElementById('sudoku-timer');
  const mistakesEl = document.getElementById('sudoku-mistakes');
  const hintsHudEl = document.getElementById('sudoku-hints-hud');
  const comboEl = document.getElementById('sudoku-combo');
  const comboCountEl = document.getElementById('sudoku-combo-count');

  const gridEl = document.getElementById('sudoku-grid');
  const loadingOverlay = document.getElementById('sudoku-loading-overlay');
  const pausedOverlay = document.getElementById('sudoku-paused-overlay');
  const resumeBtn = document.getElementById('sudoku-resume-btn');
  const resultOverlay = document.getElementById('sudoku-result-overlay');
  const resultBadge = document.getElementById('sudoku-result-badge');
  const resultTitle = document.getElementById('sudoku-result-title');
  const resultSubtitle = document.getElementById('sudoku-result-subtitle');
  const scoreBreakdownEl = document.getElementById('sudoku-score-breakdown');
  const shareWinBtn = document.getElementById('sudoku-share-win-btn');
  const playAgainBtn = document.getElementById('sudoku-play-again-btn');

  const undoBtn = document.getElementById('sudoku-undo-btn');
  const redoBtn = document.getElementById('sudoku-redo-btn');
  const eraseBtn = document.getElementById('sudoku-erase-btn');
  const notesBtn = document.getElementById('sudoku-notes-btn');
  const notesBadge = document.getElementById('sudoku-notes-badge');
  const hintBtn = document.getElementById('sudoku-hint-btn');
  const hintCountBadge = document.getElementById('sudoku-hint-count');
  const numpadEl = document.getElementById('sudoku-numpad');
  const newGameBtn = document.getElementById('sudoku-new-game-btn');
  const openRanksFromGameBtn = document.getElementById('sudoku-open-ranks-btn');
  const statusEl = document.getElementById('sudoku-status');

  const rankingsModal = document.getElementById('rankings-modal');
  const closeRankingsBtn = document.getElementById('close-rankings-modal');
  const rankingsTabsEl = document.getElementById('rankings-tabs');
  const rankingsSubtitleEl = document.getElementById('rankings-subtitle');
  const fullRankingsList = document.getElementById('full-rankings-list');
  const fullRankingsMe = document.getElementById('full-rankings-me');

  // ==================== Game & Rankings State ====================
  const game = {
    phase: 'idle', // idle | loading | playing | paused | won | lost
    sessionId: null,
    mode: 'classic',
    difficulty: 'easy',
    dailyDate: null,
    puzzle: '0'.repeat(81),
    board: new Array(81).fill('0'),
    notes: new Map(), // Map<cellIdx, Set<digit>>
    wrongCells: new Set(),
    hintedCells: new Set(),
    selectedIdx: -1,
    notesMode: false,
    mistakes: 0,
    maxMistakes: 3,
    hintsUsed: 0,
    maxHints: 3,
    elapsedSec: 0,
    combo: 0,
    completedUnits: new Set(),
    undoStack: [],
    redoStack: [],
    isSyncing: false,
    lastWinData: null,
    timerInterval: null,
  };

  let sidebarScope = 'overall';
  let fullRankingsScope = 'overall';
  let cellElements = [];
  let notesSyncTimer = null;

  function scheduleNotesSync(cellIdx) {
    if (!game.sessionId || game.phase !== 'playing' || game.board[cellIdx] !== '0') {
      return;
    }
    const targetSessionId = game.sessionId;
    window.clearTimeout(notesSyncTimer);
    notesSyncTimer = window.setTimeout(async () => {
      if (game.sessionId !== targetSessionId || game.phase !== 'playing' || game.board[cellIdx] !== '0') {
        return;
      }
      try {
        await fetch(`/api/sudoku/${targetSessionId}/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            index: cellIdx,
            value: 0,
            notes: serializeNotesForServer(),
            durationSeconds: game.elapsedSec,
          }),
        });
      } catch {
        // Ignore silent background note sync failures
      }
    }, 450);
  }

  function wall() {
    return window.BatStateWall || null;
  }

  function escapeHtml(text) {
    return wall()?.escapeHtml ? wall().escapeHtml(text) : String(text ?? '');
  }

  function formatDuration(totalSec) {
    const sec = Math.max(0, Math.floor(Number(totalSec) || 0));
    const mins = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }

  function setStatus(message, isError = false) {
    if (!statusEl) {
      return;
    }
    if (!message) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-error');
      statusEl.hidden = true;
      return;
    }
    statusEl.textContent = message;
    statusEl.classList.toggle('is-error', Boolean(isError));
    statusEl.hidden = false;
  }

  function syncSoundButtonUI() {
    if (!sudokuSoundBtn) {
      return;
    }
    const isMuted = SudokuAudio.muted;
    sudokuSoundBtn.setAttribute('aria-pressed', String(!isMuted));
    sudokuSoundBtn.title = isMuted ? 'Unmute sound effects' : 'Mute sound effects';
    if (soundOnIcon) {
      soundOnIcon.hidden = isMuted;
    }
    if (soundOffIcon) {
      soundOffIcon.hidden = !isMuted;
    }
  }

  function serializeNotesForServer() {
    const out = {};
    for (const [idx, digits] of game.notes.entries()) {
      if (digits.size > 0 && game.board[idx] === '0') {
        out[String(idx)] = Array.from(digits).sort((a, b) => a - b);
      }
    }
    return out;
  }

  function hydrateNotesMap(rawNotes) {
    const map = new Map();
    if (!rawNotes || typeof rawNotes !== 'object') {
      return map;
    }
    for (const [key, list] of Object.entries(rawNotes)) {
      const idx = Number(key);
      if (!Number.isInteger(idx) || idx < 0 || idx > 80 || !Array.isArray(list)) {
        continue;
      }
      const clean = new Set(
        list.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 1 && d <= 9)
      );
      if (clean.size > 0) {
        map.set(idx, clean);
      }
    }
    return map;
  }

  function cloneNotesMap(sourceMap) {
    const copy = new Map();
    for (const [idx, set] of sourceMap.entries()) {
      copy.set(idx, new Set(set));
    }
    return copy;
  }

  // ==================== Grid Construction & Rendering ====================

  function buildGridOnce() {
    if (!gridEl || cellElements.length === 81) {
      return;
    }
    gridEl.innerHTML = '';
    cellElements = [];

    for (let i = 0; i < 81; i += 1) {
      const row = Math.floor(i / 9);
      const col = i % 9;
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'sudoku-cell';
      cell.dataset.index = String(i);
      cell.setAttribute('role', 'gridcell');
      cell.setAttribute('aria-label', `Row ${row + 1} Column ${col + 1}`);

      if (col === 2 || col === 5) {
        cell.classList.add('box-right');
      }
      if (row === 2 || row === 5) {
        cell.classList.add('box-bottom');
      }

      gridEl.appendChild(cell);
      cellElements.push(cell);
    }
  }

  function getConflictIndices() {
    const conflicts = new Set(game.wrongCells);
    const groups = [];

    for (let r = 0; r < 9; r += 1) {
      const rowCells = [];
      for (let c = 0; c < 9; c += 1) rowCells.push(r * 9 + c);
      groups.push(rowCells);
    }
    for (let c = 0; c < 9; c += 1) {
      const colCells = [];
      for (let r = 0; r < 9; r += 1) colCells.push(r * 9 + c);
      groups.push(colCells);
    }
    for (let br = 0; br < 3; br += 1) {
      for (let bc = 0; bc < 3; bc += 1) {
        const boxCells = [];
        for (let r = br * 3; r < br * 3 + 3; r += 1) {
          for (let c = bc * 3; c < bc * 3 + 3; c += 1) {
            boxCells.push(r * 9 + c);
          }
        }
        groups.push(boxCells);
      }
    }

    for (const cells of groups) {
      const seen = new Map();
      for (const idx of cells) {
        const val = game.board[idx];
        if (val === '0') {
          continue;
        }
        if (seen.has(val)) {
          conflicts.add(idx);
          conflicts.add(seen.get(val));
        } else {
          seen.set(val, idx);
        }
      }
    }

    return conflicts;
  }

  function getPeerIndices(idx) {
    const peers = new Set();
    if (idx < 0 || idx > 80) {
      return peers;
    }
    const row = Math.floor(idx / 9);
    const col = idx % 9;
    const boxRow = Math.floor(row / 3) * 3;
    const boxCol = Math.floor(col / 3) * 3;

    for (let i = 0; i < 9; i += 1) {
      peers.add(row * 9 + i);
      peers.add(i * 9 + col);
    }
    for (let r = boxRow; r < boxRow + 3; r += 1) {
      for (let c = boxCol; c < boxCol + 3; c += 1) {
        peers.add(r * 9 + c);
      }
    }
    peers.delete(idx);
    return peers;
  }

  function renderNotesHtml(digitSet) {
    let html = '<span class="cell-notes" aria-hidden="true">';
    for (let d = 1; d <= 9; d += 1) {
      html += `<span class="cell-note-digit">${digitSet.has(d) ? d : ''}</span>`;
    }
    html += '</span>';
    return html;
  }

  function renderBoard() {
    buildGridOnce();
    if (cellElements.length !== 81) {
      return;
    }

    const selectedVal = game.selectedIdx >= 0 ? game.board[game.selectedIdx] : '0';
    const peerSet = getPeerIndices(game.selectedIdx);
    const conflictSet = getConflictIndices();

    for (let i = 0; i < 81; i += 1) {
      const cell = cellElements[i];
      const val = game.board[i];
      const isGiven = game.puzzle[i] !== '0';
      const isSelected = i === game.selectedIdx;
      const isPeer = peerSet.has(i);
      const isSameDigit = selectedVal !== '0' && val === selectedVal && !isSelected;
      const isError = !isGiven && conflictSet.has(i);
      const isHinted = game.hintedCells.has(i);

      cell.classList.toggle('is-given', isGiven);
      cell.classList.toggle('is-user', !isGiven && val !== '0');
      cell.classList.toggle('is-selected', isSelected);
      cell.classList.toggle('is-peer', isPeer && !isSelected);
      cell.classList.toggle('is-same-digit', isSameDigit);
      cell.classList.toggle('is-error', isError);
      cell.classList.toggle('is-hinted', isHinted);

      if (val !== '0') {
        cell.textContent = val;
      } else {
        const noteSet = game.notes.get(i);
        if (noteSet && noteSet.size > 0) {
          cell.innerHTML = renderNotesHtml(noteSet);
        } else {
          cell.textContent = '';
        }
      }

      const row = Math.floor(i / 9) + 1;
      const col = (i % 9) + 1;
      const labelVal = val === '0' ? 'empty' : isGiven ? `given ${val}` : val;
      cell.setAttribute('aria-label', `Row ${row} Column ${col}, ${labelVal}`);
    }

    renderNumpadCounts();
    renderHud();
  }

  function renderNumpadCounts() {
    if (!numpadEl) {
      return;
    }
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 81; i += 1) {
      const ch = game.board[i];
      if (ch !== '0' && !game.wrongCells.has(i)) {
        counts[Number(ch)] += 1;
      }
    }

    numpadEl.querySelectorAll('.numpad-btn').forEach((btn) => {
      const d = Number(btn.dataset.digit);
      const remaining = Math.max(0, 9 - counts[d]);
      const remEl = btn.querySelector('.numpad-rem');
      if (remEl) {
        remEl.textContent = remaining === 0 ? '✓' : String(remaining);
      }
      btn.classList.toggle('is-completed', remaining === 0);
      btn.disabled = game.phase !== 'playing' || (remaining === 0 && !game.notesMode);
    });
  }

  function renderHud() {
    if (timerEl) {
      timerEl.textContent = formatDuration(game.elapsedSec);
    }
    if (mistakesEl) {
      mistakesEl.textContent = `${game.mistakes} / ${game.maxMistakes}`;
      mistakesEl.classList.toggle('is-danger', game.mistakes >= 2);
    }
    const hintsLeft = Math.max(0, game.maxHints - game.hintsUsed);
    if (hintsHudEl) {
      hintsHudEl.textContent = `${hintsLeft} left`;
    }
    if (hintCountBadge) {
      hintCountBadge.textContent = String(hintsLeft);
    }
    if (hintBtn) {
      hintBtn.disabled = game.phase !== 'playing' || hintsLeft <= 0 || game.isSyncing;
    }
    if (comboEl && comboCountEl) {
      if (game.combo >= 2 && game.phase === 'playing') {
        comboCountEl.textContent = `x${game.combo}`;
        comboEl.hidden = false;
      } else {
        comboEl.hidden = true;
      }
    }
    if (notesBtn && notesBadge) {
      notesBtn.setAttribute('aria-pressed', String(game.notesMode));
      notesBtn.classList.toggle('is-active', game.notesMode);
      notesBadge.textContent = game.notesMode ? 'ON' : 'OFF';
    }
    if (undoBtn) {
      undoBtn.disabled = game.phase !== 'playing' || game.undoStack.length === 0;
    }
    if (redoBtn) {
      redoBtn.disabled = game.phase !== 'playing' || game.redoStack.length === 0;
    }
    if (eraseBtn) {
      eraseBtn.disabled = game.phase !== 'playing' || game.selectedIdx < 0;
    }
    if (sudokuPauseBtn) {
      sudokuPauseBtn.disabled = game.phase !== 'playing' && game.phase !== 'paused';
    }
    if (sudokuModeBadge) {
      const capDiff = game.difficulty.charAt(0).toUpperCase() + game.difficulty.slice(1);
      sudokuModeBadge.textContent =
        game.mode === 'daily' ? `Daily Challenge · ${game.dailyDate || 'Today'}` : `Classic · ${capDiff}`;
    }

    sudokuModeTabs?.querySelectorAll('.sudoku-mode-tab').forEach((tab) => {
      const isMatch =
        tab.dataset.mode === game.mode &&
        (game.mode === 'daily' || tab.dataset.difficulty === game.difficulty);
      tab.classList.toggle('is-active', isMatch);
    });
  }

  function updateOverlays() {
    if (loadingOverlay) {
      loadingOverlay.hidden = game.phase !== 'loading';
    }
    if (pausedOverlay) {
      pausedOverlay.hidden = game.phase !== 'paused';
    }
    if (resultOverlay) {
      resultOverlay.hidden = game.phase !== 'won' && game.phase !== 'lost';
    }
  }

  // ==================== Timer Management ====================

  function stopTimer() {
    if (game.timerInterval) {
      window.clearInterval(game.timerInterval);
      game.timerInterval = null;
    }
  }

  function startTimer() {
    stopTimer();
    game.timerInterval = window.setInterval(() => {
      if (game.phase !== 'playing' || !sudokuModal || sudokuModal.hidden || document.hidden) {
        return;
      }
      game.elapsedSec += 1;
      if (timerEl) {
        timerEl.textContent = formatDuration(game.elapsedSec);
      }
    }, 1000);
  }

  function pauseGame() {
    if (game.phase !== 'playing') {
      return;
    }
    game.phase = 'paused';
    stopTimer();
    updateOverlays();
    renderHud();
  }

  function resumeGame() {
    if (game.phase !== 'paused') {
      return;
    }
    game.phase = 'playing';
    updateOverlays();
    renderHud();
    startTimer();
  }

  // ==================== Unit Completion Ripples & Auto-Pruning ====================

  function seedAlreadyCompletedUnits() {
    game.completedUnits.clear();
    const groups = buildUnitDescriptors();
    for (const unit of groups) {
      if (unit.cells.every((idx) => game.board[idx] !== '0' && !game.wrongCells.has(idx))) {
        game.completedUnits.add(unit.key);
      }
    }
  }

  function buildUnitDescriptors() {
    const groups = [];
    for (let r = 0; r < 9; r += 1) {
      const cells = [];
      for (let c = 0; c < 9; c += 1) cells.push(r * 9 + c);
      groups.push({ key: `r-${r}`, cells });
    }
    for (let c = 0; c < 9; c += 1) {
      const cells = [];
      for (let r = 0; r < 9; r += 1) cells.push(r * 9 + c);
      groups.push({ key: `c-${c}`, cells });
    }
    for (let br = 0; br < 3; br += 1) {
      for (let bc = 0; bc < 3; bc += 1) {
        const cells = [];
        for (let r = br * 3; r < br * 3 + 3; r += 1) {
          for (let c = bc * 3; c < bc * 3 + 3; c += 1) {
            cells.push(r * 9 + c);
          }
        }
        groups.push({ key: `b-${br}-${bc}`, cells });
      }
    }
    return groups;
  }

  function triggerCellRipple(indices, stepMs = 26) {
    indices.forEach((idx, order) => {
      const el = cellElements[idx];
      if (!el) {
        return;
      }
      el.classList.remove('is-ripple');
      el.style.animationDelay = `${order * stepMs}ms`;
      void el.offsetWidth;
      el.classList.add('is-ripple');
      window.setTimeout(() => {
        el.classList.remove('is-ripple');
        el.style.animationDelay = '';
      }, 600 + order * stepMs);
    });
  }

  function checkNewUnitCompletions() {
    const groups = buildUnitDescriptors();
    let unlockedUnit = false;
    for (const unit of groups) {
      if (game.completedUnits.has(unit.key)) {
        continue;
      }
      const isComplete = unit.cells.every(
        (idx) => game.board[idx] !== '0' && !game.wrongCells.has(idx)
      );
      if (isComplete) {
        const seen = new Set(unit.cells.map((idx) => game.board[idx]));
        if (seen.size === 9 && !seen.has('0')) {
          game.completedUnits.add(unit.key);
          unlockedUnit = true;
          triggerCellRipple(unit.cells, 28);
        }
      }
    }
    if (unlockedUnit) {
      SudokuAudio.playUnitComplete();
    }
  }

  function prunePeerNotes(cellIdx, digit) {
    const prunedPeers = [];
    const peers = getPeerIndices(cellIdx);
    for (const peerIdx of peers) {
      const noteSet = game.notes.get(peerIdx);
      if (noteSet && noteSet.has(digit)) {
        noteSet.delete(digit);
        if (noteSet.size === 0) {
          game.notes.delete(peerIdx);
        }
        prunedPeers.push(peerIdx);
      }
    }
    return prunedPeers;
  }

  // ==================== Server Session Lifecycle ====================

  function hydrateSession(session) {
    stopTimer();
    game.sessionId = session.id;
    game.mode = session.mode;
    game.difficulty = session.difficulty;
    game.dailyDate = session.dailyDate || null;
    game.puzzle = session.puzzle;
    game.board = session.currentBoard.split('');
    game.notes = hydrateNotesMap(session.notes);
    game.wrongCells = new Set(Array.isArray(session.wrongCells) ? session.wrongCells : []);
    game.hintedCells = new Set();
    game.mistakes = Number(session.mistakes) || 0;
    game.maxMistakes = Number(session.maxMistakes) || 3;
    game.hintsUsed = Number(session.hintsUsed) || 0;
    game.maxHints = Number(session.maxHints) || 3;
    game.elapsedSec = Number(session.durationSeconds) || 0;
    game.combo = 0;
    game.undoStack = [];
    game.redoStack = [];
    game.lastWinData = null;
    game.phase = 'playing';

    // Select first empty cell automatically for instant keyboard play
    const firstEmpty = game.board.findIndex((ch) => ch === '0');
    game.selectedIdx = firstEmpty !== -1 ? firstEmpty : 0;

    seedAlreadyCompletedUnits();
    updateOverlays();
    renderBoard();
    startTimer();
  }

  async function startOrResumeSession({ mode = 'classic', difficulty = 'easy', forceNew = false } = {}) {
    if (!wall()?.getCurrentUser?.()) {
      closeSudokuModal();
      wall()?.openAuthModal?.('Sign in with Google to play BatStateU Sudoku Arena and earn leaderboard points.');
      return;
    }

    stopTimer();
    game.mode = mode;
    game.difficulty = mode === 'daily' ? 'medium' : difficulty;
    game.phase = 'loading';
    game.lastWinData = null;
    setStatus('');
    updateOverlays();
    renderHud();

    try {
      const response = await fetch('/api/sudoku/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, difficulty: game.difficulty, forceNew }),
      });

      if (response.status === 401) {
        closeSudokuModal();
        wall()?.openAuthModal?.('Please sign in with Google to continue playing.');
        return;
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.session) {
        game.phase = 'idle';
        updateOverlays();
        renderHud();
        setStatus(data.error || 'Could not start Sudoku puzzle.', true);
        return;
      }

      hydrateSession(data.session);
      if (data.resumed) {
        setStatus('Resumed your in-progress puzzle.');
      }
    } catch (err) {
      console.error('Sudoku start error:', err);
      game.phase = 'idle';
      updateOverlays();
      renderHud();
      setStatus('Network error starting Sudoku game.', true);
    }
  }

  async function openSudokuArena() {
    if (!wall()?.getCurrentUser?.()) {
      wall()?.openAuthModal?.('Sign in with Google to play BatStateU Sudoku Arena and climb the rankings.');
      return;
    }

    wall()?.closeInfoModal?.();
    if (!sudokuModal) {
      return;
    }
    sudokuModal.hidden = false;
    wall()?.syncBodyScrollLock?.();
    syncSoundButtonUI();

    if (game.phase === 'paused') {
      resumeGame();
      return;
    }
    if (game.phase === 'playing' && game.sessionId) {
      renderBoard();
      startTimer();
      return;
    }

    game.phase = 'loading';
    setStatus('');
    updateOverlays();
    renderHud();

    try {
      const activeRes = await fetch('/api/sudoku/active');
      if (activeRes.status === 401) {
        closeSudokuModal();
        wall()?.openAuthModal?.('Please sign in with Google to play Sudoku.');
        return;
      }
      const activeData = await activeRes.json().catch(() => ({}));
      if (activeRes.ok && activeData.session) {
        hydrateSession(activeData.session);
        setStatus('Welcome back! Resumed your active board.');
        return;
      }
      await startOrResumeSession({ mode: 'classic', difficulty: 'easy', forceNew: false });
    } catch (err) {
      console.error('Open Sudoku Arena error:', err);
      await startOrResumeSession({ mode: 'classic', difficulty: 'easy', forceNew: false });
    }
  }

  function closeSudokuModal() {
    if (!sudokuModal || sudokuModal.hidden) {
      return;
    }
    stopTimer();
    if (game.phase === 'playing') {
      game.phase = 'paused';
      updateOverlays();
    }
    sudokuModal.hidden = true;
    wall()?.syncBodyScrollLock?.();
  }

  // ==================== Gameplay Actions (0ms Client + Async Server Validation) ====================

  function pushUndoSnapshot(snapshot) {
    game.undoStack.push(snapshot);
    if (game.undoStack.length > MAX_UNDO_STEPS) {
      game.undoStack.shift();
    }
    game.redoStack = [];
  }

  function applyBoardAndNotesSnapshot(boardArr, notesMap, wrongCellsSet) {
    game.board = boardArr.slice();
    game.notes = cloneNotesMap(notesMap);
    game.wrongCells = new Set(wrongCellsSet);
  }

  async function syncMoveWithServer(index, value) {
    if (!game.sessionId) {
      return;
    }
    game.isSyncing = true;
    try {
      const response = await fetch(`/api/sudoku/${game.sessionId}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          index,
          value,
          notes: serializeNotesForServer(),
          durationSeconds: game.elapsedSec,
        }),
      });

      if (response.status === 401) {
        closeSudokuModal();
        wall()?.openAuthModal?.('Session expired. Sign in with Google to continue.');
        return;
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        if (data?.error) {
          setStatus(data.error, true);
        }
        return;
      }

      game.mistakes = Number(data.mistakes) || 0;
      game.maxMistakes = Number(data.maxMistakes) || 3;

      if (value === 0) {
        game.wrongCells.delete(index);
      } else if (data.correct) {
        game.wrongCells.delete(index);
        game.combo += 1;
        SudokuAudio.playPlace(game.combo);
        prunePeerNotes(index, value);
        window.BatStateScene?.pulseTyping();
        checkNewUnitCompletions();
      } else {
        game.wrongCells.add(index);
        game.combo = 0;
        SudokuAudio.playMistake();
        window.BatStateScene?.pulseError();
        const cellEl = cellElements[index];
        if (cellEl) {
          cellEl.classList.remove('is-shake');
          void cellEl.offsetWidth;
          cellEl.classList.add('is-shake');
        }
        setStatus(`Wrong digit! Mistakes: ${game.mistakes} / ${game.maxMistakes}`, true);
      }

      if (data.status === 'failed') {
        handleGameLost();
        return;
      }

      renderBoard();

      if (data.isSolved) {
        await completeGame();
      }
    } catch (err) {
      console.error('Sudoku move sync error:', err);
      setStatus('Connection hiccup while saving move.', true);
    } finally {
      game.isSyncing = false;
      renderHud();
    }
  }

  function placeDigit(digit) {
    if (game.phase !== 'playing' || game.selectedIdx < 0) {
      return;
    }
    const idx = game.selectedIdx;
    if (game.puzzle[idx] !== '0') {
      setStatus('Given clues cannot be edited.');
      return;
    }

    setStatus('');

    // Pencil marks mode (0ms local note toggle)
    if (game.notesMode && digit >= 1 && digit <= 9) {
      if (game.board[idx] !== '0') {
        setStatus('Erase the cell value first before adding notes.');
        return;
      }
      pushUndoSnapshot({
        idx,
        board: game.board.slice(),
        notes: cloneNotesMap(game.notes),
        wrongCells: new Set(game.wrongCells),
      });
      const existingSet = game.notes.get(idx) || new Set();
      if (existingSet.has(digit)) {
        existingSet.delete(digit);
      } else {
        existingSet.add(digit);
      }
      if (existingSet.size === 0) {
        game.notes.delete(idx);
      } else {
        game.notes.set(idx, existingSet);
      }
      SudokuAudio.playNote();
      renderBoard();
      scheduleNotesSync(idx);
      return;
    }

    const nextChar = digit === 0 ? '0' : String(digit);
    if (game.board[idx] === nextChar) {
      if (digit !== 0 && !game.wrongCells.has(idx)) {
        return;
      }
    }

    pushUndoSnapshot({
      idx,
      board: game.board.slice(),
      notes: cloneNotesMap(game.notes),
      wrongCells: new Set(game.wrongCells),
    });

    game.board[idx] = nextChar;
    if (nextChar !== '0') {
      game.notes.delete(idx);
    } else {
      game.wrongCells.delete(idx);
      SudokuAudio.playErase();
    }

    renderBoard();
    syncMoveWithServer(idx, digit);
  }

  function handleUndo() {
    if (game.phase !== 'playing' || game.undoStack.length === 0) {
      return;
    }
    const prev = game.undoStack.pop();
    game.redoStack.push({
      idx: game.selectedIdx,
      board: game.board.slice(),
      notes: cloneNotesMap(game.notes),
      wrongCells: new Set(game.wrongCells),
    });
    applyBoardAndNotesSnapshot(prev.board, prev.notes, prev.wrongCells);
    if (prev.idx >= 0) {
      game.selectedIdx = prev.idx;
    }
    SudokuAudio.playErase();
    renderBoard();
    if (prev.idx >= 0 && game.puzzle[prev.idx] === '0') {
      syncMoveWithServer(prev.idx, Number(game.board[prev.idx]));
    }
  }

  function handleRedo() {
    if (game.phase !== 'playing' || game.redoStack.length === 0) {
      return;
    }
    const next = game.redoStack.pop();
    game.undoStack.push({
      idx: game.selectedIdx,
      board: game.board.slice(),
      notes: cloneNotesMap(game.notes),
      wrongCells: new Set(game.wrongCells),
    });
    applyBoardAndNotesSnapshot(next.board, next.notes, next.wrongCells);
    if (next.idx >= 0) {
      game.selectedIdx = next.idx;
    }
    SudokuAudio.playPlace(1);
    renderBoard();
    if (next.idx >= 0 && game.puzzle[next.idx] === '0') {
      syncMoveWithServer(next.idx, Number(game.board[next.idx]));
    }
  }

  async function requestHint() {
    if (game.phase !== 'playing' || !game.sessionId || game.isSyncing) {
      return;
    }
    if (game.hintsUsed >= game.maxHints) {
      setStatus('No hints remaining on this puzzle.', true);
      return;
    }

    game.isSyncing = true;
    renderHud();
    setStatus('');

    try {
      const response = await fetch(`/api/sudoku/${game.sessionId}/hint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ durationSeconds: game.elapsedSec }),
      });

      if (response.status === 401) {
        closeSudokuModal();
        wall()?.openAuthModal?.('Session expired. Sign in with Google to continue.');
        return;
      }

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        setStatus(data?.error || 'Could not reveal hint.', true);
        return;
      }

      game.hintsUsed = Number(data.hintsUsed) || game.hintsUsed + 1;
      game.board = data.currentBoard.split('');
      game.wrongCells.delete(data.index);
      game.notes.delete(data.index);
      game.hintedCells.add(data.index);
      game.selectedIdx = data.index;
      prunePeerNotes(data.index, data.value);

      SudokuAudio.playHint();
      renderBoard();
      checkNewUnitCompletions();
      setStatus(`Smart Hint placed ${data.value} cleanly.`);

      if (data.isSolved) {
        await completeGame();
      }
    } catch (err) {
      console.error('Hint error:', err);
      setStatus('Network error requesting hint.', true);
    } finally {
      game.isSyncing = false;
      renderHud();
    }
  }

  function handleGameLost() {
    stopTimer();
    game.phase = 'lost';
    game.lastWinData = null;

    if (resultBadge) {
      resultBadge.textContent = 'OUT OF LIVES';
      resultBadge.className = 'result-badge is-lost';
    }
    if (resultTitle) {
      resultTitle.textContent = 'Too Many Mistakes';
    }
    if (resultSubtitle) {
      resultSubtitle.textContent = 'You hit the 3-mistake limit. Start a fresh puzzle and try again!';
    }
    if (scoreBreakdownEl) {
      scoreBreakdownEl.innerHTML = `
        <div class="breakdown-row"><span>Difficulty</span><strong>${escapeHtml(game.difficulty.toUpperCase())}</strong></div>
        <div class="breakdown-row"><span>Time Played</span><strong>${escapeHtml(formatDuration(game.elapsedSec))}</strong></div>
        <div class="breakdown-row"><span>Mistakes</span><strong>${game.mistakes} / ${game.maxMistakes}</strong></div>
      `;
    }
    if (shareWinBtn) {
      shareWinBtn.hidden = true;
    }

    updateOverlays();
    renderBoard();
  }

  async function completeGame() {
    if (!game.sessionId || game.phase === 'won') {
      return;
    }
    stopTimer();

    try {
      const response = await fetch(`/api/sudoku/${game.sessionId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: game.board.join(''),
          durationSeconds: game.elapsedSec,
        }),
      });

      const data = await response.json().catch(() => null);
      if (!response.ok || !data) {
        setStatus(data?.error || 'Could not finalize victory.', true);
        startTimer();
        return;
      }

      game.phase = 'won';
      game.lastWinData = data;
      SudokuAudio.playVictory();
      window.BatStateScene?.pulseSuccess();

      // Victory diagonal cascade ripple
      const diagonalOrder = Array.from({ length: 81 }, (_, i) => i).sort((a, b) => {
        const ra = Math.floor(a / 9) + (a % 9);
        const rb = Math.floor(b / 9) + (b % 9);
        return ra - rb;
      });
      triggerCellRipple(diagonalOrder, 10);

      const b = data.breakdown || {};
      const modeLabel = data.mode === 'daily' ? 'Daily Challenge' : `${data.difficulty.toUpperCase()} Sudoku`;
      if (resultBadge) {
        resultBadge.textContent = 'VICTORY';
        resultBadge.className = 'result-badge is-won';
      }
      if (resultTitle) {
        resultTitle.textContent = `${data.score.toLocaleString()} pts`;
      }
      if (resultSubtitle) {
        resultSubtitle.textContent = `${modeLabel} solved in ${formatDuration(data.durationSeconds)} · Overall Rank #${data.rank || '?'}`;
      }
      if (scoreBreakdownEl) {
        scoreBreakdownEl.innerHTML = `
          <div class="breakdown-row"><span>Base Points</span><strong>+${b.base ?? 0}</strong></div>
          <div class="breakdown-row"><span>Speed Bonus</span><strong>+${b.speedBonus ?? 0}</strong></div>
          <div class="breakdown-row"><span>Accuracy Bonus</span><strong>+${b.accuracyBonus ?? 0}</strong></div>
          <div class="breakdown-row"><span>Hints Used (${data.hintsUsed ?? 0})</span><strong>-${b.hintPenalty ?? 0}</strong></div>
          <div class="breakdown-row"><span>Daily Streak (${data.streak ?? 1}d)</span><strong>&times;${b.streakMultiplier ?? 1}</strong></div>
        `;
      }
      if (shareWinBtn) {
        shareWinBtn.hidden = false;
      }

      updateOverlays();
      renderHud();
      wall()?.showSuccessToast?.('Sudoku Victory!', `+${data.score.toLocaleString()} pts added to your ranking!`);

      // Live refresh leaderboard widget & wall author badges
      loadSidebarRankings(sidebarScope);
      if (rankingsModal && !rankingsModal.hidden) {
        loadFullRankings(fullRankingsScope);
      }
      wall()?.refreshFeed?.();
    } catch (err) {
      console.error('Complete Sudoku error:', err);
      setStatus('Network error submitting completed board.', true);
      startTimer();
    }
  }

  function handleShareVictoryToWall() {
    const win = game.lastWinData;
    if (!win) {
      return;
    }
    const label =
      win.mode === 'daily'
        ? 'Daily BatStateU Sudoku'
        : `${win.difficulty.charAt(0).toUpperCase() + win.difficulty.slice(1)} BatStateU Sudoku`;
    const timeStr = formatDuration(win.durationSeconds);
    const mistakeStr = win.mistakes === 0 ? 'zero mistakes' : `${win.mistakes} mistake${win.mistakes === 1 ? '' : 's'}`;
    const rankStr = win.rank ? ` (Rank #${win.rank})` : '';
    const shareText = `Just conquered ${label} in ${timeStr} with ${mistakeStr} — ${win.score.toLocaleString()} pts${rankStr}! Beat my score in the Sudoku Arena!`;

    closeSudokuModal();
    wall()?.openComposerWithText?.(shareText);
  }

  // ==================== Rankings Widget & Top 50 Modal ====================

  function formatMetricForScope(row, scope) {
    if (scope === 'easy' || scope === 'medium' || scope === 'hard') {
      return formatDuration(row.best_time_sec ?? row.duration_seconds ?? 0);
    }
    if (scope === 'daily') {
      return `${Number(row.score || 0).toLocaleString()} pts · ${formatDuration(row.duration_seconds)}`;
    }
    return `${Number(row.total_points || 0).toLocaleString()} pts`;
  }

  function buildRankRowHtml(row, scope, isHighlight = false) {
    const rank = Number(row.rank) || 0;
    const rankMedalClass =
      rank === 1 ? 'is-gold' : rank === 2 ? 'is-silver' : rank === 3 ? 'is-bronze' : '';
    const tone = wall()?.getAvatarTone ? wall().getAvatarTone(row.name) : 0;
    const avatarHtml = wall()?.buildAvatarHtml ? wall().buildAvatarHtml(row.name, row.avatar_url) : '?';
    const streakHtml =
      Number(row.current_streak) >= 2 ? `<span class="rank-streak">${row.current_streak}d streak</span>` : '';
    const metric = formatMetricForScope(row, scope);

    return `
      <div class="rank-row ${isHighlight ? 'is-me' : ''}">
        <span class="rank-pos ${rankMedalClass}">#${rank}</span>
        <div class="rank-avatar" data-tone="${tone}" aria-hidden="true">${avatarHtml}</div>
        <div class="rank-info">
          <div class="rank-name">${escapeHtml(row.name)}</div>
          <div class="rank-sub">${Number(row.games_won || 0)} won ${streakHtml ? '&middot; ' + streakHtml : ''}</div>
        </div>
        <div class="rank-metric">${escapeHtml(metric)}</div>
      </div>
    `;
  }

  async function loadSidebarRankings(scope = sidebarScope) {
    if (!sidebarRankingsList) {
      return;
    }
    sidebarScope = scope === 'daily' ? 'daily' : 'overall';

    sidebarRankingsTabs?.querySelectorAll('.mini-tab').forEach((tab) => {
      const active = tab.dataset.sidebarScope === sidebarScope;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    try {
      const response = await fetch(`/api/sudoku/rankings?scope=${encodeURIComponent(sidebarScope)}&limit=5`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !Array.isArray(data.leaderboard)) {
        sidebarRankingsList.innerHTML = '<div class="rankings-empty">Unable to load rankings.</div>';
        if (sidebarMyRankEl) sidebarMyRankEl.hidden = true;
        return;
      }

      if (data.leaderboard.length === 0) {
        sidebarRankingsList.innerHTML = `<div class="rankings-empty">${
          sidebarScope === 'daily'
            ? "No Daily Challenge clears yet today — claim #1!"
            : 'Be the first Red Spartan on the Sudoku leaderboard!'
        }</div>`;
      } else {
        const viewerId = wall()?.getCurrentUser?.()?.id || null;
        sidebarRankingsList.innerHTML = data.leaderboard
          .map((row) => buildRankRowHtml(row, sidebarScope, viewerId && row.user_id === viewerId))
          .join('');
      }

      if (sidebarMyRankEl) {
        if (data.myRank) {
          const metric = formatMetricForScope(data.myRank, sidebarScope);
          sidebarMyRankEl.innerHTML = `<span>Your Rank</span><strong>#${data.myRank.rank} &middot; ${escapeHtml(metric)}</strong>`;
          sidebarMyRankEl.hidden = false;
        } else if (wall()?.getCurrentUser?.()) {
          sidebarMyRankEl.innerHTML = '<span>Your Rank</span><strong>Unranked — Solve 1 puzzle!</strong>';
          sidebarMyRankEl.hidden = false;
        } else {
          sidebarMyRankEl.hidden = true;
        }
      }
    } catch (err) {
      console.error('Sidebar rankings fetch error:', err);
      sidebarRankingsList.innerHTML = '<div class="rankings-empty">Unable to load rankings.</div>';
    }
  }

  async function loadFullRankings(scope = fullRankingsScope) {
    if (!fullRankingsList) {
      return;
    }
    const validScopes = ['overall', 'daily', 'easy', 'medium', 'hard'];
    fullRankingsScope = validScopes.includes(scope) ? scope : 'overall';

    rankingsTabsEl?.querySelectorAll('.rankings-tab').forEach((tab) => {
      const active = tab.dataset.rankingsScope === fullRankingsScope;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });

    fullRankingsList.innerHTML = '<div class="rankings-empty">Loading leaderboard...</div>';

    try {
      const response = await fetch(`/api/sudoku/rankings?scope=${encodeURIComponent(fullRankingsScope)}&limit=50`);
      const data = await response.json().catch(() => null);
      if (!response.ok || !data || !Array.isArray(data.leaderboard)) {
        fullRankingsList.innerHTML = '<div class="rankings-empty">Failed to load rankings.</div>';
        if (fullRankingsMe) fullRankingsMe.hidden = true;
        return;
      }

      if (rankingsSubtitleEl) {
        const subtitles = {
          overall: 'All-time cumulative Sudoku points across BatStateWall',
          daily: `Today's Daily Spartan Challenge (${data.dailyDate || 'PH time'})`,
          easy: 'Fastest Easy difficulty clear times',
          medium: 'Fastest Medium difficulty clear times',
          hard: 'Fastest Hard difficulty clear times',
        };
        rankingsSubtitleEl.textContent = subtitles[fullRankingsScope] || subtitles.overall;
      }

      if (data.leaderboard.length === 0) {
        fullRankingsList.innerHTML = '<div class="rankings-empty">No ranked solvers in this category yet.</div>';
      } else {
        const viewerId = wall()?.getCurrentUser?.()?.id || null;
        fullRankingsList.innerHTML = data.leaderboard
          .map((row) => buildRankRowHtml(row, fullRankingsScope, viewerId && row.user_id === viewerId))
          .join('');
      }

      if (fullRankingsMe) {
        if (data.myRank) {
          const metric = formatMetricForScope(data.myRank, fullRankingsScope);
          fullRankingsMe.innerHTML = `<span>Your Standing</span><strong>#${data.myRank.rank} &middot; ${escapeHtml(metric)}</strong>`;
          fullRankingsMe.hidden = false;
        } else {
          fullRankingsMe.hidden = true;
        }
      }
    } catch (err) {
      console.error('Full rankings fetch error:', err);
      fullRankingsList.innerHTML = '<div class="rankings-empty">Failed to load rankings.</div>';
    }
  }

  function openRankingsModal(scope = 'overall') {
    wall()?.closeInfoModal?.();
    if (!rankingsModal) {
      return;
    }
    rankingsModal.hidden = false;
    wall()?.syncBodyScrollLock?.();
    loadFullRankings(scope);
  }

  function closeRankingsModal() {
    if (!rankingsModal || rankingsModal.hidden) {
      return;
    }
    rankingsModal.hidden = true;
    wall()?.syncBodyScrollLock?.();
  }

  // ==================== Event Listeners & Keyboard Controls ====================

  openSudokuBtn?.addEventListener('click', openSudokuArena);
  sidebarPlayBtn?.addEventListener('click', openSudokuArena);
  mobilePlayBtn?.addEventListener('click', openSudokuArena);
  closeSudokuBtn?.addEventListener('click', closeSudokuModal);

  sudokuModal?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeSudoku === 'true') {
      closeSudokuModal();
    }
  });

  openRankingsBtn?.addEventListener('click', () => openRankingsModal(sidebarScope));
  mobileOpenRankingsBtn?.addEventListener('click', () => openRankingsModal('overall'));
  openRanksFromGameBtn?.addEventListener('click', () => {
    closeSudokuModal();
    openRankingsModal(game.mode === 'daily' ? 'daily' : 'overall');
  });
  closeRankingsBtn?.addEventListener('click', closeRankingsModal);

  rankingsModal?.addEventListener('click', (event) => {
    if (event.target instanceof HTMLElement && event.target.dataset.closeRankings === 'true') {
      closeRankingsModal();
    }
  });

  sidebarRankingsTabs?.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-sidebar-scope]') : null;
    if (!btn) {
      return;
    }
    loadSidebarRankings(btn.dataset.sidebarScope);
  });

  rankingsTabsEl?.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('[data-rankings-scope]') : null;
    if (!btn) {
      return;
    }
    loadFullRankings(btn.dataset.rankingsScope);
  });

  sudokuModeTabs?.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.sudoku-mode-tab') : null;
    if (!btn || game.phase === 'loading') {
      return;
    }
    const mode = btn.dataset.mode === 'daily' ? 'daily' : 'classic';
    const difficulty = btn.dataset.difficulty || 'easy';
    startOrResumeSession({ mode, difficulty, forceNew: false });
  });

  sudokuPauseBtn?.addEventListener('click', () => {
    if (game.phase === 'playing') {
      pauseGame();
    } else if (game.phase === 'paused') {
      resumeGame();
    }
  });

  resumeBtn?.addEventListener('click', resumeGame);

  sudokuSoundBtn?.addEventListener('click', () => {
    SudokuAudio.muted = !SudokuAudio.muted;
    try {
      window.localStorage.setItem(SOUND_STORAGE_KEY, SudokuAudio.muted ? '1' : '0');
    } catch {
      // Ignore storage errors in private mode
    }
    syncSoundButtonUI();
    if (!SudokuAudio.muted) {
      SudokuAudio.playSelect();
    }
  });

  gridEl?.addEventListener('click', (event) => {
    if (game.phase !== 'playing') {
      return;
    }
    const cell = event.target instanceof Element ? event.target.closest('.sudoku-cell') : null;
    if (!cell) {
      return;
    }
    const idx = Number(cell.dataset.index);
    if (!Number.isInteger(idx) || idx < 0 || idx > 80) {
      return;
    }
    game.selectedIdx = idx;
    SudokuAudio.playSelect();
    renderBoard();
  });

  numpadEl?.addEventListener('click', (event) => {
    const btn = event.target instanceof Element ? event.target.closest('.numpad-btn') : null;
    if (!btn) {
      return;
    }
    const digit = Number(btn.dataset.digit);
    if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
      placeDigit(digit);
    }
  });

  undoBtn?.addEventListener('click', handleUndo);
  redoBtn?.addEventListener('click', handleRedo);
  eraseBtn?.addEventListener('click', () => placeDigit(0));
  notesBtn?.addEventListener('click', () => {
    if (game.phase !== 'playing') {
      return;
    }
    game.notesMode = !game.notesMode;
    SudokuAudio.playSelect();
    renderHud();
  });
  hintBtn?.addEventListener('click', requestHint);

  newGameBtn?.addEventListener('click', () => {
    if (game.phase === 'loading') {
      return;
    }
    startOrResumeSession({
      mode: game.mode,
      difficulty: game.difficulty,
      forceNew: game.mode !== 'daily',
    });
  });

  playAgainBtn?.addEventListener('click', () => {
    const nextMode = game.mode === 'daily' ? 'classic' : game.mode;
    const nextDiff = game.mode === 'daily' ? 'medium' : game.difficulty;
    startOrResumeSession({ mode: nextMode, difficulty: nextDiff, forceNew: true });
  });

  shareWinBtn?.addEventListener('click', handleShareVictoryToWall);

  // Auto-pause if user switches tabs while Sudoku timer is active
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.phase === 'playing' && sudokuModal && !sudokuModal.hidden) {
      pauseGame();
    }
  });

  // Full keyboard navigation when Sudoku Modal or Rankings Modal is open
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (rankingsModal && !rankingsModal.hidden) {
        closeRankingsModal();
        return;
      }
      if (sudokuModal && !sudokuModal.hidden) {
        closeSudokuModal();
        return;
      }
    }

    if (!sudokuModal || sudokuModal.hidden) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      handleRedo();
      return;
    }

    if (event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (game.phase === 'playing') pauseGame();
      else if (game.phase === 'paused') resumeGame();
      return;
    }

    if (game.phase !== 'playing') {
      return;
    }

    const row = game.selectedIdx >= 0 ? Math.floor(game.selectedIdx / 9) : 0;
    const col = game.selectedIdx >= 0 ? game.selectedIdx % 9 : 0;

    if (event.key === 'ArrowUp' || event.key.toLowerCase() === 'w') {
      event.preventDefault();
      game.selectedIdx = ((row + 8) % 9) * 9 + col;
      renderBoard();
      return;
    }
    if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
      event.preventDefault();
      game.selectedIdx = ((row + 1) % 9) * 9 + col;
      renderBoard();
      return;
    }
    if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
      event.preventDefault();
      game.selectedIdx = row * 9 + ((col + 8) % 9);
      renderBoard();
      return;
    }
    if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
      event.preventDefault();
      game.selectedIdx = row * 9 + ((col + 1) % 9);
      renderBoard();
      return;
    }

    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      placeDigit(Number(event.key));
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete' || event.key === '0') {
      event.preventDefault();
      placeDigit(0);
      return;
    }
    if (event.key.toLowerCase() === 'n') {
      event.preventDefault();
      game.notesMode = !game.notesMode;
      SudokuAudio.playSelect();
      renderHud();
      return;
    }
    if (event.key.toLowerCase() === 'h') {
      event.preventDefault();
      requestHint();
    }
  });

  // React to Google sign-in / logout transitions in app.js
  window.addEventListener('batstate:auth-changed', (event) => {
    const user = event?.detail?.user || null;
    if (!user && sudokuModal && !sudokuModal.hidden) {
      closeSudokuModal();
      game.phase = 'idle';
      game.sessionId = null;
    }
    loadSidebarRankings(sidebarScope);
  });

  // Initial leaderboard hydration on page load
  buildGridOnce();
  syncSoundButtonUI();
  loadSidebarRankings('overall');
})();
