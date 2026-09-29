// Auditoría matemática: RNG, store, monedero VIP, blackjack (apuestas laterales, estrategia
// básica, Hi-Lo), ruleta (tapete y apuestas anunciadas) y slots (avalancha, bono y RTP).
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomInt, shuffle, weightedIndex, houseEdge } from '../js/engine/rng.js';
import { Store, PHASE } from '../js/engine/store.js';
import { STARTING_BALANCE, DENOMINATIONS } from '../js/engine/wallet.js';
import {
  buildShoe, handValue, isBlackjack, dealerShouldHit, settleHand, canSplitHand, canDoubleHand,
  SHOE_SIZE, CUT_CARD, perfectPairsResult, twentyOnePlusThreeResult, sideBetEdges, SIDE_BET_HOUSE_EDGE,
  basicStrategy, hiLoValue, trueCount,
} from '../js/games/blackjack-rules.js';
import {
  WHEEL_ORDER, RED, POCKETS, betDefinition, payoutFor, houseEdgeOf, boardSpots,
  CALL_BETS, sectorNumbers, neighborsOf, callBetParts,
} from '../js/games/roulette.js';
import {
  SYMBOLS, LINES, CASCADE_MULTIPLIERS, GOLDEN, SLOT_MATH, BONUS_BUY_COST, MAX_WIN,
  findWins, collapse, resolveTumbles, scatterAward, playSpin, playFreeSpinsRound,
} from '../js/games/slots-engine.js';

// PRNG determinista (mulberry32) solo para las simulaciones de las pruebas; el juego usa crypto.
function seeded(seed) {
  let a = seed;
  const next = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
  return (n) => Math.floor((next() / 4294967296) * n);
}

// ---------- RNG ----------

test('randomInt es uniforme (chi-cuadrado, 37 casillas)', () => {
  const n = 370000;
  const counts = new Array(37).fill(0);
  for (let i = 0; i < n; i++) counts[randomInt(37)]++;
  const expected = n / 37;
  const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
  // 36 grados de libertad: p = 0.001 → 67.98
  assert.ok(chi2 < 68, `chi² demasiado alto: ${chi2.toFixed(2)}`);
});

test('Fisher-Yates conserva el multiconjunto y reparte posiciones uniformemente', () => {
  const trials = 60000;
  const firstSlot = [0, 0, 0, 0];
  for (let t = 0; t < trials; t++) firstSlot[shuffle([0, 1, 2, 3])[0]]++;
  for (const c of firstSlot) assert.ok(Math.abs(c / trials - 0.25) < 0.01);
  const shoe = shuffle(buildShoe());
  assert.equal(shoe.length, 312);
  assert.deepEqual([...shoe].sort(), buildShoe().sort());
});

test('weightedIndex respeta los pesos', () => {
  const counts = [0, 0, 0];
  const n = 200000;
  for (let i = 0; i < n; i++) counts[weightedIndex([1, 3, 6])]++;
  assert.ok(Math.abs(counts[2] / n - 0.6) < 0.01);
  assert.ok(Math.abs(counts[0] / n - 0.1) < 0.01);
});

// ---------- Store y monedero ----------

test('Store bloquea transiciones ilegales y congela el estado', () => {
  const store = new Store('test', { phase: PHASE.IDLE, value: 1 });
  assert.throws(() => store.commit('BAD', { phase: PHASE.PAYOUT }), /transición ilegal/);
  store.commit('BET', { phase: PHASE.BETTING });
  store.commit('DEAL', { phase: PHASE.DEALING });
  store.commit('RESOLVE', { phase: PHASE.RESOLVING });
  store.commit('PAY', { phase: PHASE.PAYOUT });
  assert.equal(store.phase, PHASE.PAYOUT);
  assert.throws(() => {
    store.state.value = 2;
  });
});

test('Economía hardcore: se empieza con 1 crédito y fichas de 1 a 10.000', () => {
  assert.equal(STARTING_BALANCE, 1);
  assert.deepEqual(DENOMINATIONS, [1, 5, 10, 25, 100, 500, 1000, 5000, 10000]);
});

// ---------- Blackjack ----------

test('Zapato de 6 barajas con corte al 75 %', () => {
  assert.equal(SHOE_SIZE, 312);
  assert.equal(CUT_CARD, 234);
  assert.equal(buildShoe().filter((c) => c.startsWith('A')).length, 24);
});

test('Valor de manos blandas y duras, crupier S17', () => {
  assert.deepEqual(handValue(['AS', '6H']), { total: 17, soft: true });
  assert.deepEqual(handValue(['AS', '6H', '10D']), { total: 17, soft: false });
  assert.deepEqual(handValue(['AS', 'AH', '9D']), { total: 21, soft: true });
  assert.ok(isBlackjack(['AS', 'KD']));
  assert.ok(dealerShouldHit(['10S', '6H']));
  assert.ok(!dealerShouldHit(['AS', '6H']));
});

