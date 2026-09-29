// Textos de «El Último Crédito»: prólogo, finales y las voces de la Bitácora del Crupier.
// Cada zona tiene su crupier: Moss (Callejón), Vera (Salón de Neón) y SIBILA (Penthouse).

import { randomInt } from '../engine/rng.js';

export const PROLOGUE = Object.freeze([
  'Neo-Madrid, 2089. La lluvia ácida no ha dejado de caer desde que apagaron el último satélite.',
  'Bajo el viejo metro, detrás de una puerta sin nombre, late el Casino Royale Deluxe: el tapete donde el Sindicato decide quién vive y quién desaparece.',
  'Tu deuda con ellos ya no cabe en ninguna pantalla. A cambio de tu vida te han concedido una última oportunidad: un solo crédito.',
  'Las reglas son sencillas. Sube del Callejón al Salón de Neón, y del Salón al Penthouse. Reúne 100.000 créditos y el Sindicato te venderá tu libertad.',
  'El Sindicato puede prestarte tres favores. Si tu saldo llega a cero cuando ya no quede ninguno, nadie volverá a pronunciar tu nombre.',
  'El crupier baraja. Tienes un crédito. Haz que cuente.',
]);

export const FINALE = Object.freeze([
  'El ascensor se detiene en la planta 100. Por primera vez, SIBILA apaga sus lentes rojas.',
  'Cien mil créditos. La cifra exacta de tu libertad brilla en todas las pantallas del casino.',
  'Los tres capos del Sindicato se levantan. Uno de ellos desliza sobre el tapete un anillo de oro con una inscripción: DUEÑO DEL DESTINO.',
  'Las puertas blindadas se abren hacia la azotea. Ha dejado de llover.',
  'Eres libre. Y en Neo-Madrid, la libertad es la única apuesta que nadie había ganado jamás.',
]);

export const GAME_OVER = Object.freeze([
  'La última ficha resbala entre tus dedos y rueda bajo la mesa.',
  'Ya no quedan favores. El Sindicato no concede segundas oportunidades… y tú ya gastaste la cuarta.',
  'Dos sombras con traje gris te escoltan hacia la salida de servicio. Afuera sigue lloviendo.',
  'Bancarrota perpetua. Tu nombre se borra del registro del casino, ficha a ficha.',
]);

