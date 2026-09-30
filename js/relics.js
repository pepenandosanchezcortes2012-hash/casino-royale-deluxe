// Reliquias del Cripto-Casino: bóveda de 10 reliquias, 4 ranuras para equiparlas, cofres con
// animación de gacha (cada cofre garantiza una reliquia que aún no tienes) y pociones ×2.
// Las reliquias solo actúan en el Cripto-Casino; la leyenda del Modo Historia aporta cofres.
// Las que tocan probabilidades son variantes de reglas publicadas y verificables (ver README):
// el Trébol cambia los pesos de los rodillos, el Dado y la Batería usan números del flujo
// provably fair de la jugada, el Zafiro usa otra desviación publicada del tablero de Plinko.

import { storage as defaultStore } from './storage.js';
import { randomInt } from './engine/rng.js';
import { isFree } from './mode.js';

export const RELICS_KEY = 'crd.relics.v1';
export const SLOT_COUNT = 4;
export const MIDAS_BONUS = 0.2;
export const CASHBACK_RATE = 0.1;
export const DADO_CHANCE = 0.25;
export const BATTERY_CHANCE = 0.25;
export const RADAR_THRESHOLD = 0.8;
export const CLOCK_BONUS = 50;
export const PASS_XP = 2;

export const RARITIES = Object.freeze({
  common: Object.freeze({ name: 'Común', color: '#b8c4cf' }),
  rare: Object.freeze({ name: 'Rara', color: '#3fa9ff' }),
  epic: Object.freeze({ name: 'Épica', color: '#b566ff' }),
  legendary: Object.freeze({ name: 'Legendaria', color: '#ffb52e' }),
});

export const RELICS = Object.freeze([
  Object.freeze({ id: 'clover', name: 'Trébol de Oro', icon: '🍀', rarity: 'rare', game: 'slots', text: '+15 % de comodines 🃏 y estrellas ⭐ en los rodillos de las slots.' }),
  Object.freeze({ id: 'dice', name: 'Dado de Montecarlo', icon: '🎲', rarity: 'epic', game: 'blackjack', text: 'Si el crupier pide con 15 o 16 duros, un 25 % de las veces recibe la siguiente carta de valor 10 del zapato.' }),
  Object.freeze({ id: 'shield', name: 'Escudo', icon: '🛡️', rarity: 'common', game: 'blackjack', text: 'Devuelve lo perdido en la primera mano de blackjack perdida de cada sesión.' }),
  Object.freeze({ id: 'midas', name: 'Corona de Midas', icon: '👑', rarity: 'legendary', game: null, text: 'Multiplica ×1,20 tus premios netos.' }),
  Object.freeze({ id: 'magnet', name: 'Imán de Cashback', icon: '🧲', rarity: 'rare', game: null, text: 'Recupera el 10 % de cada pérdida neta.' }),
  Object.freeze({ id: 'clock', name: 'Reloj de la Abundancia', icon: '⏳', rarity: 'common', game: null, text: '+50 fichas extra cada 60 s de juego activo.' }),
  Object.freeze({ id: 'battery', name: 'Batería Cuántica', icon: '🔋', rarity: 'epic', game: 'slots', text: 'Tras una tirada sin premio, un 25 % de las veces vuelves a girar gratis.' }),
  Object.freeze({ id: 'sapphire', name: 'Zafiro de Plinko', icon: '💎', rarity: 'rare', game: 'plinko', text: 'Empuja las bolas hacia las cubetas de los extremos.' }),
  Object.freeze({ id: 'radar', name: 'Radar de Crash', icon: '📡', rarity: 'epic', game: 'crash', text: 'Alarma visual al llegar al 80 % del punto de explosión.' }),
  Object.freeze({ id: 'pass', name: 'Pase del Padrino', icon: '🎟️', rarity: 'legendary', game: null, text: 'Duplica toda la XP que ganas.' }),
]);
export const relicById = (id) => RELICS.find((relic) => relic.id === id) ?? null;

// Pesos por rareza de cada cofre. Solo se sortean reliquias que aún no tienes; con la colección
// completa, el cofre paga fichas (más las pociones que traiga).
export const CHESTS = Object.freeze({
  common: Object.freeze({ id: 'common', name: 'Cofre común', price: 2500, weights: Object.freeze({ common: 55, rare: 30, epic: 12, legendary: 3 }), potions: 0, fallbackChips: 1500 }),
  legendary: Object.freeze({ id: 'legendary', name: 'Cofre legendario', price: 15000, weights: Object.freeze({ common: 0, rare: 30, epic: 45, legendary: 25 }), potions: 1, fallbackChips: 10000 }),
});

const round2 = (value) => Math.round(value * 100) / 100;

