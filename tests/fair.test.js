// Pruebas del juego justo verificable y del bus de eventos.
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';

import { sha256Hex, hmacHex, FairStream, ProvablyFair, blockMessage, seedMatchesHash, isValidClientSeed, FAIR_KEY } from '../js/provably_fair.js';
import { EventBus } from '../js/event_bus.js';

function memoryStore() {
  const map = new Map();
  return {
    map,
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

test('SHA-256 idéntico a node:crypto (vacío, corto, largo, multibloque y UTF-8)', () => {
  const inputs = ['', 'abc', 'El Último Crédito ñ€🂡', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000)];
  for (const input of inputs) {
    assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'), `sha256(${input.length})`);
  }
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('HMAC-SHA256 idéntico a node:crypto, incluidas claves de más de 64 bytes', () => {
  const cases = [['key', 'The quick brown fox jumps over the lazy dog'], ['f'.repeat(64), 'cliente:0'], ['k'.repeat(100), 'mensaje largo '.repeat(20)], ['', '']];
  for (const [key, message] of cases) {
    assert.equal(hmacHex(key, message), createHmac('sha256', key).update(message).digest('hex'));
  }
});

test('Fórmula del enunciado: los 8 primeros hex de HMAC(serverSeed, "cliente:nonce") ÷ 2^32', () => {
  const serverSeed = 'a'.repeat(64);
  const stream = new FairStream({ serverSeed, clientSeed: 'jugador', nonce: 7 });
  const hex = hmacHex(serverSeed, 'jugador:7');
  assert.equal(stream.float(), parseInt(hex.slice(0, 8), 16) / 2 ** 32);
  assert.equal(stream.float(), parseInt(hex.slice(8, 16), 16) / 2 ** 32);
  for (let i = 2; i < 8; i++) stream.float();
  // Agotado el primer hash, sigue con el cursor 1.
  const next = hmacHex(serverSeed, blockMessage('jugador', 7, 1));
  assert.equal(stream.float(), parseInt(next.slice(0, 8), 16) / 2 ** 32);
  assert.equal(stream.used, 9);
});

test('Flujo: determinista, uniforme y con barajado completo', () => {
  const seeds = { serverSeed: 'b'.repeat(64), clientSeed: 'semilla', nonce: 3 };
  const a = new FairStream(seeds);
  const b = new FairStream(seeds);
  for (let i = 0; i < 50; i++) assert.equal(a.float(), b.float());
  // Uniformidad: chi-cuadrado sobre 10 intervalos con 100 000 muestras (umbral 1 ‰ ≈ 27,9).
  const stream = new FairStream({ ...seeds, nonce: 99 });
  const bins = new Array(10).fill(0);
  const n = 100_000;
  for (let i = 0; i < n; i++) bins[stream.int(10)] += 1;
  const chi = bins.reduce((sum, count) => sum + (count - n / 10) ** 2 / (n / 10), 0);
  assert.ok(chi < 27.9, `chi² = ${chi.toFixed(2)}`);
  const deck = new FairStream(seeds).shuffle(Array.from({ length: 52 }, (_, i) => i));
  assert.equal(new Set(deck).size, 52);
  const weighted = new FairStream(seeds);
  const counts = [0, 0, 0];
  for (let i = 0; i < 30_000; i++) counts[weighted.weighted([1, 2, 7])] += 1;
  assert.ok(Math.abs(counts[2] / 30_000 - 0.7) < 0.015);
});

test('Semillas: compromiso previo, nonce creciente, rotación y revelado verificable', () => {
  const store = memoryStore();
  const fair = new ProvablyFair({ store, now: () => 1 });
  const before = fair.commitment;
  assert.match(before.serverSeedHash, /^[0-9a-f]{64}$/);
  assert.equal('serverSeed' in before, false, 'la semilla del servidor no se muestra antes de rotar');
  const first = fair.next('dice');
  const second = fair.next('dice');
  assert.equal(first.meta.nonce, 0);
  assert.equal(second.meta.nonce, 1);
  const outcome = first.float();
  fair.record(first.meta, { stake: 10, payout: 0, summary: 'test' });
  assert.equal(fair.history.length, 1);

  const revealed = fair.rotate();
  assert.equal(revealed.serverSeedHash, before.serverSeedHash);
  assert.ok(seedMatchesHash(revealed.serverSeed, before.serverSeedHash));
  assert.equal(revealed.nonces, 2);
  assert.notEqual(fair.commitment.serverSeedHash, before.serverSeedHash);
  assert.equal(fair.commitment.nonce, 0);
  // Con la semilla revelada, cualquiera recalcula el resultado de la jugada.
  const replay = new FairStream({ serverSeed: revealed.serverSeed, clientSeed: before.clientSeed, nonce: 0 });
  assert.equal(replay.float(), outcome);

  // Persistencia y validación de la semilla del cliente.
  assert.equal(fair.setClientSeed('mi semilla'), false, 'sin espacios');
  assert.equal(fair.setClientSeed('mi-semilla-2026'), true);
  assert.equal(fair.revealed.length, 2, 'cambiar la semilla del cliente revela la del servidor');
  const reloaded = new ProvablyFair({ store, now: () => 2 });
  assert.equal(reloaded.commitment.clientSeed, 'mi-semilla-2026');
  assert.equal(reloaded.commitment.serverSeedHash, fair.commitment.serverSeedHash);
  assert.ok(store.map.has(FAIR_KEY));
  assert.equal(isValidClientSeed('x'.repeat(65)), false);
});

test('EventBus: entrega en orden, aísla errores y permite darse de baja', () => {
  const bus = new EventBus();
  const seen = [];
  const off = bus.on('round:end', (d) => seen.push(`a${d.n}`));
  bus.on('round:end', () => {
    throw new Error('oyente roto');
  });
  bus.once('round:end', (d) => seen.push(`once${d.n}`));
  const originalError = console.error;
  console.error = () => {};
  assert.equal(bus.emit('round:end', { n: 1 }), 2);
  off();
  bus.emit('round:end', { n: 2 });
  console.error = originalError;
  assert.deepEqual(seen, ['a1', 'once1']);
});
