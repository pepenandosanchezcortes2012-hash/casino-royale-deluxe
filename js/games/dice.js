// Dados Over/Under: tirada de 0,00 a 99,99 con el flujo provably fair (dice-math.js).
// Elige la probabilidad de acierto (1–97 %) con el deslizador y la condición «Menor que» o
// «Mayor que»; el multiplicador es 98 / P, así que el RTP es del 98 % con cualquier ajuste.

import { wallet } from '../engine/wallet.js';
import { session, FREE_LIMITS, FREE_MIN_BET } from '../session.js';
import { audio } from '../audio.js';
import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { randomFloat } from '../engine/rng.js';
import { hud, formatChips } from '../ui/hud.js';
import { BetControl } from '../ui/bet-control.js';
import { fmtMult, outcomeTone, pushRecent, pace } from '../ui/arcade.js';
import { playDice, diceMultiplier, diceTarget, clampChance, MIN_CHANCE } from './dice-math.js';

const PREFS_KEY = scopedKey('crd.dice.prefs.v1');
const ROLL_MS = 480;
const round2 = (value) => Math.round(value * 100) / 100;
const fixed2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export class DiceGame {
  #root;
  #dom;
  #bet;
  #chance = 49;
  #direction = 'under';
  #busy = false;
  #lastRoll = null;

  constructor(root) {
    this.#root = root;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      roll: $('dc-roll'),
      track: $('dc-track'),
      zone: $('dc-zone'),
      marker: $('dc-marker'),
      slider: $('dc-slider'),
      history: $('dc-history'),
      direction: $('dc-direction'),
      chance: $('dc-chance'),
      target: $('dc-target'),
      mult: $('dc-mult'),
      win: $('dc-win'),
      button: $('dc-roll-btn'),
      message: $('dc-message'),
      rules: $('dc-rules'),
    };
    this.#bet = new BetControl($('dc-bet'), { game: 'dice', min: FREE_MIN_BET, max: FREE_LIMITS.dice.maxBet, value: 100 });
    const prefs = storage.read(PREFS_KEY, null) ?? {};
    this.#chance = clampChance(prefs.chance ?? 49);
    this.#direction = prefs.direction === 'over' ? 'over' : 'under';
    const d = this.#dom;
    // El deslizador marca el umbral de la tirada: «Menor que» usa P y «Mayor que», 100 − P.
    d.slider.min = String(MIN_CHANCE);
    d.slider.max = String(100 - MIN_CHANCE);
    d.rules.textContent = 'La tirada sale de floor(r · 10 000) / 100 con r el primer número verificable: 10 000 resultados equiprobables de 0,00 a 99,99. «Menor que P» gana con tirada < P; «Mayor que» gana con tirada ≥ 100 − P. Multiplicador 98 / P: RTP del 98 %.';
    this.#bind();
    session.register('dice', { hasPendingPlay: () => this.#busy });
    this.#render();
  }

  #bind() {
    const d = this.#dom;
    d.slider.addEventListener('input', () => {
      const value = Number(d.slider.value);
      this.#chance = clampChance(this.#direction === 'under' ? value : 100 - value);
      this.#save();
      this.#render();
    });
    d.direction.addEventListener('click', (event) => {
      const button = event.target.closest('[data-direction]');
      if (!button || this.#busy) return;
      audio.click();
      this.#direction = button.dataset.direction;
      this.#save();
      this.#render();
    });
    d.button.addEventListener('click', () => this.roll());
    this.#bet.addEventListener('change', () => this.#render());
    wallet.addEventListener('change', () => this.#render());
    globalThis.addEventListener('resize', () => this.#placeMarker(), { passive: true });
  }

  #save() {
    storage.write(PREFS_KEY, { chance: this.#chance, direction: this.#direction });
  }

  async roll() {
    if (this.#busy) return;
    const bet = this.#bet.value;
    if (!wallet.hold('dice', bet)) {
      hud.toast('Saldo insuficiente para esta apuesta', 'warn');
      return;
    }
    this.#busy = true;
    session.beginRound({ game: 'dice', stake: bet });
    const stream = session.stream('dice');
    const result = playDice(stream, { chance: this.#chance, direction: this.#direction });
    const payout = result.win ? round2(bet * result.multiplier) : 0;
    wallet.settle('dice', bet, payout);
    const condition = result.direction === 'under' ? `< ${result.target}` : `≥ ${result.target}`;
    session.record(stream, { stake: bet, payout, summary: `${fixed2.format(result.roll)} ${condition} → ${result.win ? 'gana' : 'pierde'}`, params: { chance: result.chance, direction: result.direction } });
    this.#render();

    const duration = pace(ROLL_MS);
    audio.diceRoll(duration / 1000);
    const d = this.#dom;
    d.roll.classList.add('is-rolling');
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        if (performance.now() - started >= duration) {
          resolve();
          return;
        }
        d.roll.textContent = fixed2.format(Math.floor(randomFloat() * 10000) / 100);
        setTimeout(tick, 40);
      };
      tick();
    });
    d.roll.classList.remove('is-rolling');
    d.roll.textContent = fixed2.format(result.roll);
    d.roll.dataset.result = result.win ? 'win' : 'loss';
    this.#lastRoll = result.roll;
    this.#placeMarker();

    wallet.reveal('dice');
    const tone = result.win ? outcomeTone(result.multiplier) : 'loss';
    pushRecent(d.history, fixed2.format(result.roll), tone);
    if (result.win) {
      audio.win(result.multiplier >= 10 ? 2 : 1);
      const rect = d.roll.getBoundingClientRect();
      hud.celebrate(result.multiplier >= 10 ? 2 : 1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      d.message.textContent = `${fixed2.format(result.roll)} ${condition}: ¡ganas ${formatChips(payout)}! (${fmtMult(result.multiplier)})`;
    } else {
      audio.lose();
      d.message.textContent = `${fixed2.format(result.roll)}: no cumple ${condition}. Pierdes ${formatChips(bet)}`;
    }
    session.report({ game: 'dice', stake: bet, returned: payout, tags: [`dice-${result.direction}`] });
    this.#busy = false;
    this.#render();
  }

  #placeMarker() {
    const d = this.#dom;
    const width = d.track.clientWidth;
    d.marker.hidden = this.#lastRoll === null;
    if (this.#lastRoll === null || !width) return;
    d.marker.style.transform = `translateX(${(this.#lastRoll / 100) * width}px)`;
  }

  #render() {
    const d = this.#dom;
    const chance = this.#chance;
    const direction = this.#direction;
    const multiplier = diceMultiplier(chance);
    const target = diceTarget(chance, direction);
    for (const button of d.direction.querySelectorAll('[data-direction]')) {
      button.setAttribute('aria-pressed', String(button.dataset.direction === direction));
      button.disabled = this.#busy;
    }
    d.chance.textContent = `${chance} %`;
    d.target.textContent = direction === 'under' ? `< ${target}` : `≥ ${target}`;
    d.mult.textContent = fmtMult(multiplier);
    d.win.textContent = formatChips(round2(this.#bet.value * multiplier));
    d.slider.value = String(target);
    d.slider.disabled = this.#busy;
    d.slider.setAttribute('aria-valuetext', `${chance} % de probabilidad, ${direction === 'under' ? 'menor que' : 'mayor o igual que'} ${target}, multiplicador ${fmtMult(multiplier)}`);
    const [from, to] = direction === 'under' ? [0, target] : [target, 100];
    d.zone.style.setProperty('--from', `${from}%`);
    d.zone.style.setProperty('--to', `${to}%`);
    this.#bet.setDisabled(this.#busy);
    d.button.disabled = this.#busy || !wallet.canAfford(this.#bet.value);
    d.button.textContent = this.#busy ? 'Tirando…' : `Tirar · ${formatChips(this.#bet.value)}`;
  }

  onShow() {
    this.#render();
    this.#placeMarker();
  }

  onHide() {}
}
