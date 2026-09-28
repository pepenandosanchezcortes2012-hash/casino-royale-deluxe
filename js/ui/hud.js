// HUD: saldo, fichas en juego, racks de fichas, rescate por bancarrota, sonido, tienda VIP y avisos.

import { wallet, DENOMINATIONS, FELTS, MIN_BET, RESCUE_AMOUNT } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { chipSvg, chipLabel, el } from './svg.js';

const CHIP_KEY = 'crd.chip.v1';
const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

export function formatChips(value) {
  return numberFormat.format(value);
}

class Hud {
  #dom = null;
  #fx = null;
  #selected = 25;
  #racks = [];
  #chipListeners = new Set();
  #shown = { balance: 0, inPlay: 0 };
  #tween = 0;
  #rescueTimer = 0;

  init({ fx }) {
    this.#fx = fx;
    this.#dom = {
      balance: document.getElementById('hud-balance'),
      inPlay: document.getElementById('hud-inplay'),
      rescue: document.getElementById('btn-rescue'),
      vip: document.getElementById('btn-vip'),
      sound: document.getElementById('btn-sound'),
      soundIcon: document.getElementById('btn-sound-icon'),
      toasts: document.getElementById('toasts'),
      dialog: document.getElementById('vip-dialog'),
      vipList: document.getElementById('vip-list'),
      vipClose: document.getElementById('vip-close'),
    };

    const saved = storage.read(CHIP_KEY, null);
    if (DENOMINATIONS.includes(saved)) this.#selected = saved;

    this.#shown = { balance: wallet.balance, inPlay: wallet.inPlay };
    this.#dom.balance.textContent = formatChips(wallet.balance);
    this.#dom.inPlay.textContent = formatChips(wallet.inPlay);

