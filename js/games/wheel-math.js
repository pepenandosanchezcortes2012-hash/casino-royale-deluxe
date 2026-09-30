// Ruleta de la Fortuna diaria (sin DOM). Una tirada gratis cada 24 horas; 10 gajos iguales en
// la rueda, con probabilidades publicadas (el bote de 10 000 es el 1 %). El gajo sale del
// primer número verificable de la tirada según los pesos.

export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const WHEEL_SLICES = Object.freeze([
  Object.freeze({ id: 'chips-200-a', label: '200', type: 'chips', amount: 200, weight: 17, color: '#1d3b2a' }),
  Object.freeze({ id: 'chips-400-a', label: '400', type: 'chips', amount: 400, weight: 13, color: '#16324a' }),
  Object.freeze({ id: 'potion', label: 'Poción ×2', type: 'potion', amount: 1, weight: 10, color: '#3a1f55' }),
  Object.freeze({ id: 'chips-800', label: '800', type: 'chips', amount: 800, weight: 11, color: '#1d3b2a' }),
  Object.freeze({ id: 'chips-200-b', label: '200', type: 'chips', amount: 200, weight: 17, color: '#16324a' }),
  Object.freeze({ id: 'chips-1500', label: '1.500', type: 'chips', amount: 1500, weight: 7, color: '#4a2a12' }),
  Object.freeze({ id: 'chest', label: 'Cofre', type: 'chest', amount: 1, weight: 8, color: '#3a1f55' }),
  Object.freeze({ id: 'chips-400-b', label: '400', type: 'chips', amount: 400, weight: 13, color: '#16324a' }),
  Object.freeze({ id: 'chips-3000', label: '3.000', type: 'chips', amount: 3000, weight: 3, color: '#4a2a12' }),
  Object.freeze({ id: 'jackpot', label: '10.000', type: 'chips', amount: 10000, weight: 1, color: '#6b0f1a', jackpot: true }),
]);

export const WHEEL_TOTAL_WEIGHT = WHEEL_SLICES.reduce((sum, slice) => sum + slice.weight, 0);

export function spinWheel(stream) {
  const index = stream.weighted(WHEEL_SLICES.map((slice) => slice.weight));
  return { index, slice: WHEEL_SLICES[index] };
}

// Milisegundos que faltan para la siguiente tirada (0 = disponible).
export const wheelCooldown = (lastSpin, now = Date.now()) => (lastSpin ? Math.max(0, lastSpin + WHEEL_COOLDOWN_MS - now) : 0);
