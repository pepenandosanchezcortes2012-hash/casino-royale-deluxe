// Locutor: decide qué se dice en voz alta. Solo frases breves en momentos clave (llegada a un
// piso, tarjeta de acceso, jugada crítica, limosna, encargos, logros, Kraken y victoria); el resto
// de la historia se lee en la bitácora. La voz descarta lo normal si acaba de hablar.

import { climb } from '../climb/climb.js';
import { voice, PRIORITY } from '../voice.js';

const NUMBERS = ['uno', 'dos', 'tres', 'cuatro'];

class Announcer {
  init() {
    climb.addEventListener('status', (event) => {
      if (event.detail.status === 'playing') voice.say('Tienes diez créditos. Empieza a subir.', { speaker: 'Moss' });
      if (event.detail.status === 'victory') voice.say('Diez millones de créditos. Transfiriendo el control del Sindicato.', { speaker: 'SIBILA', priority: PRIORITY.high });
    });
    climb.addEventListener('floor', (event) => {
      const { floor } = event.detail;
      voice.say(`Piso ${NUMBERS[floor.level - 1]}: ${floor.name}.`, { speaker: floor.host });
    });
    climb.addEventListener('unlock', (event) => {
      voice.say(`Tarjeta de acceso concedida. ${event.detail.floor.name} te espera.`, { speaker: 'Sindicato', priority: PRIORITY.high });
    });
    climb.addEventListener('critical', () => {
      voice.say('Jugada crítica.', { speaker: climb.floor.host, priority: PRIORITY.high });
    });
    climb.addEventListener('rescue', () => voice.say('Limosna concedida. La próxima, en cinco minutos.', { speaker: 'Sindicato' }));
    climb.addEventListener('broke', () => voice.say('Saldo a cero.', { speaker: 'Sindicato' }));
    climb.addEventListener('contract', (event) => {
      if (event.detail.done) voice.say('Encargo cumplido.', { speaker: 'Sindicato' });
    });
    climb.addEventListener('achievement', (event) => voice.say(`Logro: ${event.detail.achievement.name}.`, { speaker: 'Sindicato' }));
  }

  // Avisos de las mesas (el Kraken de Cyber-Fish).
  alert(text, speaker = 'Sindicato') {
    voice.say(text, { speaker, priority: PRIORITY.high });
  }
}

export const announcer = new Announcer();
