// Encargos del Sindicato: tablero de 3 objetivos simultáneos por piso con recompensa fija.
// Las mesas son justas (la ventaja de la casa sigue intacta) y los encargos son la vía de
// progreso: multiplicar 10 créditos ×1.000.000 solo con juegos de esperanza negativa es casi
// imposible (por el teorema de parada opcional, P(éxito) ≤ saldo inicial / meta).
// Recompensa = base × factor del piso. La base es ≈ 0,6 × las rondas que cuesta cumplirlo por la
// vía más rápida (un premio de ×M sale, como mucho, con probabilidad RTP / M en cualquier mesa);
// en Cyber-Fish se cuenta por tiempo de disparo (5 balas ≈ 1 ronda). Solo cuentan los premios
// de ×2 o más: una apuesta casi segura no avanza ningún encargo.

import { randomInt } from '../engine/rng.js';

export const ACTIVE_CONTRACTS = 3;
const EPS = 1e-9;

const winsAt = (round, factor) => round.stake > 0 && round.returned > round.stake + EPS && round.returned + EPS >= round.stake * factor;
const isGame = (round, game) => round.game === game;
const hasTag = (round, tag) => Array.isArray(round.tags) && round.tags.includes(tag);
const VP_TRIPS = ['vp-threeKind', 'vp-straight', 'vp-flush', 'vp-fullHouse', 'vp-fourKind', 'vp-straightFlush', 'vp-royal'];

const def = (item) => Object.freeze(item);

export const CONTRACT_TYPES = Object.freeze([
  // Cualquier mesa del piso.
  def({ type: 'wins', goal: 3, base: 4, text: 'Gana 3 rondas con premio de ×2 o más', step: (r) => (winsAt(r, 2) ? 1 : 0) }),
  def({ type: 'wins3', goal: 2, base: 4, text: 'Gana 2 rondas con premio de ×3 o más', step: (r) => (winsAt(r, 3) ? 1 : 0) }),
  def({ type: 'big5', goal: 1, base: 3, text: 'Consigue un premio de ×5 o más', step: (r) => (winsAt(r, 5) ? 1 : 0) }),
  def({ type: 'big10', goal: 1, base: 6, text: 'Consigue un premio de ×10 o más', step: (r) => (winsAt(r, 10) ? 1 : 0) }),
  def({ type: 'big25', goal: 1, base: 15, text: 'Consigue un premio de ×25 o más', step: (r) => (winsAt(r, 25) ? 1 : 0) }),
  def({ type: 'streak', goal: 3, base: 9, text: 'Encadena 3 victorias seguidas de ×2 o más', special: 'streak' }),
  // Subsuelo.
  def({ type: 'dice-sniper', game: 'dice', goal: 1, base: 6, text: 'Acierta una tirada de dados con un 10 % de probabilidad o menos', step: (r) => (isGame(r, 'dice') && r.net > 0 && r.chance <= 10 ? 1 : 0) }),
  def({ type: 'mines-deep', game: 'mines', goal: 1, base: 3, text: 'Retírate en Minas con ×5 o más', step: (r) => (isGame(r, 'mines') && winsAt(r, 5) ? 1 : 0) }),
  def({ type: 'tower-top', game: 'towers', goal: 1, base: 15, text: 'Corona la Torre de la Muerte (8 pisos)', step: (r) => (isGame(r, 'towers') && hasTag(r, 'towers-top') ? 1 : 0) }),
  // Bahía Arcade.
  def({ type: 'fish-big', game: 'fish', goal: 3, base: 3, text: 'Captura 3 Medusas Eléctricas o criaturas mayores en Cyber-Fish', step: (r) => (isGame(r, 'fish') ? Math.max(0, r.bigCatches | 0) : 0) }),
  def({ type: 'fish-shark', game: 'fish', goal: 1, base: 8, text: 'Captura un Tiburón Martillo Blindado', step: (r) => (isGame(r, 'fish') && hasTag(r, 'fish-shark') ? 1 : 0) }),
  def({ type: 'fish-kraken', game: 'fish', goal: 1, base: 40, text: 'Derrota al Mega Kraken en Cyber-Fish', step: (r) => (isGame(r, 'fish') && hasTag(r, 'fish-kraken') ? 1 : 0) }),
  def({ type: 'plinko-edge', game: 'plinko', goal: 1, base: 8, text: 'Cae en una cubeta de ×10 o más en Plinko', step: (r) => (isGame(r, 'plinko') && winsAt(r, 10) ? 1 : 0) }),
  def({ type: 'cascade', game: 'slots', goal: 1, base: 7, text: 'Consigue 2 avalanchas en un solo giro de las slots', step: (r) => (hasTag(r, 'cascade2') ? 1 : 0) }),
  def({ type: 'free-spins', game: 'slots', goal: 1, base: 161, text: 'Activa los giros gratis de las slots', step: (r) => (hasTag(r, 'freespins') ? 1 : 0) }),
  // Salón VIP.
  def({ type: 'crash-3', game: 'crash', goal: 2, base: 4, text: 'Retírate 2 veces en Crash a ×3 o más', step: (r) => (isGame(r, 'crash') && winsAt(r, 3) ? 1 : 0) }),
  def({ type: 'straight', game: 'roulette', goal: 1, base: 22, text: 'Acierta un pleno en la ruleta', step: (r) => (hasTag(r, 'straight') ? 1 : 0) }),
  def({ type: 'dozen', game: 'roulette', goal: 2, base: 4, text: 'Cobra 2 docenas o columnas en la ruleta', step: (r) => (hasTag(r, 'dozen') ? 1 : 0) }),
  def({ type: 'call', game: 'roulette', goal: 1, base: 3, text: 'Cobra una apuesta anunciada del racetrack', step: (r) => (hasTag(r, 'call-win') ? 1 : 0) }),
  def({ type: 'vp-trips', game: 'video_poker', goal: 1, base: 5, text: 'Consigue un trío o mejor en Video Póker', step: (r) => (isGame(r, 'video_poker') && VP_TRIPS.some((tag) => hasTag(r, tag)) ? 1 : 0) }),
  // Cripto-Olympus.
  def({ type: 'natural', game: 'blackjack', goal: 1, base: 13, text: 'Consigue un Blackjack natural', step: (r) => (hasTag(r, 'natural') ? 1 : 0) }),
  def({ type: 'double', game: 'blackjack', goal: 1, base: 11, text: 'Gana una mano de blackjack doblada', step: (r) => (hasTag(r, 'double-win') ? 1 : 0) }),
  def({ type: 'split', game: 'blackjack', goal: 1, base: 48, text: 'Gana una mano de blackjack dividida', step: (r) => (hasTag(r, 'split-win') ? 1 : 0) }),
  def({ type: 'side', game: 'blackjack', goal: 1, base: 4, text: 'Cobra un Perfect Pairs o un 21+3', step: (r) => (hasTag(r, 'side-win') ? 1 : 0) }),
]);

