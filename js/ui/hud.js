// HUD: créditos y fichas en juego, racks de fichas de la zona, interruptores de música y de
// efectos, avisos y efectos visuales. La parte narrativa vive en story-ui.js.

import { wallet, DENOMINATIONS } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { chipSvg, chipLabel, el } from './svg.js';

const CHIP_KEY = 'crd.chip.v2';
const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

export function formatChips(value) {
  return numberFormat.format(value);
}

class Hud {
  #dom = null;
  #fx = null;
  #selected = 1;
  #available = [...DENOMINATIONS];
  #racks = [];
  #chipListeners = new Set();
  #shown = { balance: 0, inPlay: 0 };
  #tween = 0;

  init({ fx }) {
    this.#fx = fx;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      balance: $('hud-balance'),
      inPlay: $('hud-inplay'),
      music: $('btn-music'),
      sfx: $('btn-sfx'),
      toasts: $('toasts'),
    };

    const saved = storage.read(CHIP_KEY, null);
    if (DENOMINATIONS.includes(saved)) this.#selected = saved;

    this.#shown = { balance: wallet.balance, inPlay: wallet.inPlay };
    this.#dom.balance.textContent = formatChips(wallet.balance);
    this.#dom.inPlay.textContent = formatChips(wallet.inPlay);

    wallet.addEventListener('change', () => this.#onWalletChange());
    this.#bindAudio();
  }

  // ---------- Racks de fichas ----------

  get selectedChip() {
    return this.#selected;
  }

  onChipChange(listener) {
    this.#chipListeners.add(listener);
  }

  // Con onPlace, pulsar una ficha también la apuesta; sin él, solo la selecciona.
  mountRack(container, { onPlace = null } = {}) {
    const rack = { container, onPlace, buttons: new Map() };
    for (const value of DENOMINATIONS) {
      const button = el('button', 'chip-btn');
      button.type = 'button';
      button.dataset.value = String(value);
      button.setAttribute('aria-label', `Ficha de ${value}`);
      button.append(chipSvg(value));
      button.addEventListener('click', () => {
        this.selectChip(value);
        if (onPlace) onPlace(value);
      });
      rack.buttons.set(value, button);
      container.append(button);
    }
    this.#racks.push(rack);
    this.#renderRacks();
    return rack;
  }

  // Fichas que admite la zona actual (el resto se oculta).
  setDenominations(values) {
    this.#available = DENOMINATIONS.filter((value) => values.includes(value));
    if (!this.#available.includes(this.#selected)) this.#selected = this.#available[0];
    this.#renderRacks();
  }

  selectChip(value) {
    if (!this.#available.includes(value)) return;
    this.#selected = value;
    storage.write(CHIP_KEY, value);
    audio.click();
    this.#renderRacks();
    for (const listener of this.#chipListeners) listener(value);
  }

  #renderRacks() {
    const balance = wallet.balance;
    if (this.#selected > balance) {
      const affordable = this.#available.filter((value) => value <= balance);
      if (affordable.length) this.#selected = affordable[affordable.length - 1];
    }
    for (const rack of this.#racks) {
      for (const [value, button] of rack.buttons) {
        const selected = value === this.#selected;
        button.hidden = !this.#available.includes(value);
        button.classList.toggle('is-selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.disabled = value > balance;
      }
    }
  }

  // ---------- Saldo ----------

  #onWalletChange() {
    this.#animateNumbers();
    this.#renderRacks();
  }

  #animateNumbers() {
    const from = { ...this.#shown };
    const to = { balance: wallet.balance, inPlay: wallet.inPlay };
    const start = performance.now();
    const duration = 450;
    this.#dom.balance.classList.toggle('is-up', to.balance > from.balance);
    this.#dom.balance.classList.toggle('is-down', to.balance < from.balance);
    cancelAnimationFrame(this.#tween);
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const ease = 1 - (1 - k) ** 3;
      this.#shown = {
        balance: from.balance + (to.balance - from.balance) * ease,
        inPlay: from.inPlay + (to.inPlay - from.inPlay) * ease,
      };
      this.#dom.balance.textContent = formatChips(k < 1 ? Math.round(this.#shown.balance * 10) / 10 : to.balance);
      this.#dom.inPlay.textContent = formatChips(k < 1 ? Math.round(this.#shown.inPlay * 10) / 10 : to.inPlay);
      if (k < 1) {
        this.#tween = requestAnimationFrame(step);
      } else {
        this.#shown = to;
        this.#dom.balance.classList.remove('is-up', 'is-down');
      }
    };
    this.#tween = requestAnimationFrame(step);
  }

  // ---------- Música y efectos ----------

  // Cada interruptor es independiente y guarda su estado; el clic también desbloquea el audio.
  #bindAudio() {
    const d = this.#dom;
    d.music.addEventListener('click', () => {
      audio.unlock();
      audio.toggleMusic();
    });
    d.sfx.addEventListener('click', () => {
      audio.unlock();
      if (audio.toggleSfx()) audio.chip();
    });
    audio.addEventListener('change', () => this.#renderAudio());
    this.#renderAudio();
  }

  #renderAudio() {
    const { music, sfx } = audio.prefs;
    const paint = (button, on, icons) => {
      button.setAttribute('aria-pressed', String(on));
      button.classList.toggle('is-off', !on);
      button.querySelector('.audio-icon').textContent = on ? icons[0] : icons[1];
      button.querySelector('.audio-state').textContent = on ? 'ON' : 'OFF';
    };
    paint(this.#dom.music, music, ['🎵', '🎵']);
    paint(this.#dom.sfx, sfx, ['🔊', '🔇']);
  }

  // ---------- Avisos y efectos ----------

  toast(message, tone = 'info', duration = 3200) {
    const root = this.#dom?.toasts;
    if (!root) return;
    const node = el('div', `toast toast-${tone}`, message);
    root.append(node);
    while (root.children.length > 4) root.firstElementChild.remove();
    setTimeout(() => {
      node.classList.add('is-leaving');
      setTimeout(() => node.remove(), 350);
    }, duration);
  }

  celebrate(level, origin) {
    this.#fx?.celebrate(level, origin);
  }

  sparks(x, y, count = 24) {
    this.#fx?.sparks(x, y, count);
  }

  goldStorm(seconds) {
    this.#fx?.goldStorm(seconds);
  }

  minBetNotice(minBet) {
    this.toast(`La apuesta mínima de esta zona es ${formatChips(minBet)} créditos`, 'warn');
  }
}

export const hud = new Hud();
export { chipLabel };
