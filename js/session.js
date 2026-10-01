// Sesión de juego: la única puerta entre las mesas y las reglas de la escalada.
// Las mesas le preguntan si se puede jugar y con qué límites (los del piso actual), le piden el
// azar de cada jugada (provably fair: HMAC-SHA256 con semillas comprometidas) y le avisan del
// principio y del final de cada ronda. Cada ronda llega a la escalada (encargos, logros, récord)
// y viaja por el bus de eventos (progresión, misiones, reliquias y telemetría escuchan
// `round:end`).

import { bus } from './event_bus.js';
import { climb } from './climb/climb.js';
import { wallet } from './engine/wallet.js';
import { fair } from './provably_fair.js';

const EPS = 1e-9;
const round2 = (value) => Math.round(value * 100) / 100;

function roundInfo(round) {
  const stake = round.stake ?? 0;
  const returned = round.returned ?? 0;
  const floor = climb.floor;
  return {
    ...round,
    tags: round.tags ?? [],
    stake,
    returned,
    net: round2(returned - stake),
    multiplier: stake > 0 ? round2(returned / stake) : 0,
    mode: 'climb',
    floor: floor.level,
    minBet: floor.minBet,
  };
}

class Session {
  #games = new Map();

  get mode() {
    return 'climb';
  }

  get playable() {
    return climb.playable;
  }

  limits(game) {
    return climb.limits(game);
  }

  // ¿Se juega esta mesa en el piso actual?
  available(game) {
    return climb.available(game);
  }

  register(id, api) {
    this.#games.set(id, api);
    climb.register(id, api);
  }

  // ¿Hay fichas en la mesa o una jugada a medias? (el ascensor y la limosna esperan).
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

  beginRound(round) {
    bus.emit('round:start', { ...round, mode: 'climb' });
    return climb.beginRound(round);
  }

  report(round) {
    climb.report(round);
    bus.emit('round:end', roundInfo(round));
  }
}

export const session = new Session();