export const contractType = (type) => CONTRACT_TYPES.find((item) => item.type === type) ?? null;

// Encargos posibles en un piso: los generales y los de sus mesas.
export const contractPool = (floor) => CONTRACT_TYPES.filter((item) => !item.game || floor.games.includes(item.game));

// Nuevo encargo para el piso, distinto de los tipos de `exclude`. Las mesas recién abiertas en el
// piso tienen el doble de peso: cada piso empuja a probar sus juegos nuevos.
export function drawContract(floor, exclude = [], rand = randomInt) {
  let pool = contractPool(floor).filter((item) => !exclude.includes(item.type));
  if (!pool.length) pool = contractPool(floor);
  const weights = pool.map((item) => (item.game && floor.unlocks.includes(item.game) ? 2 : 1));
  let roll = rand(weights.reduce((sum, weight) => sum + weight, 0));
  let chosen = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    if (roll < weights[i]) {
      chosen = pool[i];
      break;
    }
    roll -= weights[i];
  }
  return { type: chosen.type, text: chosen.text, goal: chosen.goal, progress: 0, reward: chosen.base * floor.contractFactor };
}

// Progreso tras una ronda. `round` = { game, stake, returned, net, tags, … }; `streak` = racha
// actual de victorias de ×2 o más.
export function advanceContract(contract, round, streak) {
  const item = contractType(contract.type);
  if (!item) return contract.progress;
  if (item.special === 'streak') return Math.max(contract.progress, Math.min(item.goal, streak));
  const step = item.step(round);
  return step > 0 ? Math.min(item.goal, contract.progress + step) : contract.progress;
}

// ¿Cuenta la ronda para la racha de los encargos? (premio de ×2 o más).
export const strongWin = (round) => winsAt(round, 2);
