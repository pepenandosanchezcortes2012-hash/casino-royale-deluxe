// Juego justo verificable (provably fair) sin servidor.
// Antes de apostar se muestra serverSeedHash = SHA-256(serverSeed); el jugador elige su clientSeed
// y cada jugada usa un nonce creciente. El resultado sale de
//   HMAC-SHA256(clave = serverSeed, mensaje = `${clientSeed}:${nonce}`)
// tomando los primeros 8 caracteres hexadecimales como entero de 32 bits ÷ 2^32 → [0, 1).
// Los juegos que necesitan más números (barajas, avalanchas, caminos) siguen con los siguientes
// grupos de 8 caracteres y, agotado el hash, con `${clientSeed}:${nonce}:${cursor}` (cursor 1, 2…).
// Al rotar la semilla se revela la anterior y cualquiera puede recalcular todas sus jugadas.
// SHA-256 y HMAC están escritos en JavaScript puro para ser síncronos (las pruebas los comparan
// con node:crypto).
// Las semillas y el nonce se guardan al instante (un nonce nunca se reutiliza); el historial de
// las últimas 60 jugadas, con un pequeño retardo: el disparo continuo de Cyber-Fish genera
// varias jugadas por segundo y no hace falta reescribirlo entero en cada una.

import { storage as defaultStore } from './storage.js';

export const FAIR_KEY = 'crd.climb.fair.v1';
export const FAIR_HISTORY_KEY = 'crd.climb.fair.history.v1';
const HISTORY_LIMIT = 60;
const HISTORY_SAVE_MS = 400;
const REVEALED_LIMIT = 12;
const CLIENT_SEED_MAX = 64;

// ---------- SHA-256 y HMAC-SHA256 ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const W = new Uint32Array(64);
const encoder = new TextEncoder();

export const utf8 = (text) => encoder.encode(String(text));

