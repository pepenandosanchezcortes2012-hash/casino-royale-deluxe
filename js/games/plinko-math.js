// Plinko Pachinko (sin DOM). Pirámide de 9 filas de clavijas: la primera es la puerta de
// entrada y en las 8 siguientes la bola decide izquierda o derecha, así que cae en una de
// 9 canastas. Los multiplicadores son los de la especificación y el RTP de cada riesgo es
// exacto porque el rebote amortiguado (restitución 0,55) tiene un sesgo publicado hacia el
// centro: en cada fila, si la bola está desplazada, vuelve hacia el centro con probabilidad q
// (en el centro, 50/50). q se ha calculado para que el RTP sea exactamente el anunciado.
// El Zafiro de Plinko (reliquia) empuja hacia las canastas laterales: otro q publicado que
// suma 2,5 puntos de RTP (sin llegar nunca al 100 %).

export const PLINKO_ROWS = 8;
export const PLINKO_PEG_ROWS = PLINKO_ROWS + 1;
export const RESTITUTION = 0.55;
export const GRAVITY = 0.28;
export const BURST = 5;
export const BURST_DELAY_MS = 150;

export const RISKS = Object.freeze({
  low: Object.freeze({ id: 'low', name: 'Bajo', multipliers: Object.freeze([5, 2, 1.2, 1, 0.5, 1, 1.2, 2, 5]), rtp: 0.972, bias: 0.51508892, sapphireBias: 0.50193254 }),
  medium: Object.freeze({ id: 'medium', name: 'Medio', multipliers: Object.freeze([10, 4, 1.5, 0.5, 0.2, 0.5, 1.5, 4, 10]), rtp: 0.968, bias: 0.49182957, sapphireBias: 0.48668906 }),
  high: Object.freeze({ id: 'high', name: 'Alto', multipliers: Object.freeze([35, 12, 2, 0.2, 0, 0.2, 2, 12, 35]), rtp: 0.965, bias: 0.55456342, sapphireBias: 0.55170603 }),
});

export const riskOf = (id) => RISKS[id] ?? RISKS.low;

// Probabilidad de ir hacia el centro desde una posición desplazada.
export const centerBias = (id, sapphire = false) => (sapphire ? riskOf(id).sapphireBias : riskOf(id).bias);

// Camino de la bola: una decisión por fila con el flujo verificable.
// `offset` = derechas − izquierdas; canasta final = (offset + 8) / 2.
export function plinkoPath(stream, id, { sapphire = false } = {}) {
  const q = centerBias(id, sapphire);
  const moves = [];
  let offset = 0;
  for (let row = 0; row < PLINKO_ROWS; row++) {
    const f = stream.float();
    let right;
    if (offset === 0) right = f < 0.5;
    else if (offset > 0) right = f >= q;
    else right = f < q;
    offset += right ? 1 : -1;
    moves.push(right ? 1 : -1);
  }
  const bucket = (offset + PLINKO_ROWS) / 2;
  return { moves, bucket, multiplier: riskOf(id).multipliers[bucket] };
}

// Distribución exacta de canastas para un sesgo (para las pruebas y el comando `rtp`).
export function bucketDistribution(id, { sapphire = false } = {}) {
  const q = centerBias(id, sapphire);
  let dist = new Map([[0, 1]]);
  for (let row = 0; row < PLINKO_ROWS; row++) {
    const next = new Map();
    for (const [x, p] of dist) {
      const right = x === 0 ? 0.5 : x > 0 ? 1 - q : q;
      next.set(x + 1, (next.get(x + 1) ?? 0) + p * right);
      next.set(x - 1, (next.get(x - 1) ?? 0) + p * (1 - right));
    }
    dist = next;
  }
  const buckets = new Array(PLINKO_ROWS + 1).fill(0);
  for (const [x, p] of dist) buckets[(x + PLINKO_ROWS) / 2] += p;
  return buckets;
}

export const plinkoRtp = (id, options) => bucketDistribution(id, options).reduce((sum, p, i) => sum + p * riskOf(id).multipliers[i], 0);
