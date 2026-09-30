// Inicializador maestro de Casino Royale Deluxe · Cyber-Ultra.
// Máquina de estados de la aplicación: arranque → menú principal | Modo Historia | Cripto-Casino
// → salida (cambiar de modo recarga la página para que cada modo arranque con su monedero y sus
// datos). Aquí viven también el router de pestañas (enlaces #juego), el temporizador de la
// abundancia (fichas extra cada minuto con la pestaña visible) y el modo turbo.

import { MODE, chooseMode, leaveMode, scopedKey } from './mode.js';
import { storage } from './storage.js';
import { audio } from './audio.js';
import { bus } from './event_bus.js';
import { settings } from './settings.js';
import { ParticleSystem } from './particles.js';
import { wallet } from './engine/wallet.js';
import { session, RESCUE_AMOUNT } from './session.js';
import { progression } from './progression.js';
import { relics, CHESTS } from './relics.js';
import { campaign } from './story/campaign.js';
import { hud, formatChips } from './ui/hud.js';
import { storyUi } from './ui/story-ui.js';
import { vipUi } from './ui/vip-ui.js';
import { mainMenu } from './ui/menu.js';
import { cyberHud } from './ui/cyber-hud.js';
import { telemetry } from './ui/telemetry.js';
import { terminalUi } from './ui/terminal-ui.js';
import { vaultUi } from './ui/vault-ui.js';
import { MatrixRain } from './ui/matrix.js';
import { el } from './ui/svg.js';
import { BlackjackGame } from './games/blackjack.js';
import { RouletteGame } from './games/roulette.js';
import { SlotsGame } from './games/slots.js';
import { PlinkoGame } from './games/plinko.js';
import { CrashGame } from './games/crash.js';
import { MinesGame } from './games/mines.js';
import { DiceGame } from './games/dice.js';
import { TowersGame } from './games/towers.js';
import { VideoPokerGame } from './games/video_poker.js';
import { WheelGame } from './games/wheel.js';

export const APP_STATES = Object.freeze({ BOOT: 'boot', MENU: 'menu', STORY: 'story', FREE: 'free', LEAVING: 'leaving' });
const TRANSITIONS = Object.freeze({
  boot: Object.freeze(['menu', 'story', 'free']),
  menu: Object.freeze(['leaving']),
  story: Object.freeze(['leaving']),
  free: Object.freeze(['leaving']),
  leaving: Object.freeze([]),
});

// Abundancia: fichas gratis por cada minuto de juego con la pestaña visible.
export const ABUNDANCE_MS = 60_000;
export const ABUNDANCE_BASE = 50;

const root = document.documentElement;

// ---------- Router de pestañas ----------

function setupTabs(games) {
  const key = scopedKey('crd.tab.v1');
  const tabs = [...document.querySelectorAll('[role="tab"]')].filter((tab) => tab.dataset.game in games);
  let active = null;

  const activate = (name, { focus = false } = {}) => {
    if (!(name in games) || name === active) return;
    if (active) games[active].onHide();
    for (const tab of tabs) {
      const selected = tab.dataset.game === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected) {
        if (focus) tab.focus();
        tab.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      }
    }
    active = name;
    storage.write(key, name);
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    games[name].onShow();
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      audio.click();
      activate(tab.dataset.game);
    });
    tab.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      const next = tabs[(moves[event.key] + tabs.length) % tabs.length];
      activate(next.dataset.game, { focus: true });
    });
  });

  // Enlaces directos: index.html#plinko abre esa mesa.
  window.addEventListener('hashchange', () => activate(decodeURIComponent(location.hash.slice(1))));
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const saved = storage.read(key, 'blackjack');
  activate(fromHash in games ? fromHash : saved in games ? saved : 'blackjack');
  return {
    activate,
    get active() {
      return active;
    },
  };
}

