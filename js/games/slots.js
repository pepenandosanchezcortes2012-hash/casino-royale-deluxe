// Slots Matrix 4x4: 16 celdas independientes con símbolos ponderados (Σ pesos = 100).
// 10 líneas (4 filas, 4 columnas, 2 diagonales). 3 iguales desde el inicio de la línea pagan
// la tabla; 4 iguales activan el Súper Bono ×15. El Diamante es scatter: 3+ en cualquier
// posición pagan y otorgan Giros Gratis con multiplicador progresivo ×1…×5.
// El RTP se calcula de forma exacta en parSheet(); las pruebas lo verifican por Monte Carlo.

import { weightedIndex, binomialPmf } from '../engine/rng.js';
import { Store, PHASE, wait } from '../engine/store.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { symbolSvg, svg, el } from '../ui/svg.js';

export const ROWS = 4;
export const COLS = 4;
export const SUPER_BONUS = 15;
export const LINE_COUNT = 10;
export const BET_STEPS = Object.freeze([10, 20, 50, 100, 200, 500]);
export const FS_MULTIPLIERS = Object.freeze([1, 2, 3, 4, 5]);

export const SYMBOLS = Object.freeze([
  Object.freeze({ id: 'D', name: 'Diamante', weight: 3, scatter: true, pay3: 0 }),
  Object.freeze({ id: 'C', name: 'Corona Real', weight: 6, pay3: 90 }),
  Object.freeze({ id: 'S', name: '7 de Oro', weight: 9, pay3: 35 }),
  Object.freeze({ id: 'B', name: 'Campana', weight: 13, pay3: 15 }),
  Object.freeze({ id: 'H', name: 'Herradura', weight: 18, pay3: 6 }),
  Object.freeze({ id: 'T', name: 'Trébol', weight: 22, pay3: 3 }),
  Object.freeze({ id: 'R', name: 'Cerezas', weight: 29, pay3: 2 }),
]);

// Premio scatter en múltiplos de la apuesta total y giros concedidos (5+ usa la fila de 5).
export const SCATTER = Object.freeze({
  3: Object.freeze({ pays: 2, spins: 8 }),
  4: Object.freeze({ pays: 10, spins: 10 }),
  5: Object.freeze({ pays: 50, spins: 12 }),
});

const BY_ID = Object.fromEntries(SYMBOLS.map((s) => [s.id, s]));
const WEIGHTS = SYMBOLS.map((s) => s.weight);
const TOTAL_WEIGHT = WEIGHTS.reduce((a, b) => a + b, 0);

export const LINES = Object.freeze([
  ...Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => [r, c])),
  ...Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, (_, r) => [r, c])),
  [[0, 0], [1, 1], [2, 2], [3, 3]],
  [[0, 3], [1, 2], [2, 1], [3, 0]],
]);

const LINE_NAMES = ['Fila 1', 'Fila 2', 'Fila 3', 'Fila 4', 'Columna 1', 'Columna 2', 'Columna 3', 'Columna 4', 'Diagonal ↘', 'Diagonal ↙'];

export const randomSymbol = () => SYMBOLS[weightedIndex(WEIGHTS)].id;

export function spinGrid() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, randomSymbol));
}

// Evalúa la cuadrícula. `units` está en apuestas de línea (apuesta total / 10).
export function evaluateGrid(grid) {
  const lines = [];
  LINES.forEach((cells, index) => {
    const first = grid[cells[0][0]][cells[0][1]];
    const symbol = BY_ID[first];
    if (symbol.scatter) return;
    let count = 1;
    while (count < cells.length && grid[cells[count][0]][cells[count][1]] === first) count++;
    if (count < 3) return;
    const units = count === 4 ? symbol.pay3 * SUPER_BONUS : symbol.pay3;
    lines.push({ index, symbol: first, count, units, cells: cells.slice(0, count) });
  });
  const scatterCells = [];
  grid.forEach((row, r) => row.forEach((id, c) => {
    if (BY_ID[id].scatter) scatterCells.push([r, c]);
  }));
  return { lines, lineUnits: lines.reduce((sum, line) => sum + line.units, 0), scatterCount: scatterCells.length, scatterCells };
}

