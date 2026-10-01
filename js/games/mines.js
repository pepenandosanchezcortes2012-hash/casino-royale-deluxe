// Minas Cripto 5×5: elige de 1 a 24 minas, destapa gemas y retírate cuando quieras.
// Las minas se colocan al empezar con el flujo provably fair (mines-math.js) y el multiplicador
// tras k gemas es 0,97 · C(25, k) / C(25 − m, k). El tablero a medias sobrevive a una recarga:
// la apuesta sigue retenida y la partida continúa donde la dejaste.

import { wallet } from '../engine/wallet.js';
import { session } from '../session.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { randomInt } from '../engine/rng.js';
import { hud, formatChips } from '../ui/hud.js';
import { el, svg, useRef } from '../ui/svg.js';
import { BetControl } from '../ui/bet-control.js';
import { fmtMult, trauma, sleep } from '../ui/arcade.js';
import { placeMines, minesMultiplier, clampMines, MINES_CELLS, MIN_MINES, MAX_MINES, MINES_EDGE } from './mines-math.js';

const ROUND_KEY = scopedKey('crd.mines.round.v1');
const PREFS_KEY = scopedKey('crd.mines.prefs.v1');
const SIZE = 5;
const round2 = (value) => Math.round(value * 100) / 100;
const cellName = (index) => `fila ${Math.floor(index / SIZE) + 1}, columna ${(index % SIZE) + 1}`;

function validRound(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const mines = raw.mines;
  if (!(Number(raw.bet) > 0) || !Number.isInteger(mines) || mines < MIN_MINES || mines > MAX_MINES) return false;
  const cells = (list) => Array.isArray(list) && list.every((i) => Number.isInteger(i) && i >= 0 && i < MINES_CELLS) && new Set(list).size === list.length;
  if (!cells(raw.layout) || raw.layout.length !== mines || !cells(raw.revealed)) return false;
  if (raw.revealed.some((i) => raw.layout.includes(i)) || raw.revealed.length >= MINES_CELLS - mines) return false;
  return Boolean(raw.meta && Number.isInteger(raw.meta.nonce));
}

