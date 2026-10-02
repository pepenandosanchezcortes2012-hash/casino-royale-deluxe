// Trofeos arcade: 12 logros permanentes (sobreviven a cada nueva escalada) con medalla pixel
// (bronce, plata u oro), indicador de progreso y aviso flotante al desbloquearse. Son distintos de
// los logros de la escalada (js/climb/achievements.js), que se reinician en cada partida y pagan
// créditos: estos solo dan gloria.
// El módulo solo guarda estadísticas y decide; quien juega le avisa con record*() y la interfaz
// escucha el evento 'unlock'.

import { storage as defaultStore } from '../storage.js';

export const TROPHIES_KEY = 'crd.arcade.trophies.v1';
export const SPECIES_IDS = Object.freeze(['neon', 'jelly', 'manta', 'shark', 'kraken']);
export const TABLE_IDS = Object.freeze(['mines', 'dice', 'towers', 'fish', 'plinko', 'slots', 'crash', 'roulette', 'video_poker', 'blackjack', 'wheel']);

const trophy = (id, name, description, tier, goal, value) => Object.freeze({ id, name, description, tier, goal, value });
const size = (list) => (Array.isArray(list) ? list.length : 0);

// `value(stats)` mide el avance hacia `goal`.
export const TROPHIES = Object.freeze([
  trophy('ace-pilot', 'As del Aire', 'Cobra en Crash a más de ×15.', 'silver', 15, (s) => s.bestCrash),
  trophy('marine-biologist', 'Biólogo Marino', 'Pesca las 5 especies de Cyber-Fish.', 'silver', 5, (s) => size(s.species)),
  trophy('grade-hacker', 'Hacker de Grado', 'Supera el Piso 4: reúne 10.000.000 de créditos.', 'gold', 1, (s) => s.victories),
  trophy('root-access', 'Acceso Root', 'Derrota a la IA Central en el Núcleo del Servidor.', 'gold', 1, (s) => s.bosses),
  trophy('marathon', 'Maratón Arcade', 'Juega 500 rondas en total.', 'bronze', 500, (s) => s.rounds),
  trophy('jackpot', 'Gran Premio', 'Cobra un premio de ×100 o más en cualquier mesa.', 'silver', 100, (s) => s.bestMultiplier),
  trophy('tourist', 'Turista del Casino', 'Juega al menos una ronda en las 11 mesas.', 'bronze', 11, (s) => size(s.tables)),
  trophy('daily-full', 'Rutina del Sindicato', 'Completa los 3 desafíos de un mismo día.', 'bronze', 1, (s) => s.dailyFull),
  trophy('daily-seven', 'Constancia', 'Completa 7 desafíos diarios en total.', 'silver', 7, (s) => s.dailyDone),
  trophy('stylist', 'Estilista', 'Compra una skin o una paleta en la tienda.', 'bronze', 1, (s) => s.purchases),
  trophy('collector', 'Coleccionista', 'Reúne las 10 reliquias de la bóveda.', 'gold', 10, (s) => s.relics),
  trophy('legend', 'Leyenda del Salón', 'Firma con tus iniciales en el Salón de la Fama.', 'bronze', 1, (s) => s.signatures),
]);

export const trophyById = (id) => TROPHIES.find((item) => item.id === id) ?? null;

function freshStats() {
  return {
    bestCrash: 0,
    bestMultiplier: 0,
    species: [],
    tables: [],
    rounds: 0,
    victories: 0,
    bosses: 0,
    dailyFull: 0,
    dailyDone: 0,
    purchases: 0,
    relics: 0,
    signatures: 0,
  };
}

const num = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const ids = (list, allowed) => (Array.isArray(list) ? [...new Set(list.filter((id) => allowed.includes(id)))] : []);

