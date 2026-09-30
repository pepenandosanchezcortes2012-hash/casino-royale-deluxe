// Minas Cripto 5×5 (sin DOM). Las minas se colocan barajando las 25 casillas con el flujo
// verificable y tomando las m primeras. Tras k gemas descubiertas:
//   multiplicador = 0,97 · C(25, k) / C(25 − m, k)
// que es exactamente 0,97 / P(sobrevivir k casillas): RTP del 97 % se retire cuando se retire.

export const MINES_CELLS = 25;
export const MINES_EDGE = 0.97;
export const MIN_MINES = 1;
export const MAX_MINES = 24;

export function combinations(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

export const clampMines = (mines) => Math.min(MAX_MINES, Math.max(MIN_MINES, Math.round(Number(mines) || MIN_MINES)));

// Probabilidad de destapar k gemas seguidas sin tocar ninguna mina.
export const minesSurvival = (mines, gems) => combinations(MINES_CELLS - mines, gems) / combinations(MINES_CELLS, gems);

// Multiplicador truncado a 2 decimales tras k gemas (1 antes de la primera).
export function minesMultiplier(mines, gems) {
  if (gems <= 0) return 1;
  const m = clampMines(mines);
  if (gems > MINES_CELLS - m) return 0;
  return Math.floor(((MINES_EDGE * combinations(MINES_CELLS, gems)) / combinations(MINES_CELLS - m, gems)) * 100) / 100;
}

// Casillas con mina (índices 0–24, fila · 5 + columna), ordenadas.
export function placeMines(stream, mines) {
  const cells = stream.shuffle(Array.from({ length: MINES_CELLS }, (_, i) => i));
  return cells.slice(0, clampMines(mines)).sort((a, b) => a - b);
}