test('Liquidación: BJ 3:2, empates, manos divididas', () => {
  const hand = (cards, extra = {}) => ({ cards, bet: 100, fromSplit: false, ...extra });
  assert.deepEqual(settleHand(hand(['AS', 'KD']), ['10H', '9C']), { result: 'blackjack', payout: 250 });
  assert.deepEqual(settleHand(hand(['AS', 'KD']), ['AH', 'QC']), { result: 'push', payout: 100 });
  assert.deepEqual(settleHand(hand(['10S', '9D']), ['AH', 'QC']), { result: 'lose', payout: 0 });
  assert.deepEqual(settleHand(hand(['10S', '9D']), ['10H', '6C', '8D']), { result: 'win', payout: 200 });
  assert.deepEqual(settleHand(hand(['10S', '9D', '5C']), ['10H', '6C', '8D']), { result: 'bust', payout: 0 });
  assert.deepEqual(settleHand(hand(['AS', 'KD'], { fromSplit: true }), ['10H', '9C']), { result: 'win', payout: 200 });
  assert.equal(settleHand({ cards: ['AS', 'KD'], bet: 25, fromSplit: false }, ['9H', '9C']).payout, 62.5);
  assert.ok(canSplitHand({ cards: ['KS', '10D'] }, 1));
  assert.ok(!canSplitHand({ cards: ['8S', '8D'] }, 4));
  assert.ok(!canDoubleHand({ cards: ['5S', '6D', '2C'] }));
});

test('Perfect Pairs y 21+3: clasificación de manos', () => {
  assert.equal(perfectPairsResult('7H', '7H').kind, 'perfect');
  assert.equal(perfectPairsResult('7H', '7D').kind, 'colored');
  assert.equal(perfectPairsResult('7H', '7S').kind, 'mixed');
  assert.equal(perfectPairsResult('7H', '8H'), null);
  assert.equal(twentyOnePlusThreeResult('7S', '7S', '7S').kind, 'suitedTrips');
  assert.equal(twentyOnePlusThreeResult('9C', '10C', 'JC').kind, 'straightFlush');
  assert.equal(twentyOnePlusThreeResult('7S', '7H', '7D').kind, 'trips');
  assert.equal(twentyOnePlusThreeResult('QS', 'KD', 'AC').kind, 'straight');
  assert.equal(twentyOnePlusThreeResult('AS', '2D', '3C').kind, 'straight');
  assert.equal(twentyOnePlusThreeResult('KS', 'AD', '2C'), null);
  assert.equal(twentyOnePlusThreeResult('2H', '9H', 'KH').kind, 'flush');
});

test('Ventaja exacta de las apuestas laterales (enumeración del zapato)', () => {
  const six = sideBetEdges(6);
  assert.ok(Math.abs(six.perfectPairs - SIDE_BET_HOUSE_EDGE.perfectPairs) < 5e-5, `PP ${six.perfectPairs}`);
  assert.ok(Math.abs(six.twentyOnePlusThree - SIDE_BET_HOUSE_EDGE.twentyOnePlusThree) < 5e-5, `21+3 ${six.twentyOnePlusThree}`);
  // Valores publicados para 8 barajas (Wizard of Odds): 4,10 % y 3,70 %.
  const eight = sideBetEdges(8);
  assert.ok(Math.abs(eight.perfectPairs - 0.041) < 5e-4);
  assert.ok(Math.abs(eight.twentyOnePlusThree - 0.037) < 5e-4);
});

test('Estrategia básica 6 barajas S17 DAS', () => {
  const act = (cards, up, options) => basicStrategy(cards, up, options).action;
  assert.equal(act(['5S', '6H'], '6D'), 'double');
  assert.equal(act(['5S', '6H'], 'AD'), 'hit');
  assert.equal(act(['10S', '2H'], '3D'), 'hit');
  assert.equal(act(['10S', '2H'], '4D'), 'stand');
  assert.equal(act(['10S', '6H'], '7D'), 'hit');
  assert.equal(act(['10S', '6H'], '6D'), 'stand');
  assert.equal(act(['AS', '7H'], '3D'), 'double');
  assert.equal(act(['AS', '7H'], '2D'), 'stand');
  assert.equal(act(['AS', '7H'], '9D'), 'hit');
  assert.equal(act(['AS', '4H', '3C'], '3D', { canDouble: false }), 'stand');
  assert.equal(act(['8S', '8H'], 'KD', { canSplit: true }), 'split');
  assert.equal(act(['9S', '9H'], '7D', { canSplit: true }), 'stand');
  assert.equal(act(['5S', '5H'], '9D', { canSplit: true }), 'double');
  assert.equal(act(['AS', 'AH'], '5D'), 'hit');
});