export function scatterAward(count) {
  return count >= 3 ? SCATTER[Math.min(count, 5)] : null;
}

// Premio de un giro en fichas. En giros gratis solo pagan las líneas, multiplicadas.
export function spinWin(grid, bet, { free = false, multiplier = 1 } = {}) {
  const evaluation = evaluateGrid(grid);
  const lineWin = (evaluation.lineUnits * bet * multiplier) / LINE_COUNT;
  const award = free ? null : scatterAward(evaluation.scatterCount);
  const scatterWin = award ? award.pays * bet : 0;
  return {
    ...evaluation,
    lineWin,
    scatterWin,
    freeSpins: award ? award.spins : 0,
    superBonus: evaluation.lines.some((line) => line.count === 4),
    total: lineWin + scatterWin,
  };
}

export function freeSpinMultiplierSum(spins) {
  let sum = 0;
  for (let i = 0; i < spins; i++) sum += FS_MULTIPLIERS[Math.min(i, FS_MULTIPLIERS.length - 1)];
  return sum;
}

// Par sheet exacto. Celdas independientes ⇒ por linealidad de la esperanza cada línea aporta
// Σ pay3·(p³(1−p) + 15·p⁴) apuestas de línea; 10 líneas × apuesta de línea = apuesta total.
export function parSheet() {
  const cells = ROWS * COLS;
  const perSymbol = SYMBOLS.filter((s) => !s.scatter).map((s) => {
    const p = s.weight / TOTAL_WEIGHT;
    const three = p ** 3 * (1 - p);
    const four = p ** 4;
    return { id: s.id, name: s.name, probability: p, three, four, rtp: s.pay3 * (three + SUPER_BONUS * four) };
  });
  const lines = perSymbol.reduce((sum, s) => sum + s.rtp, 0);
  const pScatter = BY_ID.D.weight / TOTAL_WEIGHT;
  let scatter = 0;
  let freeSpins = 0;
  let trigger = 0;
  for (let k = 3; k <= cells; k++) {
    const pk = binomialPmf(cells, k, pScatter);
    const award = scatterAward(k);
    trigger += pk;
    scatter += pk * award.pays;
    freeSpins += pk * freeSpinMultiplierSum(award.spins) * lines;
  }
  return { lines, scatter, freeSpins, total: lines + scatter + freeSpins, triggerProbability: trigger, perSymbol };
}

// ---------- Máquina ----------

const SAVE_KEY = 'crd.slots.v1';

function loadSaved() {
  const saved = storage.read(SAVE_KEY, null) ?? {};
  const bet = BET_STEPS.includes(saved.bet) ? saved.bet : 20;
  const validGrid = Array.isArray(saved.grid) && saved.grid.length === ROWS &&
    saved.grid.every((row) => Array.isArray(row) && row.length === COLS && row.every((id) => id in BY_ID));
  const fs = saved.fs && Number.isInteger(saved.fs.remaining) && saved.fs.remaining > 0 && BET_STEPS.includes(saved.fs.bet)
    ? { remaining: saved.fs.remaining, played: Math.max(0, saved.fs.played | 0), total: Number(saved.fs.total) || 0, awarded: saved.fs.awarded | 0, bet: saved.fs.bet }
    : null;
  return { bet, grid: validGrid ? saved.grid : spinGrid(), fs };
}

