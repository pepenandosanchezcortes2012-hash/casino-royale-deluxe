// Preferencias de la interfaz del Cripto-Casino: modo turbo, tema de color, lluvia Matrix y
// scanlines CRT. Se guardan juntas y avisan de cada cambio (evento `change`).
// El turbo solo acorta animaciones: nunca cambia una probabilidad ni un pago.

import { storage as defaultStore } from './storage.js';
import { isFree } from './mode.js';

export const SETTINGS_KEY = 'crd.settings.v1';
// El turbo divide por dos las duraciones de las animaciones (la ruleta, al 40 %).
export const TURBO_SPEED = 0.5;

export const THEMES = Object.freeze([
  Object.freeze({ id: 'matrix', name: 'Matrix Green', swatch: Object.freeze(['#00ff66', '#021a0b']) }),
  Object.freeze({ id: 'neon', name: 'Cyberpunk Neon', swatch: Object.freeze(['#ff2bd6', '#00e5ff']) }),
  Object.freeze({ id: 'onyx', name: 'Onyx', swatch: Object.freeze(['#e9edf2', '#101114']) }),
  Object.freeze({ id: 'gold', name: 'Gold Imperial', swatch: Object.freeze(['#f5c542', '#1d1404']) }),
  Object.freeze({ id: 'blood', name: 'Blood Red', swatch: Object.freeze(['#ff2a3d', '#1a0206']) }),
]);
export const themeById = (id) => THEMES.find((theme) => theme.id === id) ?? null;

const DEFAULTS = Object.freeze({ turbo: false, theme: 'matrix', matrix: true, scanlines: true });

function sanitize(raw) {
  const state = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return state;
  for (const key of ['turbo', 'matrix', 'scanlines']) if (typeof raw[key] === 'boolean') state[key] = raw[key];
  if (themeById(raw.theme)) state.theme = raw.theme;
  return state;
}

export class Settings extends EventTarget {
  #store;
  #s;
  #enabled;

  // `enabled`: el turbo solo existe en el Cripto-Casino (la leyenda conserva su ritmo narrativo).
  constructor({ store = defaultStore, enabled = isFree } = {}) {
    super();
    this.#store = store;
    this.#enabled = enabled;
    this.#s = sanitize(store.read(SETTINGS_KEY, null));
  }

  #set(key, value) {
    if (this.#s[key] === value) return false;
    this.#s[key] = value;
    this.#store.write(SETTINGS_KEY, this.#s);
    this.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
    return true;
  }

  get snapshot() {
    return { ...this.#s };
  }

  get turbo() {
    return this.#enabled && this.#s.turbo;
  }

  // Factor por el que se multiplican las duraciones de las animaciones.
  get speed() {
    return this.turbo ? TURBO_SPEED : 1;
  }

  setTurbo(on) {
    this.#set('turbo', Boolean(on));
    return this.turbo;
  }

  toggleTurbo() {
    return this.setTurbo(!this.#s.turbo);
  }

  get theme() {
    return this.#s.theme;
  }

  setTheme(id) {
    if (!themeById(id)) return false;
    this.#set('theme', id);
    return true;
  }

  get matrix() {
    return this.#s.matrix;
  }

  setMatrix(on) {
    this.#set('matrix', Boolean(on));
    return this.#s.matrix;
  }

  get scanlines() {
    return this.#s.scanlines;
  }

  setScanlines(on) {
    this.#set('scanlines', Boolean(on));
    return this.#s.scanlines;
  }
}

export const settings = new Settings();
