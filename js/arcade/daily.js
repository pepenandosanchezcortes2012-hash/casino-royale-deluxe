// Desafíos diarios: cada día (fecha local del sistema) trae un modificador con nombre y tres retos.
// La elección es determinista a partir de la fecha (FNV-1a + mulberry32): el mismo día da los
// mismos retos en cualquier equipo con el mismo piso desbloqueado. Cada reto completado da un
// cofre común y completar los tres, un cofre legendario de bonificación.
// Los modificadores cambian el ambiente (turbulencias en Crash, marea alta en Cyber-Fish…) pero
// nunca las probabilidades: los resultados siguen siendo provably fair y verificables.

import { storage as defaultStore } from '../storage.js';

export const DAILY_KEY = 'crd.arcade.daily.v1';
export const DAILY_COUNT = 3;

const challenge = (id, text, goal, minFloor, measure) => Object.freeze({ id, text, goal, minFloor, measure });
const won = (r) => r.returned > r.stake;

// `measure(round)` devuelve cuánto avanza el reto con esa ronda (0 si nada).
export const CHALLENGES = Object.freeze([
  challenge('rounds', 'Juega 40 rondas en cualquier mesa', 40, 1, (r) => (r.stake > 0 ? 1 : 0)),
  challenge('wins', 'Gana 15 rondas en cualquier mesa', 15, 1, (r) => (r.stake > 0 && won(r) ? 1 : 0)),
  challenge('mines', 'Retírate con premio 3 veces en Minas', 3, 1, (r) => (r.game === 'mines' && won(r) ? 1 : 0)),
  challenge('dice', 'Gana 5 tiradas de dados', 5, 1, (r) => (r.game === 'dice' && won(r) ? 1 : 0)),
  challenge('towers', 'Sube 6 pisos en Torres (en total)', 6, 1, (r) => (r.game === 'towers' ? Math.max(0, r.safe ?? 0) : 0)),
  challenge('fish', 'Captura 25 criaturas en Cyber-Fish', 25, 2, (r) => (r.game === 'fish' ? Math.max(0, r.captures ?? 0) : 0)),
  challenge('plinko', 'Suelta 20 bolas en Plinko', 20, 2, (r) => (r.game === 'plinko' ? 1 : 0)),
  challenge('slots-clean', 'Gana 5 tiradas de slots sin comodines fijos', 5, 2, (r) => (r.game === 'slots' && won(r) && !(r.tags ?? []).includes('sticky') ? 1 : 0)),
  challenge('crash', 'Cobra 3 veces en Crash a ×2 o más', 3, 3, (r) => (r.game === 'crash' && r.stake > 0 && r.returned >= 2 * r.stake ? 1 : 0)),
  challenge('roulette', 'Juega 8 rondas de ruleta', 8, 3, (r) => (r.game === 'roulette' && r.stake > 0 ? 1 : 0)),
  challenge('poker', 'Consigue 3 manos premiadas en Video Póker', 3, 3, (r) => (r.game === 'video_poker' && r.returned > 0 ? 1 : 0)),
  challenge('blackjack', 'Gana 3 manos de blackjack', 3, 4, (r) => (r.game === 'blackjack' && won(r) ? 1 : 0)),
]);

export const challengeById = (id) => CHALLENGES.find((c) => c.id === id) ?? null;

// Modificadores del día: nombre, ambiente y reto destacado.
export const MODIFIERS = Object.freeze([
  Object.freeze({ id: 'turbulence', name: 'Día de Turbulencias', text: 'El avión de Crash cruza una tormenta: vibra y deja más estela.', featured: 'crash' }),
  Object.freeze({ id: 'high-tide', name: 'Marea Alta', text: 'El acuario de Cyber-Fish se llena de burbujas.', featured: 'fish' }),
  Object.freeze({ id: 'no-wilds', name: 'Cero Comodines', text: 'El Sindicato premia las tiradas limpias, sin comodines fijos.', featured: 'slots-clean' }),
  Object.freeze({ id: 'rush-hour', name: 'Hora Punta', text: 'Las mesas no paran: cuenta cada ronda.', featured: 'rounds' }),
  Object.freeze({ id: 'lucky-floor', name: 'Suelo de la Suerte', text: 'Las mesas del subsuelo vuelven a estar de moda.', featured: 'mines' }),
]);

