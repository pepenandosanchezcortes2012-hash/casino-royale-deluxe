// Monedero de créditos con depósito en garantía (escrow) por mesa.
// Flujo de una ronda: hold (saldo → escrow) → settle (escrow → pendiente, al decidirse el azar)
// → reveal (pendiente → saldo, al terminar la animación). Si la página se recarga, los premios
// pendientes se abonan y las apuestas sin resolver de las mesas no reanudables (ruleta, slots,
// Plinko, las balas en vuelo de Cyber-Fish…) se devuelven: recargar nunca permite anular un
// resultado ya sorteado ni gastar dos veces el mismo crédito.
// La escalada empieza con 10 créditos; las recompensas del Sindicato, la limosna y la carrera
// entran con grant() y los cofres de reliquias se pagan con spend().

import { storage } from '../storage.js';

export const WALLET_KEY = 'crd.climb.wallet.v1';
export const STARTING_BALANCE = 10;
// Todas las fichas de la torre: cada piso muestra las suyas.
export const DENOMINATIONS = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 100_000, 500_000, 1_000_000]);
export const GAMES = Object.freeze(['blackjack', 'roulette', 'slots', 'plinko', 'crash', 'mines', 'dice', 'towers', 'video_poker', 'wheel', 'fish']);

// Mesas que reanudan su jugada tras recargar (mano de blackjack, tablero de minas, torre y mano de
// video póker a medias): su escrow se conserva. Las demás lo devuelven al arrancar.
export const RESUMABLE = Object.freeze(['blackjack', 'mines', 'towers', 'video_poker']);

const KEY = WALLET_KEY;
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
  // Mesas que pueden aceptar apuestas ahora (las del piso actual); la aplicación lo conecta.
  #guard = () => true;
  #updateQueued = false;
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
      if (!RESUMABLE.includes(game) && this.#s.escrow[game] > 0) {
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

  // 'change' llega al instante (reglas de la escalada); 'update', una vez por fotograma, es el que
  // escucha la interfaz: con el disparo continuo de Cyber-Fish hay varios cambios por fotograma.
  #emit(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
    if (this.#updateQueued) return;
    this.#updateQueued = true;
    const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 16));
    schedule(() => {
      this.#updateQueued = false;
      this.dispatchEvent(new CustomEvent('update'));
    });
  }

  #game(game) {
    if (!GAMES.includes(game)) throw new Error(`Mesa desconocida: ${game}`);
    return game;
  }

  // Solo las mesas del piso actual pueden retener apuestas (defensa ante botones ocultos).
  setGuard(guard) {
    this.#guard = typeof guard === 'function' ? guard : () => true;
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
    if (!isAmount(amount) || amount <= 0 || !this.canAfford(amount) || !this.#guard(game)) return false;
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

  // Abona lo pendiente de la mesa. Con `part` ({ amount, stake }) solo revela una jugada de
  // varias simultáneas (las bolas de Plinko en el aire), sin adelantar el resultado de las demás.
  reveal(game, part = null) {
    this.#game(game);
    const pending = this.#s.pending[game];
    const amount = part ? Math.min(pending, Math.max(0, part.amount ?? 0)) : pending;
    this.#staked[game] = part ? money(Math.max(0, this.#staked[game] - (part.stake ?? 0))) : 0;
    if (amount > 0) {
      this.#s.balance = money(this.#s.balance + amount);
      this.#s.pending[game] = money(pending - amount);
      this.#save();
    }
    this.#emit('payout');
    return amount;
  }

  // Créditos que no salen de una apuesta: encargos, logros, limosna y recompensas de la carrera.
  grant(amount, reason = 'grant') {
    if (!isAmount(amount) || amount <= 0) return 0;
    this.#s.balance = money(this.#s.balance + amount);
    this.#s.granted = money(this.#s.granted + amount);
    this.#save();
    this.#emit(reason);
    return amount;
  }

  // Compras fuera de las mesas (cofres de reliquias). Atómico: o se paga todo o nada.
  spend(amount, reason = 'spend') {
    if (!isAmount(amount) || amount <= 0 || !this.canAfford(amount)) return false;
    this.#s.balance = money(this.#s.balance - amount);
    this.#s.spent = money(this.#s.spent + amount);
    this.#save();
    this.#emit(reason);
    return true;
  }

  // Nueva escalada: 10 créditos y nada en juego.
  reset() {
    this.#s = fresh();
    this.#staked = perGame(0);
    this.#save();
    this.#emit('reset');
  }
}

export const wallet = new Wallet();
