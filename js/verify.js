// Verificador independiente de jugadas provably fair (sin DOM).
// Con la semilla del servidor ya revelada, la semilla del cliente y el nonce, recalcula el
// HMAC-SHA256, el primer número (8 hex ÷ 2^32) y el resultado completo de cada juego con las
// mismas funciones matemáticas que usa la mesa. Lo usan el panel de telemetría y la terminal.

import { FairStream, hmacHex, blockMessage, seedMatchesHash } from './provably_fair.js';
import { playDice } from './games/dice-math.js';
import { crashPoint } from './games/crash-math.js';
import { placeMines, clampMines, MINES_CELLS } from './games/mines-math.js';
import { towerLayout, difficultyOf } from './games/towers-math.js';
import { plinkoPath, riskOf } from './games/plinko-math.js';
import { dealHand, drawCards, evaluateHand, payPerCoin } from './games/video_poker-math.js';
import { spinWheel } from './games/wheel-math.js';
import { playSpin, SYMBOLS } from './games/slots-engine.js';
import { buildShoe } from './games/blackjack-rules.js';
import { DADO_CHANCE, BATTERY_CHANCE } from './relics.js';
import { speciesById, validMultiplier, playShot, FISH_RTP } from './games/fish-math.js';

export const GAME_NAMES = Object.freeze({
  blackjack: 'Blackjack',
  roulette: 'Ruleta',
  slots: 'Slots Matrix',
  plinko: 'Plinko',
  crash: 'Crash',
  mines: 'Minas',
  dice: 'Dados',
  towers: 'Torres',
  video_poker: 'Video Póker',
  wheel: 'Rueda Legendaria',
  fish: 'Cyber-Fish Hunter',
});

// Probabilidad de los usos de reliquias que se deciden con el flujo de la jugada.
export const RELIC_ROLLS = Object.freeze({ dado: DADO_CHANCE, battery: BATTERY_CHANCE });

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const COLOR = (n) => (n === 0 ? 'verde' : RED.has(n) ? 'rojo' : 'negro');
const decimals = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 4, useGrouping: 'always' });
const fixed2 = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (value) => decimals.format(value);
const mult = (value) => `×${fixed2.format(value)}`;
const cell = (index, size = 5) => `F${Math.floor(index / size) + 1}C${(index % size) + 1}`;
const SYMBOL_NAMES = Object.fromEntries(SYMBOLS.map((symbol) => [symbol.id, symbol.name]));

// Primer bloque HMAC de la jugada y el número que se deriva de él.
export function inspect({ serverSeed, clientSeed, nonce }) {
  const message = blockMessage(clientSeed, nonce, 0);
  const hmac = hmacHex(serverSeed, message);
  const first8 = hmac.slice(0, 8);
  const int = parseInt(first8, 16);
  return { message, hmac, first8, int, float: int / 2 ** 32 };
}

