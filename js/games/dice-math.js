// Dados Over/Under (sin DOM). La tirada es un número de 0,00 a 99,99 con 10 000 resultados
// equiprobables: floor(float · 10 000) / 100. El jugador elige la probabilidad de acierto (1–97 %)
// y la condición: «Menor que P» o «Mayor o igual que 100 − P». Multiplicador = 98 / P (RTP 98 %).

export const DICE_NUMERATOR = 98;
export const MIN_CHANCE = 1;
export const MAX_CHANCE = 97;

export const clampChance = (chance) => Math.min(MAX_CHANCE, Math.max(MIN_CHANCE, Math.round(Number(chance) || MIN_CHANCE)));

// Multiplicador truncado a 4 decimales (el redondeo nunca favorece a la casa por encima del 2 %).
export const diceMultiplier = (chance) => Math.floor((DICE_NUMERATOR / clampChance(chance)) * 10000) / 10000;

// Umbral mostrado al jugador según la condición.
export const diceTarget = (chance, direction) => (direction === 'under' ? clampChance(chance) : 100 - clampChance(chance));

export function playDice(stream, { chance, direction }) {
  const p = clampChance(chance);
  const ticks = Math.floor(stream.float() * 10000);
  const roll = ticks / 100;
  const win = direction === 'under' ? ticks < p * 100 : ticks >= (100 - p) * 100;
  return { roll, win, chance: p, direction, target: diceTarget(p, direction), multiplier: diceMultiplier(p) };
}

// RTP exacto de una configuración (probabilidad × multiplicador).
export const diceRtp = (chance) => (clampChance(chance) / 100) * diceMultiplier(chance);
