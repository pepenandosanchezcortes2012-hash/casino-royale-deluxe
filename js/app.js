// Inicializador maestro de Casino Royale Deluxe · The Syndicate Climb & Cyber-Fish Casino.
// Una sola partida: la escalada de 10 créditos a 10.000.000 por los 4 pisos del Sindicato. Aquí
// se conectan la escalada, la carrera (niveles y misiones), las reliquias, las 11 mesas, el
// router de pestañas (enlaces #juego, mesas bloqueadas según el piso), el temporizador de la
// abundancia (créditos por minuto de juego activo) y las preferencias de la interfaz.

import { storage } from './storage.js';
import { scopedKey } from './mode.js';
import { audio } from './audio.js';
import { bus } from './event_bus.js';
import { settings } from './settings.js';
import { ParticleSystem } from './particles.js';
import { wallet } from './engine/wallet.js';
import { session } from './session.js';
import { progression } from './progression.js';
import { relics, CHESTS } from './relics.js';
import { climb } from './climb/climb.js';
import { GAME_ORDER } from './climb/floors.js';
import { hud, formatChips } from './ui/hud.js';
import { climbUi } from './ui/climb-ui.js';
import { cyberHud } from './ui/cyber-hud.js';
import { telemetry } from './ui/telemetry.js';
import { terminalUi } from './ui/terminal-ui.js';
import { vaultUi } from './ui/vault-ui.js';
import { MatrixRain } from './ui/matrix.js';
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
import { FishGame } from './games/fish.js';

export const APP_STATES = Object.freeze({ BOOT: 'boot', CLIMB: 'climb' });

// Abundancia: créditos gratis por cada minuto con la pestaña visible y al menos una ronda con la
// apuesta mínima de tu piso más alto (× la escala de ese piso).
export const ABUNDANCE_MS = 60_000;
export const ABUNDANCE_BASE = 50;

const root = document.documentElement;

// ---------- Router de pestañas ----------