test('Hi-Lo: conteo balanceado y True Count', () => {
  assert.equal(buildShoe().reduce((sum, card) => sum + hiLoValue(card), 0), 0);
  assert.equal(hiLoValue('5H'), 1);
  assert.equal(hiLoValue('8H'), 0);
  assert.equal(hiLoValue('AH'), -1);
  assert.equal(hiLoValue('QH'), -1);
  assert.equal(trueCount(6, 104), 3);
});

// ---------- Ruleta ----------

test('Plato europeo: 37 casillas únicas, 18 rojos, colores alternos', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.equal(new Set(WHEEL_ORDER).size, 37);
  assert.equal(RED.size, 18);
  for (let i = 1; i < 36; i++) assert.notEqual(RED.has(WHEEL_ORDER[i]), RED.has(WHEEL_ORDER[i + 1]));
});

test('Todas las apuestas del tapete tienen ventaja de la casa 2,70 %', () => {
  const keys = [...boardSpots().map((s) => s.key), 'dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3', 'red', 'black', 'even', 'odd', 'low', 'high'];
  for (const key of keys) assert.ok(Math.abs(houseEdgeOf(key) - 1 / 37) < 1e-12, `${key}: ${houseEdgeOf(key)}`);
  assert.ok(Math.abs(houseEdge(35, 1 / 37) - 0.027027) < 1e-6);
});

test('Pagos del tapete y geometría (incluidas divididas y tríos con el cero)', () => {
  assert.equal(betDefinition('straight:17').pays, 35);
  assert.equal(betDefinition('split:17-20').pays, 17);
  assert.equal(betDefinition('street:0-2-3').pays, 11);
  assert.match(betDefinition('street:0-2-3').label, /Trío/);
  assert.equal(betDefinition('corner:16-17-19-20').pays, 8);
  assert.equal(payoutFor({ 'straight:17': 10, red: 10, 'dozen:3': 10 }, 17), 360);
  assert.equal(payoutFor({ red: 10, black: 10, even: 10 }, 0), 0);
  const spots = boardSpots();
  assert.equal(spots.filter((s) => s.key.startsWith('split')).length, 60);
  assert.equal(spots.filter((s) => s.key.startsWith('corner')).length, 22);
  assert.equal(spots.filter((s) => s.key.startsWith('street')).length, 14);
});

test('Apuestas anunciadas francesas: fichas, números cubiertos y ventaja 2,70 %', () => {
  const units = (sector) => CALL_BETS[sector].parts.reduce((sum, [, n]) => sum + n, 0);
  assert.equal(units('voisins'), 9);
  assert.equal(units('tiers'), 6);
  assert.equal(units('orphelins'), 5);
  assert.equal(units('zero'), 4);
  assert.equal(sectorNumbers('voisins').length, 17);
  assert.equal(sectorNumbers('tiers').length, 12);
  assert.equal(sectorNumbers('orphelins').length, 8);
  assert.equal(sectorNumbers('zero').length, 7);
  const all = new Set([...sectorNumbers('voisins'), ...sectorNumbers('tiers'), ...sectorNumbers('orphelins')]);
  assert.equal(all.size, 37);
  // Cada sector es un arco contiguo del plato (Orphelins son dos arcos).
  const index = (n) => WHEEL_ORDER.indexOf(n);
  const tiers = sectorNumbers('tiers').map(index).sort((a, b) => a - b);
  assert.equal(tiers[tiers.length - 1] - tiers[0], 11);
  assert.deepEqual(neighborsOf(0, 2), [3, 26, 0, 32, 15]);
  assert.deepEqual(neighborsOf(26, 1), [3, 26, 0]);
  const edge = (parts) => {
    const stake = parts.reduce((sum, p) => sum + p.amount, 0);
    const bets = Object.fromEntries(parts.map((p) => [p.key, p.amount]));
    let returned = 0;
    for (let n = 0; n < POCKETS; n++) returned += payoutFor(bets, n);
    return 1 - returned / POCKETS / stake;
  };
  for (const type of ['voisins', 'tiers', 'orphelins', 'zero']) {
    assert.ok(Math.abs(edge(callBetParts({ type }, 10)) - 1 / 37) < 1e-12, type);
  }
  assert.ok(Math.abs(edge(callBetParts({ type: 'neighbors', number: 17, count: 3 }, 10)) - 1 / 37) < 1e-12);
});

// ---------- Slots ----------

