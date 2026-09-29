// Motor matemático de Slots Matrix 4x4 (sin DOM).
// 16 celdas independientes con símbolos ponderados (Σ pesos = 1000). 10 líneas: 4 filas,
// 4 columnas y 2 diagonales; paga 3 o 4 iguales desde la primera celda de la línea (4 = Súper
// Bono ×15). Avalancha: los símbolos ganadores explotan, el resto cae y entran símbolos nuevos;
// cada combo sucesivo del mismo giro multiplica ×1, ×2, ×3 y ×5. El Diamante es scatter.
// Giros gratis (10, o comprados con Bonus Buy) con rodillos enriquecidos y un multiplicador
// dorado aleatorio (×2 a ×100) en cada giro. El RTP se mide por simulación (SLOT_MATH).

import { randomInt } from '../engine/rng.js';

export const ROWS = 4;
export const COLS = 4;
export const LINE_COUNT = 10;
export const SUPER_BONUS = 15;
export const CASCADE_MULTIPLIERS = Object.freeze([1, 2, 3, 5]);
export const BET_STEPS = Object.freeze([10, 20, 50, 100, 200, 500]);
export const FREE_SPINS = 10;
export const RETRIGGER_SPINS = 5;
export const BONUS_BUY_COST = 100;
export const MAX_WIN = 5000;
const MAX_CASCADES = 60;

export const SYMBOLS = Object.freeze([
  Object.freeze({ id: 'D', name: 'Diamante', base: 18, free: 20, pay3: 0, scatter: true }),
  Object.freeze({ id: 'C', name: 'Corona Real', base: 60, free: 158, pay3: 50 }),
  Object.freeze({ id: 'S', name: '7 de Oro', base: 90, free: 170, pay3: 20 }),
  Object.freeze({ id: 'B', name: 'Campana', base: 130, free: 180, pay3: 8 }),
  Object.freeze({ id: 'H', name: 'Herradura', base: 180, free: 170, pay3: 4 }),
  Object.freeze({ id: 'T', name: 'Trébol', base: 220, free: 150, pay3: 1 }),
  Object.freeze({ id: 'R', name: 'Cerezas', base: 302, free: 152, pay3: 1 }),
]);

// Scatter en el juego base: premio en múltiplos de la apuesta total y giros gratis (5+ = fila de 5).
export const SCATTER = Object.freeze({
  3: Object.freeze({ pays: 2, spins: 10 }),
  4: Object.freeze({ pays: 10, spins: 12 }),
  5: Object.freeze({ pays: 50, spins: 15 }),
});

// Multiplicador dorado de cada giro gratis: [valor, peso sobre 1000].
export const GOLDEN = Object.freeze([
  Object.freeze([2, 400]),
  Object.freeze([3, 250]),
  Object.freeze([5, 180]),
  Object.freeze([10, 100]),
  Object.freeze([25, 50]),
  Object.freeze([50, 15]),
  Object.freeze([100, 5]),
]);

// Resultados de la simulación del motor real (ver tests/math.test.js y README).
export const SLOT_MATH = Object.freeze({
  rtp: 0.9629,
  lines: 0.6002,
  scatter: 0.0095,
  freeSpins: 0.3533,
  bonusBuyRtp: 0.9625,
  hitRate: 0.375,
  triggerEvery: 276,
  spins: 60_000_000,
  bonusRounds: 4_500_000,
});

export const SYMBOL_BY_ID = Object.freeze(Object.fromEntries(SYMBOLS.map((symbol) => [symbol.id, symbol])));

export const LINES = Object.freeze([
  ...Array.from({ length: ROWS }, (_, r) => Object.freeze(Array.from({ length: COLS }, (_, c) => [r, c]))),
  ...Array.from({ length: COLS }, (_, c) => Object.freeze(Array.from({ length: ROWS }, (_, r) => [r, c]))),
  Object.freeze([[0, 0], [1, 1], [2, 2], [3, 3]]),
  Object.freeze([[0, 3], [1, 2], [2, 1], [3, 0]]),
]);

export const LINE_NAMES = Object.freeze(['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Columna 1', 'Columna 2', 'Columna 3', 'Columna 4', 'Diagonal ↘', 'Diagonal ↙']);

// `rand(n)` devuelve un entero uniforme en [0, n): crypto por defecto; inyectable en pruebas.
export function createDraw(mode = 'base', rand = randomInt) {
  const weights = SYMBOLS.map((symbol) => (mode === 'free' ? symbol.free : symbol.base));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return () => {
    let roll = rand(total);
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) return SYMBOLS[i].id;
      roll -= weights[i];
    }
    return SYMBOLS[SYMBOLS.length - 1].id;
  };
}

export function rollGolden(rand = randomInt) {
  let roll = rand(1000);
  for (const [value, weight] of GOLDEN) {
    if (roll < weight) return value;
    roll -= weight;
  }
  return GOLDEN[GOLDEN.length - 1][0];
}

