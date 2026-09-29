// Inicializador maestro: HUD, mesas, pestañas accesibles y desbloqueo de audio.

import { audio } from './engine/audio.js';
import { storage } from './engine/storage.js';
import { ParticleSystem } from './engine/particles.js';
import { hud } from './ui/hud.js';
import { BlackjackGame } from './games/blackjack.js';
import { RouletteGame } from './games/roulette.js';
import { SlotsGame } from './games/slots.js';

const TAB_KEY = 'crd.tab.v1';

// El AudioContext (efectos y música lounge) solo puede arrancar tras un gesto del usuario.
function setupAudioUnlock() {
  const events = ['pointerdown', 'keydown', 'touchend'];
  const unlock = () => {
    audio.unlock();
    if (audio.unlocked) events.forEach((type) => window.removeEventListener(type, unlock, true));
  };
  events.forEach((type) => window.addEventListener(type, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => audio.setHidden(document.hidden));
}

function setupTabs(games) {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  let active = null;

  const activate = (name, { focus = false } = {}) => {
    if (!(name in games) || name === active) return;
    if (active) games[active].onHide();
    for (const tab of tabs) {
      const selected = tab.dataset.game === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      document.getElementById(tab.getAttribute('aria-controls')).hidden = !selected;
      if (selected && focus) tab.focus();
    }
    active = name;
    storage.write(TAB_KEY, name);
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

  const saved = storage.read(TAB_KEY, 'blackjack');
  activate(saved in games ? saved : 'blackjack');
}

function boot() {
  const fx = new ParticleSystem(document.getElementById('fx-canvas'));
  hud.init({ fx });
  const games = {
    blackjack: new BlackjackGame(document.getElementById('panel-blackjack')),
    roulette: new RouletteGame(document.getElementById('panel-roulette')),
    slots: new SlotsGame(document.getElementById('panel-slots')),
  };
  setupTabs(games);
  setupAudioUnlock();
  document.documentElement.classList.add('is-ready');
}

boot();
