// Slots Matrix 4x4 — interfaz: rodillos, avalancha animada (explosión y caída de símbolos),
// escalera de multiplicadores ×1 ×2 ×3 ×5, giros gratis con multiplicador dorado, Bonus Buy
// y Auto-Spin con límite de pérdida obligatorio y límite por premio.
// La matemática vive en slots-engine.js; aquí solo se sortea, se liquida y se anima.

import { randomInt } from '../engine/rng.js';
import { Store, PHASE, wait } from '../engine/store.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { hud, formatChips } from '../ui/hud.js';
import { symbolSvg, svg, el } from '../ui/svg.js';
import { campaign } from '../story/campaign.js';
import {
  ROWS, COLS, LINE_COUNT, SUPER_BONUS, CASCADE_MULTIPLIERS, BET_STEPS, FREE_SPINS, RETRIGGER_SPINS,
  BONUS_BUY_COST, MAX_WIN, SYMBOLS, SCATTER, GOLDEN, SLOT_MATH, SYMBOL_BY_ID, LINES, LINE_NAMES,
  createDraw, randomGrid, playSpin,
} from './slots-engine.js';

export * from './slots-engine.js';

const SAVE_KEY = 'crd.slots.v2';
const LEGACY_KEY = 'crd.slots.v1';
const AUTO_COUNTS = [10, 25, 50, 100];
const LOSS_LIMITS = [10, 20, 50, 100];
const WIN_LIMITS = [0, 10, 50, 100, 500];
const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;

function validGrid(grid) {
  return Array.isArray(grid) && grid.length === ROWS &&
    grid.every((row) => Array.isArray(row) && row.length === COLS && row.every((id) => id in SYMBOL_BY_ID));
}

function validFs(fs) {
  return fs && Number.isInteger(fs.remaining) && fs.remaining > 0 && BET_STEPS.includes(fs.bet);
}

function loadSaved() {
  const saved = storage.read(SAVE_KEY, null) ?? {};
  const legacy = storage.read(LEGACY_KEY, null);
  storage.remove(LEGACY_KEY);
  const bet = BET_STEPS.includes(saved.bet) ? saved.bet : 1;
  let fs = null;
  if (validFs(saved.fs)) {
    fs = {
      remaining: saved.fs.remaining,
      played: Math.max(0, saved.fs.played | 0),
      awarded: Math.max(saved.fs.remaining, saved.fs.awarded | 0),
      bet: saved.fs.bet,
      total: Number(saved.fs.total) || 0,
      source: saved.fs.source === 'buy' ? 'buy' : 'scatter',
      cost: Number(saved.fs.cost) > 0 ? Number(saved.fs.cost) : 0,
    };
  } else if (validFs(legacy?.fs)) {
    // Giros gratis pendientes de la versión anterior: se conservan con el nuevo sistema.
    fs = { remaining: legacy.fs.remaining, played: 0, awarded: legacy.fs.remaining, bet: legacy.fs.bet, total: 0, source: 'scatter', cost: 0 };
  }
  const grid = validGrid(saved.grid) ? saved.grid : validGrid(legacy?.grid) ? legacy.grid : randomGrid(createDraw('base'));
  return { bet, grid, fs };
}

export class SlotsGame {
  #store;
  #dom;
  #reels = [];
  #visible = false;
  #timer = 0;
  #auto = null;
  #reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };

