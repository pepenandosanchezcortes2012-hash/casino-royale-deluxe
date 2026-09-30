// Club VIP (recuperado de la v2): la carrera del jugador a lo largo de todas sus leyendas.
// El XP (1 por crédito apostado en cualquier mesa), el rango, los tapetes comprados y el bono
// diario sobreviven al reinicio de la leyenda; los rescates VIP se cuentan por leyenda.
// Sin DOM y sin tocar el monedero: la campaña decide cuándo se usan y abona los créditos.

import { storage as defaultStore } from '../storage.js';

export const VIP_KEY = 'crd.vip.v1';
export const XP_PER_CREDIT = 1;

// Rangos VIP: umbral de XP, rescate por bancarrota, rescates por leyenda y bono diario.
export const RANKS = Object.freeze([
  Object.freeze({ id: 'bronze', name: 'Bronce', xp: 0, rescue: 500, rescues: 1, daily: 100 }),
  Object.freeze({ id: 'silver', name: 'Plata', xp: 5000, rescue: 750, rescues: 2, daily: 250 }),
  Object.freeze({ id: 'gold', name: 'Oro', xp: 25000, rescue: 1000, rescues: 3, daily: 500 }),
  Object.freeze({ id: 'platinum', name: 'Platino', xp: 100000, rescue: 1500, rescues: 4, daily: 1000 }),
  Object.freeze({ id: 'diamond', name: 'Diamante', xp: 400000, rescue: 2500, rescues: 5, daily: 2500 }),
  // Sexto rango, compartido con el Cripto-Casino: la cima de la carrera de un jugador.
  Object.freeze({ id: 'godfather', name: 'El Padrino', xp: 1500000, rescue: 4000, rescues: 6, daily: 5000 }),
]);

// Tapetes de lujo. «zone» deja el tapete propio de cada zona del casino.
export const FELTS = Object.freeze([
  Object.freeze({ id: 'zone', name: 'Tapete de la zona', price: 0, swatch: null }),
  Object.freeze({ id: 'emerald', name: 'Verde Esmeralda', price: 0, swatch: Object.freeze(['#12744a', '#063a21']) }),
  Object.freeze({ id: 'sapphire', name: 'Azul Zafiro', price: 1000, swatch: Object.freeze(['#1b4f96', '#0a2550']) }),
  Object.freeze({ id: 'crimson', name: 'Rojo Carmesí', price: 2500, swatch: Object.freeze(['#8e1627', '#43080f']) }),
  Object.freeze({ id: 'onyx', name: 'Negro Ónix', price: 5000, swatch: Object.freeze(['#2a2d31', '#08090a']) }),
]);

const FREE_FELTS = FELTS.filter((felt) => felt.price === 0).map((felt) => felt.id);
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const feltById = (id) => FELTS.find((felt) => felt.id === id) ?? null;

export function rankIndexFor(xp) {
  let index = 0;
  while (index + 1 < RANKS.length && xp >= RANKS[index + 1].xp) index++;
  return index;
}

// Día natural local (AAAA-MM-DD): el bono diario se renueva a medianoche del jugador.
export function localDayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextMidnight(now) {
  const date = new Date(now);
  date.setHours(24, 0, 0, 0);
  return date.getTime();
}

function sanitize(raw) {
  const state = { xp: 0, dailyDay: null, owned: [...FREE_FELTS], felt: 'zone', rescueLegend: 0, rescuesUsed: 0 };
  if (!raw || typeof raw !== 'object') return state;
  if (typeof raw.xp === 'number' && Number.isFinite(raw.xp) && raw.xp >= 0) state.xp = Math.floor(raw.xp);
  if (typeof raw.dailyDay === 'string' && DAY_KEY.test(raw.dailyDay)) state.dailyDay = raw.dailyDay;
  if (Array.isArray(raw.owned)) state.owned = [...new Set([...FREE_FELTS, ...raw.owned.filter((id) => feltById(id))])];
  if (state.owned.includes(raw.felt)) state.felt = raw.felt;
  if (Number.isInteger(raw.rescueLegend) && raw.rescueLegend >= 0) state.rescueLegend = raw.rescueLegend;
  if (Number.isInteger(raw.rescuesUsed) && raw.rescuesUsed >= 0) state.rescuesUsed = raw.rescuesUsed;
  return state;
}

