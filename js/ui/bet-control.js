// Control de apuesta de los juegos arcade del Cripto-Casino: importe editable, ½, ×2, MÍN, MÁX y
// las fichas de 10 a 1.000, que se suman a la apuesta. Recuerda el último importe de cada juego.

import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../audio.js';
import { FREE_CHIPS, FREE_MIN_BET } from '../session.js';
import { chipSvg, el } from './svg.js';
import { formatChips } from './hud.js';

export class BetControl extends EventTarget {
  #root;
  #input;
  #key;
  #min;
  #max;
  #value;
  #controls = [];
  #disabled = false;

  constructor(root, { game, min = FREE_MIN_BET, max = 5000, value = 100 }) {
    super();
    this.#root = root;
    this.#key = scopedKey(`crd.bet.${game}.v1`);
    this.#min = min;
    this.#max = max;
    this.#value = this.#clamp(storage.read(this.#key, value));
    this.#build(game);
    this.#render();
  }

  #clamp(value) {
    const number = Math.round(Number(value));
    if (!Number.isFinite(number)) return this.#min;
    return Math.min(this.#max, Math.max(this.#min, number));
  }

  #button(text, label, onClick, className = 'btn btn-small bet-btn') {
    const button = el('button', className, text);
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      audio.click();
      onClick();
    });
    this.#controls.push(button);
    return button;
  }

  #build(game) {
    const label = this.#root.dataset.label ?? 'Apuesta';
    const id = `${game}-bet-input`;
    const head = el('label', 'bet-label', label);
    head.htmlFor = id;
    this.#input = el('input', 'bet-input');
    Object.assign(this.#input, { id, type: 'number', min: String(this.#min), max: String(this.#max), step: '1', inputMode: 'numeric' });
    this.#input.addEventListener('change', () => this.set(this.#input.value));
    this.#input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.set(this.#input.value);
    });
    this.#controls.push(this.#input);

    const row = el('div', 'bet-row');
    row.append(
      this.#button('½', 'Mitad de la apuesta', () => this.set(this.#value / 2)),
      this.#input,
      this.#button('×2', 'Doblar la apuesta', () => this.set(this.#value * 2)),
    );
    const chips = el('div', 'bet-chips');
    for (const value of FREE_CHIPS) {
      const chip = this.#button('', `Sumar ${value} a la apuesta`, () => this.set(this.#value + value), 'chip-btn chip-mini');
      chip.append(chipSvg(value));
      chips.append(chip);
    }
    const limits = el('div', 'bet-row bet-limits');
    limits.append(
      this.#button('MÍN', `Apuesta mínima (${this.#min})`, () => this.set(this.#min)),
      this.#button('MÁX', 'Apuesta máxima que cubre tu saldo', () => this.set(Math.min(this.#max, Math.floor(wallet.balance)))),
    );
    this.#root.replaceChildren(head, row, chips, limits);
  }

  get value() {
    return this.#value;
  }

  set(value) {
    this.#value = this.#clamp(value);
    storage.write(this.#key, this.#value);
    this.#render();
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.#value } }));
  }

  setDisabled(disabled) {
    this.#disabled = Boolean(disabled);
    this.#root.classList.toggle('is-locked', this.#disabled);
    for (const control of this.#controls) control.disabled = this.#disabled;
  }

  #render() {
    this.#input.value = String(this.#value);
    this.#input.setAttribute('aria-valuetext', `${formatChips(this.#value)} fichas`);
  }
}
