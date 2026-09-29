// Reglas puras del blackjack (sin DOM): zapato, valores, liquidación, apuestas laterales
// Perfect Pairs y 21+3, estrategia básica 6 barajas S17 DAS y conteo Hi-Lo.

import { shuffle } from '../engine/rng.js';

export const DECKS = 6;
export const SHOE_SIZE = DECKS * 52;
export const CUT_CARD = Math.floor(SHOE_SIZE * 0.75);
export const BLACKJACK_PAYS = 1.5;
export const MAX_HANDS_PER_SEAT = 4;

export const RANKS = Object.freeze(['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']);
export const SUITS = Object.freeze(['S', 'H', 'D', 'C']);
const RED_SUITS = new Set(['H', 'D']);
const money = (value) => Math.round(value * 100) / 100;

// ---------- Zapato y valores ----------

export function buildShoe(decks = DECKS) {
  const cards = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) for (const rank of RANKS) cards.push(rank + suit);
  }
  return cards;
}

export const newShuffledShoe = () => shuffle(buildShoe());
export const rankOf = (card) => card.slice(0, -1);
export const suitOf = (card) => card.slice(-1);

export function cardValue(card) {
  const rank = rankOf(card);
  if (rank === 'A') return 11;
  if (rank === 'K' || rank === 'Q' || rank === 'J') return 10;
  return Number(rank);
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const value = cardValue(card);
    if (value === 11) aces++;
    total += value;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;
export const isNatural = (hand) => !hand.fromSplit && isBlackjack(hand.cards);
export const dealerShouldHit = (cards) => handValue(cards).total < 17;

export function canSplitHand(hand, seatHandCount) {
  return (
    hand.cards.length === 2 &&
    !hand.splitAces &&
    !hand.doubled &&
    seatHandCount < MAX_HANDS_PER_SEAT &&
    cardValue(hand.cards[0]) === cardValue(hand.cards[1])
  );
}

export const canDoubleHand = (hand) => hand.cards.length === 2 && !hand.splitAces && !hand.doubled;

// Devuelve el resultado y el importe total devuelto al jugador (apuesta incluida).
export function settleHand(hand, dealerCards) {
  const player = handValue(hand.cards).total;
  const dealer = handValue(dealerCards).total;
  const natural = isNatural(hand);
  const dealerNatural = isBlackjack(dealerCards);
  if (natural && dealerNatural) return { result: 'push', payout: hand.bet };
  if (natural) return { result: 'blackjack', payout: money(hand.bet * (1 + BLACKJACK_PAYS)) };
  if (dealerNatural) return { result: 'lose', payout: 0 };
  if (player > 21) return { result: 'bust', payout: 0 };
  if (dealer > 21 || player > dealer) return { result: 'win', payout: hand.bet * 2 };
  if (player === dealer) return { result: 'push', payout: hand.bet };
  return { result: 'lose', payout: 0 };
}

// ---------- Apuestas laterales ----------

export const PERFECT_PAIRS = Object.freeze({
  perfect: Object.freeze({ kind: 'perfect', name: 'Pareja perfecta', pays: 25 }),
  colored: Object.freeze({ kind: 'colored', name: 'Pareja de color', pays: 12 }),
  mixed: Object.freeze({ kind: 'mixed', name: 'Pareja mixta', pays: 6 }),
});

// Perfect Pairs: las dos primeras cartas del jugador forman pareja.
export function perfectPairsResult(first, second) {
  if (rankOf(first) !== rankOf(second)) return null;
  if (suitOf(first) === suitOf(second)) return PERFECT_PAIRS.perfect;
  if (RED_SUITS.has(suitOf(first)) === RED_SUITS.has(suitOf(second))) return PERFECT_PAIRS.colored;
  return PERFECT_PAIRS.mixed;
}

export const TWENTY_ONE_PLUS_THREE = Object.freeze({
  suitedTrips: Object.freeze({ kind: 'suitedTrips', name: 'Trío del mismo palo', pays: 100 }),
  straightFlush: Object.freeze({ kind: 'straightFlush', name: 'Escalera de color', pays: 40 }),
  trips: Object.freeze({ kind: 'trips', name: 'Trío', pays: 30 }),
  straight: Object.freeze({ kind: 'straight', name: 'Escalera', pays: 10 }),
  flush: Object.freeze({ kind: 'flush', name: 'Color', pays: 5 }),
});

const POKER_ORDER = { A: 1, J: 11, Q: 12, K: 13 };
const pokerValue = (rank) => POKER_ORDER[rank] ?? Number(rank);

// Escalera de tres cartas: A-2-3 y Q-K-A son válidas; K-A-2 no.
function isStraight(ranks) {
  const values = ranks.map(pokerValue).sort((a, b) => a - b);
  if (new Set(values).size !== 3) return false;
  if (values[2] - values[0] === 2) return true;
  return values[0] === 1 && values[1] === 12 && values[2] === 13;
}

// 21+3: las dos cartas del jugador + la carta visible del crupier como mano de póquer.
export function twentyOnePlusThreeResult(first, second, dealerUp) {
  const cards = [first, second, dealerUp];
  const ranks = cards.map(rankOf);
  const flush = cards.every((card) => suitOf(card) === suitOf(first));
  const trips = ranks.every((rank) => rank === ranks[0]);
  const straight = isStraight(ranks);
  if (trips && flush) return TWENTY_ONE_PLUS_THREE.suitedTrips;
  if (straight && flush) return TWENTY_ONE_PLUS_THREE.straightFlush;
  if (trips) return TWENTY_ONE_PLUS_THREE.trips;
  if (straight) return TWENTY_ONE_PLUS_THREE.straight;
  if (flush) return TWENTY_ONE_PLUS_THREE.flush;
  return null;
}

// Ventaja de la casa publicada en la mesa (6 barajas); las pruebas la recalculan con sideBetEdges().
export const SIDE_BET_HOUSE_EDGE = Object.freeze({ perfectPairs: 0.0611, twentyOnePlusThree: 0.0462 });

// Ventaja exacta de la casa con el zapato completo, enumerando cartas con sus multiplicidades
// (extracciones sin reemplazo de un zapato de `decks` barajas).
export function sideBetEdges(decks = DECKS) {
  const identities = buildShoe(1);
  const n = identities.length * decks;

  let pairsReturn = 0;
  for (let i = 0; i < 52; i++) {
    for (let j = 0; j < 52; j++) {
      const ways = decks * (decks - (i === j ? 1 : 0));
      const result = perfectPairsResult(identities[i], identities[j]);
      if (result) pairsReturn += ways * (result.pays + 1);
    }
  }

  let pokerReturn = 0;
  for (let i = 0; i < 52; i++) {
    for (let j = 0; j < 52; j++) {
      const second = decks - (i === j ? 1 : 0);
      for (let k = 0; k < 52; k++) {
        const third = decks - (k === i ? 1 : 0) - (k === j ? 1 : 0);
        if (third <= 0 || second <= 0) continue;
        const result = twentyOnePlusThreeResult(identities[i], identities[j], identities[k]);
        if (result) pokerReturn += decks * second * third * (result.pays + 1);
      }
    }
  }

  return {
    perfectPairs: 1 - pairsReturn / (n * (n - 1)),
    twentyOnePlusThree: 1 - pokerReturn / (n * (n - 1) * (n - 2)),
  };
}

// ---------- Estrategia básica (6 barajas, S17, DAS, sin rendición) ----------
// Columnas: carta visible del crupier 2 3 4 5 6 7 8 9 10 A.
// H pedir · S plantarse · D doblar (si no se puede, pedir) · X doblar (si no, plantarse) · P dividir.

const HARD = {
  9: 'HDDDDHHHHH',
  10: 'DDDDDDDDHH',
  11: 'DDDDDDDDDH',
  12: 'HHSSSHHHHH',
  13: 'SSSSSHHHHH',
  14: 'SSSSSHHHHH',
  15: 'SSSSSHHHHH',
  16: 'SSSSSHHHHH',
};

const SOFT = {
  13: 'HHHDDHHHHH',
  14: 'HHHDDHHHHH',
  15: 'HHDDDHHHHH',
  16: 'HHDDDHHHHH',
  17: 'HDDDDHHHHH',
  18: 'SXXXXSSHHH',
};

const PAIRS = {
  2: 'PPPPPPHHHH',
  3: 'PPPPPPHHHH',
  4: 'HHHPPHHHHH',
  6: 'PPPPPHHHHH',
  7: 'PPPPPPHHHH',
  8: 'PPPPPPPPPP',
  9: 'PPPPPSPPSS',
  10: 'SSSSSSSSSS',
  11: 'PPPPPPPPPP',
};

const dealerColumn = (card) => {
  const value = cardValue(card);
  return value === 11 ? 9 : value - 2;
};

export function basicStrategy(cards, dealerUp, { canDouble = cards.length === 2, canSplit = false } = {}) {
  const column = dealerColumn(dealerUp);
  const { total, soft } = handValue(cards);

  if (cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1])) {
    const row = PAIRS[cardValue(cards[0])];
    if (row && row[column] === 'P' && canSplit) return { action: 'split', kind: 'pair', total };
  }

  let code;
  let kind;
  if (soft) {
    kind = 'soft';
    if (total >= 19) code = 'S';
    else if (total <= 12) code = 'H';
    else code = SOFT[total][column];
  } else {
    kind = 'hard';
    if (total >= 17) code = 'S';
    else if (total <= 8) code = 'H';
    else code = HARD[total][column];
  }
  if (code === 'D') return { action: canDouble ? 'double' : 'hit', kind, total };
  if (code === 'X') return { action: canDouble ? 'double' : 'stand', kind, total };
  return { action: code === 'S' ? 'stand' : 'hit', kind, total };
}

// ---------- Conteo Hi-Lo ----------

export function hiLoValue(card) {
  const value = cardValue(card);
  if (value >= 2 && value <= 6) return 1;
  if (value >= 10) return -1;
  return 0;
}

export function trueCount(running, cardsRemaining) {
  const decks = cardsRemaining / 52;
  return decks > 0 ? running / decks : 0;
}

// El seguro solo tiene expectativa positiva con True Count Hi-Lo ≥ +3.
export const INSURANCE_TRUE_COUNT = 3;
