// La Torre de la Muerte: 8 pisos; en cada uno eliges una losa y alguna esconde una trampa.
// Fácil (3 losas, 1 trampa), Media (2 losas, 1 trampa) y Difícil (3 losas, 2 trampas).
// Las trampas se colocan al empezar con el flujo provably fair (towers-math.js); tras n pisos el
// multiplicador es 0,97 / p^n y puedes retirarte en cualquier piso. Sobrevive a una recarga.

import { wallet } from '../engine/wallet.js';
import { session, FREE_LIMITS, FREE_MIN_BET } from '../session.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { hud, formatChips } from '../ui/hud.js';
import { el } from '../ui/svg.js';
import { BetControl } from '../ui/bet-control.js';
import { fmtMult, trauma, sleep } from '../ui/arcade.js';
import { DIFFICULTIES, difficultyOf, towersMultiplier, towerLayout, safeChance, TOWER_LEVELS } from './towers-math.js';

const ROUND_KEY = scopedKey('crd.towers.round.v1');
const PREFS_KEY = scopedKey('crd.towers.prefs.v1');
const round2 = (value) => Math.round(value * 100) / 100;

function validRound(raw) {
  if (!raw || typeof raw !== 'object' || !(Number(raw.bet) > 0) || !DIFFICULTIES[raw.difficulty]) return false;
  const d = DIFFICULTIES[raw.difficulty];
  const layoutOk = Array.isArray(raw.layout) && raw.layout.length === TOWER_LEVELS &&
    raw.layout.every((traps) => Array.isArray(traps) && traps.length === d.traps && traps.every((t) => Number.isInteger(t) && t >= 0 && t < d.tiles));
  if (!layoutOk || !Array.isArray(raw.picks) || raw.picks.length >= TOWER_LEVELS) return false;
  const picksOk = raw.picks.every((tile, floor) => Number.isInteger(tile) && tile >= 0 && tile < d.tiles && !raw.layout[floor].includes(tile));
  return picksOk && Boolean(raw.meta && Number.isInteger(raw.meta.nonce));
}