export class VipClub extends EventTarget {
  #store;
  #now;
  #s;
  #partial = 0;

  constructor({ store = defaultStore, now = () => Date.now() } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#s = sanitize(store.read(VIP_KEY, null));
  }

  #save() {
    this.#store.write(VIP_KEY, this.#s);
  }

  #emit(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }

  // ---------- XP y rangos ----------

  get xp() {
    return this.#s.xp;
  }

  get rank() {
    return RANKS[rankIndexFor(this.#s.xp)];
  }

  rankProgress() {
    const xp = this.#s.xp;
    const index = rankIndexFor(xp);
    const rank = RANKS[index];
    const next = RANKS[index + 1] ?? null;
    const ratio = next ? (xp - rank.xp) / (next.xp - rank.xp) : 1;
    return { xp, index, rank, next, ratio: Math.min(1, Math.max(0, ratio)), missing: next ? next.xp - xp : 0 };
  }

  // Suma XP por los créditos apostados; devuelve el ascenso de rango si lo hay.
  addXp(credits) {
    if (!(credits > 0)) return null;
    const before = rankIndexFor(this.#s.xp);
    // Las fracciones (apuestas de 0,1 en las slots) se acumulan hasta completar un punto.
    this.#partial += credits * XP_PER_CREDIT;
    const whole = Math.floor(this.#partial + 1e-9);
    if (whole <= 0) return null;
    this.#partial -= whole;
    this.#s.xp += whole;
    this.#save();
    this.#emit('xp');
    const after = rankIndexFor(this.#s.xp);
    if (after <= before) return null;
    const detail = { rank: RANKS[after], previous: RANKS[before] };
    this.dispatchEvent(new CustomEvent('rankup', { detail }));
    return detail;
  }

  // ---------- Bono diario ----------

  dailyStatus(now = this.#now()) {
    const available = this.#s.dailyDay !== localDayKey(new Date(now));
    return { available, amount: this.rank.daily, nextAt: available ? now : nextMidnight(now) };
  }

  claimDaily(now = this.#now()) {
    const status = this.dailyStatus(now);
    if (!status.available) return 0;
    this.#s.dailyDay = localDayKey(new Date(now));
    this.#save();
    this.#emit('daily');
    return status.amount;
  }

  // ---------- Rescate VIP (por leyenda) ----------

  rescueStatus(legend) {
    const used = this.#s.rescueLegend === legend ? this.#s.rescuesUsed : 0;
    const rank = this.rank;
    return { left: Math.max(0, rank.rescues - used), used, total: rank.rescues, amount: rank.rescue };
  }

  useRescue(legend) {
    const status = this.rescueStatus(legend);
    if (status.left <= 0) return 0;
    this.#s.rescueLegend = legend;
    this.#s.rescuesUsed = status.used + 1;
    this.#save();
    this.#emit('rescue');
    return status.amount;
  }

  // ---------- Tapetes ----------

  get felt() {
    return this.#s.felt;
  }

  get owned() {
    return [...this.#s.owned];
  }

  owns(id) {
    return this.#s.owned.includes(id);
  }

  // Registra un tapete ya pagado (la campaña cobra el precio del saldo de la leyenda).
  addFelt(id) {
    if (!feltById(id) || this.owns(id)) return false;
    this.#s.owned.push(id);
    this.#save();
    this.#emit('owned');
    return true;
  }

  equipFelt(id) {
    if (!this.owns(id)) return false;
    this.#s.felt = id;
    this.#save();
    this.#emit('felt');
    return true;
  }
}

export const vip = new VipClub();
