// Encargos del Sindicato: tablero de 3 objetivos simultáneos por zona con recompensa fija.
// Las mesas son justas (ventaja de la casa intacta); los encargos son la vía de progreso:
// multiplicar un solo crédito ×100.000 solo con juegos de esperanza negativa es casi imposible
// (por el teorema de parada opcional, P(éxito) ≤ saldo inicial / objetivo).
// La recompensa base es ≈ 0,6 × rondas esperadas para cumplirlo (medidas con los motores reales)
// y se multiplica por el factor de la zona. Solo cuentan las rondas ganadas (neto positivo).

import { randomInt } from '../engine/rng.js';

export const ACTIVE_CONTRACTS = 3;

export const CONTRACT_TYPES = Object.freeze([
  Object.freeze({ type: 'wins', goal: 3, base: 4, text: 'Gana 3 rondas en cualquier mesa' }),
  Object.freeze({ type: 'bj-wins', goal: 2, base: 3, text: 'Gana 2 rondas de blackjack', game: 'blackjack' }),
  Object.freeze({ type: 'roulette-wins', goal: 2, base: 3, text: 'Gana 2 giros de ruleta', game: 'roulette' }),
  Object.freeze({ type: 'slot-wins', goal: 3, base: 13, text: 'Gana 3 tiradas en las slots', game: 'slots' }),
  Object.freeze({ type: 'outside', goal: 2, base: 3, text: 'Cobra 2 suertes sencillas (rojo, par, 1-18…)', tag: 'outside' }),
  Object.freeze({ type: 'dozen', goal: 1, base: 2, text: 'Cobra una docena o una columna', tag: 'dozen' }),
  Object.freeze({ type: 'straight', goal: 1, base: 22, text: 'Acierta un pleno en la ruleta', tag: 'straight' }),
  Object.freeze({ type: 'natural', goal: 1, base: 13, text: 'Consigue un Blackjack natural', tag: 'natural' }),
  Object.freeze({ type: 'double', goal: 1, base: 11, text: 'Gana una mano de blackjack doblada', tag: 'double-win' }),
  Object.freeze({ type: 'split', goal: 1, base: 48, text: 'Gana una mano de blackjack dividida', tag: 'split-win' }),
  Object.freeze({ type: 'streak', goal: 3, base: 9, text: 'Encadena 3 victorias seguidas', special: 'streak' }),
  Object.freeze({ type: 'cascade', goal: 1, base: 8, text: 'Consigue 2 avalanchas en un solo giro', tag: 'cascade2' }),
  Object.freeze({ type: 'big-win', goal: 1, base: 22, text: 'Gana 10 veces lo apostado en una sola ronda', special: 'big' }),
  Object.freeze({ type: 'free-spins', goal: 1, base: 165, text: 'Activa los giros gratis de las slots', tag: 'freespins' }),
  Object.freeze({ type: 'side', goal: 1, base: 4, text: 'Cobra un Perfect Pairs o un 21+3', tag: 'side-win', minLevel: 2 }),
  Object.freeze({ type: 'call', goal: 1, base: 2, text: 'Cobra una apuesta anunciada del racetrack', tag: 'call-win', minLevel: 2 }),
]);

export const contractType = (type) => CONTRACT_TYPES.find((item) => item.type === type);

// Nuevo encargo para la zona, distinto de los tipos indicados en `exclude`.
export function drawContract(zone, exclude = [], rand = randomInt) {
  const pool = CONTRACT_TYPES.filter((item) => (item.minLevel ?? 1) <= zone.level && !exclude.includes(item.type));
  const def = pool[rand(pool.length)];
  return { type: def.type, text: def.text, goal: def.goal, progress: 0, reward: def.base * zone.contractFactor };
}

// Progreso tras una ronda. `round` = { game, stake, returned, net, tags }, `streak` = racha actual.
export function advanceContract(contract, round, streak) {
  const def = contractType(contract.type);
  if (!def || round.net <= 0) return contract.progress;
  if (def.special === 'streak') return Math.max(contract.progress, Math.min(def.goal, streak));
  if (def.special === 'big') return round.stake > 0 && round.returned >= round.stake * 10 ? contract.progress + 1 : contract.progress;
  if (def.tag) return round.tags.includes(def.tag) ? contract.progress + 1 : contract.progress;
  if (def.game && def.game !== round.game) return contract.progress;
  return contract.progress + 1;
}
