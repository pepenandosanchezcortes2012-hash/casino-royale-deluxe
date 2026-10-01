// Cyber-Fish Hunter (sin DOM). Cada bala es una apuesta con su propio nonce provably fair: al
// disparar se compromete el número r = primer número verificable de la bala, y al impactar en una
// criatura de multiplicador m la bala la captura si r < 0,96 / m. Así cada impacto tiene una
// probabilidad de captura inversamente proporcional al premio y el RTP es del 96 % apuntes a donde
// apuntes: P(captura) · m = 0,96. La resistencia de las criaturas grandes es visual: cada impacto
// es un sorteo independiente (el Kraken necesita, de media, m / 0,96 impactos).

export const FISH_RTP = 0.96;
// Balas por segundo como máximo y balas en el aire a la vez.
export const FIRE_INTERVAL_MS = 200;
export const MAX_BULLETS = 40;
// Una bala que no impacta en nada en ese tiempo se devuelve.
export const BULLET_LIFETIME_MS = 6000;
// Ronda de Cyber-Fish: las balas disparadas en una ventana de 2,5 s (o 20 balas) se liquidan
// juntas y cuentan como una ronda para encargos, misiones y estadísticas.
export const VOLLEY_MS = 2500;
export const VOLLEY_MAX = 20;
// El Mega Kraken aparece cada 75 s de juego visible y cruza la sala durante 40 s.
export const KRAKEN_EVERY_MS = 75_000;
export const KRAKEN_STAY_MS = 40_000;

const species = (item) => Object.freeze({ ...item, multipliers: Object.freeze([...item.multipliers]) });

// `weight` = peso de aparición (el Kraken no entra en el sorteo: llega cada KRAKEN_EVERY_MS).
// `speed` en píxeles lógicos por segundo, `size` = radio aproximado en el lienzo de 960 × 540.
export const SPECIES = Object.freeze([
  species({ id: 'neon', name: 'Pez Neón', multipliers: [1.5, 2, 2.5, 3], weight: 70, speed: [95, 150], size: 16, hue: 160 }),
  species({ id: 'jelly', name: 'Medusa Eléctrica', multipliers: [8], weight: 18, speed: [55, 80], size: 24, hue: 290 }),
  species({ id: 'manta', name: 'Manta Raya Cibernética', multipliers: [20], weight: 8, speed: [60, 85], size: 36, hue: 200 }),
  species({ id: 'shark', name: 'Tiburón Martillo Blindado', multipliers: [60], weight: 4, speed: [70, 95], size: 46, hue: 20 }),
  species({ id: 'kraken', name: 'Mega Kraken', multipliers: [150, 200, 250, 300, 400, 500], weight: 0, speed: [22, 30], size: 92, hue: 330, boss: true }),
]);
export const speciesById = (id) => SPECIES.find((item) => item.id === id) ?? null;

// Criaturas «grandes» para los encargos: de la Medusa (×8) en adelante.
export const BIG_CATCH = 8;

// Probabilidad de captura de un impacto sobre una criatura de multiplicador m.
export const captureChance = (multiplier) => (multiplier > 0 ? Math.min(1, FISH_RTP / multiplier) : 0);

// ¿Es válido este multiplicador para la especie? (lo que el verificador acepta).
export const validMultiplier = (id, multiplier) => Boolean(speciesById(id)?.multipliers.includes(multiplier));

// Resultado de una bala con el número r de su flujo y la criatura que alcanzó.
export function resolveShot(roll, multiplier) {
  const chance = captureChance(multiplier);
  return { roll, chance, captured: roll < chance, multiplier };
}

// Igual, leyendo r del flujo verificable de la bala.
export const playShot = (stream, multiplier) => resolveShot(stream.float(), multiplier);

// RTP teórico de cualquier criatura (independiente del objetivo).
export const shotRtp = (multiplier) => captureChance(multiplier) * multiplier;

// Especie de la siguiente criatura según los pesos de aparición (`float` en [0, 1)).
export function pickSpecies(float) {
  const pool = SPECIES.filter((item) => item.weight > 0);
  const total = pool.reduce((sum, item) => sum + item.weight, 0);
  let roll = float * total;
  for (const item of pool) {
    if (roll < item.weight) return item;
    roll -= item.weight;
  }
  return pool[pool.length - 1];
}

// Acumulador de una ronda (ráfaga) de balas: suma lo apostado y lo cobrado y describe la ronda
// para la sesión cuando todas sus balas han terminado.
export class Volley {
  stake = 0;
  returned = 0;
  fired = 0;
  settled = 0;
  captures = 0;
  bigCatches = 0;
  sealed = false;
  #tags = new Set();
  #best = null;

  constructor(openedAt = 0) {
    this.openedAt = openedAt;
  }

  // Una bala más en la ronda.
  fire(bet) {
    this.stake += bet;
    this.fired += 1;
  }

  // La bala impactó: `capture` = { multiplier, species, payout } o null si escapó la criatura.
  hit(capture) {
    this.settled += 1;
    if (!capture) return;
    this.returned += capture.payout;
    this.captures += 1;
    if (capture.multiplier >= BIG_CATCH) this.bigCatches += 1;
    if (capture.species === 'shark') this.#tags.add('fish-shark');
    if (capture.species === 'kraken') this.#tags.add('fish-kraken');
    if (!this.#best || capture.multiplier > this.#best.multiplier) this.#best = capture;
  }

  // La bala no llegó a impactar y se devolvió: deja de contar como apuesta.
  refund(bet) {
    this.stake -= bet;
    this.fired -= 1;
  }

  // ¿Admite más balas?
  open(now) {
    return !this.sealed && this.fired < VOLLEY_MAX && now - this.openedAt < VOLLEY_MS;
  }

  get done() {
    return this.sealed && this.settled >= this.fired;
  }

  get best() {
    return this.#best;
  }

  // Ronda para la sesión (redondeada a céntimos).
  round() {
    const money = (value) => Math.round(value * 100) / 100;
    const tags = [...this.#tags];
    if (this.captures) tags.push('fish-capture');
    return { game: 'fish', stake: money(this.stake), returned: money(this.returned), captures: this.captures, bigCatches: this.bigCatches, shots: this.fired, tags };
  }
}
