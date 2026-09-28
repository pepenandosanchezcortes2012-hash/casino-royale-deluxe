// Auditoría matemática: RNG, reglas de blackjack, ventaja de la ruleta y RTP de las slots.
// Ejecutar con: node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';

import { randomInt, shuffle, weightedIndex, houseEdge } from '../js/engine/rng.js';
import { Store, PHASE } from '../js/engine/store.js';
import {
  buildShoe, handValue, isBlackjack, dealerShouldHit, settleHand, canSplitHand, canDoubleHand,
  SHOE_SIZE, CUT_CARD,
} from '../js/games/blackjack.js';
import { WHEEL_ORDER, RED, betDefinition, payoutFor, houseEdgeOf, boardSpots } from '../js/games/roulette.js';
import {
  SYMBOLS, LINES, parSheet, evaluateGrid, spinGrid, spinWin, FS_MULTIPLIERS, freeSpinMultiplierSum, scatterAward,
} from '../js/games/slots.js';

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

// ---------- Store ----------

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

// ---------- Blackjack ----------

test('Zapato de 6 barajas con corte al 75 %', () => {
  assert.equal(SHOE_SIZE, 312);
  assert.equal(CUT_CARD, 234);
  const shoe = buildShoe();
  assert.equal(shoe.filter((c) => c.startsWith('A')).length, 24);
});

test('Valor de manos blandas y duras', () => {
  assert.deepEqual(handValue(['AS', '6H']), { total: 17, soft: true });
  assert.deepEqual(handValue(['AS', '6H', '10D']), { total: 17, soft: false });
  assert.deepEqual(handValue(['AS', 'AH', '9D']), { total: 21, soft: true });
  assert.equal(handValue(['KS', 'QH', '5D']).total, 25);
  assert.ok(isBlackjack(['AS', 'KD']));
  assert.ok(!isBlackjack(['7S', '7D', '7C']));
});

test('El crupier pide con 16 y se planta con 17, incluido el 17 blando', () => {
  assert.ok(dealerShouldHit(['10S', '6H']));
  assert.ok(!dealerShouldHit(['10S', '7H']));
  assert.ok(!dealerShouldHit(['AS', '6H']));
});

test('Liquidación: BJ 3:2, empates, manos divididas', () => {
  const hand = (cards, extra = {}) => ({ cards, bet: 100, fromSplit: false, ...extra });
  assert.deepEqual(settleHand(hand(['AS', 'KD']), ['10H', '9C']), { result: 'blackjack', payout: 250 });
  assert.deepEqual(settleHand(hand(['AS', 'KD']), ['AH', 'QC']), { result: 'push', payout: 100 });
  assert.deepEqual(settleHand(hand(['10S', '9D']), ['AH', 'QC']), { result: 'lose', payout: 0 });
  assert.deepEqual(settleHand(hand(['10S', '9D']), ['10H', '6C', '8D']), { result: 'win', payout: 200 });
  assert.deepEqual(settleHand(hand(['10S', '9D', '5C']), ['10H', '6C', '8D']), { result: 'bust', payout: 0 });
  assert.deepEqual(settleHand(hand(['10S', '8D']), ['10H', '8C']), { result: 'push', payout: 100 });
  assert.deepEqual(settleHand(hand(['AS', 'KD'], { fromSplit: true }), ['10H', '9C']), { result: 'win', payout: 200 });
  assert.equal(settleHand({ cards: ['AS', 'KD'], bet: 25, fromSplit: false }, ['9H', '9C']).payout, 62.5);
});

test('Reglas de dividir y doblar', () => {
  assert.ok(canSplitHand({ cards: ['8S', '8D'] }, 1));
  assert.ok(canSplitHand({ cards: ['KS', '10D'] }, 1));
  assert.ok(!canSplitHand({ cards: ['8S', '8D'] }, 4));
  assert.ok(!canSplitHand({ cards: ['AS', 'AD'], splitAces: true }, 2));
  assert.ok(canDoubleHand({ cards: ['5S', '6D'] }));
  assert.ok(!canDoubleHand({ cards: ['5S', '6D', '2C'] }));
});

// ---------- Ruleta ----------

test('Plato europeo: 37 casillas únicas, 18 rojos', () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.equal(new Set(WHEEL_ORDER).size, 37);
  assert.equal(RED.size, 18);
  // En el plato real los colores alternan salvo en el cero.
  for (let i = 1; i < 36; i++) assert.notEqual(RED.has(WHEEL_ORDER[i]), RED.has(WHEEL_ORDER[i + 1]));
});