// Sorteo de un cofre entre las reliquias que faltan. `rand(n)` = entero uniforme en [0, n).
export function drawRelic(tier, owned, rand = randomInt) {
  const chest = CHESTS[tier];
  if (!chest) return null;
  const pool = RELICS.filter((relic) => !owned.includes(relic.id));
  if (!pool.length) return null;
  let weights = pool.map((relic) => chest.weights[relic.rarity]);
  if (weights.every((weight) => weight === 0)) weights = pool.map(() => 1);
  let roll = rand(weights.reduce((sum, weight) => sum + weight, 0));
  for (let i = 0; i < pool.length; i++) {
    if (roll < weights[i]) return pool[i];
    roll -= weights[i];
  }
  return pool[pool.length - 1];
}

// Bonificaciones de una ronda terminada (función pura). La poción duplica el premio; la Corona
// de Midas suma el 20 % del neto ganado; el Escudo devuelve la primera mano de blackjack perdida
// de la sesión y, si no actúa, el Imán devuelve el 10 % de la pérdida neta.
export function roundBonuses(round, { equipped = [], potionArmed = false, shieldUsed = false } = {}) {
  const result = { bonuses: [], consumedPotion: false, usedShield: false, total: 0 };
  if (!round || round.game === 'wheel') return result;
  const stake = Math.max(0, Number(round.stake) || 0);
  const returned = Math.max(0, Number(round.returned) || 0);
  let potion = 0;
  if (potionArmed && returned > 0) {
    potion = returned;
    result.consumedPotion = true;
    result.bonuses.push({ id: 'potion', name: 'Poción ×2', amount: round2(potion) });
  }
  const net = returned + potion - stake;
  if (net > 0 && equipped.includes('midas')) {
    result.bonuses.push({ id: 'midas', name: relicById('midas').name, amount: round2(net * MIDAS_BONUS) });
  } else if (net < 0) {
    if (round.game === 'blackjack' && equipped.includes('shield') && !shieldUsed) {
      result.usedShield = true;
      result.bonuses.push({ id: 'shield', name: relicById('shield').name, amount: round2(-net) });
    } else if (equipped.includes('magnet')) {
      result.bonuses.push({ id: 'magnet', name: relicById('magnet').name, amount: round2(-net * CASHBACK_RATE) });
    }
  }
  result.bonuses = result.bonuses.filter((bonus) => bonus.amount > 0);
  result.total = round2(result.bonuses.reduce((sum, bonus) => sum + bonus.amount, 0));
  return result;
}

const count = (value) => (Number.isInteger(value) && value >= 0 ? Math.min(value, 999) : 0);

function sanitize(raw) {
  const state = { owned: [], equipped: Array(SLOT_COUNT).fill(null), chests: { common: 0, legendary: 0 }, potions: 0, potionArmed: false, claimed: [], opened: 0 };
  if (!raw || typeof raw !== 'object') return state;
  if (Array.isArray(raw.owned)) state.owned = RELICS.map((relic) => relic.id).filter((id) => raw.owned.includes(id));
  if (Array.isArray(raw.equipped)) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const id = raw.equipped[i];
      if (state.owned.includes(id) && !state.equipped.includes(id)) state.equipped[i] = id;
    }
  }
  if (raw.chests && typeof raw.chests === 'object') for (const tier of Object.keys(CHESTS)) state.chests[tier] = count(raw.chests[tier]);
  state.potions = count(raw.potions);
  state.potionArmed = raw.potionArmed === true;
  if (Array.isArray(raw.claimed)) state.claimed = raw.claimed.filter((id) => typeof id === 'string' && id.length <= 40).slice(0, 100);
  state.opened = count(raw.opened);
  return state;
}

export class Relics extends EventTarget {
  #store;
  #rand;
  #enabled;
  #s;
  // El Escudo actúa una vez por sesión (por visita a la página).
  #shieldUsed = false;

  constructor({ store = defaultStore, rand = randomInt, enabled = isFree } = {}) {
    super();
    this.#store = store;
    this.#rand = rand;
    this.#enabled = enabled;
    this.#s = sanitize(store.read(RELICS_KEY, null));
  }

