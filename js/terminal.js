// Intérprete de la terminal hacker de la torre del Sindicato (sin DOM).
// runCommand(línea, contexto) devuelve las líneas que se imprimen y, si procede, una acción para
// la interfaz (limpiar, cerrar, exportar o importar la partida). El contexto trae las piezas
// vivas del juego (escalada, semillas, reliquias, progresión, ajustes, monedero) para poder
// probarlo aislado.

import { RISKS, plinkoRtp } from './games/plinko-math.js';
import { SLOT_MATH } from './games/slots-engine.js';
import { DICE_NUMERATOR } from './games/dice-math.js';
import { MINES_EDGE } from './games/mines-math.js';
import { TOWER_EDGE } from './games/towers-math.js';
import { CRASH_EDGE } from './games/crash-math.js';
import { WHEEL_SLICES, WHEEL_TOTAL_WEIGHT } from './games/wheel-math.js';
import { FISH_RTP } from './games/fish-math.js';
import { FLOORS, GOAL, rangeText } from './climb/floors.js';
import { SIDE_BET_HOUSE_EDGE } from './games/blackjack-rules.js';
import { RELICS, relicById, SLOT_COUNT } from './relics.js';
import { THEMES } from './settings.js';
import { GAME_NAMES } from './verify.js';

export const PROMPT = 'root@syndicate:~$';

const pct = (value, digits = 2) => `${(value * 100).toFixed(digits).replace('.', ',')} %`;
const chips = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });
const short = (hex, n = 16) => `${hex.slice(0, n)}…`;

const wheelValue = WHEEL_SLICES.reduce((sum, slice) => sum + (slice.type === 'chips' ? slice.amount * slice.weight : 0), 0) / WHEEL_TOTAL_WEIGHT;

