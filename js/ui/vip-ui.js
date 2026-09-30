// Club VIP en pantalla (recuperado de la v2): botón del HUD con rango y barra de XP, aviso de
// bono diario, diálogo con el bono, los rescates, la escalera de rangos y la tienda de
// tapetes, y la celebración de cada ascenso. La lógica vive en engine/vip.js y en la campaña.

import { vip, RANKS, FELTS } from '../engine/vip.js';
import { wallet } from '../engine/wallet.js';
import { audio } from '../engine/audio.js';
import { campaign } from '../story/campaign.js';
import { hud, formatChips } from './hud.js';
import { el, svg, useRef } from './svg.js';

const MAX_TIMEOUT = 2 ** 31 - 1;

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

class VipUi {
  #dom = null;
  #dailyTimer = 0;
  #badgeTimer = 0;

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      root: document.documentElement,
      button: $('btn-vip'),
      rankName: $('hud-rank'),
      xpFill: $('hud-xp-fill'),
      badge: $('hud-vip-badge'),
      dialog: $('vip-dialog'),
      close: $('vip-close'),
      status: $('vip-status'),
      daily: $('vip-daily'),
      ranks: $('vip-ranks'),
      list: $('vip-list'),
    };
    const d = this.#dom;
    d.button.addEventListener('click', () => this.open());
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.dialog.addEventListener('close', () => clearTimeout(this.#dailyTimer));
    vip.addEventListener('change', () => this.#refresh());
    wallet.addEventListener('change', () => {
      if (d.dialog.open) this.#renderShop();
    });
    campaign.addEventListener('rankup', (event) => this.#onRankUp(event.detail));
    campaign.addEventListener('status', () => this.#refresh());
    this.#applyFelt();
    this.#renderButton();
    this.#scheduleBadge();
  }

  open() {
    this.#render();
    if (!this.#dom.dialog.open) this.#dom.dialog.showModal();
  }

  #refresh() {
    this.#applyFelt();
    this.#renderButton();
    this.#scheduleBadge();
    if (this.#dom.dialog.open) this.#render();
  }

  // El tapete elegido sustituye al de la zona («zone» deja el de cada zona).
  #applyFelt() {
    const felt = vip.felt;
    if (felt === 'zone') delete this.#dom.root.dataset.felt;
    else this.#dom.root.dataset.felt = felt;
  }

  #renderButton() {
    const d = this.#dom;
    const { rank, next, xp, ratio } = vip.rankProgress();
    const bonus = campaign.lifelines().daily.available;
    d.button.dataset.rank = rank.id;
    d.rankName.textContent = rank.name;
    d.xpFill.style.transform = `scaleX(${ratio})`;
    d.badge.hidden = !bonus;
    const tail = next ? `, ${formatChips(xp)} de ${formatChips(next.xp)} XP para ${next.name}` : `, ${formatChips(xp)} XP`;
    d.button.setAttribute('aria-label', `Club VIP: rango ${rank.name}${tail}${bonus ? '. Bono diario disponible' : ''}`);
  }

  // El bono diario se renueva a medianoche: el aviso del botón vuelve a aparecer solo.
  #scheduleBadge() {
    clearTimeout(this.#badgeTimer);
    const status = vip.dailyStatus();
    if (status.available) return;
    const wait = Math.min(MAX_TIMEOUT, Math.max(1000, status.nextAt - Date.now() + 500));
    this.#badgeTimer = setTimeout(() => this.#refresh(), wait);
  }

  #onRankUp({ rank }) {
    audio.win(3);
    hud.toast(`¡Nuevo rango VIP: ${rank.name}! Bono diario de ${formatChips(rank.daily)} y ${rank.rescues} rescates de ${formatChips(rank.rescue)} por leyenda`, 'success', 5600);
    const button = this.#dom.button;
    const rect = button.getBoundingClientRect();
    if (rect.width) hud.celebrate(2, { x: rect.left + rect.width / 2, y: rect.bottom });
    button.classList.remove('is-rankup');
    void button.offsetWidth;
    button.classList.add('is-rankup');
  }

  // ---------- Diálogo ----------

  #render() {
    const { rank, next, xp, ratio, missing, index } = vip.rankProgress();

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
    this.#dom.status.replaceChildren(
      status,
      el('p', 'vip-note', 'Ganas 1 XP por cada crédito apostado en cualquier mesa. Tu rango, tus tapetes y el bono diario se conservan aunque reinicies la leyenda.'),
    );

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
        el('span', 'rank-row-perk', `Rescate ${formatChips(item.rescue)} ×${item.rescues}`),
        el('span', 'rank-row-perk', `Diario ${formatChips(item.daily)}`),
      );
      return row;
    });
    this.#dom.ranks.replaceChildren(...ladder);

    this.#renderShop();
  }

  #renderDaily() {
    clearTimeout(this.#dailyTimer);
    const life = campaign.lifelines();
    const status = vip.dailyStatus();
    const card = el('div', 'vip-daily-card');
    const text = el('div', 'vip-daily-text');
    text.append(el('strong', '', 'Bono diario'), el('span', '', `+${formatChips(status.amount)} créditos (rango ${vip.rank.name})`));
    const button = el('button', 'btn btn-gold');
    button.type = 'button';
    if (life.daily.available) {
      button.textContent = 'Reclamar';
      button.addEventListener('click', () => this.#claimDaily(button));
    } else if (status.available) {
      button.disabled = true;
      button.textContent = 'Disponible durante la leyenda';
    } else {
      button.disabled = true;
      button.textContent = `Vuelve en ${clock(status.nextAt - Date.now())}`;
      if (this.#dom.dialog.open) this.#dailyTimer = setTimeout(() => this.#renderDaily(), 1000);
    }
    card.append(text, button);
    const rescue = life.rescue;
    const note = el('p', 'vip-rescue-note', `Rescates VIP en esta leyenda: ${rescue.left} de ${rescue.total}, de ${formatChips(rescue.amount)} créditos cada uno. Se usan cuando te quedas sin créditos.`);
    this.#dom.daily.replaceChildren(card, note);
  }

  #claimDaily(button) {
    const rect = button.getBoundingClientRect();
    if (campaign.claimDaily() <= 0) return;
    if (rect.width) hud.celebrate(2, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
  }

  #renderShop() {
    const playable = campaign.playable;
    const items = FELTS.map((felt) => {
      const card = el('article', 'vip-item');
      const active = felt.id === vip.felt;
      if (active) card.classList.add('is-active');
      const swatch = el('div', 'vip-swatch');
      if (felt.swatch) swatch.style.background = `radial-gradient(circle at 50% 40%, ${felt.swatch[0]}, ${felt.swatch[1]})`;
      else swatch.classList.add('vip-swatch-zone');
      const price = felt.id === 'zone' ? 'Cambia con la zona' : felt.price === 0 ? 'Incluido' : `${formatChips(felt.price)} créditos`;
      const button = el('button', 'btn');
      button.type = 'button';
      if (active) {
        button.textContent = 'En uso';
        button.disabled = true;
      } else if (vip.owns(felt.id)) {
        button.textContent = 'Equipar';
      } else {
        button.textContent = 'Comprar';
        button.classList.add('btn-gold');
        button.disabled = !playable || !wallet.canAfford(felt.price);
      }
      button.addEventListener('click', () => this.#equip(felt));
      card.append(swatch, el('h4', 'vip-name', felt.name), el('p', 'vip-price', price), button);
      return card;
    });
    this.#dom.list.replaceChildren(...items);
  }

  #equip(felt) {
    const result = campaign.buyFelt(felt.id);
    if (!result.ok) {
      if (result.reason === 'funds') hud.toast(`Necesitas ${formatChips(felt.price)} créditos para ${felt.name}`, 'warn');
      else if (result.reason === 'pending') hud.toast('Termina las apuestas en curso antes de cambiar el tapete', 'warn');
      else hud.toast('Los tapetes se compran durante una leyenda', 'warn');
      return;
    }
    audio.chip();
    if (result.bought) {
      audio.win(1);
      hud.toast(`¡${felt.name} desbloqueado!`, 'success');
    }
    this.#renderShop();
  }
}

export const vipUi = new VipUi();