    wallet.addEventListener('change', () => this.#onWalletChange());
    this.#dom.rescue.addEventListener('click', () => this.#rescue());
    this.#dom.vip.addEventListener('click', () => this.openShop());
    this.#dom.vipClose.addEventListener('click', () => this.#dom.dialog.close());
    this.#dom.dialog.addEventListener('click', (event) => {
      if (event.target === this.#dom.dialog) this.#dom.dialog.close();
    });
    this.#dom.sound.addEventListener('click', () => {
      audio.unlock();
      audio.setMuted(!audio.muted);
      this.#renderSound();
      audio.click();
    });

    document.documentElement.dataset.felt = wallet.felt;
    this.#renderSound();
    this.#renderRescue();
  }

  // ---------- Racks de fichas ----------

  get selectedChip() {
    return this.#selected;
  }

  onChipChange(listener) {
    this.#chipListeners.add(listener);
  }

  // mode "place": pulsar una ficha la selecciona y la apuesta (onPlace). mode "select": solo selecciona.
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

  selectChip(value) {
    if (!DENOMINATIONS.includes(value)) return;
    this.#selected = value;
    storage.write(CHIP_KEY, value);
    this.#renderRacks();
    for (const listener of this.#chipListeners) listener(value);
  }

  #renderRacks() {
    const balance = wallet.balance;
    if (this.#selected > balance) {
      const affordable = DENOMINATIONS.filter((value) => value <= balance);
      if (affordable.length) this.#selected = affordable[affordable.length - 1];
    }
    for (const rack of this.#racks) {
      for (const [value, button] of rack.buttons) {
        const selected = value === this.#selected;
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
    this.#renderRescue();
    if (this.#dom.dialog.open) this.#renderShop();
  }

  #animateNumbers() {
    const from = { ...this.#shown };
    const to = { balance: wallet.balance, inPlay: wallet.inPlay };
    const start = performance.now();
    const duration = 450;
    const gained = to.balance > from.balance;
    this.#dom.balance.classList.toggle('is-up', gained);
    this.#dom.balance.classList.toggle('is-down', to.balance < from.balance);
    cancelAnimationFrame(this.#tween);
    const step = (now) => {
      const k = Math.min(1, (now - start) / duration);
      const ease = 1 - (1 - k) ** 3;
      this.#shown = {
        balance: from.balance + (to.balance - from.balance) * ease,
        inPlay: from.inPlay + (to.inPlay - from.inPlay) * ease,
      };
      this.#dom.balance.textContent = formatChips(k < 1 ? Math.round(this.#shown.balance) : to.balance);
      this.#dom.inPlay.textContent = formatChips(k < 1 ? Math.round(this.#shown.inPlay) : to.inPlay);
      if (k < 1) {
        this.#tween = requestAnimationFrame(step);
      } else {
        this.#shown = to;
        this.#dom.balance.classList.remove('is-up', 'is-down');
      }
    };
    this.#tween = requestAnimationFrame(step);
  }

  // ---------- Rescate por bancarrota ----------

  #renderRescue() {
    const status = wallet.rescueStatus();
    const button = this.#dom.rescue;
    button.hidden = !status.busted;
    clearTimeout(this.#rescueTimer);
    if (!status.busted) return;
    if (status.eligible) {
      button.disabled = false;
      button.textContent = `Rescate +${RESCUE_AMOUNT}`;
      button.classList.add('is-pulsing');
    } else {
      const seconds = Math.ceil(status.remaining / 1000);
      const mm = Math.floor(seconds / 60);
      const ss = String(seconds % 60).padStart(2, '0');
      button.disabled = true;
      button.classList.remove('is-pulsing');
      button.textContent = `Rescate en ${mm}:${ss}`;
      this.#rescueTimer = setTimeout(() => this.#renderRescue(), 1000);
    }
  }

  #rescue() {
    if (wallet.rescue()) {
      audio.chip();
      audio.win(1);
      this.toast(`Rescate concedido: +${RESCUE_AMOUNT} fichas`, 'success');
      const rect = this.#dom.balance.getBoundingClientRect();
      this.celebrate(1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    this.#renderRescue();
  }

  // ---------- Sonido ----------

  #renderSound() {
    const on = !audio.muted;
    this.#dom.sound.setAttribute('aria-pressed', String(on));
    this.#dom.sound.setAttribute('aria-label', on ? 'Sonido activado' : 'Sonido silenciado');
    this.#dom.soundIcon.setAttribute('href', on ? '#icon-sound-on' : '#icon-sound-off');
  }

  // ---------- Tienda VIP ----------

  openShop() {
    this.#renderShop();
    if (!this.#dom.dialog.open) this.#dom.dialog.showModal();
  }

  #renderShop() {
    const list = this.#dom.vipList;
    const owned = wallet.owned;
    const items = FELTS.map((felt) => {
      const card = el('article', 'vip-item');
      if (felt.id === wallet.felt) card.classList.add('is-active');
      const swatch = el('div', 'vip-swatch');
      swatch.style.background = `radial-gradient(circle at 50% 40%, ${felt.swatch[0]}, ${felt.swatch[1]})`;
      const name = el('h3', 'vip-name', felt.name);
      const price = el('p', 'vip-price', felt.price === 0 ? 'Incluido' : `${formatChips(felt.price)} fichas`);
      const button = el('button', 'btn');
      button.type = 'button';
      if (felt.id === wallet.felt) {
        button.textContent = 'En uso';
        button.disabled = true;
      } else if (owned.includes(felt.id)) {
        button.textContent = 'Equipar';
      } else {
        button.textContent = 'Comprar';
        button.classList.add('btn-gold');
        button.disabled = !wallet.canAfford(felt.price);
      }
      button.addEventListener('click', () => this.#equip(felt));
      card.append(swatch, name, price, button);
      return card;
    });
    list.replaceChildren(...items);
  }

  #equip(felt) {
    const buying = !wallet.owned.includes(felt.id);
    if (!wallet.buyFelt(felt.id)) {
      this.toast(`Necesitas ${formatChips(felt.price)} fichas para ${felt.name}`, 'warn');
      return;
    }
    document.documentElement.dataset.felt = felt.id;
    audio.chip();
    if (buying) {
      audio.win(1);
      this.toast(`¡${felt.name} desbloqueado!`, 'success');
    }
    this.#renderShop();
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

  minBetNotice() {
    this.toast(`La apuesta mínima es ${MIN_BET} fichas`, 'warn');
  }
}

export const hud = new Hud();
export { chipLabel };