// El AudioContext (efectos y música de fondo) solo puede arrancar tras un gesto del usuario.
function setupAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend'];
  const unlock = () => {
    audio.unlock();
    if (audio.unlocked) events.forEach((type) => window.removeEventListener(type, unlock, true));
  };
  events.forEach((type) => window.addEventListener(type, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
}

// ---------- Abundancia ----------

// Temporizador pausable: solo cuenta el tiempo con la pestaña visible y reparte ABUNDANCE_BASE
// fichas (más el extra del rango VIP y del Reloj de la Abundancia) cada ABUNDANCE_MS.
class AbundanceTimer {
  #remaining = ABUNDANCE_MS;
  #startedAt = 0;
  #timer = 0;
  #bar = null;

  start(bar) {
    this.#bar = bar;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.#pause() : this.#resume()));
    this.#resume();
  }

  #progress() {
    return 1 - this.#remaining / ABUNDANCE_MS;
  }

  // La barra se anima con una transición de transform (la resuelve el compositor).
  #paint(from, duration) {
    const bar = this.#bar;
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.transform = `scaleX(${from})`;
    if (duration > 0) {
      void bar.offsetWidth;
      bar.style.transition = `transform ${duration}ms linear`;
      bar.style.transform = 'scaleX(1)';
    }
  }

  #resume() {
    if (document.hidden) return;
    clearTimeout(this.#timer);
    this.#startedAt = performance.now();
    this.#paint(this.#progress(), this.#remaining);
    this.#timer = setTimeout(() => this.#tick(), this.#remaining);
  }

  #pause() {
    clearTimeout(this.#timer);
    this.#remaining = Math.max(0, this.#remaining - (performance.now() - this.#startedAt));
    this.#paint(this.#progress(), 0);
  }

  #tick() {
    this.#remaining = ABUNDANCE_MS;
    const amount = ABUNDANCE_BASE + progression.rank.abundance + relics.abundanceBonus();
    wallet.grant(amount, 'abundance');
    cyberHud.floatBalance(`+${formatChips(amount)} ⏳`);
    audio.abundance();
    bus.emit('abundance', { amount });
    this.#resume();
  }
}

// ---------- Aplicación ----------

class App {
  #state = APP_STATES.BOOT;
  #games = {};
  #tabs = null;

  get state() {
    return this.#state;
  }

  get tabs() {
    return this.#tabs;
  }

  #go(next) {
    if (!TRANSITIONS[this.#state].includes(next)) throw new Error(`Transición ilegal ${this.#state} → ${next}`);
    this.#state = next;
    root.dataset.app = next;
    bus.emit('app:state', { state: next });
  }

  // Deja en el documento solo lo que pertenece al modo (data-only="story free menu").
  #prune(mode) {
    for (const node of document.querySelectorAll('[data-only]')) {
      if (!node.dataset.only.split(/\s+/).includes(mode)) node.remove();
    }
  }

  start() {
    const mode = MODE ?? APP_STATES.MENU;
    this.#prune(mode);
    root.dataset.mode = mode;
    if (mode === APP_STATES.MENU) this.#bootMenu();
    else if (mode === APP_STATES.STORY) this.#bootStory();
    else this.#bootFree();
    this.#go(mode);
    requestAnimationFrame(() => root.classList.add('is-ready'));
  }

  // Cambia de modo (o vuelve al menú con null) y recarga.
  switchMode(mode) {
    if (this.#state === APP_STATES.LEAVING) return;
    if (this.#state === APP_STATES.FREE && session.blocksExit()) {
      hud.toast('Retírate o espera a que termine la ronda de Crash antes de salir', 'warn');
      return;
    }
    if (mode) chooseMode(mode);
    else leaveMode();
    // El enlace #mesa pertenece al modo que se deja.
    history.replaceState(null, '', location.pathname + location.search);
    this.#go(APP_STATES.LEAVING);
    audio.click();
    location.reload();
  }

  #common() {
    const fx = new ParticleSystem(document.getElementById('fx-canvas'));
    hud.init({ fx });
    setupAudioUnlock();
    document.getElementById('btn-menu').addEventListener('click', () => this.switchMode(null));
    return fx;
  }

