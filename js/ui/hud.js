// HUD: saldo, fichas en juego, racks de fichas, rango VIP y XP, rescate por bancarrota,
// bono diario, Club VIP (tapetes), panel de sonido y voz, avisos y efectos.

import { wallet, DENOMINATIONS, FELTS, MIN_BET, RANKS } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { storage } from '../engine/storage.js';
import { chipSvg, chipLabel, el, svg, useRef } from './svg.js';

const CHIP_KEY = 'crd.chip.v1';
const numberFormat = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

export function formatChips(value) {
  return numberFormat.format(value);
}

function clock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

function rankGem(rankId, className = 'rank-gem') {
  const gem = svg('svg', { viewBox: '0 0 100 100', class: className, 'aria-hidden': 'true', focusable: 'false' }, [useRef('gem', { width: 100, height: 100 })]);
  gem.dataset.rank = rankId;
  return gem;
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
  #dailyTimer = 0;

  init({ fx }) {
    this.#fx = fx;
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      balance: $('hud-balance'),
      inPlay: $('hud-inplay'),
      rescue: $('btn-rescue'),
      vip: $('btn-vip'),
      rankName: $('hud-rank'),
      xpFill: $('hud-xp-fill'),
      sound: $('btn-sound'),
      soundIcon: $('btn-sound-icon'),
      toasts: $('toasts'),
      vipDialog: $('vip-dialog'),
      vipClose: $('vip-close'),
      vipStatus: $('vip-status'),
      vipDaily: $('vip-daily'),
      vipRanks: $('vip-ranks'),
      vipList: $('vip-list'),
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
    wallet.addEventListener('rankup', (event) => this.#onRankUp(event.detail));
    this.#dom.rescue.addEventListener('click', () => this.#rescue());
    this.#dom.vip.addEventListener('click', () => this.openClub());
    this.#dom.sound.addEventListener('click', () => this.#openSound());

    for (const dialog of [this.#dom.vipDialog, this.#dom.soundDialog]) {
      dialog.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
      });
    }
    this.#dom.vipClose.addEventListener('click', () => this.#dom.vipDialog.close());
    this.#dom.vipDialog.addEventListener('close', () => clearTimeout(this.#dailyTimer));
    this.#dom.soundClose.addEventListener('click', () => this.#dom.soundDialog.close());
    this.#bindSound();

    document.documentElement.dataset.felt = wallet.felt;
    this.#renderRank();
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

  selectChip(value) {
    if (!DENOMINATIONS.includes(value)) return;
    this.#selected = value;
    storage.write(CHIP_KEY, value);
    audio.click();
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

  // ---------- Saldo y rango ----------

  #onWalletChange() {
    this.#animateNumbers();
    this.#renderRacks();
    this.#renderRescue();
    this.#renderRank();
    if (this.#dom.vipDialog.open) this.#renderClub();
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

  #renderRank() {
    const { rank, next, xp, ratio } = wallet.rankProgress();
    this.#dom.vip.dataset.rank = rank.id;
    this.#dom.rankName.textContent = rank.name;
    this.#dom.xpFill.style.transform = `scaleX(${ratio})`;
    const tail = next ? `, ${formatChips(xp)} de ${formatChips(next.xp)} XP para ${next.name}` : `, ${formatChips(xp)} XP`;
    this.#dom.vip.setAttribute('aria-label', `Club VIP: rango ${rank.name}${tail}`);
  }

  #onRankUp({ rank }) {
    audio.win(3);
    audio.say('rankUp', { rank: rank.id }, { interrupt: true });
    this.toast(`¡Nuevo rango VIP: ${rank.name}! Rescate +${formatChips(rank.rescue)} y bono diario +${formatChips(rank.daily)}`, 'success', 5200);
    const rect = this.#dom.vip.getBoundingClientRect();
    this.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height });
    this.#dom.vip.classList.remove('is-rankup');
    void this.#dom.vip.offsetWidth;
    this.#dom.vip.classList.add('is-rankup');
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
      button.textContent = `Rescate +${formatChips(status.amount)}`;
      button.classList.add('is-pulsing');
    } else {
      button.disabled = true;
      button.classList.remove('is-pulsing');
      button.textContent = `Rescate en ${clock(status.remaining)}`;
      this.#rescueTimer = setTimeout(() => this.#renderRescue(), 1000);
    }
  }

  #rescue() {
    const amount = wallet.rescue();
    if (amount > 0) {
      audio.chip();
      audio.win(1);
      this.toast(`Rescate ${wallet.rank.name} concedido: +${formatChips(amount)} fichas`, 'success');
      const rect = this.#dom.balance.getBoundingClientRect();
      this.celebrate(1, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    }
    this.#renderRescue();
  }

  // ---------- Club VIP ----------

  openClub() {
    this.#renderClub();
    if (!this.#dom.vipDialog.open) this.#dom.vipDialog.showModal();
  }

  #renderClub() {
    const { rank, next, xp, ratio, missing, index } = wallet.rankProgress();

    const status = el('div', 'vip-status-card');
    status.dataset.rank = rank.id;
    const info = el('div', 'vip-status-info');
    info.append(el('span', 'vip-status-label', 'Tu rango'), el('strong', 'vip-status-rank', rank.name));
    const bar = el('div', 'xp-bar-lg');
    const fill = el('span', 'xp-bar-fill');
    fill.style.transform = `scaleX(${ratio})`;
    bar.append(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-label', 'Progreso de XP');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '100');
    bar.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
    const detail = next
      ? `${formatChips(xp)} XP · faltan ${formatChips(missing)} XP para ${next.name}`
      : `${formatChips(xp)} XP · rango máximo alcanzado`;
    info.append(bar, el('span', 'vip-status-detail', detail));
    status.append(rankGem(rank.id, 'rank-gem rank-gem-lg'), info);
    this.#dom.vipStatus.replaceChildren(status, el('p', 'vip-note', 'Ganas 1 XP por cada ficha apostada en cualquier mesa.'));

    this.#renderDaily();

    const ladder = RANKS.map((item, i) => {
      const row = el('li', 'rank-row');
      if (i === index) row.classList.add('is-current');
      if (i < index) row.classList.add('is-done');
      const name = el('span', 'rank-row-name');
      name.append(rankGem(item.id), el('span', '', item.name));
      row.append(
        name,
        el('span', 'rank-row-xp', `${formatChips(item.xp)} XP`),
        el('span', 'rank-row-perk', `Rescate ${formatChips(item.rescue)}`),
        el('span', 'rank-row-perk', `Diario ${formatChips(item.daily)}`),
      );
      return row;
    });
    this.#dom.vipRanks.replaceChildren(...ladder);

    this.#renderShop();
  }

  #renderDaily() {
    clearTimeout(this.#dailyTimer);
    const status = wallet.dailyStatus();
    const card = el('div', 'vip-daily-card');
    const text = el('div', 'vip-daily-text');
    text.append(el('strong', '', 'Bono diario'), el('span', '', `+${formatChips(status.amount)} fichas (rango ${wallet.rank.name})`));
    const button = el('button', 'btn btn-gold');
    button.type = 'button';
    if (status.available) {
      button.textContent = 'Reclamar';
      button.addEventListener('click', () => this.#claimDaily());
    } else {
      button.disabled = true;
      button.textContent = `Vuelve en ${clock(status.nextAt - Date.now())}`;
      if (this.#dom.vipDialog.open) this.#dailyTimer = setTimeout(() => this.#renderDaily(), 1000);
    }
    card.append(text, button);
    this.#dom.vipDaily.replaceChildren(card);
  }

  #claimDaily() {
    const amount = wallet.claimDaily();
    if (amount <= 0) return;
    audio.chip();
    audio.win(2);
    this.toast(`Bono diario: +${formatChips(amount)} fichas`, 'success');
    const rect = this.#dom.vipDaily.getBoundingClientRect();
    this.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  #renderShop() {
    const owned = wallet.owned;
    const items = FELTS.map((felt) => {
      const card = el('article', 'vip-item');
      if (felt.id === wallet.felt) card.classList.add('is-active');
      const swatch = el('div', 'vip-swatch');
      swatch.style.background = `radial-gradient(circle at 50% 40%, ${felt.swatch[0]}, ${felt.swatch[1]})`;
      const name = el('h4', 'vip-name', felt.name);
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
    this.#dom.vipList.replaceChildren(...items);
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

  minBetNotice() {
    this.toast(`La apuesta mínima es ${MIN_BET} fichas`, 'warn');
  }
}

export const hud = new Hud();
export { chipLabel };
