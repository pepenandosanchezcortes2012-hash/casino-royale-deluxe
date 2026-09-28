// Entropía criptográfica: todo el azar del casino pasa por crypto.getRandomValues().
// Se usa un pool de 256 enteros de 32 bits para no invocar la API en cada extracción.

const POOL_SIZE = 256;
const TWO_32 = 0x100000000;
const TWO_53 = 9007199254740992;

const pool = new Uint32Array(POOL_SIZE);
let cursor = POOL_SIZE;

function cryptoSource() {
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Web Crypto no disponible: se requiere crypto.getRandomValues()');
  }
  return source;
}

export function randomUint32() {
  if (cursor >= POOL_SIZE) {
    cryptoSource().getRandomValues(pool);
    cursor = 0;
  }
  return pool[cursor++];
}

// Entero uniforme en [0, maxExclusive) sin sesgo de módulo (muestreo por rechazo).
export function randomInt(maxExclusive) {
  if (!Number.isInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > TWO_32) {
    throw new RangeError(`randomInt: límite inválido ${maxExclusive}`);
  }
  const limit = TWO_32 - (TWO_32 % maxExclusive);
  let value;
  do {
    value = randomUint32();
  } while (value >= limit);
  return value % maxExclusive;
}

// Flotante uniforme en [0, 1) con 53 bits de mantisa.
export function randomFloat() {
  const high = randomUint32() >>> 5;
  const low = randomUint32() >>> 6;
  return (high * 67108864 + low) / TWO_53;
}

export function randomBetween(min, max) {
  return min + (max - min) * randomFloat();
}

// Fisher-Yates (Durstenfeld) in-place: cada una de las n! permutaciones es equiprobable.
export function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}

export function pick(items) {
  return items[randomInt(items.length)];
}

// Índice ponderado con pesos enteros: P(i) = w[i] / Σw exacto.
export function weightedIndex(weights) {
  let total = 0;
  for (const w of weights) {
    if (!Number.isInteger(w) || w < 0) throw new RangeError('weightedIndex: pesos enteros no negativos');
    total += w;
  }
  let roll = randomInt(total);
  for (let i = 0; i < weights.length; i++) {
    if (roll < weights[i]) return i;
    roll -= weights[i];
  }
  return weights.length - 1;
}

// ---- Cálculo de probabilidades ----

export function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return result;
}

export function binomialPmf(n, k, p) {
  return combinations(n, k) * p ** k * (1 - p) ** (n - k);
}

export function expectedValue(outcomes) {
  return outcomes.reduce((sum, { probability, value }) => sum + probability * value, 0);
}

// Ventaja de la casa de una apuesta que paga `payout` a 1 con probabilidad `pWin`.
export function houseEdge(payout, pWin) {
  return 1 - pWin * (payout + 1);
}