const mmss = (ms) => {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

// Retorno teórico publicado de cada juego de la torre.
export const RTP_TABLE = Object.freeze([
  Object.freeze({ game: 'blackjack', rtp: 0.996, note: 'estrategia básica · 6 barajas S17 3:2 · PP ' + pct(1 - SIDE_BET_HOUSE_EDGE.perfectPairs) + ' · 21+3 ' + pct(1 - SIDE_BET_HOUSE_EDGE.twentyOnePlusThree) }),
  Object.freeze({ game: 'roulette', rtp: 36 / 37, note: 'un solo cero · racetrack incluido' }),
  Object.freeze({ game: 'slots', rtp: SLOT_MATH.rtp, note: `medido con ${chips.format(SLOT_MATH.spins)} tiradas · Trébol de Oro ${pct(SLOT_MATH.cloverRtp)}` }),
  Object.freeze({ game: 'plinko', rtp: plinkoRtp('medium'), note: Object.values(RISKS).map((risk) => `${risk.name} ${pct(plinkoRtp(risk.id))}`).join(' · ') + ' · Zafiro +2,5 puntos' }),
  Object.freeze({ game: 'crash', rtp: CRASH_EDGE, note: 'P(E ≥ x) = 0,97 / x para cualquier retiro' }),
  Object.freeze({ game: 'mines', rtp: MINES_EDGE, note: 'multiplicador 0,97 · C(25,k) / C(25−m,k)' }),
  Object.freeze({ game: 'dice', rtp: DICE_NUMERATOR / 100, note: 'multiplicador 98 / P' }),
  Object.freeze({ game: 'towers', rtp: TOWER_EDGE, note: 'multiplicador 0,97 / p^n' }),
  Object.freeze({ game: 'video_poker', rtp: 0.9954, note: 'Jacks or Better 9/6 · estrategia óptima con 5 monedas' }),
  Object.freeze({ game: 'fish', rtp: FISH_RTP, note: 'captura con p = 0,96 / multiplicador por impacto, apuntes a la criatura que apuntes' }),
  Object.freeze({ game: 'wheel', rtp: null, note: `gratis cada 24 h · valor medio ≈ ${chips.format(Math.round(wheelValue))} créditos + pociones y cofres legendarios` }),
]);

const HELP = Object.freeze([
  ['help', 'esta ayuda'],
  ['floor [1-4]', 'pisos y tarjetas de acceso; con un número, viaja a ese piso'],
  ['goal', 'progreso hacia los 10.000.000 y récord'],
  ['contracts', 'encargos del Sindicato en tu piso'],
  ['alms', 'limosna: +10 créditos con el saldo a cero, una cada 5 minutos'],
  ['seeds', 'semilla comprometida (hash), semilla del cliente y nonce'],
  ['rotate', 'revela la semilla del servidor actual y compromete otra'],
  ['clientseed <texto>', 'cambia tu semilla del cliente (revela la actual)'],
  ['verify <nonce>', 'recalcula una jugada con la semilla ya revelada'],
  ['history [n]', 'últimas apuestas registradas'],
  ['rtp', 'retorno teórico de cada juego'],
  ['relics', 'reliquias equipadas, colección, cofres y pociones'],
  ['missions', 'misiones diarias'],
  ['level', 'nivel, XP y rango VIP'],
  ['balance', 'saldo de créditos'],
  ['matrix on|off', 'lluvia de código de fondo'],
  ['turbo on|off', 'animaciones al doble de velocidad'],
  ['crt on|off', 'scanlines de monitor CRT'],
  ['theme <tema>', `tema de color: ${THEMES.map((t) => t.id).join(', ')}`],
  ['export', 'descarga una copia de seguridad (JSON)'],
  ['import', 'restaura una copia de seguridad'],
  ['clear', 'limpia la pantalla'],
  ['exit', 'cierra la terminal'],
]);

export const COMMANDS = Object.freeze(HELP.map(([usage]) => usage.split(' ')[0]).concat(['whoami', 'sudo']));

// Alias en castellano.
const ALIASES = Object.freeze({
  ayuda: 'help', '?': 'help', semillas: 'seeds', rotar: 'rotate', semilla: 'clientseed', verificar: 'verify',
  historial: 'history', reliquias: 'relics', misiones: 'missions', nivel: 'level', saldo: 'balance',
  piso: 'floor', pisos: 'floor', meta: 'goal', encargos: 'contracts', limosna: 'alms', rescate: 'alms',
  tema: 'theme', exportar: 'export', importar: 'import', limpiar: 'clear', cls: 'clear', salir: 'exit', scanlines: 'crt',
});

const line = (text, tone = 'info') => ({ text, tone });

function toggleArg(arg) {
  if (/^(on|si|sí|1|true)$/i.test(arg ?? '')) return true;
  if (/^(off|no|0|false)$/i.test(arg ?? '')) return false;
  return null;
}

export function parseCommand(input) {
  const tokens = String(input ?? '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { name: '', args: [] };
  const raw = tokens[0].toLowerCase();
  return { name: ALIASES[raw] ?? raw, args: tokens.slice(1) };
}

// Autocompletado del primer término (para la tecla Tab).
export function complete(prefix) {
  const value = String(prefix ?? '').toLowerCase();
  if (!value) return [];
  return COMMANDS.filter((name) => name.startsWith(value));
}

const HANDLERS = {
  floor(args, ctx) {
    const c = ctx.climb;
    if (!args.length) {
      return {
        lines: [
          line(`Piso actual: ${c.floor.level} · ${c.floor.name}`, 'accent'),
          ...FLOORS.map((f) => {
            const here = f.id === c.floor.id;
            const open = f.level <= c.unlockedLevel;
            const mark = here ? '>' : open ? '+' : 'x';
            const access = open ? '' : ` · tarjeta a los ${chips.format(f.unlockAt)} créditos`;
            return line(`  ${mark} ${f.level}. ${f.name} · apuestas ${rangeText(f, chips.format)}${access}`, here ? 'ok' : open ? 'info' : 'dim');
          }),
          line('Viaja con `floor <número>` (sin apuestas en juego).', 'dim'),
        ],
      };
    }
    const level = Number(args[0]);
    const target = FLOORS[level - 1];
    if (!Number.isInteger(level) || !target) return { lines: [line('Uso: floor <1-4>', 'warn')] };
    const result = (ctx.travel ?? ((id) => c.travel(id)))(target.id);
    if (result.ok) return { lines: [line(`Ascensor del Sindicato → ${target.name}.`, 'ok')] };
    const reasons = {
      here: 'Ya estás en ese piso.',
      locked: `Necesitas la tarjeta de acceso: reúne ${chips.format(result.need ?? target.unlockAt)} créditos.`,
      pending: 'Termina las apuestas en juego antes de tomar el ascensor.',
      status: 'La escalada todavía no ha empezado.',
    };
    return { lines: [line(reasons[result.reason] ?? 'No se puede viajar ahora.', 'warn')] };
  },

  goal(_, ctx) {
    const c = ctx.climb;
    const balance = ctx.wallet.balance;
    const next = c.nextFloor;
    return {
      lines: [
        line(`Meta: ${chips.format(GOAL)} créditos · tienes ${chips.format(balance)} (${pct(Math.min(1, balance / GOAL), 4)})`, 'accent'),
        line(`Avance de la torre: ${pct(c.progress, 1)} · récord de esta escalada: ${chips.format(c.record)}`),
        line(next ? `Siguiente tarjeta: ${next.name} a los ${chips.format(next.unlockAt)} créditos` : 'Tienes las 4 tarjetas de acceso.', 'dim'),
      ],
    };
  },

  contracts(_, ctx) {
    const list = ctx.climb.contracts;
    return {
      lines: [
        line(`Encargos del Sindicato · ${ctx.climb.floor.name}`, 'accent'),
        ...list.map((c) => line(`  [${c.progress}/${c.goal}] ${c.text} → +${chips.format(c.reward)} créditos`)),
      ],
    };
  },

  alms(_, ctx) {
    const c = ctx.climb;
    const status = c.rescueStatus();
    if (status.available) {
      const amount = (ctx.takeRescue ?? (() => c.takeRescue()))();
      return { lines: [line(`El Sindicato te da una limosna de ${chips.format(amount)} créditos. La próxima, dentro de 5 minutos.`, 'ok')] };
    }
    if (!status.broke) return { lines: [line('La limosna solo se concede con el saldo a cero y sin apuestas en juego.', 'warn')] };
    return { lines: [line(`El Sindicato no da otra limosna hasta dentro de ${mmss(status.wait)}.`, 'warn')] };
  },

  help() {
    return { lines: [line('Comandos disponibles:', 'accent'), ...HELP.map(([usage, text]) => line(`  ${usage.padEnd(20)} ${text}`))] };
  },

  seeds(_, ctx) {
    const c = ctx.fair.commitment;
    const lines = [
      line(`server_seed_hash  ${c.serverSeedHash}`, 'accent'),
      line(`client_seed       ${c.clientSeed}`),
      line(`nonce             ${c.nonce}`),
    ];
    const last = ctx.fair.revealed.at(-1);
    if (last) lines.push(line(`última revelada   ${short(last.serverSeed, 24)} (${last.nonces} jugadas)`, 'dim'));
    lines.push(line('La semilla del servidor se revela al rotarla: `rotate`.', 'dim'));
    return { lines };
  },

  rotate(_, ctx) {
    const revealed = ctx.fair.rotate();
    return {
      lines: [
        line('Semilla revelada:', 'ok'),
        line(`  server_seed     ${revealed.serverSeed}`),
        line(`  hash            ${revealed.serverSeedHash}`),
        line(`  jugadas         nonce 0 – ${Math.max(0, revealed.nonces - 1)}`),
        line(`Nuevo compromiso: ${ctx.fair.commitment.serverSeedHash}`, 'accent'),
      ],
    };
  },

  clientseed(args, ctx) {
    const value = args.join(' ');
    if (!value) return { lines: [line('Uso: clientseed <texto sin espacios, 1–64 caracteres>', 'warn')] };
    if (!ctx.fair.setClientSeed(value)) return { lines: [line('Semilla no válida: usa de 1 a 64 caracteres visibles, sin espacios.', 'error')] };
    return { lines: [line(`client_seed = ${ctx.fair.commitment.clientSeed}`, 'ok'), line('La semilla del servidor anterior quedó revelada; el nonce vuelve a 0.', 'dim')] };
  },

  verify(args, ctx) {
    const nonce = Number(args[0]);
    if (!Number.isInteger(nonce) || nonce < 0) return { lines: [line('Uso: verify <nonce>', 'warn')] };
    const result = ctx.verify(nonce);
    if (!result.ok) return { lines: [line(result.error, result.hidden ? 'warn' : 'error')] };
    const lines = [
      line(`${result.name} · nonce ${nonce}`, 'accent'),
      line(`sha256(server_seed) ${result.seedOk ? '✔ coincide con el hash publicado' : '✘ NO coincide'}`, result.seedOk ? 'ok' : 'error'),
      line(`HMAC-SHA256(server_seed, "${result.message}")`),
      line(`  = ${result.hmac}`),
      line(`8 hex ${result.first8} → ${result.int} / 2^32 = ${result.float.toFixed(10)}`),
      ...result.rows.map(([label, value]) => line(`  ${label}: ${value}`)),
      line(`Resultado: ${result.outcome}`, 'ok'),
    ];
    return { lines };
  },

  history(args, ctx) {
    const count = Math.min(30, Math.max(1, Number(args[0]) || 10));
    const items = ctx.fair.history.slice(-count).reverse();
    if (!items.length) return { lines: [line('Todavía no hay apuestas registradas.', 'dim')] };
    return {
      lines: [
        line('nonce  juego          apuesta    ×       premio', 'accent'),
        ...items.map((h) => line(`${String(h.nonce).padEnd(6)} ${(GAME_NAMES[h.game] ?? h.game).padEnd(14)} ${chips.format(h.stake).padStart(8)}  ${h.multiplier.toFixed(2).padStart(6)}  ${chips.format(h.payout).padStart(9)}`, h.payout > h.stake ? 'ok' : 'info')),
      ],
    };
  },

  rtp() {
    return {
      lines: [
        line('Retorno teórico al jugador (RTP):', 'accent'),
        ...RTP_TABLE.map((row) => line(`  ${(GAME_NAMES[row.game] ?? row.game).padEnd(14)} ${row.rtp === null ? '   —    ' : pct(row.rtp).padStart(8)}  ${row.note}`)),
        line('Todos los resultados salen de HMAC-SHA256 y se pueden verificar con `verify`.', 'dim'),
      ],
    };
  },

  relics(_, ctx) {
    const r = ctx.relics;
    const lines = [line(`Ranuras (${SLOT_COUNT}):`, 'accent')];
    r.equipped.forEach((id, i) => {
      const relic = relicById(id);
      lines.push(line(`  [${i + 1}] ${relic ? `${relic.name} — ${relic.text}` : '— vacía —'}`, relic ? 'info' : 'dim'));
    });
    lines.push(line(`Colección: ${r.owned.length}/${RELICS.length}`, 'accent'));
    for (const relic of RELICS) lines.push(line(`  ${r.owns(relic.id) ? relic.name : '?? Reliquia sin descubrir'}`, r.owns(relic.id) ? 'info' : 'dim'));
    const chests = r.chests;
    lines.push(line(`Cofres: ${chests.common} comunes · ${chests.legendary} legendarios · Pociones ×2: ${r.potions}${r.potionArmed ? ' (una activa)' : ''}`));
    return { lines };
  },

  missions(_, ctx) {
    const list = ctx.progression.missions();
    const done = list.filter((m) => m.done).length;
    return {
      lines: [
        line(`Misiones diarias: ${done}/${list.length}`, 'accent'),
        ...list.map((m) => line(`  ${m.done ? '[x]' : '[ ]'} ${m.text} (${chips.format(m.amount ? Math.round(m.progress * m.scale) : m.progress)}/${chips.format(m.amount ? Math.round(m.goal * m.scale) : m.goal)}) → +${chips.format(m.chips)} créditos · +${m.xp} XP`, m.done ? 'ok' : 'info')),
      ],
    };
  },

  level(_, ctx) {
    const p = ctx.progression.progress();
    return {
      lines: [
        line(`Nivel ${p.level} · rango ${p.rank.name}`, 'accent'),
        line(p.max ? `XP total ${chips.format(Math.floor(p.xp))} · nivel máximo` : `XP ${chips.format(Math.floor(p.into))}/${chips.format(p.needed)} para el nivel ${p.level + 1}`),
        line(p.nextRank ? `Siguiente rango: ${p.nextRank.name} en el nivel ${p.nextRank.level}` : 'Has alcanzado el rango más alto: El Padrino.', 'dim'),
      ],
    };
  },

  balance(_, ctx) {
    return { lines: [line(`Saldo: ${chips.format(ctx.wallet.balance)} créditos · en juego: ${chips.format(ctx.wallet.inPlay)}`, 'accent')] };
  },

  matrix(args, ctx) {
    const on = toggleArg(args[0]);
    if (on === null) return { lines: [line(`Uso: matrix on|off (ahora: ${ctx.settings.matrix ? 'on' : 'off'})`, 'warn')] };
    ctx.settings.setMatrix(on);
    return { lines: [line(`Lluvia Matrix ${on ? 'activada' : 'desactivada'}.`, 'ok')] };
  },

  turbo(args, ctx) {
    const on = toggleArg(args[0]);
    if (on === null) return { lines: [line(`Uso: turbo on|off (ahora: ${ctx.settings.turbo ? 'on' : 'off'})`, 'warn')] };
    ctx.settings.setTurbo(on);
    return { lines: [line(`Modo turbo ${on ? 'activado: animaciones al doble de velocidad' : 'desactivado'}. Las probabilidades no cambian.`, 'ok')] };
  },

  crt(args, ctx) {
    const on = toggleArg(args[0]);
    if (on === null) return { lines: [line(`Uso: crt on|off (ahora: ${ctx.settings.scanlines ? 'on' : 'off'})`, 'warn')] };
    ctx.settings.setScanlines(on);
    return { lines: [line(`Scanlines CRT ${on ? 'activadas' : 'desactivadas'}.`, 'ok')] };
  },

  theme(args, ctx) {
    const id = (args[0] ?? '').toLowerCase();
    if (!ctx.settings.setTheme(id)) {
      return { lines: [line(`Temas: ${THEMES.map((t) => `${t.id} (${t.name})`).join(', ')}. Actual: ${ctx.settings.theme}`, 'warn')] };
    }
    return { lines: [line(`Tema ${THEMES.find((t) => t.id === id).name} aplicado.`, 'ok')] };
  },

  export() {
    return { lines: [line('Generando copia de seguridad…', 'dim')], action: 'export' };
  },

  import() {
    return { lines: [line('Elige el archivo JSON de la copia de seguridad.', 'dim')], action: 'import' };
  },

  clear() {
    return { lines: [], action: 'clear' };
  },

  exit() {
    return { lines: [line('Conexión cerrada.', 'dim')], action: 'close' };
  },

  whoami(_, ctx) {
    const p = ctx.progression.progress();
    return { lines: [line(`jugador@syndicate · ${ctx.climb.title.name} · piso ${ctx.climb.floor.level} · nivel ${p.level} · ${p.rank.name}`)] };
  },

  sudo() {
    return { lines: [line('Permiso denegado: la casa no acepta sobornos.', 'error')] };
  },
};

export function runCommand(input, ctx) {
  const { name, args } = parseCommand(input);
  if (!name) return { lines: [] };
  const handler = HANDLERS[name];
  if (!handler) return { lines: [line(`${name}: orden no encontrada. Escribe \`help\`.`, 'error')] };
  try {
    return handler(args, ctx);
  } catch (error) {
    return { lines: [line(`Error: ${error?.message ?? error}`, 'error')] };
  }
}
