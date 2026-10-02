// Sala Arcade: el meta-juego que vive por encima de la escalada. Un diálogo con cinco secciones
// (Trofeos, Tienda, Récords, Diarios y Núcleo), los avisos flotantes de trofeos, la firma de
// iniciales del Salón de la Fama y la paleta retro de toda la página. También conecta los
// sistemas de js/arcade/ con el resto del juego: cada ronda que termina avanza trofeos y retos
// diarios y puede ser una partida destacada.

import { bus } from '../event_bus.js';
import { audio } from '../audio.js';
import { climb } from '../climb/climb.js';
import { relics } from '../relics.js';
import { wallet } from '../engine/wallet.js';
import { hud, formatChips } from './hud.js';
import { el, pixelIcon } from './svg.js';
import { trophies, TROPHIES } from '../arcade/trophies.js';
import { shop, SHOP_ITEMS } from '../arcade/shop.js';
import { hallOfFame, cleanInitials, INITIALS } from '../arcade/hall-of-fame.js';
import { daily, challengeById, localDay } from '../arcade/daily.js';
import { pwa } from '../arcade/pwa.js';
import { planeFrames } from './pixel-sprites.js';
import { storage } from '../storage.js';
import { session } from '../session.js';

const INITIALS_KEY = 'crd.arcade.initials.v1';
const GAME_NAMES = Object.freeze({
  mines: 'Minas', dice: 'Dados', towers: 'Torres', fish: 'Cyber-Fish', plinko: 'Plinko', slots: 'Slots', crash: 'Crash',
  roulette: 'Ruleta', video_poker: 'Video Póker', blackjack: 'Blackjack', wheel: 'Rueda', core: 'Núcleo',
});
const PALETTE_SWATCHES = Object.freeze({
  classic: ['#0b0d14', '#39ff88', '#ff3fd0', '#ffcf3a'],
  neon: ['#12002a', '#ff00c8', '#00f0ff', '#fff200'],
  amber: ['#120800', '#6a3a00', '#ffb000', '#ffe2a0'],
  gameboy: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
});
const dateFormat = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

class ArcadeHub {
  #dom = null;
  #tab = 'trophies';
  #candidate = null;
  #retry = 0;
  #pending = null;
  #letters = [0, 0, 0];
  #slot = 0;
  #resetArmed = 0;

