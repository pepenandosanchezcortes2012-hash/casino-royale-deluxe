// Sesión de juego: la única puerta entre las mesas y las reglas del modo activo.
// Las mesas le preguntan si se puede jugar y con qué límites, le piden el azar de cada jugada y
// le avisan del principio y del final de cada ronda. En el Modo Historia todo pasa por la campaña
// y el azar sale directamente de crypto.getRandomValues(); en el Cripto-Casino el azar es
// provably fair (HMAC-SHA256 con semillas comprometidas) y cada ronda viaja por el bus de eventos
// (progresión, misiones, reliquias y telemetría escuchan `round:end`).

import { isFree } from './mode.js';
import { bus } from './event_bus.js';
import { campaign } from './story/campaign.js';
import { wallet } from './engine/wallet.js';
import { fair } from './provably_fair.js';
import { randomInt, randomFloat } from './engine/rng.js';

const EPS = 1e-9;
const round2 = (value) => Math.round(value * 100) / 100;

export const FREE_CHIPS = Object.freeze([10, 25, 50, 100, 500, 1000]);
export const FREE_MIN_BET = 10;
// Fondo de rescate: si te quedas sin fichas, el casino te presta 500 automáticamente.
export const RESCUE_AMOUNT = 500;
const RESCUE_DELAY_MS = 900;

// Límites del Cripto-Casino (fichas de 10 a 1.000).
export const FREE_LIMITS = Object.freeze({
  blackjack: Object.freeze({ seats: 3, sideBets: true, maxMain: 5000, maxSide: 1000 }),
  roulette: Object.freeze({ racetrack: true, spotMax: 2500, tableMax: 20000 }),
  slots: Object.freeze({ bets: Object.freeze([10, 20, 50, 100, 200, 500]), bonusBuy: true }),
  plinko: Object.freeze({ bets: Object.freeze([10, 25, 50, 100, 250, 500, 1000]) }),
  crash: Object.freeze({ maxBet: 5000 }),
  mines: Object.freeze({ maxBet: 5000 }),
  dice: Object.freeze({ maxBet: 5000 }),
  towers: Object.freeze({ maxBet: 5000 }),
  video_poker: Object.freeze({ coins: Object.freeze([10, 25, 50, 100]) }),
});

function roundInfo(round, mode) {
  const stake = round.stake ?? 0;
  const returned = round.returned ?? 0;
  return {
    ...round,
    tags: round.tags ?? [],
    stake,
    returned,
    net: round2(returned - stake),
    multiplier: stake > 0 ? round2(returned / stake) : 0,
    mode,
  };
}

// Azar directo de crypto.getRandomValues() con la misma interfaz que un flujo verificable.
class CryptoStream {
  meta = null;

  float() {
    return randomFloat();
  }

  int(n) {
    return randomInt(n);
  }

  weighted(weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = randomFloat() * total;
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) return i;
      roll -= weights[i];
    }
    return weights.length - 1;
  }

  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  get rand() {
    return randomInt;
  }
}

class FreeSession {
  #games = new Map();
  #rescueTimer = 0;
  #rescueOn = false;

  get mode() {
    return 'free';
  }

  get playable() {
    return true;
  }

  limits(game) {
    return { ...(FREE_LIMITS[game] ?? {}), minBet: FREE_MIN_BET, chips: FREE_CHIPS, zone: 'cyber' };
  }

  register(id, api) {
    this.#games.set(id, api);
  }

  // ¿Hay fichas en la mesa o una jugada a medias? (el rescate espera a que termine).
  hasPendingPlay() {
    return wallet.inPlay > EPS || [...this.#games.values()].some((game) => game.hasPendingPlay?.());
  }

  // ¿Se perdería algo al salir ahora? (un cohete de Crash en vuelo sin retiro automático).
  blocksExit() {
    return [...this.#games.values()].some((game) => game.blocksExit?.());
  }

  // Números de la próxima jugada: flujo provably fair con el nonce siguiente.
  stream(game) {
    return fair.next(game);
  }

  // Anota la jugada en el historial verificable (lo que muestran la telemetría y `verify`).
  record(stream, result) {
    if (!stream?.meta) return null;
    return fair.record(stream.meta, result);
  }

  beginRound({ game, stake }) {
    bus.emit('round:start', { game, stake, mode: 'free' });
    return false;
  }

  report(round) {
    bus.emit('round:end', roundInfo(round, 'free'));
  }

  // Fondo de rescate automático: con el saldo por debajo de la ficha mínima y nada en juego.
  enableRescue() {
    if (this.#rescueOn) return;
    this.#rescueOn = true;
    wallet.addEventListener('change', () => this.#scheduleRescue());
    this.#scheduleRescue();
  }

  #scheduleRescue() {
    clearTimeout(this.#rescueTimer);
    if (wallet.balance >= FREE_MIN_BET) return;
    this.#rescueTimer = setTimeout(() => this.#rescue(), RESCUE_DELAY_MS);
  }

  #rescue() {
    if (wallet.balance >= FREE_MIN_BET) return;
    if (this.hasPendingPlay()) {
      this.#rescueTimer = setTimeout(() => this.#rescue(), RESCUE_DELAY_MS);
      return;
    }
    wallet.grant(RESCUE_AMOUNT, 'rescue');
    bus.emit('rescue', { amount: RESCUE_AMOUNT });
  }
}

// El Modo Historia delega en la campaña y además comparte la ronda por el bus (XP global).
const storySession = {
  get mode() {
    return 'story';
  },
  get playable() {
    return campaign.playable;
  },
  limits: (game) => campaign.limits(game),
  register: (id, api) => campaign.register(id, api),
  hasPendingPlay: () => false,
  blocksExit: () => false,
  stream: () => new CryptoStream(),
  record: () => null,
  beginRound(round) {
    bus.emit('round:start', { ...round, mode: 'story' });
    return campaign.beginRound(round);
  },
  report(round) {
    campaign.report(round);
    bus.emit('round:end', roundInfo(round, 'story'));
  },
  enableRescue() {},
};

export const session = isFree ? new FreeSession() : storySession;