  constructor(root) {
    this.root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      grid: $('sl-grid'),
      lines: $('sl-lines'),
      fx: $('sl-fx'),
      ladder: $('sl-ladder'),
      fsPanel: $('sl-fs'),
      fsLeft: $('sl-fs-left'),
      fsTotal: $('sl-fs-total'),
      banner: $('sl-banner'),
      bet: $('sl-bet'),
      lineBet: $('sl-linebet'),
      betDown: $('sl-bet-down'),
      betUp: $('sl-bet-up'),
      spin: $('sl-spin'),
      win: $('sl-win'),
      rtp: $('sl-rtp'),
      message: $('sl-message'),
      paytable: $('sl-paytable'),
      auto: $('sl-auto'),
      buy: $('sl-buy'),
      buyPrice: $('sl-buy-price'),
      autoDialog: $('sl-auto-dialog'),
      autoLoss: $('sl-auto-loss'),
      autoWin: $('sl-auto-win'),
      autoFeature: $('sl-auto-feature'),
      autoStart: $('sl-auto-start'),
      autoCancel: $('sl-auto-cancel'),
      buyDialog: $('sl-buy-dialog'),
      buyText: $('sl-buy-text'),
      buyConfirm: $('sl-buy-confirm'),
      buyCancel: $('sl-buy-cancel'),
    };
    const { bet, grid, fs } = loadSaved();
    this.#store = new Store('slots', {
      phase: PHASE.IDLE,
      busy: false,
      bet,
      grid,
      fs,
      win: 0,
      message: fs ? `Tienes ${fs.remaining} giros gratis pendientes` : '3 diamantes o la compra de bono activan los Giros Gratis',
    });
    this.#buildReels(grid);
    this.#buildPaytable();
    this.#bind();
    this.#store.subscribe((state) => {
      storage.write(SAVE_KEY, { bet: state.bet, grid: state.grid, fs: state.fs });
      this.#render(state);
    });
    wallet.addEventListener('change', () => this.#renderControls(this.state));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopAuto('Auto-spin detenido: la pestaña pasó a segundo plano');
    });
    campaign.register('slots', {
      hasPendingPlay: () => this.state.busy || Boolean(this.state.fs && this.state.fs.remaining > 0),
      onZone: () => this.#fitBet(),
    });
    this.#render(this.state);
    this.#fitBet();
  }

  // Apuestas y funciones que permite la zona actual del casino.
  #limits() {
    return campaign.limits('slots');
  }

  #fitBet() {
    const steps = this.#limits().bets;
    const s = this.state;
    if (!steps.includes(s.bet) && this.#idle() && !s.fs) this.#set('ZONE_BET', { bet: steps[0] });
    else this.#render(this.state);
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
    cell.append(symbolSvg(id, SYMBOL_BY_ID[id].name));
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
    this.#dom.rtp.textContent = pct(SLOT_MATH.rtp);
    const table = el('table', 'pay-table');
    const headRow = el('tr');
    for (const label of ['Símbolo', 'Prob.', '3 en línea', `4 en línea (×${SUPER_BONUS})`]) headRow.append(el('th', '', label));
    const head = el('thead');
    head.append(headRow);
    const body = el('tbody');
    for (const symbol of SYMBOLS) {
      const row = el('tr');
      const name = el('td', 'pay-symbol');
      name.append(symbolSvg(symbol.id, symbol.name), el('span', '', symbol.name));
      row.append(name, el('td', '', `${(symbol.base / 10).toFixed(1).replace('.', ',')} %`));
      if (symbol.scatter) {
        const cell = el('td', 'pay-scatter', Object.entries(SCATTER).map(([n, s]) => `${n}${n === '5' ? '+' : ''} → ×${s.pays} + ${s.spins} giros`).join(' · '));
        cell.colSpan = 2;
        row.append(cell);
      } else {
        row.append(el('td', '', `×${symbol.pay3}`), el('td', 'pay-super', `×${symbol.pay3 * SUPER_BONUS}`));
      }
      body.append(row);
    }
    table.append(head, body);

    const golden = GOLDEN.map(([value, weight]) => `×${value} (${(weight / 10).toFixed(1).replace('.', ',')} %)`).join(' · ');
    const rules = el('ul', 'pay-rules');
    const rule = (text) => rules.append(el('li', '', text));
    rule(`Premios de línea en apuestas de línea (apuesta ÷ ${LINE_COUNT}). 10 líneas: 4 filas, 4 columnas y 2 diagonales, contadas desde su primera celda.`);
    rule(`Avalancha: los símbolos ganadores explotan y caen nuevos en el mismo giro. Combos sucesivos: ${CASCADE_MULTIPLIERS.map((m) => `×${m}`).join(', ')} (se mantiene en ×5).`);
    rule(`Súper Bono ×${SUPER_BONUS}: 4 iguales en fila, columna o diagonal.`);
    rule(`Giros Gratis: ${FREE_SPINS} (3 diamantes), 12 (4) o 15 (5+) con rodillos premium; 3+ diamantes durante el bono suman +${RETRIGGER_SPINS} giros.`);
    rule(`Multiplicador dorado en cada giro gratis: ${golden}.`);
    rule(`Bonus Buy: ${FREE_SPINS} giros gratis por ${BONUS_BUY_COST} × apuesta · RTP de la compra ${pct(SLOT_MATH.bonusBuyRtp)}.`);
    rule(`Premio máximo: ${formatChips(MAX_WIN)} × apuesta por giro o por ronda de bono.`);
    rule(`RTP ${pct(SLOT_MATH.rtp)} (líneas ${pct(SLOT_MATH.lines)} + scatter ${pct(SLOT_MATH.scatter)} + giros gratis ${pct(SLOT_MATH.freeSpins)}), medido con ${formatChips(SLOT_MATH.spins / 1e6)} millones de tiradas del motor real. Giros gratis 1 de cada ${SLOT_MATH.triggerEvery} tiradas.`);
    this.#dom.paytable.replaceChildren(table, rules);
  }

  #bind() {
    const d = this.#dom;
    d.spin.addEventListener('click', () => {
      if (this.#auto) this.stopAuto('Auto-spin detenido');
      else this.spin();
    });
    d.betDown.addEventListener('click', () => this.#stepBet(-1));
    d.betUp.addEventListener('click', () => this.#stepBet(1));
    d.auto.addEventListener('click', () => {
      if (this.#auto) this.stopAuto('Auto-spin detenido');
      else this.#openAuto();
    });
    d.buy.addEventListener('click', () => this.#openBuy());
    d.autoStart.addEventListener('click', () => this.#startAutoFromDialog());
    d.autoCancel.addEventListener('click', () => d.autoDialog.close());
    d.buyConfirm.addEventListener('click', () => {
      d.buyDialog.close();
      this.buyBonus();
    });
    d.buyCancel.addEventListener('click', () => d.buyDialog.close());
    for (const dialog of [d.autoDialog, d.buyDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
  }

  #idle() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.PAYOUT);
  }

  #stepBet(direction) {
    const s = this.state;
    if (!this.#idle() || s.fs || this.#auto) return;
    const steps = this.#limits().bets;
    const index = steps.indexOf(s.bet) + direction;
    if (index < 0 || index >= steps.length) return;
    audio.click();
    this.#set('BET', { bet: steps[index] });
  }

  // ---------- Giro ----------

  async spin() {
    clearTimeout(this.#timer);
    if (!this.#idle()) return;
    const s = this.state;
    const free = Boolean(s.fs && s.fs.remaining > 0);
    const bet = free ? s.fs.bet : s.bet;
    if (!free && !campaign.playable) return;
    if (!free && this.#auto && !this.#autoMayContinue(bet)) return;
    if (!free && !wallet.hold('slots', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      this.stopAuto(null);
      return;
    }
    this.#set('HOLD', { phase: PHASE.BETTING, busy: true });
    if (!free) campaign.beginRound({ game: 'slots', stake: bet });

    const outcome = playSpin({ bet, mode: free ? 'free' : 'base' });
    let total = outcome.total;
    let fs = s.fs;
    let maxed = false;
    if (free) {
      const room = MAX_WIN * bet - fs.total;
      if (total >= room) {
        total = Math.max(0, room);
        maxed = true;
      }
      fs = {
        ...fs,
        remaining: maxed ? 0 : fs.remaining - 1 + outcome.retrigger,
        awarded: fs.awarded + outcome.retrigger,
        played: fs.played + 1,
        total: fs.total + total,
      };
    } else if (outcome.freeSpins) {
      fs = { remaining: outcome.freeSpins, played: 0, awarded: outcome.freeSpins, bet, total: 0, source: 'scatter', cost: 0 };
    }
    wallet.settle('slots', free ? 0 : bet, total);

    this.#set('SPIN', {
      phase: PHASE.DEALING,
      grid: outcome.final,
      fs,
      win: 0,
      message: free ? `Giro gratis ${fs.played} de ${fs.awarded}` : this.#auto ? `Auto-spin · quedan ${this.#auto.left}` : '¡Suerte!',
    });
    this.#clearBoard();
    this.#meter(0);
    await this.#spinReels(outcome.initial);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING });
    if (free) this.#showGolden(outcome.golden);
    await this.#playTumbles(outcome, bet);

    if (outcome.scatters.length >= 3) {
      this.#highlightScatters(outcome.scatters);
      if (outcome.scatterWin > 0) this.#meter(outcome.lineWin + outcome.scatterWin);
      await wait(500);
    }
    if (free) await this.#applyGolden(outcome, total);
    else this.#meter(total);

    wallet.reveal('slots');
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, win: total, message: this.#describe(outcome, total, free) });
    this.#celebrate(outcome, total, bet);
    if (!free) campaign.report({ game: 'slots', stake: bet, returned: total, tags: this.#tags(outcome) });

    if (free && outcome.retrigger && !maxed) {
      this.#banner(`+${outcome.retrigger} GIROS`, 'is-free');
    }
    if (free && fs.remaining === 0) {
      await wait(900);
      const note = maxed ? ' (premio máximo alcanzado)' : '';
      hud.toast(`Giros Gratis terminados: ${formatChips(fs.total)} créditos${note}`, fs.total > 0 ? 'success' : 'info', 4600);
      this.#set('FS_END', { fs: null, message: `Bono total: ${formatChips(fs.total)} créditos${note}` });
      campaign.report({ game: 'slots', stake: fs.cost ?? 0, returned: fs.total, tags: fs.source === 'buy' ? ['fs-round', 'bonus-buy'] : ['fs-round'] });
    } else if (!free && outcome.freeSpins) {
      audio.win(2);
      hud.toast(`¡${outcome.freeSpins} GIROS GRATIS con multiplicador dorado!`, 'success', 4200);
    }
    this.#set('READY', { busy: false });
    this.#afterSpin(outcome, total, free);
  }

  #tags(outcome) {
    const tags = [];
    if (outcome.steps.length >= 2) tags.push('cascade2');
    if (outcome.steps.length >= 3) tags.push('cascade3');
    if (outcome.steps.some((step) => step.lines.some((line) => line.count === 4))) tags.push('super');
    if (outcome.freeSpins) tags.push('freespins');
    return tags;
  }

  #describe(outcome, total, free) {
    if (total <= 0) return free ? 'Sin premio en este giro gratis' : 'Sin premio. ¡Otra vez!';
    const parts = [];
    const cascades = outcome.steps.length;
    if (cascades > 1) parts.push(`${cascades} avalanchas`);
    const best = outcome.steps.flatMap((step) => step.lines).sort((a, b) => b.units - a.units)[0];
    if (best) parts.push(`${LINE_NAMES[best.index]}: ${best.count}× ${SYMBOL_BY_ID[best.symbol].name}${best.count === 4 ? ' (SÚPER BONO)' : ''}`);
    if (outcome.scatterWin) parts.push(`${outcome.scatters.length} diamantes`);
    if (free && outcome.golden > 1) parts.push(`multiplicador dorado ×${outcome.golden}`);
    return `Ganas ${formatChips(total)} · ${parts.join(' · ')}`;
  }

  #celebrate(outcome, total, bet) {
    const rect = this.#dom.grid.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const ratio = total / bet;
    const superBonus = outcome.steps.some((step) => step.lines.some((line) => line.count === 4));
    const crowns = outcome.steps.some((step) => step.lines.some((line) => line.count === 4 && line.symbol === 'C'));
    if (crowns) {
      this.#banner('JACKPOT REAL · 4 CORONAS', 'is-jackpot');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (ratio >= 50) {
      this.#banner(superBonus ? 'SÚPER BONO ×15' : 'MEGA PREMIO', 'is-super');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (superBonus) {
      this.#banner('SÚPER BONO ×15', 'is-super');
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (ratio >= 10 || outcome.freeSpins) {
      if (outcome.freeSpins) this.#banner(`${outcome.freeSpins} GIROS GRATIS`, 'is-free');
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (total > 0) {
      audio.win(1);
      hud.celebrate(1, origin);
    }
  }

  // ---------- Encadenado: giros gratis y auto-spin ----------

  #afterSpin(outcome, total, free) {
    const auto = this.#auto;
    if (auto && !free) {
      auto.left -= 1;
      if (auto.winLimit > 0 && total >= auto.winLimit) this.stopAuto(`Auto-spin detenido: premio de ${formatChips(total)} supera tu límite`);
      else if (outcome.freeSpins && auto.stopOnFeature) this.stopAuto('Auto-spin detenido: giros gratis activados');
      else if (auto.left <= 0) this.stopAuto('Auto-spin completado');
    }
    this.#scheduleNext();
  }

  #scheduleNext() {
    clearTimeout(this.#timer);
    if (!this.#visible) return;
    const fs = this.state.fs;
    if (fs && fs.remaining > 0) {
      this.#timer = setTimeout(() => this.spin(), 1300);
    } else if (this.#auto) {
      this.#timer = setTimeout(() => this.spin(), 650);
    }
    this.#renderControls(this.state);
  }

  #autoMayContinue(bet) {
    const auto = this.#auto;
    if (!campaign.playable) {
      this.stopAuto(null);
      return false;
    }
    const lost = auto.startBalance - wallet.balance;
    if (lost + bet > auto.lossLimit) {
      this.stopAuto(`Auto-spin detenido: límite de pérdida (${formatChips(auto.lossLimit)}) alcanzado`);
      return false;
    }
    if (!wallet.canAfford(bet)) {
      this.stopAuto('Auto-spin detenido: saldo insuficiente');
      return false;
    }
    return true;
  }

  #openAuto() {
    const s = this.state;
    if (!this.#idle() || s.fs) return;
    const bet = s.bet;
    const option = (value, text) => {
      const node = el('option', '', text);
      node.value = String(value);
      return node;
    };
    const lossValue = this.#dom.autoLoss.value || '20';
    const winValue = this.#dom.autoWin.value || '0';
    this.#dom.autoLoss.replaceChildren(...LOSS_LIMITS.map((m) => option(m, `${m}× apuesta · ${formatChips(m * bet)} créditos`)));
    this.#dom.autoWin.replaceChildren(...WIN_LIMITS.map((m) => option(m, m === 0 ? 'Sin límite' : `${m}× apuesta · ${formatChips(m * bet)} créditos`)));
    this.#dom.autoLoss.value = LOSS_LIMITS.includes(Number(lossValue)) ? lossValue : '20';
    this.#dom.autoWin.value = WIN_LIMITS.includes(Number(winValue)) ? winValue : '0';
    audio.click();
    this.#dom.autoDialog.showModal();
  }

  #startAutoFromDialog() {
    const d = this.#dom;
    const checked = d.autoDialog.querySelector('input[name="sl-auto-count"]:checked');
    const count = AUTO_COUNTS.includes(Number(checked?.value)) ? Number(checked.value) : 25;
    const bet = this.state.bet;
    d.autoDialog.close();
    this.#auto = {
      left: count,
      lossLimit: Number(d.autoLoss.value) * bet,
      winLimit: Number(d.autoWin.value) * bet,
      stopOnFeature: d.autoFeature.checked,
      startBalance: wallet.balance,
    };
    hud.toast(`Auto-spin: ${count} tiradas · límite de pérdida ${formatChips(this.#auto.lossLimit)}`, 'info');
    this.#renderControls(this.state);
    this.spin();
  }

  stopAuto(reason) {
    if (!this.#auto) return;
    this.#auto = null;
    if (!(this.state.fs?.remaining > 0)) clearTimeout(this.#timer);
    if (reason) hud.toast(reason, 'info');
    this.#renderControls(this.state);
  }

  // ---------- Bonus Buy ----------

  #openBuy() {
    const s = this.state;
    if (!this.#idle() || s.fs || this.#auto) return;
    if (!this.#limits().bonusBuy) {
      hud.toast('La compra de bono se abre en el Salón de Neón', 'warn');
      return;
    }
    const price = BONUS_BUY_COST * s.bet;
    this.#dom.buyText.textContent = `${FREE_SPINS} giros gratis con rodillos premium y un multiplicador dorado (×2 a ×100) en cada giro. Precio: ${BONUS_BUY_COST} × ${formatChips(s.bet)} = ${formatChips(price)} créditos. RTP de la compra: ${pct(SLOT_MATH.bonusBuyRtp)}.`;
    this.#dom.buyConfirm.disabled = !wallet.canAfford(price);
    audio.click();
    this.#dom.buyDialog.showModal();
  }

  buyBonus() {
    const s = this.state;
    if (!this.#idle() || s.fs || this.#auto || !campaign.playable || !this.#limits().bonusBuy) return;
    const price = BONUS_BUY_COST * s.bet;
    if (!wallet.hold('slots', price)) {
      hud.toast('Saldo insuficiente para comprar el bono', 'warn');
      return;
    }
    campaign.beginRound({ game: 'slots', stake: price });
    wallet.settle('slots', price, 0);
    wallet.reveal('slots');
    this.#set('FS_BUY', {
      fs: { remaining: FREE_SPINS, played: 0, awarded: FREE_SPINS, bet: s.bet, total: 0, source: 'buy', cost: price },
      win: 0,
      message: `Bono comprado: ${FREE_SPINS} giros gratis con multiplicador dorado`,
    });
    this.#banner(`${FREE_SPINS} GIROS GRATIS`, 'is-free');
    audio.win(2);
    const rect = this.#dom.grid.getBoundingClientRect();
    hud.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    this.#scheduleNext();
  }

  // ---------- Animaciones ----------

  #speed() {
    return this.#reduced.matches ? 0.35 : 1;
  }

  async #spinReels(grid) {
    const k = this.#speed();
    const base = 850 * k;
    const stagger = 300 * k;
    audio.reelSpin((base + stagger * (COLS - 1)) / 1000);
    const runs = this.#reels.map(({ reel, strip }, c) => {
      const column = grid.map((row) => row[c]);
      const current = [...strip.children].map((cell) => cell.dataset.symbol);
      const draw = createDraw('base');
      const filler = Array.from({ length: this.#reduced.matches ? 4 : 10 + c * 4 }, draw);
      const sequence = [draw(), ...column, ...filler, ...current];
      strip.replaceChildren(...sequence.map((id) => this.#cell(id)));
      const h = reel.clientHeight / ROWS;
      const from = -(sequence.length - ROWS) * h;
      const rest = -h;
      reel.classList.add('is-spinning');
      const duration = base + stagger * c;
      const animation = strip.animate(
        [
          { transform: `translateY(${from}px)`, easing: 'cubic-bezier(.3,.05,.2,1)' },
          { transform: `translateY(${rest + h * 0.16}px)`, offset: 0.9, easing: 'ease-in-out' },
          { transform: `translateY(${rest}px)` },
        ],
        { duration, fill: 'forwards' },
      );
      setTimeout(() => reel.classList.remove('is-spinning'), duration * 0.75);
      return animation.finished.catch(() => {}).then(() => {
        strip.replaceChildren(...column.map((id) => this.#cell(id)));
        animation.cancel();
        audio.reelStop();
      });
    });
    await Promise.all(runs);
  }

  async #playTumbles(outcome, bet) {
    const k = this.#speed();
    let running = 0;
    for (let i = 0; i < outcome.steps.length; i++) {
      const step = outcome.steps[i];
      const stepWin = (step.units * step.multiplier * bet) / LINE_COUNT;
      running += stepWin;
      this.#setLadder(i);
      audio.cascade(i);
      this.#showLines(step);
      this.#popup(`+${formatChips(stepWin)}${step.multiplier > 1 ? ` · ×${step.multiplier}` : ''}`);
      this.#meter(running);
      await wait(700 * k);
      this.#explode(step.cells);
      await wait(320 * k);
      this.#clearLines();
      await this.#collapseView(step.next);
    }
  }

  #cellAt(r, c) {
    return this.#reels[c].strip.children[r];
  }

  #showLines(step) {
    this.#clearLines();
    for (const line of step.lines) {
      const points = LINES[line.index].map(([r, c]) => `${c * 100 + 50},${r * 100 + 50}`).join(' ');
      this.#dom.lines.append(svg('polyline', { points, class: `win-line${line.count === 4 ? ' is-super' : ''}` }));
    }
    for (const [r, c] of step.cells) this.#cellAt(r, c)?.classList.add('is-win');
  }

  #clearLines() {
    this.#dom.lines.replaceChildren();
  }

  #clearBoard() {
    this.#clearLines();
    this.#setLadder(-1);
    this.#dom.fx.replaceChildren();
  }

  #explode(cells) {
    const grid = this.#dom.grid.getBoundingClientRect();
    for (const [r, c] of cells) {
      const cell = this.#cellAt(r, c);
      if (!cell) continue;
      cell.classList.remove('is-win');
      cell.classList.add('is-exploding');
      const rect = cell.getBoundingClientRect();
      if (rect.width && grid.width) hud.sparks(rect.left + rect.width / 2, rect.top + rect.height / 2, 10);
    }
    audio.explode(Math.min(1.2, 0.6 + cells.length * 0.08));
  }

  // Gravedad visual: los supervivientes caen a su nueva fila y los nuevos entran desde arriba.
  async #collapseView(next) {
    const k = this.#speed();
    const animations = [];
    let fresh = 0;
    this.#reels.forEach(({ reel, strip }, c) => {
      const h = reel.clientHeight / ROWS;
      const { sources } = next.columns[c];
      const newcomers = next.columns[c].fresh;
      fresh += newcomers;
      const cells = next.grid.map((row) => this.#cell(row[c]));
      strip.replaceChildren(...cells);
      cells.forEach((cell, r) => {
        const source = sources[r];
        const offset = source === null ? -newcomers * h : (source - r) * h;
        if (offset === 0 || !h) return;
        const animation = cell.animate(
          [{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }],
          { duration: (source === null ? 420 : 340) * k, easing: 'cubic-bezier(.3,1.35,.5,1)', delay: source === null ? 60 * k : 0 },
        );
        animations.push(animation.finished.catch(() => {}));
      });
    });
    audio.drop(Math.min(6, fresh));
    await Promise.all(animations);
    await wait(90 * k);
  }

  #highlightScatters(cells) {
    for (const [r, c] of cells) this.#cellAt(r, c)?.classList.add('is-scatter');
    audio.shimmer();
  }

  #setLadder(step) {
    const items = [...this.#dom.ladder.children];
    const active = step < 0 ? -1 : Math.min(step, items.length - 1);
    items.forEach((item, i) => {
      item.classList.toggle('is-active', i === active);
      item.classList.toggle('is-passed', active >= 0 && i < active);
    });
  }

  #meter(value) {
    this.#dom.win.textContent = formatChips(value);
    this.#dom.win.classList.toggle('is-lit', value > 0);
  }

  #popup(text) {
    const pop = el('div', 'win-pop', text);
    this.#dom.fx.append(pop);
    setTimeout(() => pop.remove(), 1200);
  }

  #showGolden(value) {
    const orb = el('div', 'golden-orb', `×${value}`);
    orb.dataset.value = String(value);
    const row = randomInt(ROWS);
    const col = randomInt(COLS);
    orb.style.left = `${((col + 0.5) / COLS) * 100}%`;
    orb.style.top = `${((row + 0.5) / ROWS) * 100}%`;
    if (value >= 25) orb.classList.add('is-epic');
    this.#dom.fx.append(orb);
    audio.shimmer();
  }

  async #applyGolden(outcome, total) {
    const orb = this.#dom.fx.querySelector('.golden-orb');
    if (!orb) {
      this.#meter(total);
      return;
    }
    if (outcome.lineWin <= 0) {
      orb.classList.add('is-fading');
      await wait(400);
      orb.remove();
      this.#meter(total);
      return;
    }
    const from = orb.getBoundingClientRect();
    const to = this.#dom.win.getBoundingClientRect();
    if (from.width && to.width) {
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const flight = orb.animate(
        [{ transform: 'translate(-50%, -50%) scale(1)' }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.6)`, opacity: 0.2 }],
        { duration: 650 * this.#speed(), easing: 'cubic-bezier(.5,0,.3,1)', fill: 'forwards' },
      );
      await flight.finished.catch(() => {});
    }
    orb.remove();
    audio.shimmer();
    this.#meter(total);
    this.#dom.win.classList.remove('is-boosted');
    void this.#dom.win.offsetWidth;
    this.#dom.win.classList.add('is-boosted');
    this.#popup(`×${outcome.golden} DORADO`);
  }

  #banner(text, variant) {
    const node = el('div', `slot-banner-text ${variant}`, text);
    this.#dom.banner.replaceChildren(node);
    setTimeout(() => {
      if (node.isConnected) node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 500);
    }, 2400);
  }

  // ---------- Render ----------

  #render(s) {
    const d = this.#dom;
    d.message.textContent = s.message;
    const bet = s.fs ? s.fs.bet : s.bet;
    d.bet.textContent = formatChips(bet);
    d.lineBet.textContent = formatChips(bet / LINE_COUNT);
    if (s.phase === PHASE.PAYOUT || s.phase === PHASE.IDLE) this.#meter(s.win);
    this.root.classList.toggle('is-free-spins', Boolean(s.fs));
    d.fsPanel.hidden = !s.fs;
    if (s.fs) {
      d.fsLeft.textContent = String(s.fs.remaining);
      d.fsTotal.textContent = formatChips(s.fs.total);
    }
    this.#renderControls(s);
  }

  #renderControls(s) {
    const d = this.#dom;
    const idle = this.#idle();
    const free = Boolean(s.fs && s.fs.remaining > 0);
    const auto = this.#auto;
    const price = BONUS_BUY_COST * s.bet;
    if (auto) {
      d.spin.disabled = false;
      d.spin.textContent = `STOP · ${auto.left}`;
      d.spin.setAttribute('aria-label', `Detener auto-spin, quedan ${auto.left} tiradas`);
    } else {
      d.spin.disabled = !(idle && (free || wallet.canAfford(s.bet)));
      d.spin.textContent = free ? `GIRO GRATIS · ${s.fs.remaining}` : 'GIRAR';
      d.spin.setAttribute('aria-label', free ? `Giro gratis, quedan ${s.fs.remaining}` : 'Girar');
    }
    d.spin.classList.toggle('is-auto', Boolean(auto));
    const { bets: steps, bonusBuy } = this.#limits();
    d.betDown.disabled = !idle || free || Boolean(auto) || s.bet <= steps[0];
    d.betUp.disabled = !idle || free || Boolean(auto) || s.bet >= steps[steps.length - 1];
    d.auto.textContent = auto ? 'Detener auto' : 'Auto-spin';
    d.auto.setAttribute('aria-pressed', String(Boolean(auto)));
    d.auto.disabled = !auto && (!idle || free || !wallet.canAfford(s.bet));
    d.buyPrice.textContent = bonusBuy ? formatChips(price) : 'Salón de Neón';
    d.buy.classList.toggle('is-locked', !bonusBuy);
    d.buy.disabled = !bonusBuy || !idle || Boolean(s.fs) || Boolean(auto) || !wallet.canAfford(price);
  }

  onShow() {
    this.#visible = true;
    this.#scheduleNext();
  }

  onHide() {
    this.#visible = false;
    clearTimeout(this.#timer);
    this.stopAuto('Auto-spin detenido al cambiar de mesa');
  }
}
