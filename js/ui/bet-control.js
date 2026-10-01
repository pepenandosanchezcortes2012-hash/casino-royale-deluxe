// Control de apuesta de las mesas arcade: importe editable, ½, ×2, MÍN, MÁX y las fichas del piso,
// que se suman a la apuesta. El rango y las fichas cambian con el piso (setLimits) y se recuerda
// el último importe de cada mesa en cada piso.

import { storage } from '../storage.js';
import { scopedKey } from '../mode.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../audio.js';
import { chipSvg, el } from './svg.js';
import { formatChips } from './hud.js';

export class BetControl extends EventTarget {
  #root;
  #game;
  #input;
  #chipBox;
  #minButton;
  #key = '';
  #min = 1;
  #max = Infinity;
  #value = 1;
  #controls = [];
  #chipButtons = [];
  #disabled = false;

  // `limits` = { minBet, maxBet, chips, floor } de la sesión.
  constructor(root, { game, limits }) {
    super();
    this.#root = root;
    this.#game = game;
    this.#build();
    this.setLimits(limits);
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
    return button;
  }

  #build() {
    const label = this.#root.dataset.label ?? 'Apuesta';
    const id = `${this.#game}-bet-input`;
    const head = el('label', 'bet-label', label);
    head.htmlFor = id;
    this.#input = el('input', 'bet-input');
    Object.assign(this.#input, { id, type: 'number', step: '1', inputMode: 'numeric' });
    this.#input.addEventListener('change', () => this.set(this.#input.value));
    this.#input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') this.set(this.#input.value);
    });

    const half = this.#button('½', 'Mitad de la apuesta', () => this.set(this.#value / 2));
    const double = this.#button('×2', 'Doblar la apuesta', () => this.set(this.#value * 2));
    const row = el('div', 'bet-row');
    row.append(half, this.#input, double);
    this.#chipBox = el('div', 'bet-chips');
    this.#minButton = this.#button('MÍN', 'Apuesta mínima', () => this.set(this.#min));
    const max = this.#button('MÁX', 'Apuesta máxima que cubre tu saldo', () => this.set(Math.min(this.#max, Math.floor(wallet.balance))));
    const limits = el('div', 'bet-row bet-limits');
    limits.append(this.#minButton, max);
    this.#controls = [this.#input, half, double, this.#minButton, max];
    this.#root.replaceChildren(head, row, this.#chipBox, limits);
  }

  // Nuevo rango del piso: fichas, mínimo y máximo (sin límite = Infinity) y el importe guardado
  // para este piso.
  setLimits({ minBet, maxBet, chips = [], floor = 1 }) {
    this.#min = minBet;
    this.#max = Number.isFinite(maxBet) ? maxBet : Infinity;
    this.#key = scopedKey(`crd.bet.${this.#game}.f${floor}.v1`);
    this.#input.min = String(this.#min);
    if (Number.isFinite(this.#max)) this.#input.max = String(this.#max);
    else this.#input.removeAttribute('max');
    this.#minButton.setAttribute('aria-label', `Apuesta mínima (${formatChips(this.#min)})`);
    this.#chipButtons = chips.map((value) => {
      const chip = this.#button('', `Sumar ${formatChips(value)} a la apuesta`, () => this.set(this.#value + value), 'chip-btn chip-mini');
      chip.append(chipSvg(value));
      return chip;
    });
    this.#chipBox.replaceChildren(...this.#chipButtons);
    this.#value = this.#clamp(storage.read(this.#key, this.#min));
    this.setDisabled(this.#disabled);
    this.#render();
    this.dispatchEvent(new CustomEvent('change', { detail: { value: this.#value } }));
  }

  get value() {
    return this.#value;
  }

  get min() {
    return this.#min;
  }

  get max() {
    return this.#max;
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
    for (const control of [...this.#controls, ...this.#chipButtons]) control.disabled = this.#disabled;
  }

  #render() {
    this.#input.value = String(this.#value);
    this.#input.setAttribute('aria-valuetext', `${formatChips(this.#value)} créditos`);
  }
}