const VERIFIERS = {
  dice(stream, params) {
    const r = playDice(stream, { chance: params.chance ?? 50, direction: params.direction === 'over' ? 'over' : 'under' });
    const condition = r.direction === 'under' ? `< ${r.target}` : `≥ ${r.target}`;
    return {
      rows: [['Tirada', fixed2.format(r.roll)], ['Condición', `${condition} (${r.chance} %)`], ['Multiplicador', mult(r.multiplier)]],
      outcome: `${fixed2.format(r.roll)} → ${r.win ? `gana ${mult(r.multiplier)}` : 'pierde'}`,
    };
  },

  crash(stream) {
    const point = crashPoint(stream.float());
    return {
      rows: [['Fórmula', 'E = 0,97 / (1 − r), truncado; < 1,01 → 1,00'], ['Punto de choque', mult(point)]],
      outcome: point <= 1 ? 'Explota al despegar (×1,00)' : `El cohete explota en ${mult(point)}`,
    };
  },

  mines(stream, params) {
    const mines = clampMines(params.mines ?? 3);
    const layout = placeMines(stream, mines);
    const cells = layout.map((i) => cell(i)).join(' · ');
    return { rows: [['Minas', String(mines)], ['Casillas con mina', cells]], outcome: `${mines} minas en ${MINES_CELLS} casillas: ${cells}` };
  },

  towers(stream, params) {
    const difficulty = difficultyOf(params.difficulty);
    const layout = towerLayout(stream, difficulty.id);
    const floors = layout.map((traps, i) => [`Piso ${i + 1}`, `trampa en la losa ${traps.map((t) => t + 1).join(' y ')} de ${difficulty.tiles}`]);
    return { rows: [['Dificultad', difficulty.name], ...floors], outcome: `Torre ${difficulty.name.toLowerCase()}: ${layout.map((t) => t.map((x) => x + 1).join('+')).join(' / ')}` };
  },

  plinko(stream, params) {
    const risk = riskOf(params.risk);
    const path = plinkoPath(stream, risk.id, { sapphire: params.sapphire === true });
    const moves = path.moves.map((m) => (m > 0 ? 'D' : 'I')).join(' ');
    return {
      rows: [['Riesgo', `${risk.name}${params.sapphire ? ' · Zafiro' : ''}`], ['Camino (I/D)', moves], ['Cubeta', `${path.bucket + 1} de 9`], ['Multiplicador', mult(path.multiplier)]],
      outcome: `Cubeta ${path.bucket + 1} → ${mult(path.multiplier)}`,
    };
  },

  roulette(stream) {
    const pocket = stream.int(37);
    return { rows: [['Casilla', `${pocket} ${COLOR(pocket)}`]], outcome: `Sale el ${pocket} ${COLOR(pocket)}` };
  },

  wheel(stream) {
    const { index, slice } = spinWheel(stream);
    return { rows: [['Gajo', `${index + 1} de 10`], ['Premio', slice.type === 'chips' ? `${decimals.format(slice.amount)} créditos` : slice.label]], outcome: `Gajo ${index + 1}: ${slice.label}` };
  },

  fish(stream, params) {
    const kind = speciesById(params.species);
    const multiplier = Number(params.multiplier);
    const roll = stream.float();
    if (!kind || !validMultiplier(kind.id, multiplier)) {
      return {
        rows: [['Número de la bala', num(roll)], ['Impacto', 'Indica en los parámetros la criatura y su multiplicador, p. ej. {"species":"jelly","multiplier":8}']],
        outcome: `Número de la bala: ${num(roll)}`,
      };
    }
    const shot = playShot({ float: () => roll }, multiplier);
    return {
      rows: [
        ['Criatura', `${kind.name} ×${num(multiplier)}`],
        ['Probabilidad de captura', `${num(FISH_RTP)} / ${num(multiplier)} = ${num(shot.chance)}`],
        ['Número de la bala', num(roll)],
        ['Resultado', shot.captured ? `${num(roll)} < ${num(shot.chance)} → capturada (paga ×${num(multiplier)})` : `${num(roll)} ≥ ${num(shot.chance)} → escapa`],
      ],
      outcome: shot.captured ? `${kind.name} capturada: ×${num(multiplier)}` : `${kind.name} escapa`,
    };
  },

  video_poker(stream, params) {
    const { deck, hand } = dealHand(stream);
    const holds = Array.isArray(params.holds) && params.holds.length === 5 ? params.holds.map(Boolean) : null;
    const rows = [['Mano inicial', hand.join(' ')], ['Reposición', deck.slice(5, 10).join(' ')]];
    if (!holds) return { rows, outcome: `Mano inicial: ${hand.join(' ')}` };
    const final = drawCards(deck, hand, holds);
    const row = evaluateHand(final);
    const coins = params.coins ?? 1;
    rows.push(['Retenidas', holds.map((h, i) => (h ? hand[i] : '·')).join(' ')], ['Mano final', final.join(' ')], ['Jugada', row ? `${row.name} (paga ${payPerCoin(row, coins)} por 1)` : 'Sin premio']);
    return { rows, outcome: `${final.join(' ')} → ${row ? row.name : 'sin premio'}` };
  },

  slots(stream, params) {
    const spin = playSpin({
      bet: 1,
      mode: params.mode === 'free' ? 'free' : 'base',
      rand: stream.rand,
      sticky: Array.isArray(params.sticky) ? params.sticky : [],
      clover: params.clover === true,
    });
    const grid = (g) => g.map((row) => row.join('')).join(' / ');
    const rows = [['Rodillos', grid(spin.initial)], ['Avalanchas', String(spin.steps.length)], ['Final', grid(spin.final)], ['Premio', `${mult(spin.total)} la apuesta`]];
    if (spin.freeSpins) rows.push(['Estrellas', `${spin.scatters.length} → ${spin.freeSpins} giros gratis`]);
    if (params.battery && spin.total === 0) {
      const roll = stream.float();
      rows.push(['Batería Cuántica', `${num(roll)} ${roll < RELIC_ROLLS.battery ? `< ${num(RELIC_ROLLS.battery)} → giro gratis` : `≥ ${num(RELIC_ROLLS.battery)} → sin giro`}`]);
    }
    rows.push(['Leyenda', Object.entries(SYMBOL_NAMES).map(([id, name]) => `${id}=${name}`).join(', ')]);
    return { rows, outcome: `Premio ${mult(spin.total)} la apuesta con ${spin.steps.length} avalancha${spin.steps.length === 1 ? '' : 's'}` };
  },

  blackjack(stream, params) {
    if (params.kind === 'dado') {
      const roll = stream.float();
      const acts = roll < RELIC_ROLLS.dado;
      return { rows: [['Dado de Montecarlo', `${num(roll)} ${acts ? `< ${num(RELIC_ROLLS.dado)} → el crupier recibe un 10` : `≥ ${num(RELIC_ROLLS.dado)} → carta normal`}`]], outcome: acts ? 'El dado cambia la carta del crupier' : 'El dado no actúa' };
    }
    const shoe = stream.shuffle(buildShoe());
    const from = Number.isInteger(params.from) ? params.from : 0;
    const to = Number.isInteger(params.to) ? Math.min(params.to, shoe.length) : Math.min(from + 20, shoe.length);
    const cards = shoe.slice(from, to);
    return {
      rows: [['Zapato', '6 barajas · 312 cartas barajadas con Fisher-Yates'], [`Cartas ${from + 1}–${to}`, cards.join(' ')]],
      outcome: `Cartas ${from + 1}–${to} del zapato: ${cards.join(' ')}`,
    };
  },
};

// Verifica una jugada. Con `serverSeedHash` también comprueba el compromiso publicado.
export function verifyBet({ game, serverSeed, serverSeedHash = null, clientSeed, nonce, params = {} }) {
  const verifier = VERIFIERS[game];
  if (!verifier) return { ok: false, error: `Juego desconocido: ${game}` };
  if (!/^[0-9a-f]{64}$/.test(String(serverSeed ?? ''))) return { ok: false, error: 'La semilla del servidor debe tener 64 caracteres hexadecimales' };
  if (!Number.isInteger(nonce) || nonce < 0) return { ok: false, error: 'El nonce debe ser un entero ≥ 0' };
  if (!clientSeed) return { ok: false, error: 'Falta la semilla del cliente' };
  const seedOk = serverSeedHash ? seedMatchesHash(serverSeed, serverSeedHash) : null;
  const first = inspect({ serverSeed, clientSeed, nonce });
  const stream = new FairStream({ serverSeed, clientSeed, nonce });
  const result = verifier(stream, params ?? {});
  return { ok: true, game, name: GAME_NAMES[game], seedOk, ...first, rows: result.rows, outcome: result.outcome, used: stream.used };
}