export function toHex(bytes) {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

export function sha256(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : utf8(bytes);
  const length = input.length;
  const total = Math.ceil((length + 9) / 64) * 64;
  const data = new Uint8Array(total);
  data.set(input);
  data[length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(total - 8, Math.floor((length * 8) / 2 ** 32));
  view.setUint32(total - 4, (length * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const x = W[i - 15];
      const y = W[i - 2];
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0];
    let b = H[1];
    let c = H[2];
    let d = H[3];
    let e = H[4];
    let f = H[5];
    let g = H[6];
    let h = H[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i]);
  return out;
}

export function hmacSha256(key, message) {
  let keyBytes = key instanceof Uint8Array ? key : utf8(key);
  if (keyBytes.length > 64) keyBytes = sha256(keyBytes);
  const messageBytes = message instanceof Uint8Array ? message : utf8(message);
  const inner = new Uint8Array(64 + messageBytes.length);
  const outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) {
    const byte = keyBytes[i] ?? 0;
    inner[i] = byte ^ 0x36;
    outer[i] = byte ^ 0x5c;
  }
  inner.set(messageBytes, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

export const sha256Hex = (text) => toHex(sha256(text));
export const hmacHex = (key, message) => toHex(hmacSha256(key, message));

// ---------- Flujo de números de una jugada ----------

// Mensaje HMAC del bloque `cursor`: el primero es exactamente `${clientSeed}:${nonce}`.
export const blockMessage = (clientSeed, nonce, cursor) => (cursor === 0 ? `${clientSeed}:${nonce}` : `${clientSeed}:${nonce}:${cursor}`);

export class FairStream {
  #serverSeed;
  #clientSeed;
  #nonce;
  #cursor = 0;
  #block = null;
  #offset = 8;
  #used = 0;

  constructor({ serverSeed, clientSeed, nonce }) {
    this.#serverSeed = serverSeed;
    this.#clientSeed = clientSeed;
    this.#nonce = nonce;
  }

  get used() {
    return this.#used;
  }

  // Siguiente número en [0, 1): 8 caracteres hexadecimales (32 bits) ÷ 2^32.
  float() {
    if (this.#offset >= 8) {
      this.#block = hmacSha256(this.#serverSeed, blockMessage(this.#clientSeed, this.#nonce, this.#cursor));
      this.#cursor += 1;
      this.#offset = 0;
    }
    const i = this.#offset * 4;
    const b = this.#block;
    const value = ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
    this.#offset += 1;
    this.#used += 1;
    return value / 2 ** 32;
  }

  // Entero en [0, n): floor(float · n), el método estándar y verificable a mano.
  int(n) {
    return Math.floor(this.float() * n);
  }

  // Índice según pesos enteros (Σ pesos ≥ 1).
  weighted(weights) {
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let roll = this.float() * total;
    for (let i = 0; i < weights.length; i++) {
      if (roll < weights[i]) return i;
      roll -= weights[i];
    }
    return weights.length - 1;
  }

  // Fisher-Yates in situ con los números del flujo.
  shuffle(items) {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  // Adaptador `rand(n)` para los motores que reciben un generador de enteros.
  get rand() {
    return (n) => this.int(n);
  }
}

// ---------- Semillas, nonce e historial ----------

function randomHex(bytes = 32) {
  const buffer = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buffer);
  return toHex(buffer);
}

export function isValidClientSeed(text) {
  return typeof text === 'string' && text.length >= 1 && text.length <= CLIENT_SEED_MAX && /^[\x21-\x7e]+$/.test(text);
}

const freshSeed = () => {
  const serverSeed = randomHex(32);
  return { serverSeed, serverSeedHash: sha256Hex(serverSeed) };
};

const validHistory = (list) => (Array.isArray(list) ? list.filter((h) => h && Number.isInteger(h.nonce) && typeof h.game === 'string').slice(-HISTORY_LIMIT) : []);

function sanitize(raw) {
  const seed = freshSeed();
  const state = { ...seed, clientSeed: randomHex(8), nonce: 0, revealed: [], history: [] };
  if (!raw || typeof raw !== 'object') return state;
  const hex64 = /^[0-9a-f]{64}$/;
  if (hex64.test(raw.serverSeed) && sha256Hex(raw.serverSeed) === raw.serverSeedHash) {
    state.serverSeed = raw.serverSeed;
    state.serverSeedHash = raw.serverSeedHash;
    if (Number.isInteger(raw.nonce) && raw.nonce >= 0) state.nonce = raw.nonce;
  }
  if (isValidClientSeed(raw.clientSeed)) state.clientSeed = raw.clientSeed;
  if (Array.isArray(raw.revealed)) {
    state.revealed = raw.revealed
      .filter((r) => r && hex64.test(r.serverSeed) && hex64.test(r.serverSeedHash) && isValidClientSeed(r.clientSeed) && Number.isInteger(r.nonces))
      .slice(-REVEALED_LIMIT);
  }
  state.history = validHistory(raw.history);
  return state;
}

export class ProvablyFair extends EventTarget {
  #store;
  #now;
  #s;
  #historyTimer = null;

  constructor({ store = defaultStore, now = () => Date.now() } = {}) {
    super();
    this.#store = store;
    this.#now = now;
    this.#s = sanitize(store.read(FAIR_KEY, null));
    const history = validHistory(store.read(FAIR_HISTORY_KEY, null));
    if (history.length) this.#s.history = history;
    this.#save();
    this.#saveHistory();
    // Al cerrar u ocultar la página se guarda lo que quedara pendiente del historial.
    globalThis.addEventListener?.('pagehide', () => this.flush());
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document.hidden) this.flush();
    });
  }

  // Semillas, nonce y semillas reveladas (sin el historial).
  #save() {
    const { history, ...seeds } = this.#s;
    this.#store.write(FAIR_KEY, seeds);
  }

  #saveHistory() {
    this.#historyTimer = null;
    this.#store.write(FAIR_HISTORY_KEY, this.#s.history);
  }

  #scheduleHistory() {
    if (this.#historyTimer !== null) return;
    this.#historyTimer = setTimeout(() => this.#saveHistory(), HISTORY_SAVE_MS);
    this.#historyTimer?.unref?.();
  }

  // Guarda ya el historial pendiente.
  flush() {
    if (this.#historyTimer === null) return;
    clearTimeout(this.#historyTimer);
    this.#saveHistory();
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
    this.dispatchEvent(new CustomEvent('change', { detail: { type } }));
  }

  // Lo que el jugador puede ver antes de apostar (la semilla del servidor sigue oculta).
  get commitment() {
    const s = this.#s;
    return { serverSeedHash: s.serverSeedHash, clientSeed: s.clientSeed, nonce: s.nonce };
  }

  get history() {
    return this.#s.history.slice();
  }

  get revealed() {
    return this.#s.revealed.slice();
  }

  // Flujo para la próxima jugada; consume el nonce actual.
  next(game) {
    const s = this.#s;
    const nonce = s.nonce;
    s.nonce += 1;
    this.#save();
    const stream = new FairStream({ serverSeed: s.serverSeed, clientSeed: s.clientSeed, nonce });
    stream.meta = { game, nonce, clientSeed: s.clientSeed, serverSeedHash: s.serverSeedHash };
    return stream;
  }

  // Anota el resultado de la jugada en el historial verificable.
  record(meta, { stake = 0, payout = 0, summary = '', params = {} } = {}) {
    if (!meta) return;
    const entry = {
      nonce: meta.nonce,
      game: meta.game,
      clientSeed: meta.clientSeed,
      serverSeedHash: meta.serverSeedHash,
      stake,
      payout,
      multiplier: stake > 0 ? Math.round((payout / stake) * 10000) / 10000 : 0,
      summary: String(summary).slice(0, 120),
      params,
      at: this.#now(),
    };
    this.#s.history.push(entry);
    if (this.#s.history.length > HISTORY_LIMIT) this.#s.history.splice(0, this.#s.history.length - HISTORY_LIMIT);
    this.#scheduleHistory();
    this.#emit('bet', { entry });
    return entry;
  }

  // Revela la semilla actual (ya verificable) y compromete una nueva; el nonce vuelve a 0.
  rotate() {
    const s = this.#s;
    const revealed = { serverSeed: s.serverSeed, serverSeedHash: s.serverSeedHash, clientSeed: s.clientSeed, nonces: s.nonce, at: this.#now() };
    s.revealed.push(revealed);
    if (s.revealed.length > REVEALED_LIMIT) s.revealed.splice(0, s.revealed.length - REVEALED_LIMIT);
    Object.assign(s, freshSeed(), { nonce: 0 });
    this.#save();
    this.#emit('rotate', { revealed });
    return revealed;
  }

  // Cambiar la semilla del cliente cierra la semilla del servidor actual (la revela).
  setClientSeed(text) {
    const value = String(text ?? '').trim();
    if (!isValidClientSeed(value)) return false;
    if (value === this.#s.clientSeed) return true;
    this.rotate();
    this.#s.clientSeed = value;
    this.#save();
    this.#emit('client', { clientSeed: value });
    return true;
  }

  // Semilla revelada con la que se jugó un nonce (null si sigue oculta).
  revealedFor(serverSeedHash) {
    return this.#s.revealed.find((r) => r.serverSeedHash === serverSeedHash) ?? null;
  }
}

// Comprobación independiente: ¿la semilla revelada corresponde al hash publicado?
export const seedMatchesHash = (serverSeed, serverSeedHash) => sha256Hex(serverSeed) === serverSeedHash;

// Flujo reconstruido para verificar una jugada con una semilla ya revelada.
export const streamFor = ({ serverSeed, clientSeed, nonce }) => new FairStream({ serverSeed, clientSeed, nonce });

// Instancia perezosa: las semillas se crean (y se guardan) la primera vez que se usan.
let instance = null;
const current = () => (instance ??= new ProvablyFair());
export const fair = new Proxy({}, {
  get(_, prop) {
    const target = current();
    const value = Reflect.get(target, prop, target);
    return typeof value === 'function' ? value.bind(target) : value;
  },
});
