// Slots Matrix 4×4 — interfaz: rodillos, avalancha animada (explosión y caída de símbolos),
// escalera de multiplicadores ×1 ×2 ×3 ×5, comodines 🃏 pegajosos con candado y contador,
// estrellas ⭐ que dan 8 giros gratis, Bonus Buy y Auto-Spin con límite de pérdida obligatorio.
// La matemática vive en slots-engine.js; aquí solo se sortea, se liquida y se anima.
// En el Cripto-Casino cada giro usa el flujo provably fair y actúan el Trébol de Oro (más
// comodines y estrellas) y la Batería Cuántica (25 % de giro gratis tras una tirada sin premio).

import { Store, PHASE, wait } from '../engine/store.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { settings } from '../settings.js';
import { relics, BATTERY_CHANCE } from '../relics.js';
import { hud, formatChips } from '../ui/hud.js';
import { symbolSvg, svg, el } from '../ui/svg.js';
import { session } from '../session.js';
import { scopedKey } from '../mode.js';
import {
  ROWS, COLS, LINE_COUNT, SUPER_BONUS, WILD_FOUR, CASCADE_MULTIPLIERS, WILD_MULTIPLIER, MAX_WILD_MULTIPLIER,
  STICKY_SPINS, BET_STEPS, FREE_SPINS, BONUS_BUY_COST, MAX_WIN, SYMBOLS, SLOT_MATH, SYMBOL_BY_ID, LINES,
  LINE_NAMES, WILD, CLOVER_BOOST, createDraw, playSpin,
} from './slots-engine.js';

export * from './slots-engine.js';

const SAVE_KEY = scopedKey('crd.slots.v2');
const LEGACY_KEY = 'crd.slots.v1';
const AUTO_COUNTS = [10, 25, 50, 100];
const LOSS_LIMITS = [10, 20, 50, 100];
const WIN_LIMITS = [0, 10, 50, 100, 500];
const pct = (value) => `${(value * 100).toFixed(2).replace('.', ',')} %`;
const randomGrid = (draw) => Array.from({ length: ROWS }, () => Array.from({ length: COLS }, draw));

function validGrid(grid) {
  return Array.isArray(grid) && grid.length === ROWS &&
    grid.every((row) => Array.isArray(row) && row.length === COLS && row.every((id) => id in SYMBOL_BY_ID));
}

function validFs(fs) {
  return fs && Number.isInteger(fs.remaining) && fs.remaining > 0 && BET_STEPS.includes(fs.bet);
}