  #save() {
    this.#store.write(RELICS_KEY, this.#s);
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    if (type !== 'change') this.dispatchEvent(new CustomEvent('change', { detail: { type } }));
  }

  // ---------- Colección y ranuras ----------

  get owned() {
    return [...this.#s.owned];
  }

  get equipped() {
    return [...this.#s.equipped];
  }

  get chests() {
    return { ...this.#s.chests };
  }

  get potions() {
    return this.#s.potions;
  }

  get potionArmed() {
    return this.#s.potionArmed;
  }

  get shieldUsed() {
    return this.#shieldUsed;
  }

  owns(id) {
    return this.#s.owned.includes(id);
  }

  isEquipped(id) {
    return this.#s.equipped.includes(id);
  }

  // ¿Está actuando la reliquia? Solo en el Cripto-Casino y equipada.
  active(id) {
    return this.#enabled && this.#s.equipped.includes(id);
  }

  // Equipa en la ranura indicada (o en la primera libre). Si la reliquia ya estaba en otra
  // ranura, se mueve; si la ranura estaba ocupada, la anterior vuelve a la bóveda.
  equip(id, slot = null) {
    if (!this.owns(id)) return false;
    const target = slot ?? this.#s.equipped.indexOf(null);
    if (!Number.isInteger(target) || target < 0 || target >= SLOT_COUNT) return false;
    const from = this.#s.equipped.indexOf(id);
    if (from === target) return true;
    if (from >= 0) this.#s.equipped[from] = null;
    this.#s.equipped[target] = id;
    this.#save();
    this.#emit('equip', { id, slot: target });
    return true;
  }

  unequip(slotOrId) {
    const slot = typeof slotOrId === 'number' ? slotOrId : this.#s.equipped.indexOf(slotOrId);
    if (slot < 0 || slot >= SLOT_COUNT || !this.#s.equipped[slot]) return false;
    const id = this.#s.equipped[slot];
    this.#s.equipped[slot] = null;
    this.#save();
    this.#emit('unequip', { id, slot });
    return true;
  }

  // ---------- Cofres y pociones ----------

  addChest(tier, reason = '') {
    if (!CHESTS[tier]) return false;
    this.#s.chests[tier] = count(this.#s.chests[tier] + 1);
    this.#save();
    this.#emit('chest', { tier, reason });
    return true;
  }

  // Abre un cofre: reliquia nueva garantizada (se equipa sola si hay una ranura libre) o, con la
  // colección completa, fichas. Devuelve { tier, relic, chips, potions, equipped } o null.
  openChest(tier) {
    const chest = CHESTS[tier];
    if (!chest || this.#s.chests[tier] <= 0) return null;
    this.#s.chests[tier] -= 1;
    this.#s.opened = count(this.#s.opened + 1);
    const relic = drawRelic(tier, this.#s.owned, this.#rand);
    let equipped = false;
    if (relic) {
      this.#s.owned = RELICS.map((item) => item.id).filter((id) => id === relic.id || this.#s.owned.includes(id));
      const free = this.#s.equipped.indexOf(null);
      if (free >= 0) {
        this.#s.equipped[free] = relic.id;
        equipped = true;
      }
    }
    this.#s.potions = count(this.#s.potions + chest.potions);
    this.#save();
    const result = { tier, relic, chips: relic ? 0 : chest.fallbackChips, potions: chest.potions, equipped };
    this.#emit('open', result);
    return result;
  }

  // Compra un cofre con fichas del Cripto-Casino.
  buyChest(tier, wallet) {
    const chest = CHESTS[tier];
    if (!chest || !wallet.spend(chest.price, 'chest')) return false;
    this.addChest(tier, 'Compra');
    return true;
  }

  addPotion(amount = 1, reason = '') {
    if (!(amount > 0)) return false;
    this.#s.potions = count(this.#s.potions + amount);
    this.#save();
    this.#emit('potion', { amount, reason });
    return true;
  }

  // Activa una poción: el siguiente premio que cobres se duplica.
  armPotion() {
    if (this.#s.potionArmed || this.#s.potions <= 0) return false;
    this.#s.potions -= 1;
    this.#s.potionArmed = true;
    this.#save();
    this.#emit('potion-armed');
    return true;
  }

  // Cofre por un logro de la leyenda: cada logro paga su cofre una sola vez.
  claimStoryReward(id, tier = 'common') {
    const key = `story:${id}`;
    if (this.#s.claimed.includes(key)) return false;
    this.#s.claimed.push(key);
    return this.addChest(tier, 'Logro de la leyenda');
  }

  // ---------- Efectos ----------

  xpMultiplier() {
    return this.active('pass') ? PASS_XP : 1;
  }

  abundanceBonus() {
    return this.active('clock') ? CLOCK_BONUS : 0;
  }

  // Aplica poción y reliquias a una ronda terminada y devuelve las bonificaciones abonadas.
  applyRound(round, wallet) {
    if (!this.#enabled || round?.mode !== 'free') return null;
    const result = roundBonuses(round, { equipped: this.#s.equipped, potionArmed: this.#s.potionArmed, shieldUsed: this.#shieldUsed });
    if (result.consumedPotion) {
      this.#s.potionArmed = false;
      this.#save();
    }
    if (result.usedShield) this.#shieldUsed = true;
    if (result.total > 0) wallet.grant(result.total, 'relic');
    if (result.bonuses.length) this.#emit('bonus', { round, ...result });
    else if (result.consumedPotion) this.#emit('change', { type: 'potion-used' });
    return result;
  }

  // Conecta las reliquias al bus: bonificaciones de cada ronda y cofres de recompensa.
  attach(bus, { wallet } = {}) {
    const offs = [bus.on('reward:chest', ({ tier, reason }) => this.addChest(tier, reason))];
    if (wallet) offs.push(bus.on('round:end', (round) => this.applyRound(round, wallet)));
    return () => offs.forEach((off) => off());
  }
}

export const relics = new Relics();