export function normalizeTrophies(raw) {
  const stats = freshStats();
  const source = raw && typeof raw === 'object' ? raw : {};
  const s = source.stats && typeof source.stats === 'object' ? source.stats : {};
  for (const key of Object.keys(stats)) {
    if (key === 'species') stats.species = ids(s.species, SPECIES_IDS);
    else if (key === 'tables') stats.tables = ids(s.tables, TABLE_IDS);
    else stats[key] = num(s[key]);
  }
  const unlocked = {};
  if (source.unlocked && typeof source.unlocked === 'object') {
    for (const [id, t] of Object.entries(source.unlocked)) if (trophyById(id) && num(t)) unlocked[id] = t;
  }
  return { stats, unlocked };
}

export class Trophies extends EventTarget {
  #store;
  #now;
  #s;

  constructor({ store = defaultStore, now = () => Date.now() } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#s = normalizeTrophies(store.read(TROPHIES_KEY, null));
  }

  get stats() {
    return structuredClone(this.#s.stats);
  }

  get unlockedCount() {
    return Object.keys(this.#s.unlocked).length;
  }

  isUnlocked(id) {
    return Object.hasOwn(this.#s.unlocked, id);
  }

  unlockedAt(id) {
    return this.#s.unlocked[id] ?? null;
  }

  // Avance de un trofeo: { value, goal, ratio, unlocked }.
  progress(id) {
    const item = trophyById(id);
    if (!item) return null;
    const value = Math.min(item.goal, item.value(this.#s.stats));
    return { value, goal: item.goal, ratio: item.goal ? value / item.goal : 1, unlocked: this.isUnlocked(id) };
  }

  // Ronda terminada en una mesa (lo que emite la sesión en `round:end`).
  recordRound(round) {
    const s = this.#s.stats;
    if (!round || typeof round.game !== 'string') return [];
    if (round.stake > 0 || round.returned > 0) s.rounds += 1;
    if (TABLE_IDS.includes(round.game) && !s.tables.includes(round.game)) s.tables.push(round.game);
    const multiplier = round.stake > 0 ? round.returned / round.stake : 0;
    if (round.game !== 'wheel') s.bestMultiplier = Math.max(s.bestMultiplier, multiplier);
    if (round.game === 'crash' && round.returned > 0) s.bestCrash = Math.max(s.bestCrash, multiplier);
    for (const tag of round.tags ?? []) {
      const species = /^fish-(\w+)$/.exec(tag)?.[1];
      if (SPECIES_IDS.includes(species) && !s.species.includes(species)) s.species.push(species);
    }
    return this.#check();
  }

  // Contadores sueltos: 'victories', 'bosses', 'dailyFull', 'dailyDone', 'purchases', 'signatures'.
  bump(stat, amount = 1) {
    if (!(stat in this.#s.stats) || Array.isArray(this.#s.stats[stat])) return [];
    this.#s.stats[stat] += num(amount);
    return this.#check();
  }

  // Valores absolutos que se leen de otro sistema (p. ej. reliquias reunidas).
  observe(stat, value) {
    if (!(stat in this.#s.stats) || Array.isArray(this.#s.stats[stat])) return [];
    this.#s.stats[stat] = Math.max(this.#s.stats[stat], num(value));
    return this.#check();
  }

  // Desbloquea lo que haya alcanzado su meta y guarda. Devuelve los trofeos nuevos.
  #check() {
    const fresh = [];
    for (const item of TROPHIES) {
      if (this.isUnlocked(item.id) || item.value(this.#s.stats) < item.goal) continue;
      this.#s.unlocked[item.id] = this.#now();
      fresh.push(item);
    }
    this.#store.write(TROPHIES_KEY, this.#s);
    for (const item of fresh) this.dispatchEvent(new CustomEvent('unlock', { detail: { trophy: item } }));
    if (fresh.length) this.dispatchEvent(new Event('change'));
    return fresh;
  }

  reset() {
    this.#s = normalizeTrophies(null);
    this.#store.write(TROPHIES_KEY, this.#s);
    this.dispatchEvent(new Event('change'));
  }
}

export const trophies = new Trophies();
