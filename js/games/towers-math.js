// La Torre de la Muerte (sin DOM). 8 pisos; en cada uno se elige una losa y algunas esconden
// una trampa. Dificultad: Fácil (3 losas, 1 trampa), Media (2 losas, 1 trampa) y Difícil
// (3 losas, 2 trampas). Tras superar n pisos: multiplicador = 0,97 / p^n, con p la probabilidad
// de losa segura, así que el RTP es del 97 % se retire en el piso que se retire.

export const TOWER_LEVELS = 8;
export const TOWER_EDGE = 0.97;

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ id: 'easy', name: 'Fácil', tiles: 3, traps: 1 }),
  medium: Object.freeze({ id: 'medium', name: 'Media', tiles: 2, traps: 1 }),
  hard: Object.freeze({ id: 'hard', name: 'Difícil', tiles: 3, traps: 2 }),
});

export const difficultyOf = (id) => DIFFICULTIES[id] ?? DIFFICULTIES.easy;
export const safeChance = (id) => {
  const d = difficultyOf(id);
  return (d.tiles - d.traps) / d.tiles;
};

// Multiplicador truncado a 2 decimales tras superar `level` pisos (1 al empezar).
export function towersMultiplier(id, level) {
  if (level <= 0) return 1;
  return Math.floor((TOWER_EDGE / safeChance(id) ** Math.min(level, TOWER_LEVELS)) * 100) / 100;
}

// Trampas de cada piso (de abajo arriba): índices de losa barajados con el flujo verificable.
export function towerLayout(stream, id) {
  const d = difficultyOf(id);
  return Array.from({ length: TOWER_LEVELS }, () => {
    const tiles = stream.shuffle(Array.from({ length: d.tiles }, (_, i) => i));
    return tiles.slice(0, d.traps).sort((a, b) => a - b);
  });
}
