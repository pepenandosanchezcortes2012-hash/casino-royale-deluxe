// Monedero con depósito en garantía (escrow) por mesa.
// Flujo de una ronda: hold (saldo → escrow) → settle (escrow → pendiente, al decidirse el azar)
// → reveal (pendiente → saldo, al terminar la animación). Si la página se recarga, los premios
// pendientes se abonan y las apuestas sin resolver de ruleta/slots se devuelven: recargar
// nunca permite anular un resultado ya sorteado ni gastar dos veces la misma ficha.

import { storage } from './storage.js';

export const STARTING_BALANCE = 1000;
export const RESCUE_AMOUNT = 500;
export const RESCUE_COOLDOWN_MS = 3 * 60 * 1000;
export const MIN_BET = 10;
export const DENOMINATIONS = Object.freeze([10, 25, 50, 100, 500, 1000]);
export const GAMES = Object.freeze(['blackjack', 'roulette', 'slots']);

// La mesa de blackjack reanuda su mano tras recargar, así que su escrow se conserva.
const RESUMABLE = new Set(['blackjack']);

export const FELTS = Object.freeze([
  Object.freeze({ id: 'emerald', name: 'Verde Esmeralda', price: 0, swatch: ['#12744a', '#063a21'] }),
  Object.freeze({ id: 'sapphire', name: 'Azul Zafiro', price: 1000, swatch: ['#1b4f96', '#0a2550'] }),
  Object.freeze({ id: 'crimson', name: 'Rojo Carmesí', price: 2500, swatch: ['#8e1627', '#43080f'] }),
  Object.freeze({ id: 'onyx', name: 'Negro Ónix', price: 5000, swatch: ['#2a2d31', '#08090a'] }),
]);

const KEY = 'crd.wallet.v1';
const EPSILON = 1e-9;

export const money = (value) => Math.round(value * 100) / 100;
const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const perGame = (value) => Object.fromEntries(GAMES.map((game) => [game, value]));

function sanitize(raw) {
  const state = {
    balance: STARTING_BALANCE,
    escrow: perGame(0),
    pending: perGame(0),
    lastRescue: 0,
    rescues: 0,
    owned: ['emerald'],
    felt: 'emerald',
    wagered: 0,
    paid: 0,
  };
  if (!raw || typeof raw !== 'object') return state;

  if (isAmount(raw.balance)) state.balance = money(raw.balance);
  for (const game of GAMES) {
    if (raw.escrow && isAmount(raw.escrow[game])) state.escrow[game] = money(raw.escrow[game]);
    if (raw.pending && isAmount(raw.pending[game])) state.pending[game] = money(raw.pending[game]);
  }
  if (isAmount(raw.lastRescue)) state.lastRescue = raw.lastRescue;
  if (Number.isInteger(raw.rescues) && raw.rescues >= 0) state.rescues = raw.rescues;
  if (isAmount(raw.wagered)) state.wagered = money(raw.wagered);
  if (isAmount(raw.paid)) state.paid = money(raw.paid);
  if (Array.isArray(raw.owned)) {
    const valid = raw.owned.filter((id) => FELTS.some((felt) => felt.id === id));
    state.owned = [...new Set(['emerald', ...valid])];
  }
  if (state.owned.includes(raw.felt)) state.felt = raw.felt;
  return state;
}

class Wallet extends EventTarget {
  #s;
  // Apuestas ya sorteadas cuyo resultado aún se está animando: siguen "en juego" para el HUD,
  // de modo que el importe pendiente no revela el resultado antes de tiempo.
  #staked = perGame(0);

  constructor() {
    super();
    this.#s = sanitize(storage.read(KEY, null));
    this.#recover();
  }