export const modifierById = (id) => MODIFIERS.find((m) => m.id === id) ?? null;

export function localDay(time) {
  const date = new Date(time);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Modificador y retos de un día para quien tiene `level` pisos desbloqueados.
export function dailyFor(day, level = 1) {
  const rand = mulberry32(fnv1a(`crd-daily:${day}`));
  const modifier = MODIFIERS[Math.floor(rand() * MODIFIERS.length)];
  const open = CHALLENGES.filter((c) => c.minFloor <= level);
  const picked = [];
  const featured = challengeById(modifier.featured);
  if (featured && featured.minFloor <= level) picked.push(featured.id);
  const pool = open.filter((c) => !picked.includes(c.id));
  while (picked.length < DAILY_COUNT && pool.length) picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0].id);
  return { day, modifier: modifier.id, challenges: picked };
}

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.day !== 'string' || !modifierById(raw.modifier) || !Array.isArray(raw.challenges)) return null;
  const challenges = raw.challenges
    .filter((c) => c && challengeById(c.id))
    .slice(0, DAILY_COUNT)
    .map((c) => ({ id: c.id, progress: Math.max(0, Number(c.progress) || 0), done: c.done === true }));
  return { day: raw.day, modifier: raw.modifier, challenges, bonus: raw.bonus === true };
}

export class Daily extends EventTarget {
  #store;
  #now;
  #level;
  #s = null;

  constructor({ store = defaultStore, now = () => Date.now(), level = () => 1 } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#level = level;
  }

  // Pisos desbloqueados (decide qué retos entran al generar el día).
  setLevelSource(level) {
    this.#level = level;
  }

  // Desafíos de hoy (se generan al empezar el día).
  get today() {
    const day = localDay(this.#now());
    if (!this.#s) this.#s = normalize(this.#store.read(DAILY_KEY, null));
    if (this.#s?.day !== day) {
      const plan = dailyFor(day, this.#level());
      this.#s = { day, modifier: plan.modifier, challenges: plan.challenges.map((id) => ({ id, progress: 0, done: false })), bonus: false };
      this.#store.write(DAILY_KEY, this.#s);
    }
    return structuredClone(this.#s);
  }

  get modifier() {
    return modifierById(this.today.modifier);
  }

  // ¿Está activo hoy el modificador `id`?
  active(id) {
    return this.today.modifier === id;
  }

  // Ronda terminada: avanza los retos. Devuelve { completed: [retos], bonus: bool }.
  record(round) {
    const state = this.today;
    const completed = [];
    let changed = false;
    for (const entry of state.challenges) {
      if (entry.done) continue;
      const def = challengeById(entry.id);
      const step = def.measure(round ?? {});
      if (!(step > 0)) continue;
      entry.progress = Math.min(def.goal, entry.progress + step);
      changed = true;
      if (entry.progress >= def.goal) {
        entry.done = true;
        completed.push(def);
      }
    }
    let bonus = false;
    if (!state.bonus && state.challenges.length && state.challenges.every((c) => c.done)) {
      state.bonus = true;
      bonus = true;
    }
    if (changed) {
      this.#s = state;
      this.#store.write(DAILY_KEY, state);
      this.dispatchEvent(new Event('change'));
    }
    for (const def of completed) this.dispatchEvent(new CustomEvent('complete', { detail: { challenge: def } }));
    if (bonus) this.dispatchEvent(new Event('bonus'));
    return { completed, bonus };
  }
}

export const daily = new Daily();