test('Todas las apuestas del tapete tienen ventaja de la casa 2,70 %', () => {
  const keys = [...boardSpots().map((s) => s.key), 'dozen:1', 'dozen:2', 'dozen:3', 'column:1', 'column:2', 'column:3', 'red', 'black', 'even', 'odd', 'low', 'high'];
  for (const key of keys) {
    assert.ok(Math.abs(houseEdgeOf(key) - 1 / 37) < 1e-12, `${key}: ${houseEdgeOf(key)}`);
  }
  assert.ok(Math.abs(houseEdge(35, 1 / 37) - 0.027027) < 1e-6);
});

test('Pagos del tapete: pleno 35, dividida 17, calle 11, cuadro 8, docena 2, sencilla 1', () => {
  assert.equal(betDefinition('straight:17').pays, 35);
  assert.equal(betDefinition('split:17-20').pays, 17);
  assert.equal(betDefinition('street:16-17-18').pays, 11);
  assert.equal(betDefinition('corner:16-17-19-20').pays, 8);
  assert.equal(betDefinition('dozen:2').pays, 2);
  assert.equal(betDefinition('column:1').pays, 2);
  assert.deepEqual(betDefinition('column:1').numbers.slice(0, 3), [1, 4, 7]);
  assert.equal(betDefinition('red').pays, 1);
  assert.equal(payoutFor({ 'straight:17': 10, red: 10, 'dozen:3': 10 }, 17), 360 + 0);
  assert.equal(payoutFor({ red: 10, black: 10, even: 10 }, 0), 0);
});

test('Geometría del tapete: splits y cuadros son adyacentes', () => {
  for (const spot of boardSpots()) {
    const def = betDefinition(spot.key);
    if (def.type === 'split') {
      const [a, b] = def.numbers;
      assert.ok(b - a === 3 || (b - a === 1 && a % 3 !== 0), spot.key);
    }
    if (def.type === 'corner') {
      const [a, b, c, d] = def.numbers;
      assert.deepEqual([b - a, c - a, d - a], [1, 3, 4], spot.key);
      assert.notEqual(a % 3, 0, spot.key);
    }
  }
  assert.equal(boardSpots().filter((s) => s.key.startsWith('split')).length, 57);
  assert.equal(boardSpots().filter((s) => s.key.startsWith('corner')).length, 22);
  assert.equal(boardSpots().filter((s) => s.key.startsWith('street')).length, 12);
});

// ---------- Slots ----------

test('Pesos de símbolos suman 100 y hay 10 líneas', () => {
  assert.equal(SYMBOLS.reduce((sum, s) => sum + s.weight, 0), 100);
  assert.equal(LINES.length, 10);
});

test('Par sheet exacto: RTP ≈ 96 %', () => {
  const par = parSheet();
  assert.ok(par.total > 0.955 && par.total < 0.965, `RTP ${par.total}`);
  assert.equal(freeSpinMultiplierSum(8), 1 + 2 + 3 + 4 + 5 + 5 + 5 + 5);
  assert.deepEqual(FS_MULTIPLIERS, [1, 2, 3, 4, 5]);
});

test('Evaluación: 3 y 4 en línea, Súper Bono ×15, scatter', () => {
  const grid = [
    ['C', 'C', 'C', 'C'],
    ['R', 'R', 'R', 'T'],
    ['D', 'H', 'D', 'B'],
    ['T', 'B', 'D', 'S'],
  ];
  const result = evaluateGrid(grid);
  const row0 = result.lines.find((l) => l.index === 0);
  const row1 = result.lines.find((l) => l.index === 1);
  assert.equal(row0.count, 4);
  assert.equal(row0.units, 90 * 15);
  assert.equal(row1.units, 2);
  assert.equal(result.scatterCount, 3);
  const win = spinWin(grid, 100);
  assert.equal(win.lineWin, ((1350 + 2) * 100) / 10);
  assert.equal(win.scatterWin, 200);
  assert.equal(win.freeSpins, 8);
  assert.ok(win.superBonus);
  const free = spinWin(grid, 100, { free: true, multiplier: 3 });
  assert.equal(free.scatterWin, 0);
  assert.equal(free.lineWin, ((1350 + 2) * 100 * 3) / 10);
  assert.equal(scatterAward(9).spins, 12);
});

test('Monte Carlo del motor real coincide con el par sheet', () => {
  const par = parSheet();
  const spins = 400000;
  let lineUnits = 0;
  for (let i = 0; i < spins; i++) lineUnits += evaluateGrid(spinGrid()).lineUnits;
  const lineRtp = lineUnits / 10 / spins;
  // Error estándar ≈ 0.6 % con esta muestra; se acepta ±3 %.
  assert.ok(Math.abs(lineRtp - par.lines) < 0.03, `Monte Carlo ${lineRtp} vs exacto ${par.lines}`);
});