const POOLS = {
  begin: {
    any: ['Tienes un crédito. Haz que cuente.', 'La puerta se cierra a tu espalda. Un crédito en el bolsillo y toda una deuda por delante.'],
  },
  arrive: {
    alley: [
      'La bombilla parpadea sobre la mesa coja. Moss escupe en el suelo y empuja una ficha gastada hacia ti.',
      'Huele a óxido y a promesas rotas. Bienvenido al Callejón: aquí nadie apuesta más de 10 créditos.',
      '«Aquí abajo todos empezamos igual», gruñe Moss mientras baraja. «Con nada.»',
    ],
    neon: [
      'El ascensor se abre a un océano de neón violeta. Vera sonríe sin enseñar los dientes.',
      'El humo de sintetabaco dibuja ondas bajo los neones. En el Salón las apuestas ya tienen tres cifras.',
      '«Por fin una cara nueva», dice Vera, repartiendo sin mirar las cartas. «Veamos cuánto duras.»',
    ],
    penthouse: [
      'Silencio blindado. Una lente roja se enciende sobre la mesa: SIBILA te está calculando.',
      '«Bienvenido al Penthouse», sintetiza SIBILA. «Su probabilidad de salir de aquí con vida es… interesante.»',
      'Los capos del Sindicato observan desde un palco a oscuras. Aquí cada ficha pesa como una vida.',
    ],
  },
  unlock: {
    neon: [
      'Un portero con gafas de espejo te hace una seña: el Salón de Neón te abre sus puertas.',
      'Un mensaje cifrado vibra en tu muñeca: «Acceso al Salón de Neón concedido».',
    ],
    penthouse: [
      'SIBILA te envía una invitación con bordes dorados. El Penthouse está abierto para ti.',
      'El ascensor privado del Sindicato desbloquea la planta 100. Solo para quienes superan los 5.000 créditos.',
    ],
  },
  win: {
    alley: ['Moss gruñe y te paga {amount}. «No te acostumbres.»', 'En el Callejón hasta las migas saben a banquete: +{amount}.', 'La bombilla deja de parpadear un segundo. +{amount} créditos.'],
    neon: ['Vera arquea una ceja y desliza {amount} créditos hacia ti.', 'Los neones zumban un poco más fuerte: +{amount}.', '«Suerte de principiante», susurra Vera. Pero paga: +{amount}.'],
    penthouse: ['SIBILA registra una anomalía estadística: +{amount} créditos para el jugador.', '«Pérdida aceptable», calcula SIBILA mientras te transfiere {amount}.', 'Un capo aplaude sin ganas desde el palco: +{amount}.'],
  },
  loss: {
    alley: ['Moss recoge tus fichas sin mirarte. El Callejón siempre cobra.', 'Otra ficha que se cuela por la rendija del tapete: -{amount}.', 'La bombilla parpadea como si se riera de ti.'],
    neon: ['Vera recoge la apuesta con una sonrisa de terciopelo: -{amount}.', 'El neón parpadea en rojo. La casa se queda {amount}.', '«Así empiezan todas las historias tristes», murmura Vera.'],
    penthouse: ['SIBILA archiva tu derrota en microsegundos: -{amount}.', '«Tal y como estaba previsto», sintetiza la IA.', 'El silencio del Penthouse pesa más que los {amount} créditos perdidos.'],
  },
  'big-win': {
    alley: ['¡A Moss se le cae el palillo! +{amount} créditos: el Callejón no veía tanto dinero desde hace años.', 'Los borrachos del fondo se despiertan para verte cobrar {amount}.'],
    neon: ['El Salón entero se gira. Vera tiene que pedir más fichas: +{amount}.', 'Los neones estallan en dorado. +{amount} créditos y un murmullo que recorre la sala.'],
    penthouse: ['Las alarmas silenciosas de SIBILA se encienden: +{amount}. Los capos han dejado de sonreír.', '«Recalculando…», repite SIBILA mientras el marcador sube {amount} créditos.'],
  },
  'big-loss': {
    alley: ['Un golpe seco. {amount} créditos se evaporan en la humedad del sótano.', 'Moss cuenta tus fichas con una lentitud cruel: -{amount}.'],
    neon: ['Vera barre las fichas con elegancia despiadada: -{amount}.', 'La música del Salón no se detiene por ti. -{amount} créditos.'],
    penthouse: ['SIBILA cobra {amount} créditos sin un parpadeo de sus lentes.', 'Desde el palco llega una risa ahogada. -{amount}.'],
  },
  'critical-start': {
    any: ['Te juegas el {share} % de todo lo que tienes. El aire se detiene.', 'Todo o nada. Hasta el crupier contiene la respiración.', 'Una gota de sudor cae sobre el tapete. Empieza la jugada crítica.'],
    penthouse: ['SIBILA eleva esta mano a prioridad crítica: {share} % de tu capital en juego.', '«Riesgo extremo detectado», anuncia SIBILA. Los capos se inclinan hacia delante.'],
  },
  'critical-win': {
    any: ['¡Sobrevives! La jugada crítica te devuelve {amount} créditos de golpe.', 'El destino parpadea… y te sonríe. +{amount}.', 'El corazón vuelve a latir: ganas {amount}.'],
  },
  'critical-loss': {
    any: ['La jugada crítica se lleva {amount} créditos. El suelo se abre bajo tus pies.', 'Todo… y nada. -{amount}.', 'El eco de las fichas cayendo dura una eternidad: -{amount}.'],
  },
  'streak-win': {
    any: ['{n} victorias seguidas. Los murmullos empiezan a seguirte.', 'Racha de {n}. Alguien del Sindicato apunta tu nombre.', '{n} seguidas. La suerte es una amante celosa: no la hagas esperar.'],
  },
  'streak-loss': {
    any: ['{n} derrotas seguidas. El humo se vuelve más espeso.', 'Racha negra de {n}. Recuerda por qué estás aquí.', '{n} caídas consecutivas. El casino huele el miedo.'],
  },
  push: {
    any: ['Empate. El casino te devuelve lo que es tuyo… por ahora.', 'Tablas. Nadie gana, nadie sangra.'],
  },
  'title-up': {
    any: ['Nuevo apodo en los pasillos: «{title}».', 'Ya te llaman «{title}». Tu reputación sube como el humo.'],
  },
  'title-down': {
    any: ['Los rumores cambian rápido: ahora eres «{title}».', 'Tu nombre pierde brillo. Ya solo eres «{title}».'],
  },
  achievement: {
    any: ['Logro desbloqueado: «{name}». El Sindicato ingresa {reward} créditos a tu nombre.', '«{name}». Hasta el Sindicato tiene que reconocerlo: +{reward} créditos.'],
  },
  'contract-new': {
    any: ['Nuevo encargo del Sindicato: {text}. Pago: {reward} créditos.', 'Un sobre negro aparece bajo tu vaso: «{text}». Recompensa: {reward} créditos.'],
  },
  'contract-done': {
    any: ['Encargo cumplido. El Sindicato paga {reward} créditos, como prometió.', 'Trabajo limpio. {reward} créditos transferidos a tu nombre.'],
  },
  broke: {
    any: ['Sin créditos. Un hombre de traje gris se sienta a tu lado: el Sindicato puede hacerte un favor de {amount}. Te quedan {n}.', 'Tus bolsillos están vacíos. Una voz te susurra al oído: «Pide un favor. Solo te quedan {n}.»'],
  },
  favor: {
    any: ['El Sindicato te presta {amount} créditos. Los favores se pagan, de un modo u otro. Quedan {n}.', 'Un sobre con {amount} créditos cae sobre la mesa. «Nos lo debes», dice el hombre de gris. Quedan {n}.'],
  },
  demoted: {
    any: ['Dos gorilas te escoltan hasta {zone}. Sin fondos no hay sitio para ti ahí arriba.', 'Tu saldo ya no alcanza. Te devuelven a {zone} sin ninguna ceremonia.'],
  },
  victory: {
    any: ['Cien mil créditos. El Sindicato te declara libre: Dueño del Destino.'],
  },
  gameover: {
    any: ['Bancarrota perpetua. El casino cierra la puerta a tu espalda.'],
  },
};

const SPEAKERS = {
  table: new Set(['arrive', 'win', 'loss', 'big-win', 'big-loss', 'critical-start', 'critical-win', 'critical-loss', 'streak-win', 'streak-loss', 'push']),
  syndicate: new Set(['unlock', 'achievement', 'contract-new', 'contract-done', 'broke', 'favor']),
};

const DEALERS = { alley: 'Moss', neon: 'Vera', penthouse: 'SIBILA' };

// Devuelve { text, speaker } con los marcadores {clave} sustituidos.
export function narrate(kind, zoneId, params = {}, rand = randomInt) {
  const pool = POOLS[kind];
  if (!pool) return { text: '', speaker: 'Narrador' };
  const lines = pool[zoneId] ?? pool.any ?? Object.values(pool)[0];
  const template = lines[rand(lines.length)];
  const text = template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
  const speaker = SPEAKERS.table.has(kind) ? DEALERS[zoneId] ?? 'Crupier' : SPEAKERS.syndicate.has(kind) ? 'Sindicato' : 'Narrador';
  return { text, speaker };
}

export const NARRATIVE_KINDS = Object.freeze(Object.keys(POOLS));