export class MinesGame {
  #root;
  #dom;
  #bet;
  #cells = [];
  #round = null;
  #last = null;
  #busy = false;
  #mines = 3;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      grid: $('mn-grid'),
      count: $('mn-count'),
      mult: $('mn-mult'),
      next: $('mn-next'),
      win: $('mn-win'),
      start: $('mn-start'),
      random: $('mn-random'),
      cashout: $('mn-cashout'),
      message: $('mn-message'),
      rules: $('mn-rules'),
    };
    this.#bet = new BetControl($('mn-bet'), { game: 'mines', limits: session.limits('mines') });
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    this.#mines = clampMines(prefs.mines ?? 3);
    this.#buildCount();
    this.#buildGrid();
    this.#bind();
    this.#dom.rules.textContent = `Tras k gemas el multiplicador es ${MINES_EDGE.toString().replace('.', ',')} · C(25, k) / C(25 − minas, k): exactamente 0,97 / P(sobrevivir), así que el RTP es del 97 % te retires cuando te retires. Las minas se colocan al empezar barajando las 25 casillas con el flujo verificable.`;
    session.register('mines', { hasPendingPlay: () => this.#round !== null || this.#busy, onZone: () => this.#bet.setLimits(session.limits('mines')) });
    this.#recover();
    this.#render();
  }

  #buildCount() {
    const options = [];
    for (let m = MIN_MINES; m <= MAX_MINES; m++) {
      const option = el('option', '', `${m} mina${m === 1 ? '' : 's'} · 1.ª gema ${fmtMult(minesMultiplier(m, 1))}`);
      option.value = String(m);
      options.push(option);
    }
    this.#dom.count.replaceChildren(...options);
    this.#dom.count.value = String(this.#mines);
  }

  #buildGrid() {
    this.#cells = Array.from({ length: MINES_CELLS }, (_, index) => {
      const button = el('button', 'mn-cell');
      button.type = 'button';
      button.dataset.index = String(index);
      button.addEventListener('click', () => this.pick(index));
      return button;
    });
    this.#dom.grid.replaceChildren(...this.#cells);
  }

  #bind() {
    const d = this.#dom;
    d.count.addEventListener('change', () => {
      this.#mines = clampMines(d.count.value);
      storage.write(PREFS_KEY, { mines: this.#mines });
      this.#render();
    });
    d.start.addEventListener('click', () => this.start());
    d.cashout.addEventListener('click', () => this.cashout());
    d.random.addEventListener('click', () => {
      const round = this.#round;
      if (!round) return;
      const hidden = Array.from({ length: MINES_CELLS }, (_, i) => i).filter((i) => !round.revealed.includes(i));
      this.pick(hidden[randomInt(hidden.length)]);
    });
    this.#bet.addEventListener('change', () => this.#render());
    wallet.addEventListener('update', () => this.#render());
  }

  #save() {
    const r = this.#round;
    if (r) storage.write(ROUND_KEY, { bet: r.bet, mines: r.mines, layout: r.layout, revealed: r.revealed, meta: r.meta });
    else storage.remove(ROUND_KEY);
  }

  #recover() {
    const saved = storage.read(ROUND_KEY, null);
    if (validRound(saved) && wallet.escrowOf('mines') >= saved.bet - 1e-9) {
      this.#round = { ...saved, stream: { meta: saved.meta } };
      this.#mines = saved.mines;
      this.#dom.count.value = String(saved.mines);
      this.#dom.message.textContent = `Partida recuperada: ${saved.revealed.length} gema${saved.revealed.length === 1 ? '' : 's'} destapada${saved.revealed.length === 1 ? '' : 's'}. Sigue o retírate.`;
      return;
    }
    storage.remove(ROUND_KEY);
    if (wallet.escrowOf('mines') > 0) wallet.refund('mines');
  }

  // ---------- Partida ----------

  start() {
    if (this.#round || this.#busy) return;
    const bet = this.#bet.value;
    if (!wallet.hold('mines', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    session.beginRound({ game: 'mines', stake: bet });
    const stream = session.stream('mines');
    const layout = placeMines(stream, this.#mines);
    this.#round = { bet, mines: this.#mines, layout, revealed: [], meta: stream.meta, stream };
    this.#last = null;
    this.#save();
    audio.chip();
    this.#dom.message.textContent = `${this.#mines} mina${this.#mines === 1 ? '' : 's'} escondida${this.#mines === 1 ? '' : 's'}: destapa una casilla`;
    this.#render();
  }

  async pick(index) {
    const round = this.#round;
    if (!round || this.#busy || round.revealed.includes(index)) return;
    if (round.layout.includes(index)) {
      await this.#bust(index);
      return;
    }
    round.revealed.push(index);
    this.#save();
    const gems = round.revealed.length;
    audio.gem(gems);
    const cell = this.#cells[index];
    const rect = cell.getBoundingClientRect();
    hud.sparks(rect.left + rect.width / 2, rect.top + rect.height / 2, 12);
    this.#dom.message.textContent = `¡Gema! ${gems} de ${MINES_CELLS - round.mines} · ${fmtMult(minesMultiplier(round.mines, gems))}`;
    this.#render();
    if (gems >= MINES_CELLS - round.mines) this.cashout();
  }

  cashout() {
    const round = this.#round;
    if (!round || this.#busy || !round.revealed.length) return;
    const gems = round.revealed.length;
    const multiplier = minesMultiplier(round.mines, gems);
    const payout = round2(round.bet * multiplier);
    wallet.settle('mines', round.bet, payout);
    wallet.reveal('mines');
    session.record(round.stream, { stake: round.bet, payout, summary: `${gems} gemas con ${round.mines} minas · ${fmtMult(multiplier)}`, params: { mines: round.mines } });
    session.report({ game: 'mines', stake: round.bet, returned: payout, safe: gems, tags: ['mines-cashout'] });
    audio.cashout();
    const rect = this.#dom.grid.getBoundingClientRect();
    hud.celebrate(multiplier >= 10 ? 3 : multiplier >= 3 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    this.#dom.message.textContent = `Retirada con ${gems} gema${gems === 1 ? '' : 's'}: ${fmtMult(multiplier)} → cobras ${formatChips(payout)}`;
    this.#finish(null);
  }

  async #bust(index) {
    const round = this.#round;
    this.#busy = true;
    const gems = round.revealed.length;
    wallet.settle('mines', round.bet, 0);
    wallet.reveal('mines');
    session.record(round.stream, { stake: round.bet, payout: 0, summary: `Mina en ${cellName(index)} tras ${gems} gema${gems === 1 ? '' : 's'}`, params: { mines: round.mines } });
    session.report({ game: 'mines', stake: round.bet, returned: 0, safe: gems, tags: [] });
    audio.mine();
    trauma(this.#dom.grid, 3);
    const rect = this.#cells[index].getBoundingClientRect();
    hud.sparks(rect.left + rect.width / 2, rect.top + rect.height / 2, 60);
    this.#dom.message.textContent = `¡BOOM! Mina en la ${cellName(index)}. Pierdes ${formatChips(round.bet)}`;
    this.#finish(index);
    await sleep(400);
    this.#busy = false;
    this.#render();
  }

  #finish(exploded) {
    this.#last = { layout: this.#round.layout, revealed: [...this.#round.revealed], exploded };
    this.#round = null;
    this.#save();
    this.#render();
  }

  // ---------- Render ----------

  #cellIcon(kind) {
    return svg('svg', { viewBox: '0 0 100 100', class: `mn-icon is-${kind}`, 'aria-hidden': 'true', focusable: 'false' }, [useRef(kind === 'gem' ? 'gem' : 'mine')]);
  }

  #render() {
    const d = this.#dom;
    const round = this.#round;
    const view = round ?? this.#last;
    this.#cells.forEach((cell, index) => {
      const revealed = view?.revealed.includes(index) ?? false;
      const ended = !round && this.#last;
      const mine = ended && this.#last.layout.includes(index);
      const kind = revealed ? 'gem' : mine ? 'mine' : null;
      const state = revealed ? 'gem' : mine ? (this.#last.exploded === index ? 'boom' : 'mine') : ended ? 'spare' : 'hidden';
      if (cell.dataset.state !== state) {
        cell.dataset.state = state;
        cell.replaceChildren(...(kind ? [this.#cellIcon(kind)] : ended ? [this.#cellIcon('gem')] : []));
      }
      cell.disabled = !round || revealed || this.#busy;
      const label = revealed ? 'gema' : mine ? 'mina' : ended ? 'gema sin destapar' : 'oculta';
      cell.setAttribute('aria-label', `Casilla ${cellName(index)}: ${label}`);
    });
    const mines = round?.mines ?? this.#mines;
    const gems = round?.revealed.length ?? 0;
    const current = minesMultiplier(mines, gems);
    const next = gems < MINES_CELLS - mines ? minesMultiplier(mines, gems + 1) : null;
    d.mult.textContent = fmtMult(current);
    d.next.textContent = next ? fmtMult(next) : '—';
    d.win.textContent = round && gems ? formatChips(round2(round.bet * current)) : '0';
    d.count.disabled = Boolean(round);
    this.#bet.setDisabled(Boolean(round));
    d.start.disabled = Boolean(round) || this.#busy || !wallet.canAfford(this.#bet.value);
    d.start.textContent = round ? 'En juego' : `Jugar · ${formatChips(this.#bet.value)}`;
    d.random.disabled = !round || this.#busy;
    d.cashout.disabled = !round || !gems || this.#busy;
    d.cashout.textContent = round && gems ? `Retirar ${formatChips(round2(round.bet * current))}` : 'Retirar';
    this.#dom.grid.classList.toggle('is-live', Boolean(round));
  }

  onShow() {
    this.#render();
  }

  onHide() {}
}