  #recover() {
    let changed = false;
    for (const game of GAMES) {
      if (this.#s.pending[game] > 0) {
        this.#s.balance = money(this.#s.balance + this.#s.pending[game]);
        this.#s.pending[game] = 0;
        changed = true;
      }
      if (!RESUMABLE.has(game) && this.#s.escrow[game] > 0) {
        this.#s.balance = money(this.#s.balance + this.#s.escrow[game]);
        this.#s.escrow[game] = 0;
        changed = true;
      }
    }
    if (changed) this.#save();
  }

  #save() {
    storage.write(KEY, this.#s);
  }

  #emit(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }

  #game(game) {
    if (!GAMES.includes(game)) throw new Error(`Mesa desconocida: ${game}`);
    return game;
  }

  get balance() {
    return this.#s.balance;
  }

  get inPlay() {
    let total = 0;
    for (const game of GAMES) total += this.#s.escrow[game] + this.#staked[game];
    return money(total);
  }

  get felt() {
    return this.#s.felt;
  }

  get owned() {
    return [...this.#s.owned];
  }

  get totals() {
    return { wagered: this.#s.wagered, paid: this.#s.paid, rescues: this.#s.rescues };
  }

  escrowOf(game) {
    return this.#s.escrow[this.#game(game)];
  }

  canAfford(amount) {
    return isAmount(amount) && amount <= this.#s.balance + EPSILON;
  }

  // Retiene fichas del saldo en el depósito de la mesa. Atómico: o se retiene todo o nada.
  hold(game, amount) {
    this.#game(game);
    if (!isAmount(amount) || amount <= 0 || !this.canAfford(amount)) return false;
    this.#s.balance = money(this.#s.balance - amount);
    this.#s.escrow[game] = money(this.#s.escrow[game] + amount);
    this.#save();
    this.#emit('hold');
    return true;
  }

  refund(game, amount = this.#s.escrow[game]) {
    this.#game(game);
    const value = Math.min(amount, this.#s.escrow[game]);
    if (!(value > 0)) return 0;
    this.#s.escrow[game] = money(this.#s.escrow[game] - value);
    this.#s.balance = money(this.#s.balance + value);
    this.#save();
    this.#emit('refund');
    return value;
  }

  // Liquida una apuesta resuelta: consume `stake` del escrow y deja `payout` pendiente de revelar.
  settle(game, stake, payout) {
    this.#game(game);
    if (!isAmount(stake) || !isAmount(payout)) throw new Error('settle: importes inválidos');
    if (stake > this.#s.escrow[game] + EPSILON) {
      throw new Error(`settle: el escrow de ${game} (${this.#s.escrow[game]}) no cubre ${stake}`);
    }
    this.#s.escrow[game] = money(Math.max(0, this.#s.escrow[game] - stake));
    this.#s.pending[game] = money(this.#s.pending[game] + payout);
    this.#staked[game] = money(this.#staked[game] + stake);
    this.#s.wagered = money(this.#s.wagered + stake);
    this.#s.paid = money(this.#s.paid + payout);
    this.#save();
    this.#emit('settle');
  }

  reveal(game) {
    this.#game(game);
    const amount = this.#s.pending[game];
    this.#staked[game] = 0;
    if (amount > 0) {
      this.#s.balance = money(this.#s.balance + amount);
      this.#s.pending[game] = 0;
      this.#save();
    }
    this.#emit('payout');
    return amount;
  }

  rescueStatus(now = Date.now()) {
    const idle = GAMES.every((game) => this.#s.escrow[game] === 0 && this.#s.pending[game] === 0 && this.#staked[game] === 0);
    const busted = this.#s.balance < MIN_BET && idle;
    const remaining = Math.max(0, this.#s.lastRescue + RESCUE_COOLDOWN_MS - now);
    return { busted, remaining, eligible: busted && remaining === 0 };
  }

  rescue(now = Date.now()) {
    if (!this.rescueStatus(now).eligible) return false;
    this.#s.balance = money(this.#s.balance + RESCUE_AMOUNT);
    this.#s.lastRescue = now;
    this.#s.rescues += 1;
    this.#save();
    this.#emit('rescue');
    return true;
  }

  buyFelt(id) {
    const felt = FELTS.find((item) => item.id === id);
    if (!felt) return false;
    if (!this.#s.owned.includes(id)) {
      if (!this.canAfford(felt.price)) return false;
      this.#s.balance = money(this.#s.balance - felt.price);
      this.#s.owned.push(id);
    }
    this.#s.felt = id;
    this.#save();
    this.#emit('felt');
    return true;
  }
}

export const wallet = new Wallet();
