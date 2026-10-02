// Salón de la Fama estilo recreativa: los 10 mejores premios con las 3 iniciales de quien los
// consiguió. Vive en localStorage (permanente entre escaladas) y se puede exportar a JSON o
// restablecer. Una «partida destacada» es un premio neto de al menos HIGHLIGHT_BETS apuestas
// mínimas del piso y ×HIGHLIGHT_MULT o más (o una victoria contra el jefe) que además entra en la
// tabla.

import { storage as defaultStore } from '../storage.js';

export const HOF_KEY = 'crd.arcade.hof.v1';
export const HOF_SIZE = 10;
export const HIGHLIGHT_BETS = 25;
export const HIGHLIGHT_MULT = 5;
export const HOF_FORMAT = 'casino-royale-deluxe/hall-of-fame';
export const INITIALS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Tres caracteres A–Z / 0–9 (las tildes se quitan y lo demás pasa a «A»).
export function cleanInitials(value) {
  const plain = String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  return (plain + 'AAA').slice(0, 3);
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

export function normalizeHall(raw) {
  const list = Array.isArray(raw?.entries) ? raw.entries : Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && finite(e.score) && e.score > 0)
    .map((e) => ({
      initials: cleanInitials(e.initials),
      score: Math.round(e.score * 100) / 100,
      game: typeof e.game === 'string' ? e.game.slice(0, 24) : '',
      detail: typeof e.detail === 'string' ? e.detail.slice(0, 40) : '',
      t: finite(e.t) ? e.t : 0,
    }))
    .sort((a, b) => b.score - a.score || a.t - b.t)
    .slice(0, HOF_SIZE);
}

export class HallOfFame extends EventTarget {
  #store;
  #now;
  #entries;

  constructor({ store = defaultStore, now = () => Date.now() } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#entries = normalizeHall(store.read(HOF_KEY, null));
  }

  get entries() {
    return this.#entries.map((entry) => ({ ...entry }));
  }

  // ¿Entraría esta puntuación en la tabla?
  qualifies(score) {
    if (!finite(score) || score <= 0) return false;
    return this.#entries.length < HOF_SIZE || score > this.#entries[this.#entries.length - 1].score;
  }

  // Partida destacada: premio grande para el piso, multiplicador alto y sitio en la tabla.
  isHighlight(net, minBet, multiplier = Infinity) {
    return finite(net) && net >= HIGHLIGHT_BETS * Math.max(1, minBet || 1) && multiplier >= HIGHLIGHT_MULT && this.qualifies(net);
  }

  // Añade una firma; devuelve su posición (1–10) o 0 si no entra.
  add({ initials, score, game = '', detail = '' }) {
    if (!this.qualifies(score)) return 0;
    const entry = { initials: cleanInitials(initials), score: Math.round(score * 100) / 100, game, detail, t: this.#now() };
    this.#entries = normalizeHall({ entries: [...this.#entries, entry] });
    this.#save();
    return this.#entries.findIndex((e) => e.t === entry.t && e.score === entry.score && e.initials === entry.initials) + 1;
  }

  // Copia de seguridad legible (para descargar como archivo .json).
  exportJson() {
    return JSON.stringify({ format: HOF_FORMAT, version: 1, exportedAt: new Date(this.#now()).toISOString(), entries: this.#entries }, null, 2);
  }

  reset() {
    this.#entries = [];
    this.#save();
  }

  #save() {
    this.#store.write(HOF_KEY, { entries: this.#entries });
    this.dispatchEvent(new Event('change'));
  }
}

export const hallOfFame = new HallOfFame();