export function randomGrid(draw) {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => draw()));
}

// Líneas ganadoras de una cuadrícula; `units` en apuestas de línea (apuesta total / 10).
export function findWins(grid) {
  const lines = [];
  const cells = new Map();
  LINES.forEach((line, index) => {
    const first = grid[line[0][0]][line[0][1]];
    const symbol = SYMBOL_BY_ID[first];
    if (symbol.scatter) return;
    let count = 1;
    while (count < line.length && grid[line[count][0]][line[count][1]] === first) count++;
    if (count < 3) return;
    const units = count === 4 ? symbol.pay3 * SUPER_BONUS : symbol.pay3;
    const winning = line.slice(0, count);
    for (const [r, c] of winning) cells.set(`${r},${c}`, [r, c]);
    lines.push({ index, symbol: first, count, units, cells: winning });
  });
  return { lines, units: lines.reduce((sum, line) => sum + line.units, 0), cells: [...cells.values()] };
}

// Retira las celdas ganadoras, deja caer el resto por gravedad y rellena desde arriba.
// `columns[c].sources[r]` indica la fila de origen de cada celda final (null = símbolo nuevo).
export function collapse(grid, cells, draw) {
  const removed = new Set(cells.map(([r, c]) => `${r},${c}`));
  const next = Array.from({ length: ROWS }, () => new Array(COLS));
  const columns = [];
  for (let c = 0; c < COLS; c++) {
    const kept = [];
    for (let r = 0; r < ROWS; r++) if (!removed.has(`${r},${c}`)) kept.push(r);
    const fresh = ROWS - kept.length;
    const sources = [];
    for (let r = 0; r < ROWS; r++) {
      if (r < fresh) {
        next[r][c] = draw();
        sources.push(null);
      } else {
        const from = kept[r - fresh];
        next[r][c] = grid[from][c];
        sources.push(from);
      }
    }
    columns.push({ fresh, sources });
  }
  return { grid: next, columns };
}

// Secuencia completa de avalanchas de un giro.
export function resolveTumbles(initial, draw) {
  const steps = [];
  let grid = initial;
  let units = 0;
  for (let k = 0; k < MAX_CASCADES; k++) {
    const wins = findWins(grid);
    if (!wins.units) break;
    const multiplier = CASCADE_MULTIPLIERS[Math.min(k, CASCADE_MULTIPLIERS.length - 1)];
    const next = collapse(grid, wins.cells, draw);
    units += wins.units * multiplier;
    steps.push({ grid, lines: wins.lines, cells: wins.cells, units: wins.units, multiplier, next });
    grid = next.grid;
  }
  return { steps, final: grid, units };
}

export function scatterCells(grid) {
  const cells = [];
  grid.forEach((row, r) => row.forEach((id, c) => {
    if (SYMBOL_BY_ID[id].scatter) cells.push([r, c]);
  }));
  return cells;
}

export function scatterAward(count) {
  return count >= 3 ? SCATTER[Math.min(count, 5)] : null;
}

// Un giro completo. En modo 'free' paga solo líneas × multiplicador dorado y el scatter
// reactiva +5 giros; en modo 'base' el scatter paga y concede giros gratis.
export function playSpin({ bet, mode = 'base', rand = randomInt }) {
  const draw = createDraw(mode, rand);
  const initial = randomGrid(draw);
  const { steps, final, units } = resolveTumbles(initial, draw);
  const scatters = scatterCells(final);
  const lineWin = (units * bet) / LINE_COUNT;
  const cap = MAX_WIN * bet;
  if (mode === 'free') {
    const golden = rollGolden(rand);
    const raw = lineWin * golden;
    return {
      mode, initial, steps, final, lineWin, golden, scatters,
      scatterWin: 0,
      freeSpins: 0,
      retrigger: scatters.length >= 3 ? RETRIGGER_SPINS : 0,
      total: Math.min(raw, cap),
      capped: raw > cap,
    };
  }
  const award = scatterAward(scatters.length);
  const scatterWin = award ? award.pays * bet : 0;
  const raw = lineWin + scatterWin;
  return {
    mode, initial, steps, final, lineWin, golden: 1, scatters, scatterWin,
    freeSpins: award ? award.spins : 0,
    retrigger: 0,
    total: Math.min(raw, cap),
    capped: raw > cap,
  };
}

// Ronda completa de giros gratis (para simulación y pruebas); tope de premio por ronda.
export function playFreeSpinsRound({ bet, spins = FREE_SPINS, rand = randomInt }) {
  const cap = MAX_WIN * bet;
  let left = spins;
  let total = 0;
  let played = 0;
  while (left > 0 && total < cap) {
    left--;
    played++;
    const spin = playSpin({ bet, mode: 'free', rand });
    total = Math.min(cap, total + spin.total);
    left += spin.retrigger;
  }
  return { total, played };
}
