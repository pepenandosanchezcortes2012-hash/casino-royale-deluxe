// Textos de «The Syndicate Climb»: prólogo, epílogo y las voces de la Bitácora del Sindicato.
// Cada piso tiene su anfitrión: Moss (Subsuelo), Vera (Bahía Arcade), Ferro (Salón VIP del
// Padrino) y SIBILA (Penthouse Cripto-Olympus).

import { randomInt } from '../engine/rng.js';

export const PROLOGUE = Object.freeze([
  'Neo-Madrid, 2089. Despiertas en un callejón del bajo mundo, empapado de lluvia ácida, con la cabeza a punto de estallar.',
  'Tu monedero cripto parpadea en la muñeca: 10 créditos. Es todo lo que te queda.',
  'Sobre ti se alza la torre del Sindicato: cuatro pisos de mesas, cada uno más alto, más caro y más peligroso que el anterior.',
  'El Subsuelo Clandestino, la Bahía Arcade, el Salón VIP del Padrino y, en la cima, el Penthouse Cripto-Olympus.',
  'Reúne 10.000.000 de créditos y comprarás tu libertad… y el control del Sindicato.',
  'Si te quedas a cero, el Sindicato te tirará una limosna de 10 créditos. Solo una cada cinco minutos: gestiona tu riesgo.',
  'Moss baraja en la penumbra. Tienes 10 créditos. Empieza a subir.',
]);

export const EPILOGUE = Object.freeze([
  'Diez millones de créditos. La cifra se enciende a la vez en todas las pantallas de la torre.',
  'SIBILA apaga sus lentes rojas por primera vez desde que la encendieron. «Transfiriendo el control del Sindicato», sintetiza.',
  'Ferro te ofrece el anillo del Padrino sobre una bandeja de plata. Vera brinda desde la Bahía; hasta Moss ha subido desde el Subsuelo.',
  'Las puertas blindadas del Penthouse se abren a la azotea. Neo-Madrid se extiende a tus pies, por fin sin lluvia.',
  'Empezaste en un callejón con 10 créditos. Hoy la ciudad entera juega en tus mesas.',
]);

