// Crash Rocket (sin DOM). El multiplicador crece en tiempo real como M(t) = 1 + 0,06 · t^1,35
// (t en segundos). El punto de choque sale del primer número verificable de la ronda:
//   E = 0,97 / (1 − r), truncado a 2 decimales; si queda por debajo de 1,01, choque en 1,00x.
// Así P(E ≥ x) = 0,97 / x para cualquier objetivo x ≥ 1,01: RTP del 97 % con cualquier retiro,
// y un 3,96 % de las rondas explota nada más despegar (nadie puede asegurarse el 1,01x).

export const CRASH_EDGE = 0.97;
export const CRASH_GROWTH = 0.06;
export const CRASH_EXPONENT = 1.35;
export const CRASH_MAX = 10000;
export const MIN_CASHOUT = 1.01;

export function crashPoint(float) {
  const point = Math.floor((CRASH_EDGE / (1 - float)) * 100) / 100;
  if (point < MIN_CASHOUT) return 1;
  return Math.min(point, CRASH_MAX);
}

export const playCrash = (stream) => ({ point: crashPoint(stream.float()) });

export const multiplierAt = (seconds) => 1 + CRASH_GROWTH * Math.max(0, seconds) ** CRASH_EXPONENT;
export const secondsFor = (multiplier) => (Math.max(0, multiplier - 1) / CRASH_GROWTH) ** (1 / CRASH_EXPONENT);

// Multiplicador mostrado (truncado a 2 decimales).
export const displayMultiplier = (seconds) => Math.floor(multiplierAt(seconds) * 100) / 100;

// Probabilidad de que el cohete llegue a `target` (para mostrarla junto al retiro automático).
export const reachChance = (target) => (target <= 1 ? 1 : Math.min(1, CRASH_EDGE / target));

// Un retiro en `cashout` cobra si el cohete no ha explotado antes: cashout ≤ E.
export const cashoutWins = (cashout, point) => cashout >= MIN_CASHOUT && cashout <= point;