export class SlotsGame {
  #store;
  #dom;
  #reels = [];
  #visible = false;
  #autoTimer = 0;
  #reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      grid: $('sl-grid'),
      lines: $('sl-lines'),
      bet: $('sl-bet'),
      lineBet: $('sl-linebet'),
      betDown: $('sl-bet-down'),
      betUp: $('sl-bet-up'),
      spin: $('sl-spin'),
      win: $('sl-win'),
      rtp: $('sl-rtp'),
      message: $('sl-message'),
      banner: $('sl-banner'),
      paytable: $('sl-paytable'),
    };
    const { bet, grid, fs } = loadSaved();
    this.#store = new Store('slots', {
      phase: PHASE.IDLE,
      busy: false,
      bet,
      grid,
      fs,
      win: 0,
      message: fs ? `Tienes ${fs.remaining} giros gratis pendientes` : '3 diamantes activan los Giros Gratis',
    });
    this.#buildReels(grid);
    this.#buildPaytable();
    this.#bind();
    this.#store.subscribe((state) => {
      storage.write(SAVE_KEY, { bet: state.bet, grid: state.grid, fs: state.fs });
      this.#render(state);
    });
    wallet.addEventListener('change', () => this.#renderControls(this.state));
    this.#render(this.state);
  }

  get state() {
    return this.#store.state;
  }

  #set(action, patch) {
    return this.#store.commit(action, patch);
  }

  // ---------- Construcción ----------

  #cell(id) {
    const cell = el('div', 'slot-cell');
    cell.dataset.symbol = id;
    cell.append(symbolSvg(id, BY_ID[id].name));
    return cell;
  }

  #buildReels(grid) {
    for (let c = 0; c < COLS; c++) {
      const reel = el('div', 'reel');
      const strip = el('div', 'reel-strip');
      for (let r = 0; r < ROWS; r++) strip.append(this.#cell(grid[r][c]));
      reel.append(strip);
      this.#dom.grid.append(reel);
      this.#reels.push({ reel, strip });
    }
  }

  #buildPaytable() {
    const par = parSheet();
    this.#dom.rtp.textContent = `${(par.total * 100).toFixed(2)}%`;
    const table = el('table', 'pay-table');
    const head = el('thead');
    const headRow = el('tr');
    for (const label of ['Símbolo', 'Prob.', '3 en línea', '4 en línea (×15)']) headRow.append(el('th', '', label));
    head.append(headRow);
    const body = el('tbody');
    for (const symbol of SYMBOLS) {
      const row = el('tr');
      const name = el('td', 'pay-symbol');
      name.append(symbolSvg(symbol.id, symbol.name), el('span', '', symbol.name));
      row.append(name, el('td', '', `${symbol.weight}%`));
      if (symbol.scatter) {
        const cell = el('td', 'pay-scatter', 'Scatter: 3 → ×2 + 8 giros · 4 → ×10 + 10 giros · 5+ → ×50 + 12 giros');
        cell.colSpan = 2;
        row.append(cell);
      } else {
        row.append(el('td', '', `×${symbol.pay3}`), el('td', 'pay-super', `×${symbol.pay3 * SUPER_BONUS}`));
      }
      body.append(row);
    }
    table.append(head, body);

    const rules = el('ul', 'pay-rules');
    const rule = (text) => rules.append(el('li', '', text));
    rule('Los premios de línea se expresan en apuestas de línea (apuesta total ÷ 10).');
    rule('10 líneas: 4 filas (→), 4 columnas (↓) y 2 diagonales. Se cuenta desde la primera celda de cada línea.');
    rule('Súper Bono ×15: 4 símbolos iguales en fila, columna o diagonal multiplican por 15 el premio de 3.');
    rule('Scatter premia en múltiplos de la apuesta total en cualquier posición.');
    rule('Giros Gratis con la apuesta que los activó y multiplicador progresivo ×1, ×2, ×3, ×4, ×5 (se mantiene en ×5).');
    rule(`Par sheet exacto: líneas ${(par.lines * 100).toFixed(2)}% + scatter ${(par.scatter * 100).toFixed(2)}% + giros gratis ${(par.freeSpins * 100).toFixed(2)}% = RTP ${(par.total * 100).toFixed(2)}%. Giros gratis 1 de cada ${Math.round(1 / par.triggerProbability)} tiradas.`);
    this.#dom.paytable.replaceChildren(table, rules);
  }

  #bind() {
    const d = this.#dom;
    d.spin.addEventListener('click', () => this.spin());
    d.betDown.addEventListener('click', () => this.#stepBet(-1));
    d.betUp.addEventListener('click', () => this.#stepBet(1));
    this.root.addEventListener('keydown', (event) => {
      if (event.code === 'Space' && event.target === this.root) {
        event.preventDefault();
        this.spin();
      }
    });
  }

  #idle() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.PAYOUT);
  }

  #stepBet(direction) {
    const s = this.state;
    if (!this.#idle() || s.fs) return;
    const index = BET_STEPS.indexOf(s.bet) + direction;
    if (index < 0 || index >= BET_STEPS.length) return;
    audio.click();
    this.#set('BET', { bet: BET_STEPS[index] });
  }

  // ---------- Giro ----------

  async spin() {
    clearTimeout(this.#autoTimer);
    if (!this.#idle()) return;
    const s = this.state;
    const free = Boolean(s.fs && s.fs.remaining > 0);
    const bet = free ? s.fs.bet : s.bet;
    if (!free && !wallet.hold('slots', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    this.#set('HOLD', { phase: PHASE.BETTING, busy: true });

    const grid = spinGrid();
    const multiplier = free ? FS_MULTIPLIERS[Math.min(s.fs.played, FS_MULTIPLIERS.length - 1)] : 1;
    const outcome = spinWin(grid, bet, { free, multiplier });
    wallet.settle('slots', free ? 0 : bet, outcome.total);

    let fs = s.fs;
    if (free) {
      fs = { ...fs, remaining: fs.remaining - 1, played: fs.played + 1, total: fs.total + outcome.total };
    } else if (outcome.freeSpins) {
      fs = { remaining: outcome.freeSpins, played: 0, total: 0, awarded: outcome.freeSpins, bet };
    }
    this.#set('SPIN', {
      phase: PHASE.DEALING,
      grid,
      fs,
      win: 0,
      message: free ? `Giro gratis ${fs.played} de ${fs.awarded} · multiplicador ×${multiplier}` : '¡Suerte!',
    });
    this.#clearLines();
    await this.#animateReels(grid);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING });
    this.#showLines(outcome);
    await wait(outcome.total > 0 ? 450 : 150);

    wallet.reveal('slots');
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, win: outcome.total, message: this.#describe(outcome, free, multiplier) });
    this.#celebrate(outcome, bet);

    if (free && fs.remaining === 0) {
      await wait(900);
      hud.toast(`Giros Gratis terminados: ganaste ${formatChips(fs.total)} fichas`, fs.total > 0 ? 'success' : 'info', 4200);
      this.#set('FS_END', { fs: null, message: `Bonus total: ${formatChips(fs.total)} fichas` });
    } else if (!free && outcome.freeSpins) {
      audio.win(2);
      hud.toast(`¡${outcome.freeSpins} GIROS GRATIS con multiplicador progresivo!`, 'success', 4200);
    }
    this.#set('READY', { busy: false });
    this.#scheduleFreeSpin();
  }

  #scheduleFreeSpin() {
    clearTimeout(this.#autoTimer);
    const fs = this.state.fs;
    if (!fs || fs.remaining <= 0 || !this.#visible) return;
    this.#autoTimer = setTimeout(() => this.spin(), 1400);
  }

  #describe(outcome, free, multiplier) {
    if (outcome.total <= 0) return free ? 'Sin premio en este giro gratis' : 'Sin premio. ¡Otra vez!';
    const parts = [];
    for (const line of outcome.lines) {
      parts.push(`${LINE_NAMES[line.index]}: ${line.count}× ${BY_ID[line.symbol].name}${line.count === 4 ? ' (SÚPER BONO ×15)' : ''}`);
    }
    if (outcome.scatterWin) parts.push(`${outcome.scatterCount} Diamantes`);
    const mult = free && multiplier > 1 ? ` con ×${multiplier}` : '';
    return `Ganas ${formatChips(outcome.total)}${mult} · ${parts.join(' · ')}`;
  }

  #celebrate(outcome, bet) {
    const rect = this.#dom.grid.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const ratio = outcome.total / bet;
    if (outcome.superBonus && outcome.lines.some((line) => line.count === 4 && line.symbol === 'C')) {
      this.#banner('JACKPOT REAL · 4 CORONAS', 'is-jackpot');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (outcome.superBonus || ratio >= 50) {
      this.#banner(outcome.superBonus ? 'SÚPER BONO ×15' : 'MEGA PREMIO', 'is-super');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (ratio >= 10 || outcome.freeSpins) {
      if (outcome.freeSpins) this.#banner(`${outcome.freeSpins} GIROS GRATIS`, 'is-free');
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (outcome.total > 0) {
      audio.win(1);
      hud.celebrate(1, origin);
    }
  }

  #banner(text, variant) {
    const node = el('div', `slot-banner-text ${variant}`, text);
    this.#dom.banner.replaceChildren(node);
    setTimeout(() => {
      if (node.isConnected) node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 500);
    }, 2600);
  }

  async #animateReels(grid) {
    const fast = this.#reduced.matches;
    const base = fast ? 350 : 900;
    const stagger = fast ? 120 : 330;
    audio.reelSpin((base + stagger * (COLS - 1)) / 1000);
    const runs = this.#reels.map(({ reel, strip }, c) => {
      const column = grid.map((row) => row[c]);
      const current = [...strip.children].map((cell) => cell.dataset.symbol);
      const filler = Array.from({ length: fast ? 4 : 12 + c * 4 }, randomSymbol);
      const sequence = [randomSymbol(), ...column, ...filler, ...current];
      strip.replaceChildren(...sequence.map((id) => this.#cell(id)));
      const h = reel.clientHeight / ROWS;
      const from = -(sequence.length - ROWS) * h;
      const rest = -h;
      reel.classList.add('is-spinning');
      const animation = strip.animate(
        [
          { transform: `translateY(${from}px)`, easing: 'cubic-bezier(.3,.05,.2,1)' },
          { transform: `translateY(${rest + h * 0.16}px)`, offset: 0.9, easing: 'ease-in-out' },
          { transform: `translateY(${rest}px)` },
        ],
        { duration: base + stagger * c, fill: 'forwards' },
      );
      setTimeout(() => reel.classList.remove('is-spinning'), (base + stagger * c) * 0.75);
      return animation.finished.catch(() => {}).then(() => {
        strip.replaceChildren(...column.map((id) => this.#cell(id)));
        animation.cancel();
        audio.reelStop();
      });
    });
    await Promise.all(runs);
  }

  #clearLines() {
    this.#dom.lines.replaceChildren();
    for (const { strip } of this.#reels) for (const cell of strip.children) cell.classList.remove('is-win', 'is-scatter');
  }

  #showLines(outcome) {
    const cellAt = (r, c) => this.#reels[c].strip.children[r];
    for (const line of outcome.lines) {
      const points = LINES[line.index].map(([r, c]) => `${c * 100 + 50},${r * 100 + 50}`).join(' ');
      this.#dom.lines.append(svg('polyline', { points, class: `win-line${line.count === 4 ? ' is-super' : ''}` }));
      for (const [r, c] of line.cells) cellAt(r, c)?.classList.add('is-win');
    }
    if (outcome.scatterCount >= 3 && outcome.scatterWin > 0) {
      for (const [r, c] of outcome.scatterCells) cellAt(r, c)?.classList.add('is-scatter');
    }
  }

  // ---------- Render ----------

  #render(s) {
    const d = this.#dom;
    d.message.textContent = s.message;
    const bet = s.fs ? s.fs.bet : s.bet;
    d.bet.textContent = formatChips(bet);
    d.lineBet.textContent = formatChips(bet / LINE_COUNT);
    d.win.textContent = formatChips(s.win);
    d.win.classList.toggle('is-lit', s.win > 0);
    this.root.classList.toggle('is-free-spins', Boolean(s.fs));
    this.#renderControls(s);
  }

  #renderControls(s) {
    const d = this.#dom;
    const idle = this.#idle();
    const free = Boolean(s.fs && s.fs.remaining > 0);
    d.spin.disabled = !(idle && (free || wallet.canAfford(s.bet)));
    d.spin.textContent = free ? `GIRO GRATIS · ${s.fs.remaining}` : 'GIRAR';
    d.betDown.disabled = !idle || free || s.bet === BET_STEPS[0];
    d.betUp.disabled = !idle || free || s.bet === BET_STEPS[BET_STEPS.length - 1];
  }

  onShow() {
    this.#visible = true;
    this.#scheduleFreeSpin();
  }

  onHide() {
    this.#visible = false;
    clearTimeout(this.#autoTimer);
  }
}