  // ---------- Menú principal ----------

  #bootMenu() {
    root.dataset.theme = settings.theme;
    root.classList.toggle('has-crt', settings.scanlines);
    document.querySelector('.skip-link')?.setAttribute('href', '#main-menu');
    new MatrixRain(document.getElementById('matrix-canvas'), { settings }).start();
    mainMenu.init({ onChoose: (mode) => this.switchMode(mode) });
  }

  // ---------- Modo Historia ----------

  #bootStory() {
    // La campaña se crea antes que las mesas: una leyenda nueva reinicia el monedero y las mesas
    // todavía no deben estar escuchando sus cambios (le preguntarían por la campaña a medio crear).
    void campaign.status;
    this.#common();
    this.#games = {
      blackjack: new BlackjackGame(document.getElementById('panel-blackjack')),
      roulette: new RouletteGame(document.getElementById('panel-roulette')),
      slots: new SlotsGame(document.getElementById('panel-slots')),
    };
    this.#tabs = setupTabs(this.#games);
    storyUi.init({ games: this.#games });
    vipUi.init();
    this.#fuseStory();
  }

  // La leyenda alimenta la carrera global: sus rondas suman XP (niveles y rangos VIP) y cada
  // logro deja un cofre de reliquias para el Cripto-Casino.
  #fuseStory() {
    progression.attach(bus, { xpMultiplier: () => 1 });
    relics.attach(bus);
    campaign.addEventListener('achievement', (event) => {
      const { achievement } = event.detail;
      if (relics.claimStoryReward(achievement.id)) hud.toast(`Cofre de reliquias para el Cripto-Casino por «${achievement.name}»`, 'success', 4200);
    });
    campaign.addEventListener('status', (event) => {
      if (event.detail.status !== 'victory') return;
      const legend = campaign.state?.legend ?? 1;
      if (relics.claimStoryReward(`freedom-${legend}`, 'legendary')) hud.toast('¡Libertad! Un cofre legendario te espera en el Cripto-Casino', 'success', 5200);
    });
    progression.addEventListener('levelup', (event) => {
      hud.toast(`Nivel global ${event.detail.level}: recompensas guardadas para el Cripto-Casino`, 'info', 3600);
    });
    const global = document.getElementById('dossier-global');
    const render = () => {
      const p = progression.progress();
      const chests = relics.chests;
      global?.replaceChildren(
        el('h3', 'modal-subtitle', 'Carrera global · Cripto-Casino'),
        el('p', 'dossier-global-text', `Nivel ${p.level} · rango ${p.rank.name}. Tus rondas de la leyenda suman XP y cada logro te da un cofre de reliquias para el Cripto-Casino.`),
        el('p', 'dossier-global-meta', `Cofres esperando: ${chests.common} comunes · ${chests.legendary} legendarios · Fichas guardadas: ${formatChips(progression.pendingChips)}`),
      );
    };
    progression.addEventListener('change', render);
    relics.addEventListener('change', render);
    render();
  }

  // ---------- Cripto-Casino ----------

  #bootFree() {
    root.removeAttribute('data-zone');
    this.#applySettings();
    settings.addEventListener('change', () => this.#applySettings());
    document.getElementById('hud-balance-label').textContent = 'Fichas';
    const fx = this.#common();
    // Las chispas toman el color de acento del tema.
    const tint = () => fx.setTint(getComputedStyle(root).getPropertyValue('--cy-accent').trim() || '#00ff66');
    tint();
    settings.addEventListener('change', (event) => {
      if (event.detail.key === 'theme') tint();
    });

    progression.attach(bus, { xpMultiplier: () => relics.xpMultiplier() });
    relics.attach(bus, { wallet });
    this.#rewards();
    session.enableRescue();

    this.#games = {
      blackjack: new BlackjackGame(document.getElementById('panel-blackjack')),
      roulette: new RouletteGame(document.getElementById('panel-roulette')),
      slots: new SlotsGame(document.getElementById('panel-slots')),
      plinko: new PlinkoGame(document.getElementById('panel-plinko')),
      crash: new CrashGame(document.getElementById('panel-crash')),
      mines: new MinesGame(document.getElementById('panel-mines')),
      dice: new DiceGame(document.getElementById('panel-dice')),
      towers: new TowersGame(document.getElementById('panel-towers')),
      video_poker: new VideoPokerGame(document.getElementById('panel-video_poker')),
      wheel: new WheelGame(document.getElementById('panel-wheel')),
    };
    this.#tabs = setupTabs(this.#games);

    new MatrixRain(document.getElementById('matrix-canvas'), { settings }).start();
    cyberHud.init({ onTerminal: () => terminalUi.toggle(), onVault: () => vaultUi.open() });
    telemetry.init();
    vaultUi.init();
    terminalUi.init({ telemetry });
    new AbundanceTimer().start(document.getElementById('hud-abundance'));
    this.#shortcuts();
  }

  #applySettings() {
    root.dataset.theme = settings.theme;
    root.classList.toggle('is-turbo', settings.turbo);
    root.classList.toggle('has-crt', settings.scanlines);
  }

  // Recompensas de progresión y reliquias: fichas al monedero y avisos en pantalla.
  #rewards() {
    const collect = () => {
      const amount = progression.collectChips();
      if (amount > 0) wallet.grant(amount, 'progress');
      return amount;
    };
    const waiting = collect();
    if (waiting > 0) setTimeout(() => hud.toast(`Recompensas acumuladas: +${formatChips(waiting)} fichas`, 'success', 4200), 600);
    bus.on('reward:chips', () => collect());
    bus.on('rescue', ({ amount }) => {
      hud.toast(`Fondo de rescate: el casino te presta +${formatChips(amount ?? RESCUE_AMOUNT)} fichas`, 'success', 4200);
      audio.win(1);
    });
    progression.addEventListener('levelup', (event) => {
      const { level, chips, chest } = event.detail;
      const extra = chest ? ` y un ${CHESTS[chest].name.toLowerCase()}` : '';
      hud.toast(`¡Nivel ${level}! +${formatChips(chips)} fichas${extra}`, 'success', 4200);
      audio.levelUp();
      hud.celebrate(2);
    });
    progression.addEventListener('rankup', (event) => {
      hud.toast(`Nuevo rango VIP: ${event.detail.rank.name}`, 'success', 5200);
      hud.goldStorm(3);
    });
    progression.addEventListener('mission', (event) => {
      const { mission, done, total } = event.detail;
      hud.toast(`Misión completada (${done}/${total}): ${mission.text} · +${formatChips(mission.chips)} fichas`, 'success', 4200);
      audio.win(1);
    });
    progression.addEventListener('missions-complete', () => hud.toast('¡Las 10 misiones del día! Cofre común y +1.000 fichas', 'success', 5200));
    relics.addEventListener('bonus', (event) => {
      for (const bonus of event.detail.bonuses) hud.toast(`${bonus.name}: +${formatChips(bonus.amount)} fichas`, 'success', 2600);
      audio.shimmer();
    });
    relics.addEventListener('chest', (event) => {
      const { tier, reason } = event.detail;
      hud.toast(`${CHESTS[tier].name} a la bóveda${reason ? ` · ${reason}` : ''}`, 'info', 3600);
    });
  }

  // Atajo de la terminal: ~ (o la tecla º/` de la misma posición) fuera de los campos de texto.
  #shortcuts() {
    window.addEventListener('keydown', (event) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '~' || event.key === '`' || event.code === 'Backquote') {
        event.preventDefault();
        terminalUi.toggle();
      }
    });
  }
}

export const app = new App();
app.start();
