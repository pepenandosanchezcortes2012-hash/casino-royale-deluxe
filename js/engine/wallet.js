// Monedero de créditos con depósito en garantía (escrow) por mesa.
// Flujo de una ronda: hold (saldo → escrow) → settle (escrow → pendiente, al decidirse el azar)
// → reveal (pendiente → saldo, al terminar la animación). Si la página se recarga, los premios
// pendientes se abonan y las apuestas sin resolver de ruleta/slots se devuelven: recargar
// nunca permite anular un resultado ya sorteado ni gastar dos veces el mismo crédito.
// «El Último Crédito» empieza con un único crédito; las recompensas del Sindicato y las ayudas del
// Club VIP entran con grant() y los tapetes de lujo se pagan con spend().

import { storage } from './storage.js';

export const STARTING_BALANCE = 1;
export const DENOMINATIONS = Object.freeze([1, 5, 10, 25, 100, 500, 1000, 5000, 10000]);
export const GAMES = Object.freeze(['blackjack', 'roulette', 'slots']);

// La mesa de blackjack reanuda su mano tras recargar, así que su escrow se conserva.
const RESUMABLE = new Set(['blackjack']);

const KEY = 'crd.wallet.v2';
const EPSILON = 1e-9;

export const money = (value) => Math.round(value * 100) / 100;
const isAmount = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const perGame = (value) => Object.fromEntries(GAMES.map((game) => [game, value]));

function fresh() {
  return { balance: STARTING_BALANCE, escrow: perGame(0), pending: perGame(0), wagered: 0, paid: 0, granted: 0, spent: 0 };
}

function sanitize(raw) {
  const state = fresh();
  if (!raw || typeof raw !== 'object') return state;
  if (isAmount(raw.balance)) state.balance = money(raw.balance);
  for (const game of GAMES) {
    if (raw.escrow && isAmount(raw.escrow[game])) state.escrow[game] = money(raw.escrow[game]);
    if (raw.pending && isAmount(raw.pending[game])) state.pending[game] = money(raw.pending[game]);
  }
  for (const key of ['wagered', 'paid', 'granted', 'spent']) if (isAmount(raw[key])) state[key] = money(raw[key]);
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

  get totals() {
    return { wagered: this.#s.wagered, paid: this.#s.paid, granted: this.#s.granted, spent: this.#s.spent };
  }

  escrowOf(game) {
    return this.#s.escrow[this.#game(game)];
  }

  canAfford(amount) {
    return isAmount(amount) && amount <= this.#s.balance + EPSILON;
  }

  // Retiene créditos del saldo en el depósito de la mesa. Atómico: o se retiene todo o nada.
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

  // Créditos que no salen de una apuesta: recompensas de logros, encargos y favores.
  grant(amount, reason = 'grant') {
    if (!isAmount(amount) || amount <= 0) return 0;
    this.#s.balance = money(this.#s.balance + amount);
    this.#s.granted = money(this.#s.granted + amount);
    this.#save();
    this.#emit(reason);
    return amount;
  }

  // Compras fuera de las mesas (tapetes del Club VIP). Atómico: o se paga todo o nada.
  spend(amount, reason = 'spend') {
    if (!isAmount(amount) || amount <= 0 || !this.canAfford(amount)) return false;
    this.#s.balance = money(this.#s.balance - amount);
    this.#s.spent = money(this.#s.spent + amount);
    this.#save();
    this.#emit(reason);
    return true;
  }

  // Nueva leyenda: un crédito y nada en juego.
  reset() {
    this.#s = fresh();
    this.#staked = perGame(0);
    this.#save();
    this.#emit('reset');
  }
}

export const wallet = new Wallet();
