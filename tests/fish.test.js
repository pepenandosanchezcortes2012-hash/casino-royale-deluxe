// Pruebas de Cyber-Fish Hunter: probabilidad de captura, RTP con cualquier objetivo, ráfagas y
// verificación provably fair de cada bala.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SPECIES, FISH_RTP, BIG_CATCH, VOLLEY_MAX, VOLLEY_MS,
  captureChance, shotRtp, resolveShot, playShot, pickSpecies, speciesById, validMultiplier, Volley,
} from '../js/games/fish-math.js';
import { FairStream } from '../js/provably_fair.js';
import { verifyBet } from '../js/verify.js';

const SEEDS = { serverSeed: 'c'.repeat(64), clientSeed: 'pez-neon' };

test('Cyber-Fish: el RTP es del 96 % apuntes a la criatura que apuntes', () => {
  const all = SPECIES.flatMap((s) => s.multipliers);
  assert.deepEqual(speciesById('neon').multipliers, [1.5, 2, 2.5, 3]);
  assert.equal(speciesById('jelly').multipliers[0], 8);
  assert.equal(speciesById('manta').multipliers[0], 20);
  assert.equal(speciesById('shark').multipliers[0], 60);
  assert.ok(speciesById('kraken').multipliers.every((m) => m >= 150 && m <= 500));
  for (const m of all) {
    assert.ok(Math.abs(shotRtp(m) - FISH_RTP) < 1e-12, `×${m}`);
    assert.ok(captureChance(m) > 0 && captureChance(m) < 1);
  }
  // Inversamente proporcional al premio.
  assert.ok(captureChance(1.5) > captureChance(8) && captureChance(8) > captureChance(500));
  assert.equal(resolveShot(0.119, 8).captured, true);
  assert.equal(resolveShot(0.12, 8).captured, false);
  assert.equal(validMultiplier('kraken', 300), true);
  assert.equal(validMultiplier('jelly', 9), false);
});

test('Cyber-Fish: Monte Carlo con balas provably fair (una por nonce)', () => {
  for (const m of [2, 8, 20]) {
    const shots = 60_000;
    let paid = 0;
    for (let nonce = 0; nonce < shots; nonce++) {
      const shot = playShot(new FairStream({ ...SEEDS, nonce }), m);
      if (shot.captured) paid += m;
    }
    const rtp = paid / shots;
    assert.ok(Math.abs(rtp - FISH_RTP) < 0.05 * Math.sqrt(m), `×${m}: RTP ${rtp.toFixed(4)}`);
  }
});

test('Cyber-Fish: aparición ponderada sin el Kraken (llega por calendario)', () => {
  const counts = {};
  for (let i = 0; i < 1000; i++) {
    const s = pickSpecies(i / 1000);
    counts[s.id] = (counts[s.id] ?? 0) + 1;
  }
  assert.equal(counts.kraken, undefined);
  assert.deepEqual(counts, { neon: 700, jelly: 180, manta: 80, shark: 40 });
});

test('Cyber-Fish: una ráfaga suma balas, capturas y devoluciones y se liquida entera', () => {
  const volley = new Volley(1000);
  assert.equal(volley.open(1000 + VOLLEY_MS - 1), true);
  assert.equal(volley.open(1000 + VOLLEY_MS), false);
  for (let i = 0; i < 4; i++) volley.fire(50);
  volley.hit({ multiplier: 2, species: 'neon', payout: 100 });
  volley.hit(null);
  volley.hit({ multiplier: 60, species: 'shark', payout: 3000 });
  volley.refund(50);
  volley.sealed = true;
  assert.equal(volley.done, true);
  const round = volley.round();
  assert.equal(round.game, 'fish');
  assert.equal(round.stake, 150);
  assert.equal(round.returned, 3100);
  assert.equal(round.captures, 2);
  assert.equal(round.bigCatches, 1);
  assert.equal(round.shots, 3);
  assert.ok(round.tags.includes('fish-shark') && round.tags.includes('fish-capture'));
  assert.equal(volley.best.species, 'shark');
  assert.ok(BIG_CATCH === 8);
  const full = new Volley(0);
  for (let i = 0; i < VOLLEY_MAX; i++) full.fire(10);
  assert.equal(full.open(1), false, 'como mucho 20 balas por ronda');
});

test('Cyber-Fish: el verificador recalcula cada bala con su criatura', () => {
  for (let nonce = 0; nonce < 40; nonce++) {
    const result = verifyBet({ game: 'fish', ...SEEDS, nonce, params: { species: 'jelly', multiplier: 8 } });
    const shot = playShot(new FairStream({ ...SEEDS, nonce }), 8);
    assert.equal(result.ok, true);
    assert.equal(result.outcome, shot.captured ? 'Medusa Eléctrica capturada: ×8' : 'Medusa Eléctrica escapa');
    assert.equal(result.used, 1);
  }
  const bare = verifyBet({ game: 'fish', ...SEEDS, nonce: 1 });
  assert.equal(bare.ok, true);
  assert.match(bare.outcome, /Número de la bala/);
});
