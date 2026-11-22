// Server-authoritative Sudoku puzzle engine (zero external dependencies)
// Provides bitmask MRV solving, uniqueness verification, daily seeded generation, smart hints, and scoring.

const crypto = require('crypto');

const ALL_DIGITS_MASK = 0x3fe; // Bits 1..9 represent digits 1 through 9
const DIFFICULTY_CLUES = {
  easy: 42,
  medium: 33,
  hard: 27,
};
const SCORE_BASE = {
  easy: 500,
  medium: 1000,
  hard: 1800,
};
const SCORE_PAR_SECONDS = {
  easy: 240,
  medium: 480,
  hard: 900,
};

/**
 * FNV-1a 32-bit string hash used to deterministically seed Daily Spartan Challenges.
 */
function hashSeed(seedStr) {
  let hash = 2166136261;
  const text = String(seedStr);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Mulberry32 fast 32-bit seeded PRNG returning floats in [0, 1).
 */
function mulberry32(seedInt) {
  let state = seedInt >>> 0;
  return function nextRandom() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed) {
  if (seed !== null && seed !== undefined && seed !== '') {
    return mulberry32(hashSeed(seed));
  }
  return mulberry32(crypto.randomBytes(4).readUInt32BE(0));
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Returns today's date in Asia/Manila timezone formatted as YYYY-MM-DD.
 */
function getTodayManilaDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Returns YYYY-MM-DD one calendar day before the supplied YYYY-MM-DD string.
 */
function getYesterdayManilaDate(dateStr) {
  const dt = new Date(`${dateStr}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

function isValidDifficulty(value) {
  return value === 'easy' || value === 'medium' || value === 'hard';
}

function isBoardString(value) {
  return typeof value === 'string' && /^[0-9]{81}$/.test(value);
}

function getBoxIndex(row, col) {
  return Math.floor(row / 3) * 3 + Math.floor(col / 3);
}

function popcount9(mask) {
  let m = mask & ALL_DIGITS_MASK;
  let count = 0;
  while (m) {
    m &= m - 1;
    count += 1;
  }
  return count;
}

function toBoardArray(boardInput) {
  if (Array.isArray(boardInput) && boardInput.length === 81) {
    return boardInput.slice();
  }
  if (isBoardString(boardInput)) {
    const arr = new Array(81);
    for (let i = 0; i < 81; i += 1) {
      arr[i] = Number(boardInput[i]);
    }
    return arr;
  }
  return null;
}

function buildMasks(boardArr) {
  const rows = new Int32Array(9);
  const cols = new Int32Array(9);
  const boxes = new Int32Array(9);

  for (let i = 0; i < 81; i += 1) {
    const digit = boardArr[i];
    if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
      return null;
    }
    if (digit === 0) {
      continue;
    }
    const bit = 1 << digit;
    const row = Math.floor(i / 9);
    const col = i % 9;
    const box = getBoxIndex(row, col);

    if ((rows[row] & bit) || (cols[col] & bit) || (boxes[box] & bit)) {
      return null;
    }
    rows[row] |= bit;
    cols[col] |= bit;
    boxes[box] |= bit;
  }

  return { rows, cols, boxes };
}

/**
 * Finds the empty cell with Minimum Remaining Values (fewest legal candidates).
 * Returns { idx: -1, candMask: 0 } if solved, or { idx, candMask: 0 } if a dead end is hit.
 */
function pickMrvCell(boardArr, rows, cols, boxes) {
  let bestIdx = -1;
  let bestMask = 0;
  let bestCount = 10;

  for (let i = 0; i < 81; i += 1) {
    if (boardArr[i] !== 0) {
      continue;
    }
    const row = Math.floor(i / 9);
    const col = i % 9;
    const box = getBoxIndex(row, col);
    const candMask = ALL_DIGITS_MASK & ~(rows[row] | cols[col] | boxes[box]);
    const count = popcount9(candMask);

    if (count === 0) {
      return { idx: i, candMask: 0 };
    }
    if (count < bestCount) {
      bestCount = count;
      bestIdx = i;
      bestMask = candMask;
      if (count === 1) {
        break;
      }
    }
  }

  return { idx: bestIdx, candMask: bestMask };
}

/**
 * Counts valid Sudoku solutions up to `limit` (default 2 for strict uniqueness check).
 */
function countSolutions(boardInput, limit = 2) {
  const boardArr = toBoardArray(boardInput);
  if (!boardArr) {
    return 0;
  }
  const masks = buildMasks(boardArr);
  if (!masks) {
    return 0;
  }
  const { rows, cols, boxes } = masks;
  let count = 0;

  function search() {
    if (count >= limit) {
      return;
    }
    const { idx, candMask } = pickMrvCell(boardArr, rows, cols, boxes);
    if (idx === -1) {
      count += 1;
      return;
    }
    if (candMask === 0) {
      return;
    }

    const row = Math.floor(idx / 9);
    const col = idx % 9;
    const box = getBoxIndex(row, col);

    for (let digit = 1; digit <= 9; digit += 1) {
      const bit = 1 << digit;
      if (!(candMask & bit)) {
        continue;
      }
      boardArr[idx] = digit;
      rows[row] |= bit;
      cols[col] |= bit;
      boxes[box] |= bit;

      search();

      boardArr[idx] = 0;
      rows[row] &= ~bit;
      cols[col] &= ~bit;
      boxes[box] &= ~bit;

      if (count >= limit) {
        return;
      }
    }
  }

  search();
  return count;
}

/**
 * Generates a complete, valid 81-cell solved Sudoku grid using the given PRNG.
 */
function generateSolvedBoard(rng) {
  const boardArr = new Array(81).fill(0);
  const rows = new Int32Array(9);
  const cols = new Int32Array(9);
  const boxes = new Int32Array(9);

  function fill() {
    const { idx, candMask } = pickMrvCell(boardArr, rows, cols, boxes);
    if (idx === -1) {
      return true;
    }
    if (candMask === 0) {
      return false;
    }

    const row = Math.floor(idx / 9);
    const col = idx % 9;
    const box = getBoxIndex(row, col);
    const candidates = [];
    for (let digit = 1; digit <= 9; digit += 1) {
      if (candMask & (1 << digit)) {
        candidates.push(digit);
      }
    }
    shuffleInPlace(candidates, rng);

    for (const digit of candidates) {
      const bit = 1 << digit;
      boardArr[idx] = digit;
      rows[row] |= bit;
      cols[col] |= bit;
      boxes[box] |= bit;

      if (fill()) {
        return true;
      }

      boardArr[idx] = 0;
      rows[row] &= ~bit;
      cols[col] &= ~bit;
      boxes[box] &= ~bit;
    }
    return false;
  }

  fill();
  return boardArr;
}

/**
 * Generates a Sudoku puzzle guaranteed to have a unique solution (`countSolutions === 1`).
 */
function generatePuzzle(difficulty = 'easy', seed = null) {
  const safeDifficulty = isValidDifficulty(difficulty) ? difficulty : 'easy';
  const targetClues = DIFFICULTY_CLUES[safeDifficulty];
  const rng = createRng(seed);

  const solutionArr = generateSolvedBoard(rng);
  const puzzleArr = solutionArr.slice();
  const indices = Array.from({ length: 81 }, (_, i) => i);
  shuffleInPlace(indices, rng);

  let clues = 81;
  for (const idx of indices) {
    if (clues <= targetClues) {
      break;
    }
    const prev = puzzleArr[idx];
    puzzleArr[idx] = 0;

    if (countSolutions(puzzleArr, 2) === 1) {
      clues -= 1;
    } else {
      puzzleArr[idx] = prev;
    }
  }

  return {
    puzzle: puzzleArr.join(''),
    solution: solutionArr.join(''),
    clues,
  };
}

/**
 * Selects the most logical next hint cell (fewest valid candidates among empty cells,
 * or the first incorrect cell if all cells are filled).
 */
function pickSmartHint(currentBoard, solution) {
  if (!isBoardString(currentBoard) || !isBoardString(solution)) {
    return null;
  }

  const rows = new Int32Array(9);
  const cols = new Int32Array(9);
  const boxes = new Int32Array(9);

  // Build peer constraints only from currently valid placements so user typos don't skew MRV
  for (let i = 0; i < 81; i += 1) {
    const ch = currentBoard[i];
    if (ch !== '0' && ch === solution[i]) {
      const bit = 1 << Number(ch);
      const row = Math.floor(i / 9);
      const col = i % 9;
      const box = getBoxIndex(row, col);
      rows[row] |= bit;
      cols[col] |= bit;
      boxes[box] |= bit;
    }
  }

  let bestEmptyIdx = -1;
  let bestCandidateCount = 10;
  let firstWrongIdx = -1;

  for (let i = 0; i < 81; i += 1) {
    const ch = currentBoard[i];
    if (ch === solution[i]) {
      continue;
    }
    if (ch === '0') {
      const row = Math.floor(i / 9);
      const col = i % 9;
      const box = getBoxIndex(row, col);
      const candMask = ALL_DIGITS_MASK & ~(rows[row] | cols[col] | boxes[box]);
      const count = popcount9(candMask) || 9;
      if (count < bestCandidateCount) {
        bestCandidateCount = count;
        bestEmptyIdx = i;
        if (count === 1) {
          break;
        }
      }
    } else if (firstWrongIdx === -1) {
      firstWrongIdx = i;
    }
  }

  const chosenIdx = bestEmptyIdx !== -1 ? bestEmptyIdx : firstWrongIdx;
  if (chosenIdx === -1) {
    return null;
  }
  return {
    index: chosenIdx,
    value: Number(solution[chosenIdx]),
  };
}

/**
 * Computes transparent score breakdown from difficulty, speed, accuracy, hints, and daily streak.
 */
function calculateScore({
  difficulty = 'easy',
  durationSeconds = 0,
  mistakes = 0,
  hintsUsed = 0,
  streakDays = 0,
} = {}) {
  const safeDiff = isValidDifficulty(difficulty) ? difficulty : 'easy';
  const base = SCORE_BASE[safeDiff];
  const par = SCORE_PAR_SECONDS[safeDiff];
  const safeDuration = Math.max(0, Number(durationSeconds) || 0);
  const safeMistakes = Math.max(0, Number(mistakes) || 0);
  const safeHints = Math.max(0, Number(hintsUsed) || 0);
  const safeStreak = Math.max(0, Number(streakDays) || 0);

  const speedBonus = Math.max(0, Math.round(600 * (1 - safeDuration / (par * 1.5))));
  const accuracyBonus = safeMistakes === 0 ? 250 : safeMistakes === 1 ? 100 : 0;
  const hintPenalty = 150 * safeHints;
  const streakMultiplier = Number((1 + Math.min(safeStreak, 5) * 0.05).toFixed(2));
  const total = Math.max(100, Math.round((base + speedBonus + accuracyBonus - hintPenalty) * streakMultiplier));

  return {
    total,
    base,
    speedBonus,
    accuracyBonus,
    hintPenalty,
    streakMultiplier,
  };
}

module.exports = {
  generatePuzzle,
  countSolutions,
  pickSmartHint,
  calculateScore,
  getTodayManilaDate,
  getYesterdayManilaDate,
  isValidDifficulty,
  isBoardString,
};
