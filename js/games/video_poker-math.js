// Video Póker Jacks or Better 9/6 (sin DOM). Baraja de 52 cartas barajada con el flujo
// verificable: las 5 primeras forman la mano y las 5 siguientes reponen los descartes en orden.
// Pagos «por 1» (devuelven la apuesta incluida), la convención estándar de las máquinas:
// Jotas o mejor 1, Doble pareja 2, Trío 3, Escalera 4, Color 6, Full 9, Póker 25,
// Escalera de color 50 y Escalera real 250 (800 con la apuesta máxima de 5 créditos).
// Con estrategia óptima y apuesta máxima el retorno es del 99,54 %.

export const MAX_COINS = 5;
export const RANKS = Object.freeze(['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
export const SUITS = Object.freeze(['S', 'H', 'D', 'C']);

export const PAYTABLE = Object.freeze([
  Object.freeze({ id: 'royal', name: 'Escalera Real', pays: 250, maxPays: 800 }),
  Object.freeze({ id: 'straightFlush', name: 'Escalera de Color', pays: 50 }),
  Object.freeze({ id: 'fourKind', name: 'Póker', pays: 25 }),
  Object.freeze({ id: 'fullHouse', name: 'Full', pays: 9 }),
  Object.freeze({ id: 'flush', name: 'Color', pays: 6 }),
  Object.freeze({ id: 'straight', name: 'Escalera', pays: 4 }),
  Object.freeze({ id: 'threeKind', name: 'Trío', pays: 3 }),
  Object.freeze({ id: 'twoPair', name: 'Doble Pareja', pays: 2 }),
  Object.freeze({ id: 'jacks', name: 'Jotas o Mejor', pays: 1 }),
]);
export const PAY_BY_ID = Object.freeze(Object.fromEntries(PAYTABLE.map((row) => [row.id, row])));

export const newDeck = () => SUITS.flatMap((suit) => RANKS.map((rank) => `${rank}${suit}`));
const rankIndex = (card) => RANKS.indexOf(card.slice(0, -1));
const suitOf = (card) => card.slice(-1);

// Clasifica una mano de 5 cartas; devuelve la fila de la tabla o null.
export function evaluateHand(cards) {
  const ranks = cards.map(rankIndex).sort((a, b) => a - b);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);
  const flush = cards.every((card) => suitOf(card) === suitOf(cards[0]));
  const distinct = counts.size === 5;
  const wheel = distinct && ranks[4] === 12 && ranks[3] === 3; // A-2-3-4-5
  const straight = distinct && (ranks[4] - ranks[0] === 4 || wheel);
  if (straight && flush) return ranks[0] === 8 && ranks[4] === 12 ? PAY_BY_ID.royal : PAY_BY_ID.straightFlush;
  if (groups[0] === 4) return PAY_BY_ID.fourKind;
  if (groups[0] === 3 && groups[1] === 2) return PAY_BY_ID.fullHouse;
  if (flush) return PAY_BY_ID.flush;
  if (straight) return PAY_BY_ID.straight;
  if (groups[0] === 3) return PAY_BY_ID.threeKind;
  if (groups[0] === 2 && groups[1] === 2) return PAY_BY_ID.twoPair;
  if (groups[0] === 2) {
    const pair = [...counts.entries()].find(([, n]) => n === 2)[0];
    if (pair >= RANKS.indexOf('J')) return PAY_BY_ID.jacks;
  }
  return null;
}

// Pago por crédito apostado de una mano (la real paga 800 solo con 5 créditos).
export function payPerCoin(row, coins) {
  if (!row) return 0;
  return row.maxPays && coins >= MAX_COINS ? row.maxPays : row.pays;
}

// Reparto verificable: baraja completa, mano inicial y cartas de reposición.
export function dealHand(stream) {
  const deck = stream.shuffle(newDeck());
  return { deck, hand: deck.slice(0, 5) };
}

// Cambia las cartas no retenidas por las siguientes de la baraja, en orden.
export function drawCards(deck, hand, holds) {
  let next = 5;
  return hand.map((card, i) => (holds[i] ? card : deck[next++]));
}