// Las mesas de pisos superiores al actual aparecen bloqueadas (con el piso en que se abren).
function setupTabs(games) {
  const key = scopedKey('crd.tab.v1');
  const tabs = GAME_ORDER.map((game) => document.getElementById(`tab-${game}`)).filter((tab) => tab && tab.dataset.game in games);
  let active = null;
  const locked = (name) => climbUi.gameLocked(name);
  const firstOpen = () => tabs.find((tab) => !locked(tab.dataset.game))?.dataset.game ?? 'mines';

  const activate = (name, { focus = false, quiet = false } = {}) => {
    if (!(name in games) || name === active) return;
    if (locked(name)) {
      if (!quiet) hud.toast(climbUi.lockedMessage(name), 'warn', 3600);
      return;
    }
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

  // Candados según el piso; si la mesa activa deja de estar disponible, se abre otra.
  const refresh = () => {
    for (const tab of tabs) {
      const isLocked = locked(tab.dataset.game);
      tab.classList.toggle('is-locked', isLocked);
      tab.setAttribute('aria-disabled', String(isLocked));
      tab.title = isLocked ? climbUi.lockedMessage(tab.dataset.game) : '';
    }
    if (!active || locked(active)) {
      if (active) {
        games[active].onHide();
        active = null;
      }
      activate(firstOpen(), { quiet: true });
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      audio.click();
      activate(tab.dataset.game);
    });
    tab.addEventListener('keydown', (event) => {
      const moves = { ArrowRight: 1, ArrowLeft: -1 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      // Las flechas recorren solo las mesas abiertas del piso.
      for (let step = 1; step <= tabs.length; step++) {
        const next = tabs[(index + moves[event.key] * step + tabs.length * 2) % tabs.length];
        if (!locked(next.dataset.game)) {
          activate(next.dataset.game, { focus: true });
          break;
        }
      }
    });
  });

  // Enlaces directos: index.html#plinko abre esa mesa (si el piso la tiene).
  window.addEventListener('hashchange', () => activate(decodeURIComponent(location.hash.slice(1))));
  const fromHash = decodeURIComponent(location.hash.slice(1));
  const saved = storage.read(key, 'mines');
  const pick = [fromHash, saved].find((name) => name in games && !locked(name)) ?? firstOpen();
  for (const tab of tabs) document.getElementById(tab.getAttribute('aria-controls')).hidden = true;
  refresh();
  activate(pick, { quiet: true });
  return {
    activate,
    refresh,
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

// Temporizador pausable: solo cuenta el tiempo con la pestaña visible y reparte cada ABUNDANCE_MS
// (ABUNDANCE_BASE + extra del rango VIP + Reloj de la Abundancia) × escala del piso desbloqueado,
// siempre que en ese minuto hayas jugado al menos una ronda con la apuesta mínima de ese piso.
class AbundanceTimer {
  #remaining = ABUNDANCE_MS;
  #startedAt = 0;
  #timer = 0;
  #bar = null;
  #active = false;

  start(bar) {
    this.#bar = bar;
    document.addEventListener('visibilitychange', () => (document.hidden ? this.#pause() : this.#resume()));
    bus.on('round:end', (round) => {
      if (round.stake > 0 && round.stake + 1e-9 >= climb.unlockedFloor.minBet) this.#mark(true);
    });
    this.#mark(false);
    this.#resume();
  }

  #mark(active) {
    this.#active = active;
    this.#bar?.closest('.abundance-track')?.classList.toggle('is-idle', !active);
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
    if (this.#active && climb.playable) {
      const scale = climb.unlockedFloor.scale;
      const amount = Math.round((ABUNDANCE_BASE + progression.rank.abundance + relics.abundanceBonus()) * scale * 100) / 100;
      wallet.grant(amount, 'abundance');
      cyberHud.floatBalance(`+${formatChips(amount)} ⏳`);
      audio.abundance();
      bus.emit('abundance', { amount });
    }
    this.#mark(false);
    this.#resume();
  }
}

// ---------- Aplicación ----------

class App {
  #state = APP_STATES.BOOT;
  #games = {};
  #tabs = null;
  #fx = null;
  #matrix = null;

  get state() {
    return this.#state;
  }

  get tabs() {
    return this.#tabs;
  }

  start() {
    // La escalada se crea antes que las mesas: una escalada nueva reinicia el monedero y las
    // mesas todavía no deben estar escuchando sus cambios.
    void climb.status;
    wallet.setGuard((game) => session.available(game));
    this.#applySettings();
    settings.addEventListener('change', () => this.#applySettings());
    this.#fx = new ParticleSystem(document.getElementById('fx-canvas'));
    hud.init({ fx: this.#fx });
    setupAudioUnlock();

    progression.attach(bus, {
      xpMultiplier: () => relics.xpMultiplier(),
      scale: () => climb.unlockedFloor.scale,
      minStake: () => climb.unlockedFloor.minBet,
      games: () => climb.unlockedFloor.games,
    });
    relics.attach(bus, { wallet, scale: () => climb.unlockedFloor.scale, minBet: () => climb.floor.minBet });
    this.#rewards();

    this.#games = {
      mines: new MinesGame(document.getElementById('panel-mines')),
      dice: new DiceGame(document.getElementById('panel-dice')),
      towers: new TowersGame(document.getElementById('panel-towers')),
      fish: new FishGame(document.getElementById('panel-fish')),
      plinko: new PlinkoGame(document.getElementById('panel-plinko')),
      slots: new SlotsGame(document.getElementById('panel-slots')),
      crash: new CrashGame(document.getElementById('panel-crash')),
      roulette: new RouletteGame(document.getElementById('panel-roulette')),
      video_poker: new VideoPokerGame(document.getElementById('panel-video_poker')),
      blackjack: new BlackjackGame(document.getElementById('panel-blackjack')),
      wheel: new WheelGame(document.getElementById('panel-wheel')),
    };

    this.#matrix = new MatrixRain(document.getElementById('matrix-canvas'), { settings });
    this.#matrix.start();
    climbUi.init({ games: this.#games, onApply: () => this.#onFloor() });
    this.#tabs = setupTabs(this.#games);
    cyberHud.init({ onTerminal: () => terminalUi.toggle(), onVault: () => vaultUi.open(), minStake: () => climb.unlockedFloor.minBet });
    telemetry.init();
    vaultUi.init();
    terminalUi.init({ telemetry, travel: (id) => climbUi.travel(id), takeRescue: () => climbUi.takeRescue() });
    new AbundanceTimer().start(document.getElementById('hud-abundance'));
    this.#shortcuts();
    this.#state = APP_STATES.CLIMB;
    root.dataset.app = APP_STATES.CLIMB;
    bus.emit('app:state', { state: APP_STATES.CLIMB });
    requestAnimationFrame(() => root.classList.add('is-ready'));
  }

  // Tema (automático: el del piso), turbo y scanlines.
  #applySettings() {
    const before = root.dataset.theme;
    root.dataset.theme = settings.resolveTheme(climb.floor.theme);
    root.classList.toggle('is-turbo', settings.turbo);
    root.classList.toggle('has-crt', settings.scanlines);
    if (before !== root.dataset.theme) this.#tint();
  }

  // Las chispas y la lluvia Matrix toman el color de acento del tema.
  #tint() {
    this.#fx?.setTint(getComputedStyle(root).getPropertyValue('--cy-accent').trim() || '#00ff66');
    this.#matrix?.refresh();
  }

  // Nuevo piso visible: tema, candados de las pestañas y textos de la carrera.
  #onFloor() {
    this.#applySettings();
    this.#tabs?.refresh();
    cyberHud.refresh();
  }

  // Recompensas de la carrera y de las reliquias: créditos al monedero y avisos en pantalla.
  #rewards() {
    const collect = () => {
      const amount = progression.collectChips();
      if (amount > 0) wallet.grant(amount, 'progress');
      return amount;
    };
    const waiting = collect();
    if (waiting > 0) setTimeout(() => hud.toast(`Recompensas acumuladas: +${formatChips(waiting)} créditos`, 'success', 4200), 600);
    bus.on('reward:chips', () => collect());
    progression.addEventListener('levelup', (event) => {
      const { level, chips, chest } = event.detail;
      const extra = chest ? ` y un ${CHESTS[chest].name.toLowerCase()}` : '';
      hud.toast(`¡Nivel ${level}! +${formatChips(chips)} créditos${extra}`, 'success', 4200);
      audio.levelUp();
      hud.celebrate(2);
    });
    progression.addEventListener('rankup', (event) => {
      hud.toast(`Nuevo rango VIP: ${event.detail.rank.name}`, 'success', 5200);
      hud.goldStorm(3);
    });
    progression.addEventListener('mission', (event) => {
      const { mission, done, total } = event.detail;
      hud.toast(`Misión completada (${done}/${total}): ${mission.text} · +${formatChips(mission.chips)} créditos`, 'success', 4200);
      audio.win(1);
    });
    progression.addEventListener('missions-complete', (event) => hud.toast(`¡Todas las misiones del día! Cofre común y +${formatChips(event.detail.chips)} créditos`, 'success', 5200));
    relics.addEventListener('bonus', (event) => {
      for (const bonus of event.detail.bonuses) hud.toast(`${bonus.name}: +${formatChips(bonus.amount)} créditos`, 'success', 2600);
      audio.shimmer();
    });
    relics.addEventListener('chest', (event) => {
      const { tier, reason } = event.detail;
      hud.toast(`${CHESTS[tier].name} a la bóveda${reason ? ` · ${reason}` : ''}`, 'info', 3600);
    });
    // Hitos de la escalada: un cofre por cada tarjeta de acceso (una sola vez) y otro legendario
    // por cada victoria.
    const FLOOR_CHESTS = { 2: 'common', 3: 'legendary', 4: 'legendary' };
    climb.addEventListener('unlock', (event) => {
      const { level, name } = event.detail.floor;
      if (FLOOR_CHESTS[level]) relics.claimReward(`floor-${level}`, FLOOR_CHESTS[level], `Tarjeta de ${name}`);
    });
    climb.addEventListener('status', (event) => {
      if (event.detail.status === 'victory') relics.claimReward(`victory-${climb.state.run}`, 'legendary', 'Dueño del Sindicato');
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
