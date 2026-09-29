// HUD: créditos y fichas en juego, racks de fichas de la zona, panel de sonido y voz,
// avisos y efectos. La parte narrativa (título, zona, favores, expediente) vive en story-ui.js.

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
      sound: $('btn-sound'),
      soundIcon: $('btn-sound-icon'),
      toasts: $('toasts'),
      soundDialog: $('sound-dialog'),
      soundClose: $('sound-close'),
      sndMute: $('snd-mute'),
      sndSfx: $('snd-sfx'),
      sndSfxOut: $('snd-sfx-out'),
      sndMusicOn: $('snd-music-on'),
      sndMusic: $('snd-music'),
      sndMusicOut: $('snd-music-out'),
      sndVoiceOn: $('snd-voice-on'),
      sndVoice: $('snd-voice'),
      sndVoiceOut: $('snd-voice-out'),
      sndLang: $('snd-lang'),
      sndTest: $('snd-test'),
      sndNote: $('snd-voice-note'),
    };

    const saved = storage.read(CHIP_KEY, null);
    if (DENOMINATIONS.includes(saved)) this.#selected = saved;

    this.#shown = { balance: wallet.balance, inPlay: wallet.inPlay };
    this.#dom.balance.textContent = formatChips(wallet.balance);
    this.#dom.inPlay.textContent = formatChips(wallet.inPlay);

    wallet.addEventListener('change', () => this.#onWalletChange());
    this.#dom.sound.addEventListener('click', () => this.#openSound());
    this.#dom.soundDialog.addEventListener('click', (event) => {
      if (event.target === this.#dom.soundDialog) this.#dom.soundDialog.close();
    });
    this.#dom.soundClose.addEventListener('click', () => this.#dom.soundDialog.close());
    this.#bindSound();
    this.#renderSound();
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

  // ---------- Sonido y voz ----------

  #openSound() {
    audio.unlock();
    this.#renderSound();
    if (!this.#dom.soundDialog.open) this.#dom.soundDialog.showModal();
  }

  #bindSound() {
    const d = this.#dom;
    const percent = (input) => Number(input.value) / 100;
    d.sndMute.addEventListener('change', () => audio.update({ muted: d.sndMute.checked }));
    d.sndSfx.addEventListener('input', () => audio.update({ sfx: percent(d.sndSfx) }));
    d.sndSfx.addEventListener('change', () => audio.chip());
    d.sndMusicOn.addEventListener('change', () => audio.update({ musicOn: d.sndMusicOn.checked }));
    d.sndMusic.addEventListener('input', () => audio.update({ music: percent(d.sndMusic) }));
    d.sndVoiceOn.addEventListener('change', () => audio.update({ voiceOn: d.sndVoiceOn.checked }));
    d.sndVoice.addEventListener('input', () => audio.update({ voice: percent(d.sndVoice) }));
    d.sndLang.addEventListener('change', () => audio.update({ lang: d.sndLang.value }));
    d.sndTest.addEventListener('click', () => {
      audio.unlock();
      if (!audio.say('test', {}, { interrupt: true })) {
        this.toast(audio.voice.supported ? 'Activa la voz y el sonido para escucharla' : 'Tu navegador no admite síntesis de voz', 'warn');
      }
    });
    audio.addEventListener('change', () => this.#renderSound());
  }

  #renderSound() {
    const d = this.#dom;
    const s = audio.settings;
    const on = !s.muted;
    d.sound.setAttribute('aria-label', on ? 'Sonido y voz (activado)' : 'Sonido y voz (silenciado)');
    d.sound.classList.toggle('is-muted', !on);
    d.soundIcon.setAttribute('href', on ? '#icon-sound-on' : '#icon-sound-off');
    d.sndMute.checked = s.muted;
    d.sndSfx.value = String(Math.round(s.sfx * 100));
    d.sndSfxOut.textContent = `${Math.round(s.sfx * 100)}%`;
    d.sndMusicOn.checked = s.musicOn;
    d.sndMusic.value = String(Math.round(s.music * 100));
    d.sndMusicOut.textContent = `${Math.round(s.music * 100)}%`;
    d.sndMusic.disabled = !s.musicOn;
    d.sndVoiceOn.checked = s.voiceOn;
    d.sndVoice.value = String(Math.round(s.voice * 100));
    d.sndVoiceOut.textContent = `${Math.round(s.voice * 100)}%`;
    d.sndLang.value = s.lang;
    const voice = audio.voice.supported;
    d.sndVoiceOn.disabled = !voice;
    d.sndVoice.disabled = !voice || !s.voiceOn;
    d.sndLang.disabled = !voice;
    d.sndTest.disabled = !voice;
    d.sndNote.textContent = voice
      ? 'La voz usa las voces instaladas en tu dispositivo (Web Speech API).'
      : 'Este navegador no ofrece síntesis de voz: los anuncios se muestran solo en pantalla.';
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
