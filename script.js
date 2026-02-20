document.addEventListener('DOMContentLoaded', () => {
  const PIP_RENDER_MODE = 'pips'; // "pips" | "numbers"

  const WIDTH = 8;
  const HEIGHT = 16;
  const CELL_COUNT = WIDTH * HEIGHT;

  const gridEl = document.getElementById('grid');
  const rowSumsEl = document.getElementById('row-sums');
  const floatLayerEl = document.getElementById('float-layer');
  const pauseOverlayEl = document.getElementById('pause-overlay');

  const scoreEl = document.getElementById('score');
  const livesEl = document.getElementById('lives');
  const streakEl = document.getElementById('streak');
  const multiplierEl = document.getElementById('multiplier');
  const rowsClearedEl = document.getElementById('rows-cleared');
  const speedEl = document.getElementById('speed');
  const modeEl = document.getElementById('mode');
  const messageEl = document.getElementById('message');

  const startEasyBtn = document.getElementById('start-easy');
  const startHardBtn = document.getElementById('start-hard');
  const pauseBtn = document.getElementById('pause-button');
  const restartBtn = document.getElementById('restart-button');

  const domCells = [];
  const rowSumEls = [];
  let state;

  for (let i = 0; i < CELL_COUNT; i += 1) {
    const div = document.createElement('div');
    div.className = 'cell';
    domCells.push(div);
    gridEl.appendChild(div);
  }

  for (let row = 0; row < HEIGHT; row += 1) {
    const sum = document.createElement('div');
    sum.className = 'row-sum';
    rowSumsEl.appendChild(sum);
    rowSumEls.push(sum);
  }

  function makeEmptyCells() {
    return Array.from({ length: CELL_COUNT }, () => ({ taken: false, pip: null, dominoId: null, seam: '' }));
  }

  function createBag() {
    const bag = [];
    for (let a = 0; a <= 6; a += 1) {
      for (let b = a; b <= 6; b += 1) bag.push({ a, b });
    }
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function initState() {
    state = {
      cells: makeEmptyCells(),
      currentPiece: null,
      bag: createBag(),
      bagIndex: 0,
      dominoCounter: 0,
      score: 0,
      lives: 10,
      streakActive: false,
      totalRowsCleared: 0,
      dropIntervalMs: 1000,
      mode: null,
      isPaused: false,
      isRunning: false,
      gravityTimerId: null,
      softDropHeld: false,
      lockBusy: false,
      gameOver: false,
    };
  }

  function idx(row, col) { return row * WIDTH + col; }
  function inBounds(row, col) { return row >= 0 && row < HEIGHT && col >= 0 && col < WIDTH; }

  function nextTile() {
    if (state.bagIndex >= state.bag.length) {
      state.bag = createBag();
      state.bagIndex = 0;
    }
    const tile = state.bag[state.bagIndex];
    state.bagIndex += 1;
    return tile;
  }

  function spawnPiece() {
    const tile = nextTile();
    const left = Math.min(tile.a, tile.b);
    const right = Math.max(tile.a, tile.b);
    const dominoId = `d-${Date.now()}-${state.dominoCounter++}`;
    const candidate = {
      orientation: 'H',
      dominoId,
      cells: [
        { row: 0, col: 3, pip: left },
        { row: 0, col: 4, pip: right },
      ],
    };

    if (!pieceFits(candidate.cells)) {
      endGame('Spawn collision!');
      return false;
    }
    state.currentPiece = candidate;
    return true;
  }

  function pieceFits(pieceCells) {
    return pieceCells.every((c) => inBounds(c.row, c.col) && !state.cells[idx(c.row, c.col)].taken);
  }

  function movePiece(dRow, dCol) {
    if (!state.currentPiece || state.lockBusy) return false;
    const moved = state.currentPiece.cells.map((c) => ({ ...c, row: c.row + dRow, col: c.col + dCol }));
    if (!pieceFits(moved)) return false;
    state.currentPiece.cells = moved;
    return true;
  }

  function rotatePieceClockwise() {
    if (!state.currentPiece || state.lockBusy || state.currentPiece.orientation !== 'H' && state.currentPiece.orientation !== 'V') return;

    const [c1, c2] = state.currentPiece.cells;
    const horizontal = state.currentPiece.orientation === 'H';
    const anchor = horizontal ? (c1.col <= c2.col ? c1 : c2) : (c1.row >= c2.row ? c1 : c2);
    const other = anchor === c1 ? c2 : c1;

    let rotated;
    let nextOrientation;
    if (horizontal) {
      rotated = [{ ...anchor }, { ...other, row: anchor.row - 1, col: anchor.col }];
      nextOrientation = 'V';
    } else {
      rotated = [{ ...anchor }, { ...other, row: anchor.row, col: anchor.col + 1 }];
      nextOrientation = 'H';
    }

    const kicks = [
      { x: 0, y: 0 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    for (const kick of kicks) {
      const trial = rotated.map((c) => ({ ...c, row: c.row + kick.y, col: c.col + kick.x }));
      if (pieceFits(trial)) {
        state.currentPiece.cells = trial;
        state.currentPiece.orientation = nextOrientation;
        return;
      }
    }
  }

  function hardDrop() {
    if (!state.currentPiece || state.lockBusy) return;
    while (movePiece(1, 0));
    lockCurrentPiece();
  }

  function lockCurrentPiece() {
    if (!state.currentPiece || state.lockBusy) return;
    state.lockBusy = true;

    const seams = pieceSeams(state.currentPiece.cells);
    for (const c of state.currentPiece.cells) {
      const index = idx(c.row, c.col);
      state.cells[index] = {
        taken: true,
        pip: c.pip,
        dominoId: state.currentPiece.dominoId,
        seam: seams.get(`${c.row},${c.col}`) || '',
      };
    }

    resolveAfterLock().finally(() => {
      state.lockBusy = false;
      if (!state.gameOver && !spawnPiece()) return;
      if (!state.gameOver) render();
    });
  }

  function pieceSeams(cells) {
    const [a, b] = cells;
    const map = new Map();
    if (a.row === b.row) {
      const left = a.col <= b.col ? a : b;
      const right = left === a ? b : a;
      map.set(`${left.row},${left.col}`, 'right');
      map.set(`${right.row},${right.col}`, 'left');
    } else {
      const top = a.row <= b.row ? a : b;
      const bottom = top === a ? b : a;
      map.set(`${top.row},${top.col}`, 'bottom');
      map.set(`${bottom.row},${bottom.col}`, 'top');
    }
    return map;
  }

  async function resolveAfterLock() {
    const fullRows = [];
    for (let row = 0; row < HEIGHT; row += 1) {
      let complete = true;
      for (let col = 0; col < WIDTH; col += 1) {
        if (!state.cells[idx(row, col)].taken) complete = false;
      }
      if (complete) fullRows.push(row);
    }

    const rows = fullRows.slice(0, 2);
    if (rows.length === 0) {
      state.streakActive = false;
      updateDropSpeed();
      updateHUD();
      return;
    }

    const details = rows.map((row) => {
      let sum = 0;
      for (let col = 0; col < WIDTH; col += 1) sum += state.cells[idx(row, col)].pip;
      return { row, sum, is5Mult: sum > 0 && sum % 5 === 0 };
    });

    const has5Mult = details.some((d) => d.is5Mult);
    const streakBefore = state.streakActive;

    let gained = 0;
    if (details.length === 1) {
      const d = details[0];
      if (d.is5Mult) gained += d.sum * (streakBefore ? 2 : 1);
    } else if (has5Mult) {
      gained += details.filter((d) => d.is5Mult).reduce((acc, d) => acc + d.sum, 0) * 2;
    }

    const livesDelta = details.reduce((acc, d) => acc + (d.is5Mult ? 2 : -1), 0);
    state.score += gained;
    state.lives += livesDelta;
    state.totalRowsCleared += details.length;
    state.streakActive = has5Mult;

    showFloatingFeedback(gained, livesDelta);
    await flashRows(details);
    clearRows(rows);
    collapseRows();

    if (state.lives < 0) {
      endGame('Lives below 0');
      return;
    }

    updateDropSpeed();
    updateHUD();
  }

  function showFloatingFeedback(scoreGain, livesDelta) {
    const text = document.createElement('div');
    const multText = state.streakActive ? ' ×2 ACTIVE' : '';
    text.className = `float-text ${scoreGain > 0 || livesDelta > 0 ? 'good' : 'bad'}`;
    const lifeSign = livesDelta >= 0 ? '+' : '';
    text.textContent = `+${scoreGain} · Lives ${lifeSign}${livesDelta}${multText}`;
    text.style.top = `${Math.floor(HEIGHT / 2) * 34}px`;
    floatLayerEl.appendChild(text);
    setTimeout(() => text.remove(), 900);
  }

  function flashRows(details) {
    const toFlash = [];
    details.forEach((d) => {
      for (let col = 0; col < WIDTH; col += 1) {
        toFlash.push(domCells[idx(d.row, col)]);
      }
    });

    details.forEach((d) => {
      const cls = d.is5Mult ? 'flash-mult' : 'flash-nonmult';
      for (let col = 0; col < WIDTH; col += 1) domCells[idx(d.row, col)].classList.add(cls);
    });

    return new Promise((resolve) => {
      setTimeout(() => {
        toFlash.forEach((c) => c.classList.remove('flash-mult', 'flash-nonmult'));
        resolve();
      }, 130);
    });
  }

  function clearRows(rows) {
    rows.forEach((row) => {
      for (let col = 0; col < WIDTH; col += 1) {
        state.cells[idx(row, col)] = { taken: false, pip: null, dominoId: null, seam: '' };
      }
    });
  }

  function collapseRows() {
    for (let row = HEIGHT - 1; row >= 0; row -= 1) {
      if (rowIsEmpty(row)) {
        for (let above = row - 1; above >= 0; above -= 1) {
          for (let col = 0; col < WIDTH; col += 1) {
            state.cells[idx(above + 1, col)] = { ...state.cells[idx(above, col)] };
          }
        }
        for (let col = 0; col < WIDTH; col += 1) state.cells[idx(0, col)] = { taken: false, pip: null, dominoId: null, seam: '' };
        row += 1;
      }
    }

    recomputeLockedSeams();
  }

  function recomputeLockedSeams() {
    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const cell = state.cells[idx(row, col)];
        if (cell.taken) cell.seam = '';
      }
    }

    for (let row = 0; row < HEIGHT; row += 1) {
      for (let col = 0; col < WIDTH; col += 1) {
        const current = state.cells[idx(row, col)];
        if (!current.taken || !current.dominoId) continue;

        const rightCol = col + 1;
        const downRow = row + 1;

        if (rightCol < WIDTH) {
          const right = state.cells[idx(row, rightCol)];
          if (right.taken && right.dominoId === current.dominoId) {
            current.seam = 'right';
            right.seam = 'left';
          }
        }

        if (downRow < HEIGHT) {
          const down = state.cells[idx(downRow, col)];
          if (down.taken && down.dominoId === current.dominoId) {
            current.seam = 'bottom';
            down.seam = 'top';
          }
        }
      }
    }
  }

  function rowIsEmpty(row) {
    for (let col = 0; col < WIDTH; col += 1) if (state.cells[idx(row, col)].taken) return false;
    return true;
  }

  function updateDropSpeed() {
    state.dropIntervalMs = Math.max(150, 1000 - (50 * Math.floor(state.totalRowsCleared / 10)));

    if (!state.isRunning || state.gameOver) return;

    const intervalMs = state.softDropHeld ? Math.max(80, Math.floor(state.dropIntervalMs / 4)) : state.dropIntervalMs;

    if (state.isPaused) {
      clearInterval(state.gravityTimerId);
      state.gravityTimerId = null;
      return;
    }

    clearInterval(state.gravityTimerId);
    state.gravityTimerId = setInterval(tick, intervalMs);
  }

  function tick() {
    if (state.isPaused || state.gameOver || !state.currentPiece) return;
    if (!movePiece(1, 0)) lockCurrentPiece();
    render();
  }

  function startGame(mode) {
    initState();
    state.mode = mode;
    state.isRunning = true;
    messageEl.textContent = 'Game running';
    modeEl.textContent = mode.toUpperCase();
    startEasyBtn.disabled = true;
    startHardBtn.disabled = true;
    if (!spawnPiece()) return;
    updateDropSpeed();
    updateHUD();
    render();
  }

  function endGame(reason) {
    state.gameOver = true;
    clearInterval(state.gravityTimerId);
    messageEl.textContent = `Game Over: ${reason}`;
    startEasyBtn.disabled = false;
    startHardBtn.disabled = false;
    state.currentPiece = null;
    render();
  }

  function updateHUD() {
    scoreEl.textContent = state.score;
    livesEl.textContent = state.lives;
    rowsClearedEl.textContent = state.totalRowsCleared;
    speedEl.textContent = `${state.dropIntervalMs}ms`;
    streakEl.textContent = state.streakActive ? 'ON' : 'OFF';
    multiplierEl.textContent = state.streakActive ? '×2 ACTIVE' : '×1';
  }

  function getVirtualCell(index) {
    const row = Math.floor(index / WIDTH);
    const col = index % WIDTH;
    const locked = state.cells[index];
    const active = state.currentPiece?.cells.find((c) => c.row === row && c.col === col);
    if (active) {
      const seams = pieceSeams(state.currentPiece.cells);
      return {
        occupied: true,
        pip: active.pip,
        dominoId: state.currentPiece.dominoId,
        active: true,
        seam: seams.get(`${row},${col}`) || '',
      };
    }
    if (locked.taken) {
      return { occupied: true, pip: locked.pip, dominoId: locked.dominoId, active: false, seam: locked.seam || '' };
    }
    return { occupied: false, pip: null, dominoId: null, active: false, seam: '' };
  }

  function pipsForValue(value) {
    const map = {
      0: [],
      1: [4],
      2: [0, 8],
      3: [0, 4, 8],
      4: [0, 2, 6, 8],
      5: [0, 2, 4, 6, 8],
      6: [0, 2, 3, 5, 6, 8],
    };
    return map[value] || [];
  }

  function renderPips(cellEl, value) {
    if (PIP_RENDER_MODE === 'numbers') {
      const val = document.createElement('div');
      val.className = 'value';
      val.textContent = String(value);
      cellEl.appendChild(val);
      return;
    }

    const pipsEl = document.createElement('div');
    pipsEl.className = 'pips';
    const positions = pipsForValue(value);
    for (let i = 0; i < 9; i += 1) {
      const slot = document.createElement('div');
      if (positions.includes(i)) slot.className = 'pip';
      pipsEl.appendChild(slot);
    }
    cellEl.appendChild(pipsEl);
  }

  function renderRowSums() {
    for (let row = 0; row < HEIGHT; row += 1) {
      let sum = 0;
      for (let col = 0; col < WIDTH; col += 1) {
        const cell = state.cells[idx(row, col)];
        if (cell.taken) sum += cell.pip;
      }
      const rowEl = rowSumEls[row];
      rowEl.textContent = String(sum);
      rowEl.classList.toggle('hidden', state.mode !== 'easy');
      rowEl.classList.toggle('mult', state.mode === 'easy' && sum > 0 && sum % 5 === 0);
    }
  }

  function render() {
    if (!state) return;
    const virtualBoard = Array.from({ length: CELL_COUNT }, (_, i) => getVirtualCell(i));

    for (let i = 0; i < CELL_COUNT; i += 1) {
      const row = Math.floor(i / WIDTH);
      const col = i % WIDTH;
      const d = virtualBoard[i];
      const el = domCells[i];

      el.className = 'cell';
      el.textContent = '';
      el.innerHTML = '';
      el.removeAttribute('data-divider');

      if (d.occupied) {
        el.classList.add('occupied');
        if (d.active) el.classList.add('active');
        if (d.seam) el.dataset.divider = d.seam;
        renderPips(el, d.pip);
      }
    }

    renderRowSums();
    updateHUD();
    pauseOverlayEl.classList.toggle('hidden', !state.isPaused);
  }

  function togglePause() {
    if (!state || !state.isRunning || state.gameOver) return;
    state.isPaused = !state.isPaused;
    messageEl.textContent = state.isPaused ? 'Paused' : 'Game running';
    updateDropSpeed();
    render();
  }

  function restart() {
    if (!state || !state.mode) {
      initState();
      render();
      return;
    }
    clearInterval(state.gravityTimerId);
    startGame(state.mode);
  }

  function adjustSoftDrop(isHeld) {
    if (!state || !state.isRunning || state.gameOver) return;
    state.softDropHeld = isHeld;
    updateDropSpeed();
  }

  document.addEventListener('keydown', (e) => {
    if (!state || !state.isRunning || state.gameOver) return;

    const key = e.key;
    const code = e.code;
    if (key === 'p' || key === 'P') return togglePause();
    if (key === 'r' || key === 'R') return restart();
    if (state.isPaused) return;

    if (code === 'Space') e.preventDefault();
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') movePiece(0, -1);
    if (key === 'ArrowRight' || key === 'd' || key === 'D') movePiece(0, 1);
    if (key === 'ArrowUp' || key === 'w' || key === 'W') rotatePieceClockwise();
    if (key === 'ArrowDown' || key === 's' || key === 'S') adjustSoftDrop(true);
    if (code === 'Space' || code === 'ShiftRight') hardDrop();

    render();
  });

  document.addEventListener('keyup', (e) => {
    const key = e.key;
    if (key === 'ArrowDown' || key === 's' || key === 'S') adjustSoftDrop(false);
  });

  startEasyBtn.addEventListener('click', () => startGame('easy'));
  startHardBtn.addEventListener('click', () => startGame('hard'));
  pauseBtn.addEventListener('click', togglePause);
  restartBtn.addEventListener('click', restart);

  initState();
  render();
});