const POOLS = {
  begin: {
    any: ['Tienes 10 créditos y toda una torre por delante.', 'El callejón se queda atrás. Tu monedero marca 10 créditos.'],
  },
  arrive: {
    subsuelo: [
      'Las tuberías gotean sobre mesas cojas. Moss empuja hacia ti un vaso de dados mellado.',
      'Neón verde parpadeando y olor a óxido. Bienvenido al Subsuelo: aquí nadie apuesta más de 50 créditos.',
      '«Aquí abajo todos empezamos igual», gruñe Moss. «Con casi nada.»',
    ],
    bahia: [
      'El ascensor se abre a un océano de luces cian y magenta. Vera te saluda desde la cabina de Cyber-Fish.',
      'Máquinas arcade, peces de neón en las pantallas y el zumbido de mil fichas. La Bahía no duerme.',
      '«Por fin una cara nueva», dice Vera. «Aquí las apuestas ya tienen cuatro cifras.»',
    ],
    salon: [
      'Alfombras carmesí, mármol oscuro y un camarero androide que se inclina: «El Padrino le esperaba».',
      'Ferro, el mayordomo androide del Padrino, te acompaña a una mesa de terciopelo rojo.',
      'En el Salón VIP el silencio es caro. Las fichas más pequeñas valen 1.000 créditos.',
    ],
    olympus: [
      'La metrópolis entera brilla bajo el cristal blindado. Una lente roja se enciende: SIBILA te está calculando.',
      '«Bienvenido al Olimpo», sintetiza SIBILA. «Aquí no hay techo para las apuestas… ni red debajo.»',
      'Mesas de oro, cristal y nubes. Desde aquí arriba, diez millones parecen al alcance de la mano.',
    ],
  },
  unlock: {
    bahia: [
      'Un pitido en tu muñeca: «Tarjeta de acceso Neón concedida». La Bahía Arcade te espera en el Piso 2.',
      'Moss desliza una tarjeta fluorescente sobre la mesa. «Ya no perteneces a este sótano.»',
    ],
    salon: [
      'Un sobre lacrado con el sello del Padrino aparece bajo tu copa: el Salón VIP te abre sus puertas.',
      'Vera te guiña un ojo: «El Padrino quiere conocerte. Piso 3».',
    ],
    olympus: [
      'Tu huella dactilar se registra en el ascensor privado. El Penthouse Cripto-Olympus está abierto para ti.',
      'Ferro inclina la cabeza: «La IA del Sindicato ha solicitado su presencia en la cima».',
    ],
  },
  travel: {
    any: ['El ascensor del Sindicato te lleva a {floor}.', 'Las puertas se abren en {floor}.'],
  },
  win: {
    subsuelo: ['Moss gruñe y te paga {amount}. «No te acostumbres.»', 'En el Subsuelo hasta las migas saben a banquete: +{amount}.', 'Una tubería deja de gotear un segundo. +{amount} créditos.'],
    bahia: ['Vera desliza {amount} créditos hacia ti al ritmo del arcade.', 'Las luces de la Bahía parpadean en tu honor: +{amount}.', '«Suerte de principiante», dice Vera. Pero paga: +{amount}.'],
    salon: ['Ferro deposita {amount} créditos en una bandeja de plata.', 'El Padrino asiente desde su palco: +{amount}.', 'Un camarero androide aplaude sin ruido: +{amount}.'],
    olympus: ['SIBILA registra una anomalía estadística: +{amount} créditos para el jugador.', '«Pérdida aceptable», calcula SIBILA mientras te transfiere {amount}.', 'La ciudad brilla un poco más bajo tus pies: +{amount}.'],
  },
  loss: {
    subsuelo: ['Moss recoge tus fichas sin mirarte. El Subsuelo siempre cobra.', 'Otra ficha que se cuela por una rejilla: -{amount}.', 'El neón parpadea como si se riera de ti.'],
    bahia: ['Vera recoge la apuesta con una sonrisa de neón: -{amount}.', 'Las máquinas arcade se tragan {amount} créditos.', '«Así empiezan todas las partidas tristes», murmura Vera.'],
    salon: ['Ferro retira {amount} créditos con una reverencia impecable.', 'El Padrino no sonríe. La casa se queda {amount}.', 'El mármol del Salón no guarda memoria de los que pierden: -{amount}.'],
    olympus: ['SIBILA archiva tu derrota en microsegundos: -{amount}.', '«Tal y como estaba previsto», sintetiza la IA.', 'El viento golpea el cristal. -{amount} créditos.'],
  },
  'big-win': {
    subsuelo: ['¡A Moss se le cae el palillo! +{amount} créditos: el Subsuelo no veía tanto dinero desde hace años.', 'Los jugadores del fondo se levantan para verte cobrar {amount}.'],
    bahia: ['Toda la Bahía se gira. Vera tiene que pedir más fichas: +{amount}.', 'Las pantallas estallan en dorado. +{amount} créditos.'],
    salon: ['El Padrino se quita las gafas. +{amount} créditos sobre el terciopelo rojo.', 'Ferro recalibra su sonrisa: +{amount}.'],
    olympus: ['Las alarmas silenciosas de SIBILA se encienden: +{amount}.', '«Recalculando…», repite SIBILA mientras tu saldo sube {amount}.'],
  },
  'big-loss': {
    subsuelo: ['Un golpe seco. {amount} créditos se pierden entre las tuberías.', 'Moss cuenta tus fichas con una lentitud cruel: -{amount}.'],
    bahia: ['Vera barre las fichas con elegancia despiadada: -{amount}.', 'La música arcade no se detiene por ti. -{amount} créditos.'],
    salon: ['Ferro retira {amount} créditos sin pestañear. No tiene pestañas.', 'El Padrino brinda a tu salud mientras pierdes {amount}.'],
    olympus: ['SIBILA cobra {amount} créditos sin un parpadeo de sus lentes.', 'Desde la cima, la caída de {amount} se ve muy larga.'],
  },
  'critical-start': {
    any: ['Te juegas el {share} % de todo lo que tienes. El aire se detiene.', 'Todo o nada. Hasta el crupier contiene la respiración.', 'Una gota de sudor cae sobre el tapete. Empieza la jugada crítica.'],
    olympus: ['SIBILA eleva esta jugada a prioridad crítica: {share} % de tu capital en juego.', '«Riesgo extremo detectado», anuncia SIBILA.'],
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
    any: ['{n} derrotas seguidas. El humo se vuelve más espeso.', 'Racha negra de {n}. Recuerda por qué estás aquí.', '{n} caídas consecutivas. La torre huele el miedo.'],
  },
  push: {
    any: ['Empate. La casa te devuelve lo que es tuyo… por ahora.', 'Tablas. Nadie gana, nadie sangra.'],
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
  'achievement-plain': {
    any: ['Logro desbloqueado: «{name}».'],
  },
  'contract-new': {
    any: ['Nuevo encargo del Sindicato: {text}. Pago: {reward} créditos.', 'Un sobre negro aparece bajo tu vaso: «{text}». Recompensa: {reward} créditos.'],
  },
  'contract-done': {
    any: ['Encargo cumplido. El Sindicato paga {reward} créditos, como prometió.', 'Trabajo limpio. {reward} créditos transferidos a tu nombre.'],
  },
  broke: {
    any: ['Sin créditos. Un hombre de gris te tiende la mano: «El Sindicato da limosna, pero solo una cada cinco minutos».', 'Tu monedero marca cero. En la torre, la caridad tiene horario: pide tu limosna.'],
  },
  rescue: {
    any: ['El Sindicato te arroja una limosna de {amount} créditos. «No la desperdicies.»', 'Diez créditos tintinean en tu monedero. La próxima limosna, dentro de cinco minutos.'],
  },
  record: {
    any: ['Nuevo récord personal: {amount} créditos.', 'Nunca habías tenido tanto: {amount} créditos.'],
  },
  victory: {
    any: ['Diez millones de créditos. El Sindicato es tuyo.'],
  },
  owner: {
    any: ['{name} se proclama Dueño Absoluto del Sindicato.'],
  },
};

const SPEAKERS = {
  table: new Set(['arrive', 'win', 'loss', 'big-win', 'big-loss', 'critical-start', 'critical-win', 'critical-loss', 'streak-win', 'streak-loss', 'push']),
  syndicate: new Set(['unlock', 'achievement', 'achievement-plain', 'contract-new', 'contract-done', 'broke', 'rescue', 'victory', 'owner']),
};

export const HOSTS = Object.freeze({ subsuelo: 'Moss', bahia: 'Vera', salon: 'Ferro', olympus: 'SIBILA' });

// Devuelve { text, speaker } con los marcadores {clave} sustituidos.
export function narrate(kind, floorId, params = {}, rand = randomInt) {
  const pool = POOLS[kind];
  if (!pool) return { text: '', speaker: 'Narrador' };
  const lines = pool[floorId] ?? pool.any ?? Object.values(pool)[0];
  const template = lines[rand(lines.length)];
  const text = template.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? ''));
  const speaker = SPEAKERS.table.has(kind) ? HOSTS[floorId] ?? 'Crupier' : SPEAKERS.syndicate.has(kind) ? 'Sindicato' : 'Narrador';
  return { text, speaker };
}

export const NARRATIVE_KINDS = Object.freeze(Object.keys(POOLS));