  init() {
    const $ = (id) => document.getElementById(id);
    this.#dom = {
      open: $('btn-arcade'),
      dialog: $('arcade-dialog'),
      close: $('arcade-close'),
      tabs: [...document.querySelectorAll('.arcade-tab')],
      trophyGrid: $('trophy-grid'),
      trophySummary: $('trophy-summary'),
      planes: $('shop-planes'),
      palettes: $('shop-palettes'),
      hof: $('hof-list'),
      hofExport: $('hof-export'),
      hofReset: $('hof-reset'),
      hofStatus: $('hof-status'),
      dailyDate: $('daily-date'),
      dailyName: $('daily-name'),
      dailyText: $('daily-text'),
      dailyList: $('daily-list'),
      coreText: $('core-text'),
      coreEnter: $('core-enter'),
      pwaStatus: $('pwa-status'),
      pwaInstall: $('pwa-install'),
      initials: $('initials-dialog'),
      initialsText: $('initials-text'),
      initialsSave: $('initials-save'),
      initialsSkip: $('initials-skip'),
      chars: [...document.querySelectorAll('.initial-char')],
      toasts: $('trophy-toasts'),
    };
    daily.setLevelSource(() => climb.unlockedLevel);
    this.#applyPalette();
    this.#bindDialog();
    this.#bindInitials();
    this.#bindSystems();
    pwa.init();
    // Estado de partida ya guardado: victoria y reliquias reunidas cuentan para los trofeos.
    if (climb.status === 'victory') trophies.observe('victories', 1);
    trophies.observe('relics', relics.owned.length);
  }

  // ---------- Diálogo y pestañas ----------

  #bindDialog() {
    const d = this.#dom;
    d.open.addEventListener('click', () => this.open());
    d.close.addEventListener('click', () => d.dialog.close());
    d.dialog.addEventListener('click', (event) => {
      if (event.target === d.dialog) d.dialog.close();
    });
    d.tabs.forEach((tab, i) => {
      tab.addEventListener('click', () => this.#select(tab.dataset.tab));
      tab.addEventListener('keydown', (event) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = d.tabs[(i + step + d.tabs.length) % d.tabs.length];
        this.#select(next.dataset.tab);
        next.focus();
      });
    });
    d.hofExport.addEventListener('click', () => this.#exportHall());
    d.hofReset.addEventListener('click', () => this.#resetHall());
    d.coreEnter.addEventListener('click', () => {
      if (climb.status !== 'victory') return;
      d.dialog.close();
      document.dispatchEvent(new CustomEvent('core:open'));
    });
    d.pwaInstall.addEventListener('click', async () => {
      audio.click();
      if (await pwa.install()) hud.toast('App instalada: ya puedes jugar sin conexión', 'success', 4200);
      this.#renderCore();
    });
    // Tras cerrar cualquier diálogo, quizá toque firmar un récord pendiente.
    document.addEventListener('close', () => setTimeout(() => this.#nextInitials(), 250), true);
  }

  open(tab = this.#tab) {
    audio.click();
    this.#select(tab);
    if (!this.#dom.dialog.open) this.#dom.dialog.showModal();
  }

  #select(tab) {
    this.#tab = tab;
    for (const button of this.#dom.tabs) {
      const on = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(on));
      button.tabIndex = on ? 0 : -1;
      document.getElementById(button.getAttribute('aria-controls')).hidden = !on;
    }
    this.#render();
  }

  #render() {
    const view = { trophies: () => this.#renderTrophies(), shop: () => this.#renderShop(), scores: () => this.#renderHall(), daily: () => this.#renderDaily(), core: () => this.#renderCore() };
    view[this.#tab]?.();
  }

  // ---------- Trofeos ----------

  #renderTrophies() {
    const d = this.#dom;
    d.trophySummary.textContent = `${trophies.unlockedCount} de ${TROPHIES.length} trofeos. Son permanentes: no se pierden al empezar una nueva escalada.`;
    d.trophyGrid.replaceChildren(...TROPHIES.map((item) => {
      const p = trophies.progress(item.id);
      const li = el('li', `trophy trophy-${item.tier} ${p.unlocked ? 'is-unlocked' : 'is-locked'}`);
      const bar = el('span', 'trophy-track');
      const fill = el('span', 'trophy-fill');
      fill.style.width = `${Math.round(p.ratio * 100)}%`;
      bar.append(fill);
      const count = item.goal > 1 ? `${formatChips(Math.floor(p.value))} / ${formatChips(item.goal)}` : p.unlocked ? 'Conseguido' : 'Pendiente';
      li.append(
        pixelIcon(`medal-${item.tier}`, 'px-icon trophy-medal'),
        el('strong', 'trophy-name', item.name),
        el('span', 'trophy-desc', item.description),
        bar,
        el('span', 'trophy-count', p.unlocked ? `Conseguido · ${count}` : count),
      );
      li.setAttribute('aria-label', `${item.name}: ${item.description} ${p.unlocked ? 'Conseguido.' : `Progreso ${count}.`}`);
      return li;
    }));
  }

  // Aviso flotante en la esquina con la medalla.
  #trophyToast(item) {
    audio.reward(3);
    const toast = el('div', `trophy-toast trophy-${item.tier}`);
    toast.setAttribute('role', 'status');
    toast.append(pixelIcon(`medal-${item.tier}`, 'px-icon trophy-medal'), el('span', 'trophy-toast-kicker', 'Trofeo desbloqueado'), el('strong', 'trophy-name', item.name));
    this.#dom.toasts.append(toast);
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 400);
    }, 4600);
    if (this.#dom.dialog.open && this.#tab === 'trophies') this.#renderTrophies();
  }

  // ---------- Tienda ----------

  #renderShop() {
    const d = this.#dom;
    const card = (entry) => {
      const li = el('li', `shop-item${shop.equipped(entry.kind) === entry.id ? ' is-equipped' : ''}`);
      const preview = el('div', 'shop-preview');
      if (entry.kind === 'plane') {
        const art = planeFrames(entry.id)[0];
        const canvas = art.grid.toCanvas(art.palette, 3);
        canvas.className = 'shop-plane';
        preview.append(canvas);
      } else {
        for (const color of PALETTE_SWATCHES[entry.id]) {
          const swatch = el('span', 'shop-swatch');
          swatch.style.backgroundColor = color;
          preview.append(swatch);
        }
      }
      const owned = shop.owns(entry.id);
      const equipped = shop.equipped(entry.kind) === entry.id;
      const button = el('button', `btn btn-small${owned ? '' : ' btn-gold'}`, equipped ? 'Equipado' : owned ? 'Equipar' : `Comprar · ${formatChips(entry.price)}`);
      button.type = 'button';
      button.disabled = equipped || (!owned && !wallet.canAfford(entry.price));
      button.addEventListener('click', () => {
        if (owned) shop.equip(entry.id);
        else if (!shop.buy(entry.id, wallet)) {
          audio.error();
          hud.toast('Saldo insuficiente para este cosmético', 'warn', 3000);
        }
        this.#renderShop();
      });
      li.append(preview, el('strong', 'shop-name', entry.name), el('span', 'shop-desc', entry.description), button);
      return li;
    };
    d.planes.replaceChildren(...SHOP_ITEMS.filter((e) => e.kind === 'plane').map(card));
    d.palettes.replaceChildren(...SHOP_ITEMS.filter((e) => e.kind === 'palette').map(card));
  }

  #applyPalette() {
    const palette = shop.equipped('palette');
    if (palette === 'classic') delete document.documentElement.dataset.palette;
    else document.documentElement.dataset.palette = palette;
  }

  // ---------- Salón de la Fama ----------

  #renderHall() {
    const entries = hallOfFame.entries;
    const rows = entries.map((entry, i) => {
      const li = el('li', `hof-row${i < 3 ? ` hof-top-${i + 1}` : ''}`);
      li.append(
        el('span', 'hof-rank', `${String(i + 1).padStart(2, '0')}`),
        el('span', 'hof-initials', entry.initials),
        el('span', 'hof-score', formatChips(entry.score)),
        el('span', 'hof-game', `${GAME_NAMES[entry.game] ?? entry.game}${entry.detail ? ` · ${entry.detail}` : ''}`),
      );
      return li;
    });
    while (rows.length < 10) {
      const li = el('li', 'hof-row is-empty');
      li.append(el('span', 'hof-rank', String(rows.length + 1).padStart(2, '0')), el('span', 'hof-initials', '---'), el('span', 'hof-score', '0'), el('span', 'hof-game', ''));
      rows.push(li);
    }
    this.#dom.hof.replaceChildren(...rows);
  }

  #exportHall() {
    const blob = new Blob([hallOfFame.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = el('a');
    link.href = url;
    link.download = `salon-de-la-fama-${localDay(Date.now())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    this.#dom.hofStatus.textContent = 'Récords exportados como archivo JSON.';
    audio.click();
  }

  // Restablecer pide una segunda pulsación en 4 s (sin diálogos del navegador).
  #resetHall() {
    const d = this.#dom;
    if (!this.#resetArmed) {
      this.#resetArmed = setTimeout(() => {
        this.#resetArmed = 0;
        d.hofReset.textContent = 'Restablecer';
      }, 4000);
      d.hofReset.textContent = '¿Seguro? Pulsa otra vez';
      audio.alert();
      return;
    }
    clearTimeout(this.#resetArmed);
    this.#resetArmed = 0;
    hallOfFame.reset();
    d.hofReset.textContent = 'Restablecer';
    d.hofStatus.textContent = 'Salón de la Fama vacío.';
    this.#renderHall();
  }

  // Récord pendiente de firmar: solo se guarda el mejor, y se pide en cuanto no hay ningún diálogo
  // abierto ni una jugada en curso (para no cortar la partida).
  queueInitials(entry) {
    if (!this.#candidate || entry.score > this.#candidate.score) this.#candidate = entry;
    this.#nextInitials();
  }

  #bindInitials() {
    const d = this.#dom;
    const saved = cleanInitials(storage.read(INITIALS_KEY, 'AAA'));
    this.#letters = [...saved].map((c) => INITIALS.indexOf(c));
    const paint = () => {
      d.chars.forEach((node, i) => {
        node.textContent = INITIALS[this.#letters[i]];
        node.classList.toggle('is-active', i === this.#slot);
      });
    };
    const move = (slot, step) => {
      this.#slot = slot;
      this.#letters[slot] = (this.#letters[slot] + step + INITIALS.length) % INITIALS.length;
      audio.click();
      paint();
    };
    for (const button of d.initials.querySelectorAll('[data-move]')) {
      button.addEventListener('click', () => move(Number(button.dataset.slot), button.dataset.move === 'up' ? 1 : -1));
    }
    d.initials.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        move(this.#slot, event.key === 'ArrowUp' ? 1 : -1);
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        this.#slot = (this.#slot + (event.key === 'ArrowRight' ? 1 : 2)) % 3;
        paint();
      } else if (/^[a-z0-9]$/i.test(event.key) && !event.ctrlKey && !event.metaKey) {
        this.#letters[this.#slot] = INITIALS.indexOf(event.key.toUpperCase());
        this.#slot = Math.min(2, this.#slot + 1);
        audio.click();
        paint();
      } else if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
        event.preventDefault();
        d.initialsSave.click();
      }
    });
    d.initialsSave.addEventListener('click', () => {
      const initials = this.#letters.map((i) => INITIALS[i]).join('');
      storage.write(INITIALS_KEY, initials);
      const entry = this.#pending;
      this.#pending = null;
      d.initials.close();
      if (!entry) return;
      const rank = hallOfFame.add({ ...entry, initials });
      if (rank) {
        audio.coin();
        trophies.bump('signatures');
        hud.toast(`${initials} entra en el Salón de la Fama: puesto ${rank}`, 'success', 4200);
      }
    });
    d.initialsSkip.addEventListener('click', () => {
      this.#pending = null;
      d.initials.close();
    });
    d.initials.addEventListener('cancel', () => {
      this.#pending = null;
    });
    this.paintInitials = paint;
  }

  #nextInitials() {
    clearTimeout(this.#retry);
    if (this.#pending || !this.#candidate) return;
    if (document.querySelector('dialog[open]') || session.hasPendingPlay()) {
      this.#retry = setTimeout(() => this.#nextInitials(), 3000);
      return;
    }
    const entry = this.#candidate;
    this.#candidate = null;
    if (!hallOfFame.qualifies(entry.score)) return;
    this.#pending = entry;
    this.#slot = 0;
    this.paintInitials?.();
    this.#dom.initialsText.textContent = `${formatChips(entry.score)} en ${GAME_NAMES[entry.game] ?? entry.game}${entry.detail ? ` (${entry.detail})` : ''}. Elige tus 3 iniciales para el Salón de la Fama.`;
    audio.fanfare();
    this.#dom.initials.showModal();
  }

  // ---------- Desafíos diarios ----------

  #renderDaily() {
    const d = this.#dom;
    const today = daily.today;
    const modifier = daily.modifier;
    d.dailyDate.textContent = `Hoy · ${dateFormat.format(new Date())}`;
    d.dailyName.textContent = modifier.name;
    d.dailyText.textContent = modifier.text;
    d.dailyList.replaceChildren(...today.challenges.map((entry) => {
      const def = challengeById(entry.id);
      const li = el('li', `daily-item${entry.done ? ' is-done' : ''}`);
      const bar = el('span', 'trophy-track');
      const fill = el('span', 'trophy-fill');
      fill.style.width = `${Math.round((entry.progress / def.goal) * 100)}%`;
      bar.append(fill);
      li.append(
        pixelIcon(entry.done ? 'px-star' : 'px-calendar', 'px-icon daily-icon'),
        el('strong', 'daily-text', def.text),
        bar,
        el('span', 'trophy-count', entry.done ? 'Completado · cofre común' : `${entry.progress} / ${def.goal}`),
      );
      return li;
    }));
  }

  // ---------- Núcleo y PWA ----------

  #renderCore() {
    const d = this.#dom;
    const open = climb.status === 'victory';
    d.coreText.textContent = open
      ? 'El ascensor baja más allá del Penthouse: la IA Central te espera en el Núcleo del Servidor. Combate de reflejos en 3 fases, sin apuesta. Vencerla da un trofeo, cofres legendarios y un récord.'
      : 'Piso 5 secreto. Se abre cuando reúnas 10.000.000 de créditos y tomes el control del Sindicato.';
    d.coreEnter.disabled = !open;
    d.pwaStatus.textContent = pwa.installed
      ? 'Estás jugando con la app instalada.'
      : pwa.offlineReady
        ? 'El juego ya está guardado en este equipo: funciona sin conexión.'
        : pwa.supported ? 'Preparando el modo sin conexión…' : 'El modo sin conexión necesita abrir el juego desde su web (https).';
    d.pwaInstall.hidden = !pwa.canInstall;
  }

  // ---------- Conexión con el juego ----------

  #bindSystems() {
    trophies.addEventListener('unlock', (event) => this.#trophyToast(event.detail.trophy));
    bus.on('round:end', (round) => {
      trophies.recordRound(round);
      daily.record(round);
      if (hallOfFame.isHighlight(round.net, round.minBet, round.multiplier)) {
        const detail = round.multiplier > 0 ? `×${String(Math.round(round.multiplier * 100) / 100).replace('.', ',')}` : '';
        // Con auto-juego en marcha se firma al terminar (la cola espera a que no haya diálogos).
        setTimeout(() => this.queueInitials({ score: round.net, game: round.game, detail }), 1200);
      }
    });
    climb.addEventListener('status', (event) => {
      if (event.detail.status === 'victory') trophies.bump('victories');
    });
    relics.addEventListener('open', () => trophies.observe('relics', relics.owned.length));
    shop.addEventListener('buy', (event) => {
      audio.coin();
      trophies.bump('purchases');
      hud.toast(`Comprado: ${event.detail.item.name}`, 'success', 3000);
    });
    shop.addEventListener('change', () => this.#applyPalette());
    daily.addEventListener('complete', (event) => {
      relics.addChest('common', 'Desafío diario');
      trophies.bump('dailyDone');
      audio.coin();
      hud.toast(`Desafío diario completado: ${event.detail.challenge.text}. +1 cofre común`, 'success', 4600);
      if (this.#dom.dialog.open && this.#tab === 'daily') this.#renderDaily();
    });
    daily.addEventListener('bonus', () => {
      relics.addChest('legendary', 'Los 3 desafíos del día');
      trophies.bump('dailyFull');
      hud.toast('¡Los 3 desafíos del día! +1 cofre legendario', 'success', 5200);
    });
    daily.addEventListener('change', () => {
      if (this.#dom.dialog.open && this.#tab === 'daily') this.#renderDaily();
    });
    pwa.addEventListener('change', () => {
      if (this.#dom.dialog.open && this.#tab === 'core') this.#renderCore();
    });
    pwa.addEventListener('update', () => hud.toast('Nueva versión descargada: recarga la página cuando termines la ronda', 'info', 6000));
    // Victoria contra el jefe (js/ui/boss-ui.js).
    document.addEventListener('core:won', (event) => {
      const { score, firstClear } = event.detail;
      trophies.bump('bosses');
      relics.addChest('legendary', 'Núcleo del Servidor');
      if (firstClear) relics.addChest('legendary', 'Primera victoria en el Núcleo');
      this.queueInitials({ score, game: 'core', detail: 'IA Central' });
    });
  }
}

export const arcadeHub = new ArcadeHub();