// Comodines bloqueados guardados: celdas válidas, sin repetir y con un comodín en la rejilla.
function validSticky(list, grid) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const longest = Math.max(...STICKY_SPINS);
  return list.filter((item) => {
    const ok = item && Number.isInteger(item.r) && Number.isInteger(item.c) && item.r >= 0 && item.r < ROWS && item.c >= 0 && item.c < COLS &&
      Number.isInteger(item.spins) && item.spins > 0 && item.spins <= longest && grid[item.r][item.c] === WILD && !seen.has(item.r * COLS + item.c);
    if (ok) seen.add(item.r * COLS + item.c);
    return ok;
  }).map(({ r, c, spins }) => ({ r, c, spins }));
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
    // Giros gratis pendientes de una versión anterior: se conservan con las reglas actuales.
    fs = { remaining: legacy.fs.remaining, played: 0, awarded: legacy.fs.remaining, bet: legacy.fs.bet, total: 0, source: 'scatter', cost: 0 };
  }
  const grid = validGrid(saved.grid) ? saved.grid : validGrid(legacy?.grid) ? legacy.grid : randomGrid(createDraw('base'));
  const sticky = validSticky(saved.sticky, grid);
  const respin = !fs && BET_STEPS.includes(saved.respin) ? saved.respin : 0;
  return { bet, grid, fs, sticky, respin };
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
      sticky: $('sl-sticky'),
      stickyNote: $('sl-sticky-note'),
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
    const { bet, grid, fs, sticky, respin } = loadSaved();
    this.#store = new Store('slots', {
      phase: PHASE.IDLE,
      busy: false,
      bet,
      grid,
      fs,
      sticky,
      respin,
      win: 0,
      message: fs ? `Tienes ${fs.remaining} giros gratis pendientes` : respin ? 'Batería Cuántica: tienes un giro gratis pendiente' : '3 estrellas o la compra de bono activan 8 giros gratis',
    });
    this.#buildReels(grid);
    this.#buildPaytable();
    this.#bind();
    this.#store.subscribe((state) => {
      storage.write(SAVE_KEY, { bet: state.bet, grid: state.grid, fs: state.fs, sticky: state.sticky, respin: state.respin });
      this.#render(state);
    });
    wallet.addEventListener('change', () => this.#renderControls(this.state));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stopAuto('Auto-spin detenido: la pestaña pasó a segundo plano');
    });
    session.register('slots', {
      hasPendingPlay: () => this.state.busy || Boolean(this.state.fs && this.state.fs.remaining > 0) || this.state.respin > 0,
      onZone: () => this.#fitBet(),
    });
    this.#render(this.state);
    this.#renderSticky(this.state.sticky);
    this.#fitBet();
  }

  // Apuestas y funciones que permite la zona (Modo Historia) o el Cripto-Casino.
  #limits() {
    return session.limits('slots');
  }

  #fitBet() {
    const steps = this.#limits().bets;
    const s = this.state;
    if (!steps.includes(s.bet) && this.#idle() && !this.#betLocked(s)) this.#set('ZONE_BET', { bet: steps[0] });
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
    const clover = relics.active('clover');
    this.#dom.rtp.textContent = pct(clover ? SLOT_MATH.cloverRtp : SLOT_MATH.rtp);
    const table = el('table', 'pay-table');
    const headRow = el('tr');
    for (const label of ['Símbolo', 'Prob.', '3 en línea', `4 iguales (×${SUPER_BONUS})`]) headRow.append(el('th', '', label));
    const head = el('thead');
    head.append(headRow);
    const body = el('tbody');
    const total = SYMBOLS.reduce((sum, symbol) => sum + symbol.base, 0);
    for (const symbol of SYMBOLS) {
      const row = el('tr');
      const name = el('td', 'pay-symbol');
      name.append(symbolSvg(symbol.id, symbol.name), el('span', '', symbol.name));
      row.append(name, el('td', '', `${((symbol.base / total) * 100).toFixed(1).replace('.', ',')} %`));
      if (symbol.scatter) {
        const cell = el('td', 'pay-scatter', `3 o más en cualquier posición → ${FREE_SPINS} giros gratis`);
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
    rule(`Premios en apuestas de línea (apuesta ÷ ${LINE_COUNT}). 10 líneas: 4 filas, 4 columnas y 2 diagonales, contadas desde su primera celda.`);
    rule(`Avalancha: los símbolos ganadores explotan y caen nuevos en el mismo giro. Combos sucesivos: ${CASCADE_MULTIPLIERS.map((m) => `×${m}`).join(', ')} (se mantiene en ×5).`);
    rule(`Súper Bono ×${SUPER_BONUS}: 4 símbolos idénticos en fila, columna o diagonal. Si un comodín completa el cuarteto, paga ×${WILD_FOUR}.`);
    rule(`Comodín 🃏: sustituye a los símbolos de pago y 3 comodines pagan como la corona. Cuando forma parte de un premio queda fijo ${STICKY_SPINS.join(' o ')} giros; en cada uno actúa una vez y multiplica ×${WILD_MULTIPLIER} las líneas que pasan por él (hasta ×${MAX_WILD_MULTIPLIER}). Mientras haya comodines fijos la apuesta queda bloqueada.`);
    rule(`Estrella ⭐: 3 o más al final del giro dan ${FREE_SPINS} giros gratis con rodillos cargados de comodines.`);
    rule(`Bonus Buy: ${FREE_SPINS} giros gratis por ${BONUS_BUY_COST} × apuesta · RTP de la compra ${pct(SLOT_MATH.bonusBuyRtp)}.`);
    rule(`Premio máximo: ${formatChips(MAX_WIN)} × apuesta por giro o por ronda de giros gratis.`);
    rule(`RTP ${pct(SLOT_MATH.rtp)} (líneas del juego base ${pct(SLOT_MATH.lines)} + giros gratis ${pct(SLOT_MATH.freeSpins)}), medido con ${formatChips(SLOT_MATH.spins / 1e6)} millones de tiradas del motor real. Giros gratis 1 de cada ${SLOT_MATH.triggerEvery} tiradas.`);
    if (session.mode === 'free') rule(`Cripto-Casino: el Trébol de Oro da +${Math.round((CLOVER_BOOST - 1) * 100)} % de comodines y estrellas (RTP ${pct(SLOT_MATH.cloverRtp)}); la Batería Cuántica, un ${Math.round(BATTERY_CHANCE * 100)} % de giro gratis tras una tirada sin premio, decidido con el siguiente número verificable del giro.`);
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
    relics.addEventListener('equip', () => this.#buildPaytable());
    relics.addEventListener('unequip', () => this.#buildPaytable());
  }

  #idle() {
    const s = this.state;
    return !s.busy && (s.phase === PHASE.IDLE || s.phase === PHASE.PAYOUT);
  }

  // La apuesta no se cambia con giros gratis, con un giro de la Batería o con comodines fijos.
  #betLocked(s = this.state) {
    return Boolean(s.fs) || s.respin > 0 || s.sticky.length > 0;
  }

  #stepBet(direction) {
    const s = this.state;
    if (!this.#idle() || this.#betLocked(s) || this.#auto) return;
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
    const respin = !free && s.respin > 0;
    const charged = !free && !respin;
    const bet = free ? s.fs.bet : respin ? s.respin : s.bet;
    if (charged && !session.playable) return;
    if (charged && this.#auto && !this.#autoMayContinue(bet)) return;
    if (charged && !wallet.hold('slots', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      this.stopAuto(null);
      return;
    }
    this.#set('HOLD', { phase: PHASE.BETTING, busy: true });
    if (charged) session.beginRound({ game: 'slots', stake: bet });

    const stream = session.stream('slots');
    const clover = relics.active('clover');
    const battery = !free && relics.active('battery');
    const outcome = playSpin({ bet, mode: free ? 'free' : 'base', rand: stream.rand, sticky: s.sticky, clover });
    let total = outcome.total;
    let fs = s.fs;
    let maxed = false;
    if (free) {
      const room = MAX_WIN * bet - fs.total;
      if (total >= room) {
        total = Math.max(0, room);
        maxed = true;
      }
      fs = { ...fs, remaining: maxed ? 0 : fs.remaining - 1, played: fs.played + 1, total: fs.total + total };
    } else if (outcome.freeSpins) {
      fs = { remaining: outcome.freeSpins, played: 0, awarded: outcome.freeSpins, bet, total: 0, source: 'scatter', cost: 0 };
    }
    // Batería Cuántica: el siguiente número del mismo flujo decide el giro gratis (verificable).
    const recharge = battery && total === 0 && !outcome.freeSpins && stream.float() < BATTERY_CHANCE;
    wallet.settle('slots', charged ? bet : 0, total);
    session.record(stream, {
      stake: charged ? bet : 0,
      payout: total,
      summary: `${free ? 'Giro gratis' : respin ? 'Giro de la Batería' : 'Giro'} · ${outcome.steps.length} avalancha${outcome.steps.length === 1 ? '' : 's'} · ×${(total / bet).toFixed(2).replace('.', ',')}${outcome.freeSpins ? ' · giros gratis' : ''}${recharge ? ' · batería' : ''}`,
      params: { mode: free ? 'free' : 'base', sticky: outcome.stickyBefore, clover, battery },
    });

    this.#set('SPIN', {
      phase: PHASE.DEALING,
      grid: outcome.final,
      fs,
      sticky: outcome.sticky,
      respin: recharge ? bet : 0,
      win: 0,
      message: free ? `Giro gratis ${fs.played} de ${fs.awarded}` : respin ? 'Batería Cuántica: giro gratis' : this.#auto ? `Auto-spin · quedan ${this.#auto.left}` : '¡Suerte!',
    });
    this.#clearBoard();
    this.#meter(0);
    this.#renderSticky(outcome.stickyBefore, { spinning: true });
    await this.#spinReels(outcome.initial);

    this.#set('RESOLVE', { phase: PHASE.RESOLVING });
    await this.#playTumbles(outcome, bet);
    this.#renderSticky(outcome.sticky);

    if (outcome.scatters.length >= 3) {
      this.#highlightScatters(outcome.scatters);
      await wait(500 * this.#speed());
    }
    this.#meter(total);

    wallet.reveal('slots');
    this.#set('PAYOUT', { phase: PHASE.PAYOUT, win: total, message: this.#describe(outcome, total, free, recharge) });
    this.#celebrate(outcome, total, bet);
    if (!free) session.report({ game: 'slots', stake: charged ? bet : 0, returned: total, tags: this.#tags(outcome) });

    if (free && fs.remaining === 0) {
      await wait(900 * this.#speed());
      const note = maxed ? ' (premio máximo alcanzado)' : '';
      hud.toast(`Giros Gratis terminados: ${formatChips(fs.total)} créditos${note}`, fs.total > 0 ? 'success' : 'info', 4600);
      this.#set('FS_END', { fs: null, message: `Bono total: ${formatChips(fs.total)} créditos${note}` });
      session.report({ game: 'slots', stake: fs.cost ?? 0, returned: fs.total, tags: fs.source === 'buy' ? ['fs-round', 'bonus-buy'] : ['fs-round'] });
    } else if (!free && outcome.freeSpins) {
      audio.win(2);
      hud.toast(`¡${outcome.freeSpins} GIROS GRATIS con comodines pegajosos!`, 'success', 4200);
    } else if (recharge) {
      audio.shimmer();
      this.#banner('🔋 GIRO GRATIS', 'is-free');
    }
    this.#set('READY', { busy: false });
    this.#afterSpin(outcome, total, free || respin);
  }

  #tags(outcome) {
    const tags = [];
    if (outcome.steps.length >= 2) tags.push('cascade2');
    if (outcome.steps.length >= 3) tags.push('cascade3');
    if (outcome.steps.some((step) => step.lines.some((line) => line.count === 4 && line.natural))) tags.push('super');
    if (outcome.steps.some((step) => step.locked.length)) tags.push('sticky');
    if (outcome.freeSpins) tags.push('freespins');
    return tags;
  }

  #describe(outcome, total, free, recharge) {
    if (total <= 0) {
      if (recharge) return 'Sin premio… ¡pero la Batería Cuántica te regala otro giro!';
      return free ? 'Sin premio en este giro gratis' : 'Sin premio. ¡Otra vez!';
    }
    const parts = [];
    const cascades = outcome.steps.length;
    if (cascades > 1) parts.push(`${cascades} avalanchas`);
    const lines = outcome.steps.flatMap((step) => step.lines);
    const best = [...lines].sort((a, b) => b.units - a.units)[0];
    if (best) parts.push(`${LINE_NAMES[best.index]}: ${best.count}× ${SYMBOL_BY_ID[best.symbol].name}${best.count === 4 && best.natural ? ' (SÚPER BONO)' : ''}`);
    const wildBoost = Math.max(1, ...lines.map((line) => line.multiplier));
    if (wildBoost > 1) parts.push(`comodín ×${wildBoost}`);
    return `Ganas ${formatChips(total)} · ${parts.join(' · ')}`;
  }

  #celebrate(outcome, total, bet) {
    const rect = this.#dom.grid.getBoundingClientRect();
    const origin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const ratio = total / bet;
    const superBonus = outcome.steps.some((step) => step.lines.some((line) => line.count === 4 && line.natural));
    const crowns = outcome.steps.some((step) => step.lines.some((line) => line.count === 4 && line.natural && line.symbol === 'C'));
    if (crowns) {
      this.#banner('JACKPOT REAL · 4 CORONAS', 'is-jackpot');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (ratio >= 50) {
      this.#banner(superBonus ? `SÚPER BONO ×${SUPER_BONUS}` : 'MEGA PREMIO', 'is-super');
      audio.win(3);
      hud.celebrate(3, origin);
    } else if (superBonus) {
      this.#banner(`SÚPER BONO ×${SUPER_BONUS}`, 'is-super');
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (ratio >= 10 || outcome.freeSpins) {
      if (outcome.freeSpins) this.#banner(`⭐ ${outcome.freeSpins} GIROS GRATIS`, 'is-free');
      audio.win(2);
      hud.celebrate(2, origin);
    } else if (total > 0) {
      audio.win(1);
      hud.celebrate(1, origin);
    }
  }

  // ---------- Encadenado: giros gratis, Batería y auto-spin ----------

  #afterSpin(outcome, total, bonusSpin) {
    const auto = this.#auto;
    if (auto && !bonusSpin) {
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
    const s = this.state;
    if (s.fs && s.fs.remaining > 0) {
      this.#timer = setTimeout(() => this.spin(), 1300 * this.#speed());
    } else if (s.respin > 0) {
      this.#timer = setTimeout(() => this.spin(), 1000 * this.#speed());
    } else if (this.#auto) {
      this.#timer = setTimeout(() => this.spin(), 650 * this.#speed());
    }
    this.#renderControls(s);
  }

  #autoMayContinue(bet) {
    const auto = this.#auto;
    if (!session.playable) {
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
    if (!this.#idle() || s.fs || s.respin) return;
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
    const s = this.state;
    if (!(s.fs?.remaining > 0) && !s.respin) clearTimeout(this.#timer);
    if (reason) hud.toast(reason, 'info');
    this.#renderControls(s);
  }

  // ---------- Bonus Buy ----------

  #openBuy() {
    const s = this.state;
    if (!this.#idle() || s.fs || s.respin || this.#auto) return;
    if (!this.#limits().bonusBuy) {
      hud.toast('La compra de bono se abre en el Salón de Neón', 'warn');
      return;
    }
    const price = BONUS_BUY_COST * s.bet;
    this.#dom.buyText.textContent = `${FREE_SPINS} giros gratis con rodillos cargados de comodines pegajosos. Precio: ${BONUS_BUY_COST} × ${formatChips(s.bet)} = ${formatChips(price)} créditos. RTP de la compra: ${pct(SLOT_MATH.bonusBuyRtp)}.`;
    this.#dom.buyConfirm.disabled = !wallet.canAfford(price);
    audio.click();
    this.#dom.buyDialog.showModal();
  }

  buyBonus() {
    const s = this.state;
    if (!this.#idle() || s.fs || s.respin || this.#auto || !session.playable || !this.#limits().bonusBuy) return;
    const price = BONUS_BUY_COST * s.bet;
    if (!wallet.hold('slots', price)) {
      hud.toast('Saldo insuficiente para comprar el bono', 'warn');
      return;
    }
    session.beginRound({ game: 'slots', stake: price });
    wallet.settle('slots', price, 0);
    wallet.reveal('slots');
    this.#set('FS_BUY', {
      fs: { remaining: FREE_SPINS, played: 0, awarded: FREE_SPINS, bet: s.bet, total: 0, source: 'buy', cost: price },
      win: 0,
      message: `Bono comprado: ${FREE_SPINS} giros gratis con comodines pegajosos`,
    });
    this.#banner(`⭐ ${FREE_SPINS} GIROS GRATIS`, 'is-free');
    audio.win(2);
    const rect = this.#dom.grid.getBoundingClientRect();
    hud.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    this.#scheduleNext();
  }

  // ---------- Animaciones ----------

  #speed() {
    return (this.#reduced.matches ? 0.35 : 1) * settings.speed;
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
      const wild = Math.max(1, ...step.lines.map((line) => line.multiplier));
      const extra = [step.multiplier > 1 ? `×${step.multiplier}` : '', wild > 1 ? `🃏×${wild}` : ''].filter(Boolean).join(' · ');
      this.#popup(`+${formatChips(stepWin)}${extra ? ` · ${extra}` : ''}`);
      this.#meter(running);
      await wait(700 * k);
      if (step.locked.length) this.#lockWilds(step.locked);
      this.#explode(step.exploding);
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
      const kind = line.count === 4 && line.natural ? ' is-super' : line.multiplier > 1 ? ' is-wild' : '';
      this.#dom.lines.append(svg('polyline', { points, class: `win-line${kind}` }));
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

  // Gravedad visual: los supervivientes caen a su nueva fila y los nuevos entran desde arriba;
  // los comodines fijos no se mueven.
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

  // ---------- Comodines pegajosos ----------

  #stickyBadge({ r, c, spins }, fresh = false) {
    const badge = el('div', `sticky-wild${fresh ? ' is-fresh' : ''}`);
    badge.style.gridRow = String(r + 1);
    badge.style.gridColumn = String(c + 1);
    badge.dataset.cell = `${r}:${c}`;
    badge.append(el('span', 'sticky-lock', '🔒'), el('span', 'sticky-count', String(spins)));
    badge.title = `Comodín fijo: ${spins} giro${spins === 1 ? '' : 's'} más`;
    return badge;
  }

  // Candados sobre los comodines fijos: se quedan quietos mientras giran los rodillos.
  #renderSticky(list, { spinning = false } = {}) {
    const layer = this.#dom.sticky;
    layer.classList.toggle('is-spinning', spinning);
    layer.replaceChildren(...list.map((item) => this.#stickyBadge(item)));
    const note = this.#dom.stickyNote;
    note.hidden = !list.length;
    if (list.length) note.textContent = `🔒 ${list.length} ${list.length === 1 ? 'comodín fijo' : 'comodines fijos'} · apuesta bloqueada`;
  }

  #lockWilds(locked) {
    for (const item of locked) {
      this.#dom.sticky.querySelector(`[data-cell="${item.r}:${item.c}"]`)?.remove();
      this.#dom.sticky.append(this.#stickyBadge(item, true));
    }
    audio.bell(1760, 0, 0.12);
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
    const bet = s.fs ? s.fs.bet : s.respin || s.bet;
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
    const respin = !free && s.respin > 0;
    const auto = this.#auto;
    const price = BONUS_BUY_COST * s.bet;
    const locked = this.#betLocked(s);
    if (auto) {
      d.spin.disabled = false;
      d.spin.textContent = `STOP · ${auto.left}`;
      d.spin.setAttribute('aria-label', `Detener auto-spin, quedan ${auto.left} tiradas`);
    } else {
      d.spin.disabled = !(idle && (free || respin || wallet.canAfford(s.bet)));
      d.spin.textContent = free ? `GIRO GRATIS · ${s.fs.remaining}` : respin ? 'GIRO GRATIS 🔋' : 'GIRAR';
      d.spin.setAttribute('aria-label', free ? `Giro gratis, quedan ${s.fs.remaining}` : respin ? 'Giro gratis de la Batería Cuántica' : 'Girar');
    }
    d.spin.classList.toggle('is-auto', Boolean(auto));
    const { bets: steps, bonusBuy } = this.#limits();
    d.betDown.disabled = !idle || locked || Boolean(auto) || s.bet <= steps[0];
    d.betUp.disabled = !idle || locked || Boolean(auto) || s.bet >= steps[steps.length - 1];
    d.auto.textContent = auto ? 'Detener auto' : 'Auto-spin';
    d.auto.setAttribute('aria-pressed', String(Boolean(auto)));
    d.auto.disabled = !auto && (!idle || free || respin || !wallet.canAfford(s.bet));
    d.buyPrice.textContent = bonusBuy ? formatChips(price) : 'Salón de Neón';
    d.buy.classList.toggle('is-locked', !bonusBuy);
    d.buy.disabled = !bonusBuy || !idle || Boolean(s.fs) || respin || Boolean(auto) || !wallet.canAfford(price);
  }

  onShow() {
    this.#visible = true;
    this.#buildPaytable();
    this.#scheduleNext();
  }

  onHide() {
    this.#visible = false;
    clearTimeout(this.#timer);
    this.stopAuto('Auto-spin detenido al cambiar de mesa');
  }
}
