// Motor matemático de Slots Matrix 4×4 con avalancha y comodines pegajosos (sin DOM).
// - 16 celdas con símbolos ponderados. 10 líneas (4 filas, 4 columnas y 2 diagonales) que pagan
//   3 o 4 iguales desde la primera celda de la línea (4 = Súper Bono ×15).
// - Comodín (W): sustituye a los símbolos de pago. Al formar parte de un premio se queda
//   bloqueado 2 o 3 giros. En cada uno de esos giros actúa una vez: completa las líneas y
//   multiplica ×2 cada línea ganadora que pasa por él (varios se multiplican entre sí, hasta ×8);
//   después descansa hasta el giro siguiente. Así ningún comodín fijo encadena premios sin fin.
// - Avalancha: las celdas ganadoras explotan (los comodines bloqueados se quedan), el resto cae
//   y entran símbolos nuevos; cada combo sucesivo del mismo giro multiplica ×1, ×2, ×3 y ×5.
// - Estrella (X): scatter. 3 o más al final del giro conceden 8 giros gratis, con rodillos donde
//   los comodines son mucho más frecuentes. También se pueden comprar (Bonus Buy).
// El RTP se mide por simulación con el motor real (SLOT_MATH, tools/measure-slots.mjs).

import { randomInt } from '../engine/rng.js';

export const ROWS = 4;
export const COLS = 4;
export const LINE_COUNT = 10;
export const SUPER_BONUS = 15;
// Cuatro en línea completados con comodines pagan ×5 (el Súper Bono ×15 es para 4 idénticos).
export const WILD_FOUR = 5;
export const CASCADE_MULTIPLIERS = Object.freeze([1, 2, 3, 5]);
export const WILD_MULTIPLIER = 2;
export const MAX_WILD_MULTIPLIER = 8;
export const STICKY_SPINS = Object.freeze([2, 3]);
// Todas las apuestas posibles; cada piso habilita un subconjunto.
export const BET_STEPS = Object.freeze([1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000]);
export const FREE_SPINS = 8;
export const BONUS_BUY_COST = 80;
export const MAX_WIN = 5000;
// Reliquia Trébol de Oro: en el juego base los pesos se duplican y la estrella gana 1 punto
// (+2,8 % de estrellas: más giros gratis sin que la mesa llegue a pagar más de lo que cobra).
export const CLOVER = Object.freeze({ factor: 2, extra: Object.freeze({ X: 1 }) });
const MAX_CASCADES = 60;

export const WILD = 'W';
export const SCATTER_ID = 'X';

// Pesos por celda (juego base y giros gratis) y pago con 3 en línea (en apuestas de línea).
export const SYMBOLS = Object.freeze([
  Object.freeze({ id: 'X', name: 'Estrella', base: 18, free: 14, pay3: 0, scatter: true }),
  Object.freeze({ id: 'W', name: 'Chip Comodín', base: 4, free: 45, pay3: 50, wild: true }),
  Object.freeze({ id: 'C', name: 'Diamante', base: 58, free: 150, pay3: 50 }),
  Object.freeze({ id: 'S', name: '7 de Oro', base: 88, free: 160, pay3: 20 }),
  Object.freeze({ id: 'B', name: 'Campana', base: 128, free: 170, pay3: 8 }),
  Object.freeze({ id: 'H', name: 'Herradura', base: 180, free: 160, pay3: 4 }),
  Object.freeze({ id: 'T', name: 'Trébol', base: 220, free: 140, pay3: 1 }),
  Object.freeze({ id: 'R', name: 'Cerezas', base: 290, free: 136, pay3: 1 }),
]);

// Resultados de la simulación del motor real (ver tools/measure-slots.mjs y README).
export const SLOT_MATH = Object.freeze({
  rtp: 0.9638,
  lines: 0.6753,
  freeSpins: 0.2884,
  bonusBuyRtp: 0.9663,
  freeSpinsRoundValue: 77.3,
  hitRate: 0.3946,
  netWinRate: 0.1524,
  triggerEvery: 268,
  twoCascades: 0.0846,
  cloverRtp: 0.9811,
  spins: 3_000_000,
  bonusRounds: 300_000,
});

export const SYMBOL_BY_ID = Object.freeze(Object.fromEntries(SYMBOLS.map((symbol) => [symbol.id, symbol])));

export const LINES = Object.freeze([
  ...Array.from({ length: ROWS }, (_, r) => Object.freeze(Array.from({ length: COLS }, (_, c) => [r, c]))),
  ...Array.from({ length: COLS }, (_, c) => Object.freeze(Array.from({ length: ROWS }, (_, r) => [r, c]))),
  Object.freeze([[0, 0], [1, 1], [2, 2], [3, 3]]),
  Object.freeze([[0, 3], [1, 2], [2, 1], [3, 0]]),
]);

