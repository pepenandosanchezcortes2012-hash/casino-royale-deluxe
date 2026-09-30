// Mide el RTP de Slots Matrix con el motor real (PRNG rápido con semilla, reproducible).
//   node tools/measure-slots.mjs [tiradas=2000000] [rondas de bono=200000] [pesos JSON] [--clover]
// Pesos opcionales: '{"base":[X,W,C,S,B,H,T,R],"free":[...]}' para calibrar sin tocar el motor.
import { playSpin, playFreeSpinsRound, SYMBOLS, BONUS_BUY_COST, FREE_SPINS } from '../js/games/slots-engine.js';

const SPINS = Number(process.argv[2] ?? 2_000_000);
const ROUNDS = Number(process.argv[3] ?? 200_000);
const table = process.argv[4] && process.argv[4].startsWith('{') ? JSON.parse(process.argv[4]) : null;
const clover = process.argv.includes('--clover');

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const next = mulberry32(20260929);
const rand = (n) => Math.floor(next() * n);
const bet = 10;

let lines = 0;
let hits = 0;
let triggers = 0;
let multi = 0;
let big = 0;
let sticky = [];
let stickySum = 0;
for (let i = 0; i < SPINS; i++) {
  const spin = playSpin({ bet, rand, sticky, clover, table });
  sticky = spin.sticky;
  stickySum += sticky.length;
  lines += spin.total;
  if (spin.total > 0) hits++;
  if (spin.freeSpins) triggers++;
  if (spin.steps.length >= 2) multi++;
  if (spin.total >= bet * 10) big++;
}
let bonus = 0;
for (let i = 0; i < ROUNDS; i++) bonus += playFreeSpinsRound({ bet, rand, clover, table }).total;
const fsValue = bonus / ROUNDS / bet;
const lineRtp = lines / (SPINS * bet);
const triggerRate = triggers / SPINS;
const rtp = lineRtp + triggerRate * fsValue;
const pct = (v) => `${(v * 100).toFixed(2)} %`;
console.log(JSON.stringify({
  spins: SPINS,
  rounds: ROUNDS,
  weights: table ?? { base: SYMBOLS.map((s) => s.base), free: SYMBOLS.map((s) => s.free) },
  clover,
  lines: pct(lineRtp),
  freeSpins: pct(triggerRate * fsValue),
  rtp: pct(rtp),
  bonusBuy: pct(fsValue / BONUS_BUY_COST),
  fsRoundValue: `${fsValue.toFixed(2)}× (${FREE_SPINS} giros)`,
  hitRate: pct(hits / SPINS),
  triggerEvery: Math.round(1 / triggerRate),
  twoCascades: pct(multi / SPINS),
  winTenX: pct(big / SPINS),
  avgSticky: (stickySum / SPINS).toFixed(3),
}, null, 1));