export class TowersGame {
  #root;
  #dom;
  #bet;
  #difficulty = 'easy';
  #round = null;
  #last = null;
  #busy = false;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      tower: $('tw-tower'),
      difficulty: $('tw-difficulty'),
      floor: $('tw-floor'),
      mult: $('tw-mult'),
      win: $('tw-win'),
      start: $('tw-start'),
      cashout: $('tw-cashout'),
      message: $('tw-message'),
      rules: $('tw-rules'),
    };
    this.#bet = new BetControl($('tw-bet'), { game: 'towers', min: FREE_MIN_BET, max: FREE_LIMITS.towers.maxBet, value: 100 });
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    this.#difficulty = DIFFICULTIES[prefs.difficulty] ? prefs.difficulty : 'easy';
    this.#dom.rules.textContent = `Fácil: 3 losas y 1 trampa (${Math.round(safeChance('easy') * 100)} % de acierto). Media: 2 losas y 1 trampa (50 %). Difícil: 3 losas y 2 trampas (33 %). Tras n pisos cobras 0,97 / p^n: RTP del 97 % en cualquier piso. Las trampas de los 8 pisos se deciden al empezar con el flujo verificable.`;
    this.#bind();
    session.register('towers', { hasPendingPlay: () => this.#round !== null || this.#busy });
    this.#recover();
    this.#render();
  }

  #bind() {
    const d = this.#dom;
    d.difficulty.addEventListener('click', (event) => {
      const button = event.target.closest('[data-difficulty]');
      if (!button || this.#round) return;
      audio.click();
      this.#difficulty = button.dataset.difficulty;
      storage.write(PREFS_KEY, { difficulty: this.#difficulty });
      this.#last = null;
      this.#render();
    });
    d.start.addEventListener('click', () => this.start());
    d.cashout.addEventListener('click', () => this.cashout());
    this.#bet.addEventListener('change', () => this.#render());
    wallet.addEventListener('change', () => this.#render());
  }

  #save() {
    const r = this.#round;
    if (r) storage.write(ROUND_KEY, { bet: r.bet, difficulty: r.difficulty, layout: r.layout, picks: r.picks, meta: r.meta });
    else storage.remove(ROUND_KEY);
  }

  #recover() {
    const saved = storage.read(ROUND_KEY, null);
    if (validRound(saved) && wallet.escrowOf('towers') >= saved.bet - 1e-9) {
      this.#round = { ...saved, stream: { meta: saved.meta } };
      this.#difficulty = saved.difficulty;
      this.#dom.message.textContent = `Partida recuperada en el piso ${saved.picks.length + 1}. Sigue subiendo o retírate.`;
      return;
    }
    storage.remove(ROUND_KEY);
    if (wallet.escrowOf('towers') > 0) wallet.refund('towers');
  }

  // ---------- Partida ----------

  start() {
    if (this.#round || this.#busy) return;
    const bet = this.#bet.value;
    if (!wallet.hold('towers', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    session.beginRound({ game: 'towers', stake: bet });
    const stream = session.stream('towers');
    const layout = towerLayout(stream, this.#difficulty);
    this.#round = { bet, difficulty: this.#difficulty, layout, picks: [], meta: stream.meta, stream };
    this.#last = null;
    this.#save();
    audio.chip();
    this.#dom.message.textContent = 'Piso 1: elige una losa';
    this.#render();
  }

  async pick(tile) {
    const round = this.#round;
    if (!round || this.#busy) return;
    const floor = round.picks.length;
    if (round.layout[floor].includes(tile)) {
      await this.#fall(floor, tile);
      return;
    }
    round.picks.push(tile);
    this.#save();
    const climbed = round.picks.length;
    audio.towerStep(climbed);
    this.#dom.message.textContent = climbed >= TOWER_LEVELS ? '¡Has coronado la torre!' : `¡A salvo! Piso ${climbed + 1}: ${fmtMult(towersMultiplier(round.difficulty, climbed + 1))} si aciertas`;
    this.#render();
    if (climbed >= TOWER_LEVELS) this.cashout();
  }

  cashout() {
    const round = this.#round;
    if (!round || this.#busy || !round.picks.length) return;
    const climbed = round.picks.length;
    const multiplier = towersMultiplier(round.difficulty, climbed);
    const payout = round2(round.bet * multiplier);
    wallet.settle('towers', round.bet, payout);
    wallet.reveal('towers');
    session.record(round.stream, { stake: round.bet, payout, summary: `${climbed} piso${climbed === 1 ? '' : 's'} (${difficultyOf(round.difficulty).name}) · ${fmtMult(multiplier)}`, params: { difficulty: round.difficulty } });
    session.report({ game: 'towers', stake: round.bet, returned: payout, safe: climbed, tags: climbed >= TOWER_LEVELS ? ['towers-top'] : [] });
    audio.cashout();
    const rect = this.#dom.tower.getBoundingClientRect();
    hud.celebrate(climbed >= TOWER_LEVELS ? 3 : multiplier >= 5 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 3 });
    this.#dom.message.textContent = `Retirada en el piso ${climbed}: ${fmtMult(multiplier)} → cobras ${formatChips(payout)}`;
    this.#finish(null);
  }

  async #fall(floor, tile) {
    const round = this.#round;
    this.#busy = true;
    const climbed = round.picks.length;
    wallet.settle('towers', round.bet, 0);
    wallet.reveal('towers');
    session.record(round.stream, { stake: round.bet, payout: 0, summary: `Trampa en el piso ${floor + 1} (${difficultyOf(round.difficulty).name})`, params: { difficulty: round.difficulty } });
    session.report({ game: 'towers', stake: round.bet, returned: 0, safe: climbed, tags: [] });
    audio.trap();
    trauma(this.#dom.tower, 2);
    this.#dom.message.textContent = `¡Trampa en el piso ${floor + 1}! Pierdes ${formatChips(round.bet)}`;
    this.#finish({ floor, tile });
    await sleep(400);
    this.#busy = false;
    this.#render();
  }

  #finish(fall) {
    this.#last = { difficulty: this.#round.difficulty, layout: this.#round.layout, picks: [...this.#round.picks], fall };
    this.#round = null;
    this.#save();
    this.#render();
  }

  // ---------- Render ----------

  #render() {
    const d = this.#dom;
    const round = this.#round;
    const view = round ?? this.#last;
    const difficulty = difficultyOf(view?.difficulty ?? this.#difficulty);
    const climbed = round?.picks.length ?? 0;

    for (const button of d.difficulty.querySelectorAll('[data-difficulty]')) {
      button.setAttribute('aria-pressed', String(button.dataset.difficulty === (round?.difficulty ?? this.#difficulty)));
      button.disabled = Boolean(round);
    }

    const floors = [];
    for (let floor = TOWER_LEVELS - 1; floor >= 0; floor--) {
      const item = el('li', 'tw-floor');
      const active = round && floor === climbed && !this.#busy;
      const passed = view && floor < view.picks.length;
      item.classList.toggle('is-active', Boolean(active));
      item.classList.toggle('is-passed', Boolean(passed));
      item.append(el('span', 'tw-floor-mult', fmtMult(towersMultiplier(difficulty.id, floor + 1))));
      const tiles = el('div', 'tw-tiles');
      for (let tile = 0; tile < difficulty.tiles; tile++) {
        const button = el('button', 'tw-tile');
        button.type = 'button';
        const picked = view?.picks[floor] === tile;
        const ended = !round && this.#last;
        const trap = ended && this.#last.layout[floor].includes(tile);
        const fell = ended && this.#last.fall?.floor === floor && this.#last.fall?.tile === tile;
        const state = fell ? 'fall' : picked ? 'safe' : trap ? 'trap' : ended ? 'spare' : 'hidden';
        button.dataset.state = state;
        button.textContent = fell ? '💀' : picked ? '💎' : trap ? '☠' : '';
        button.disabled = !active;
        button.setAttribute('aria-label', `Piso ${floor + 1}, losa ${tile + 1}${state === 'hidden' ? '' : `: ${{ fall: 'trampa (caíste)', safe: 'segura', trap: 'trampa', spare: 'segura' }[state]}`}`);
        if (active) button.addEventListener('click', () => this.pick(tile));
        tiles.append(button);
      }
      item.append(tiles);
      floors.push(item);
    }
    d.tower.replaceChildren(...floors);
    d.tower.dataset.difficulty = difficulty.id;

    const multiplier = towersMultiplier(difficulty.id, climbed);
    d.floor.textContent = `${climbed} / ${TOWER_LEVELS}`;
    d.mult.textContent = fmtMult(multiplier);
    d.win.textContent = round && climbed ? formatChips(round2(round.bet * multiplier)) : '0';
    this.#bet.setDisabled(Boolean(round));
    d.start.disabled = Boolean(round) || this.#busy || !wallet.canAfford(this.#bet.value);
    d.start.textContent = round ? 'Subiendo…' : `Jugar · ${formatChips(this.#bet.value)}`;
    d.cashout.disabled = !round || !climbed || this.#busy;
    d.cashout.textContent = round && climbed ? `Retirar ${formatChips(round2(round.bet * multiplier))}` : 'Retirar';
  }

  onShow() {
    this.#render();
  }

  onHide() {}
}