test('Pesos de símbolos (base y giros gratis) suman 1000 y hay 10 líneas', () => {
  assert.equal(SYMBOLS.reduce((sum, s) => sum + s.base, 0), 1000);
  assert.equal(SYMBOLS.reduce((sum, s) => sum + s.free, 0), 1000);
  assert.equal(GOLDEN.reduce((sum, [, w]) => sum + w, 0), 1000);
  assert.equal(LINES.length, 10);
  assert.deepEqual(CASCADE_MULTIPLIERS, [1, 2, 3, 5]);
});

test('Líneas, Súper Bono ×15 y scatter', () => {
  const grid = [
    ['C', 'C', 'C', 'C'],
    ['R', 'R', 'R', 'T'],
    ['D', 'H', 'D', 'B'],
    ['T', 'B', 'D', 'S'],
  ];
  const wins = findWins(grid);
  assert.equal(wins.lines.find((l) => l.index === 0).units, 50 * 15);
  assert.equal(wins.lines.find((l) => l.index === 1).units, 1);
  assert.equal(wins.units, 751);
  assert.equal(wins.cells.length, 7);
  assert.equal(scatterAward(3).spins, 10);
  assert.equal(scatterAward(9).spins, 15);
});

test('Avalancha: gravedad, relleno desde arriba y multiplicadores ×1 ×2 ×3 ×5', () => {
  const grid = [
    ['R', 'B', 'H', 'T'],
    ['S', 'C', 'B', 'H'],
    ['R', 'R', 'R', 'S'],
    ['T', 'H', 'S', 'B'],
  ];
  const { grid: next, columns } = collapse(grid, [[2, 0], [2, 1], [2, 2]], () => 'D');
  assert.deepEqual(next.map((row) => row.join('')), ['DDDT', 'RBHH', 'SCBS', 'THSB']);
  assert.deepEqual(columns[0].sources, [null, 0, 1, 3]);
  assert.equal(columns[3].fresh, 0);

  // Cada relleno forma una nueva fila superior de coronas → cascadas encadenadas.
  const start = [
    ['H', 'H', 'H', 'T'],
    ['S', 'B', 'R', 'D'],
    ['B', 'R', 'S', 'D'],
    ['R', 'S', 'B', 'T'],
  ];
  let fills = 0;
  const draw = () => (fills++ < 9 ? 'C' : 'D');
  const { steps, units } = resolveTumbles(start, draw);
  assert.deepEqual(steps.map((s) => s.multiplier), [1, 2, 3, 5]);
  assert.deepEqual(steps.map((s) => s.units), [4, 50, 50, 50]);
  assert.equal(units, 4 + 50 * 2 + 50 * 3 + 50 * 5);
});

test('Giro determinista con RNG inyectado y tope de premio', () => {
  const spin = playSpin({ bet: 10, rand: seeded(7) });
  assert.equal(spin.total, Math.min(spin.lineWin + spin.scatterWin, MAX_WIN * 10));
  const free = playSpin({ bet: 10, mode: 'free', rand: seeded(8) });
  assert.ok(GOLDEN.some(([value]) => value === free.golden));
  assert.equal(free.scatterWin, 0);
  const round = playFreeSpinsRound({ bet: 10, rand: seeded(9) });
  assert.ok(round.played >= 10 && round.total <= MAX_WIN * 10);
});

test('Monte Carlo del motor real: líneas y scatter del juego base coinciden con SLOT_MATH', () => {
  const rand = seeded(2026);
  const spins = 300000;
  let lines = 0;
  let scatter = 0;
  for (let i = 0; i < spins; i++) {
    const spin = playSpin({ bet: 10, rand });
    const lineWin = Math.min(spin.lineWin, spin.total);
    lines += lineWin;
    scatter += spin.total - lineWin;
  }
  const measured = (lines + scatter) / (spins * 10);
  assert.ok(Math.abs(measured - (SLOT_MATH.lines + SLOT_MATH.scatter)) < 0.02, `líneas+scatter ${measured}`);
});

test('Monte Carlo del Bonus Buy: RTP de la compra ≈ SLOT_MATH.bonusBuyRtp', () => {
  const rand = seeded(96);
  const rounds = 40000;
  let total = 0;
  for (let i = 0; i < rounds; i++) total += playFreeSpinsRound({ bet: 10, rand }).total;
  const rtp = total / rounds / (BONUS_BUY_COST * 10);
  assert.ok(Math.abs(rtp - SLOT_MATH.bonusBuyRtp) < 0.05, `compra ${rtp}`);
  assert.ok(Math.abs(SLOT_MATH.rtp - 0.96) < 0.01 && Math.abs(SLOT_MATH.bonusBuyRtp - 0.96) < 0.01);
});