export const LINE_NAMES = Object.freeze(['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Columna 1', 'Columna 2', 'Columna 3', 'Columna 4', 'Diagonal ↘', 'Diagonal ↙']);

const cellKey = (r, c) => r * COLS + c;
// Celda ocupada por un comodín que ya actuó en este giro: no sustituye ni forma línea.
const DORMANT = '-';

// `rand(n)` devuelve un entero uniforme en [0, n): por defecto crypto; en el juego, el flujo
// verificable de la jugada; inyectable en pruebas y simulaciones.
// `table` (solo para calibrar) sustituye los pesos: { base: [...], free: [...] } en el orden de SYMBOLS.
export function createDraw(mode = 'base', rand = randomInt, { clover = false, table = null } = {}) {
  const boosted = clover && mode !== 'free';
  const weights = SYMBOLS.map((symbol, i) => {
    const weight = table ? table[mode][i] : mode === 'free' ? symbol.free : symbol.base;
    return boosted ? weight * CLOVER.factor + (CLOVER.extra[symbol.id] ?? 0) : weight;
  });
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

// Valor de una lectura en apuestas de línea: 3 en línea = pay3; 4 idénticos = Súper Bono ×15;
// 4 completados con comodines = ×5 (4 comodines cuentan como idénticos).
const lineValue = (read) => (read.count === 4 ? read.pay3 * (read.natural ? SUPER_BONUS : WILD_FOUR) : read.pay3);

// Mejor lectura de una línea: símbolo de pago con comodines sustituyendo, o línea de comodines.
function readLine(grid, line) {
  const ids = line.map(([r, c]) => grid[r][c]);
  let wilds = 0;
  while (wilds < ids.length && ids[wilds] === WILD) wilds++;
  let best = null;
  if (wilds >= 3) best = { symbol: WILD, count: wilds, pay3: SYMBOL_BY_ID[WILD].pay3, natural: true };
  const anchor = ids.find((id) => id !== WILD);
  if (anchor && anchor !== DORMANT && !SYMBOL_BY_ID[anchor].scatter) {
    let count = 0;
    while (count < ids.length && (ids[count] === anchor || ids[count] === WILD)) count++;
    if (count >= 3) {
      const natural = ids.slice(0, count).every((id) => id === anchor);
      const candidate = { symbol: anchor, count, pay3: SYMBOL_BY_ID[anchor].pay3, natural };
      if (!best || lineValue(candidate) > lineValue(best)) best = candidate;
    }
  }
  return best;
}

// Líneas ganadoras. `multiplying` = celdas con comodín bloqueado que ya multiplican; con
// `fixed` (comodines bloqueados) y `repeat`, una línea hecha solo de comodines bloqueados no
// vuelve a pagar en los combos siguientes del mismo giro (no hay nada nuevo en ella).
export function findWins(grid, { multiplying = new Set(), fixed = new Set(), repeat = false } = {}) {
  const lines = [];
  const cells = new Map();
  LINES.forEach((line, index) => {
    const read = readLine(grid, line);
    if (!read) return;
    const winning = line.slice(0, read.count);
    if (repeat && winning.every(([r, c]) => fixed.has(cellKey(r, c)))) return;
    const multiplied = winning.filter(([r, c]) => multiplying.has(cellKey(r, c))).length;
    const multiplier = Math.min(MAX_WILD_MULTIPLIER, WILD_MULTIPLIER ** multiplied);
    const base = lineValue(read);
    for (const [r, c] of winning) cells.set(cellKey(r, c), [r, c]);
    lines.push({ index, symbol: read.symbol, count: read.count, natural: read.natural, base, multiplier, units: base * multiplier, cells: winning });
  });
  return { lines, units: lines.reduce((sum, line) => sum + line.units, 0), cells: [...cells.values()] };
}

// Retira las celdas ganadoras (salvo los comodines, que se quedan bloqueados), deja caer el
// resto alrededor de los comodines fijos y rellena desde arriba.
// `columns[c].sources[r]`: fila de origen de cada celda final (null = símbolo nuevo).
export function collapse(grid, removedCells, fixed, draw) {
  const removed = new Set(removedCells.map(([r, c]) => cellKey(r, c)));
  const next = Array.from({ length: ROWS }, () => new Array(COLS));
  const columns = [];
  for (let c = 0; c < COLS; c++) {
    const movable = [];
    const kept = [];
    for (let r = 0; r < ROWS; r++) {
      if (fixed.has(cellKey(r, c))) continue;
      movable.push(r);
      if (!removed.has(cellKey(r, c))) kept.push(r);
    }
    const fresh = movable.length - kept.length;
    const sources = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) {
      if (fixed.has(cellKey(r, c))) {
        next[r][c] = grid[r][c];
        sources[r] = r;
      }
    }
    movable.forEach((r, i) => {
      if (i < fresh) {
        next[r][c] = draw();
        sources[r] = null;
      } else {
        const from = kept[i - fresh];
        next[r][c] = grid[from][c];
        sources[r] = from;
      }
    });
    columns.push({ fresh, sources });
  }
  return { grid: next, columns };
}

