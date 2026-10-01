// Rueda de la Fortuna Legendaria (sin DOM), en el Penthouse Cripto-Olympus. Una tirada gratis
// cada 24 horas; 10 gajos iguales en la rueda, con probabilidades publicadas (el bote de
// 1.000.000 es el 1 %). El gajo sale del primer número verificable de la tirada según los pesos.

export const WHEEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export const WHEEL_SLICES = Object.freeze([
  Object.freeze({ id: 'chips-20k-a', label: '20K', type: 'chips', amount: 20_000, weight: 17, color: '#1d3b2a' }),
  Object.freeze({ id: 'chips-40k-a', label: '40K', type: 'chips', amount: 40_000, weight: 13, color: '#16324a' }),
  Object.freeze({ id: 'potion', label: 'Poción ×2', type: 'potion', amount: 1, weight: 10, color: '#3a1f55' }),
  Object.freeze({ id: 'chips-80k', label: '80K', type: 'chips', amount: 80_000, weight: 11, color: '#1d3b2a' }),
  Object.freeze({ id: 'chips-20k-b', label: '20K', type: 'chips', amount: 20_000, weight: 17, color: '#16324a' }),
  Object.freeze({ id: 'chips-150k', label: '150K', type: 'chips', amount: 150_000, weight: 7, color: '#4a2a12' }),
  Object.freeze({ id: 'chest', label: 'Cofre legendario', type: 'chest', amount: 1, weight: 8, color: '#3a1f55' }),
  Object.freeze({ id: 'chips-40k-b', label: '40K', type: 'chips', amount: 40_000, weight: 13, color: '#16324a' }),
  Object.freeze({ id: 'chips-300k', label: '300K', type: 'chips', amount: 300_000, weight: 3, color: '#4a2a12' }),
  Object.freeze({ id: 'jackpot', label: '1M', type: 'chips', amount: 1_000_000, weight: 1, color: '#6b0f1a', jackpot: true }),
]);

export const WHEEL_TOTAL_WEIGHT = WHEEL_SLICES.reduce((sum, slice) => sum + slice.weight, 0);

export function spinWheel(stream) {
  const index = stream.weighted(WHEEL_SLICES.map((slice) => slice.weight));
  return { index, slice: WHEEL_SLICES[index] };
}

// Milisegundos que faltan para la siguiente tirada (0 = disponible).
export const wheelCooldown = (lastSpin, now = Date.now()) => (lastSpin ? Math.max(0, lastSpin + WHEEL_COOLDOWN_MS - now) : 0);