export function scatterCells(grid) {
  const cells = [];
  grid.forEach((row, r) => row.forEach((id, c) => {
    if (SYMBOL_BY_ID[id].scatter) cells.push([r, c]);
  }));
  return cells;
}

// Un giro completo con sus avalanchas. `sticky` = comodines bloqueados de giros anteriores
// ([{ r, c, spins }]); el resultado trae los que siguen bloqueados para el próximo giro.
export function playSpin({ bet, mode = 'base', rand = randomInt, sticky = [], clover = false, table = null }) {
  const draw = createDraw(mode, rand, { clover, table });
  // Comodines bloqueados: `fresh` = bloqueado en este giro; `used` = ya actuó en este giro.
  const fixed = new Map();
  for (const item of sticky) {
    if (item && Number.isInteger(item.r) && Number.isInteger(item.c) && item.spins > 0) {
      fixed.set(cellKey(item.r, item.c), { r: item.r, c: item.c, spins: item.spins, fresh: false, used: false });
    }
  }
  const initial = Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => (fixed.has(cellKey(r, c)) ? WILD : draw())));

  const steps = [];
  let grid = initial;
  let units = 0;
  for (let k = 0; k < MAX_CASCADES; k++) {
    // Los comodines que ya actuaron en este giro no cuentan hasta el siguiente.
    const view = grid.map((row, r) => row.map((id, c) => (fixed.get(cellKey(r, c))?.used ? DORMANT : id)));
    const multiplying = new Set([...fixed.entries()].filter(([, item]) => !item.fresh && !item.used).map(([key]) => key));
    const wins = findWins(view, { multiplying, fixed: new Set(fixed.keys()), repeat: k > 0 });
    if (!wins.units) break;
    const multiplier = CASCADE_MULTIPLIERS[Math.min(k, CASCADE_MULTIPLIERS.length - 1)];
    // Cada comodín que forma parte de un premio queda bloqueado 2 o 3 giros y ya ha actuado.
    const locked = [];
    for (const [r, c] of wins.cells) {
      const key = cellKey(r, c);
      if (grid[r][c] !== WILD) continue;
      const item = fixed.get(key);
      if (item) {
        item.used = true;
      } else {
        const spins = STICKY_SPINS[rand(STICKY_SPINS.length)];
        fixed.set(key, { r, c, spins, fresh: true, used: true });
        locked.push({ r, c, spins });
      }
    }
    const exploding = wins.cells.filter(([r, c]) => !fixed.has(cellKey(r, c)));
    const next = collapse(grid, exploding, new Set(fixed.keys()), draw);
    units += wins.units * multiplier;
    steps.push({ grid, lines: wins.lines, cells: wins.cells, exploding, locked, units: wins.units, multiplier, next });
    grid = next.grid;
  }

  const scatters = scatterCells(grid);
  const lineWin = (units * bet) / LINE_COUNT;
  const cap = MAX_WIN * bet;
  const stickyNext = [];
  for (const item of fixed.values()) {
    const spins = item.fresh ? item.spins : item.spins - 1;
    if (spins > 0) stickyNext.push({ r: item.r, c: item.c, spins });
  }
  return {
    mode,
    initial,
    steps,
    final: grid,
    lineWin,
    scatters,
    freeSpins: mode === 'base' && scatters.length >= 3 ? FREE_SPINS : 0,
    total: Math.min(lineWin, cap),
    capped: lineWin > cap,
    sticky: stickyNext,
    stickyBefore: sticky.map((item) => ({ ...item })),
  };
}

// Ronda completa de giros gratis (para simulación y pruebas); tope de premio por ronda.
export function playFreeSpinsRound({ bet, spins = FREE_SPINS, rand = randomInt, sticky = [], clover = false, table = null }) {
  const cap = MAX_WIN * bet;
  let total = 0;
  let played = 0;
  let current = sticky;
  while (played < spins && total < cap) {
    played++;
    const spin = playSpin({ bet, mode: 'free', rand, sticky: current, clover, table });
    total = Math.min(cap, total + spin.total);
    current = spin.sticky;
  }
  return { total, played, sticky: current };
}
