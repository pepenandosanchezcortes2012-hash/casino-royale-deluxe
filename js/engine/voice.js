// Voz del crupier con Web Speech API (speechSynthesis): anuncios en español o inglés.
// Solo habla tras la primera interacción del usuario y nunca acumula una cola de frases.

const RANK_NAMES = {
  es: { bronze: 'Bronce', silver: 'Plata', gold: 'Oro', platinum: 'Platino', diamond: 'Diamante' },
  en: { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum', diamond: 'Diamond' },
};

const PHRASES = {
  es: {
    placeBets: 'Hagan sus apuestas',
    noMoreBets: 'No va más',
    blackjack: 'Blackjack',
    houseWins: 'Gana la casa',
    dealerBust: 'El crupier se pasa',
    playerWins: 'Gana el jugador',
    push: 'Empate',
    insurance: '¿Desea seguro?',
    shuffle: 'Barajando zapato nuevo',
    number: ({ number, color }) => (number === 0 ? 'Cero' : `${number}, ${color === 'red' ? 'rojo' : 'negro'}`),
    freeSpins: ({ count }) => `${count} giros gratis`,
    superBonus: 'Súper bono',
    bigWin: 'Gran premio',
    rankUp: ({ rank }) => `Enhorabuena. Nuevo rango ${RANK_NAMES.es[rank] ?? rank}`,
    test: 'Bienvenido a Casino Royale. Hagan sus apuestas',
    begin: 'Tiene un crédito. Haga que cuente',
    arrive: ({ zone }) => ({ alley: 'Bienvenido al Callejón', neon: 'Bienvenido al Salón de Neón', penthouse: 'Bienvenido al Penthouse. El Sindicato le observa' })[zone] ?? 'Bienvenido',
    unlock: 'Una nueva puerta se abre',
    critical: 'Todo o nada',
    sibila: ({ i }) => ['Calculo su derrota con un noventa y siete por ciento de certeza', 'El Sindicato agradece su contribución', 'Interesante. Recalculando', 'Su pulso se ha acelerado. Lo he notado'][i % 4],
    favor: 'El Sindicato le concede un favor. No lo olvide',
    demoted: 'Acompáñenos, por favor',
    victory: 'Es usted libre. Dueño del destino',
    gameover: 'La casa siempre gana',
  },
  en: {
    placeBets: 'Place your bets',
    noMoreBets: 'No more bets',
    blackjack: 'Blackjack',
    houseWins: 'House wins',
    dealerBust: 'Dealer busts',
    playerWins: 'Player wins',
    push: 'Push',
    insurance: 'Insurance?',
    shuffle: 'Shuffling a new shoe',
    number: ({ number, color }) => (number === 0 ? 'Zero' : `${number}, ${color === 'red' ? 'red' : 'black'}`),
    freeSpins: ({ count }) => `${count} free spins`,
    superBonus: 'Super bonus',
    bigWin: 'Big win',
    rankUp: ({ rank }) => `Congratulations. New rank, ${RANK_NAMES.en[rank] ?? rank}`,
    test: 'Welcome to Casino Royale. Place your bets',
    begin: 'You have one credit. Make it count',
    arrive: ({ zone }) => ({ alley: 'Welcome to the Alley', neon: 'Welcome to the Neon Lounge', penthouse: 'Welcome to the Penthouse. The Syndicate is watching' })[zone] ?? 'Welcome',
    unlock: 'A new door opens',
    critical: 'All or nothing',
    sibila: ({ i }) => ['I calculate your defeat with ninety seven percent certainty', 'The Syndicate appreciates your contribution', 'Interesting. Recalculating', 'Your pulse has increased. I noticed'][i % 4],
    favor: 'The Syndicate grants you a favor. Do not forget it',
    demoted: 'Come with us, please',
    victory: 'You are free. Master of destiny',
    gameover: 'The house always wins',
  },
};

const PREFERRED = {
  es: ['es-es', 'es-mx', 'es-us', 'es'],
  en: ['en-us', 'en-gb', 'en'],
};

export class DealerVoice {
  #settings;
  #voices = [];
  #synth;

  constructor(getSettings) {
    this.#settings = getSettings;
    const synth = globalThis.speechSynthesis;
    this.#synth = synth && typeof globalThis.SpeechSynthesisUtterance === 'function' ? synth : null;
    if (!this.#synth) return;
    const load = () => {
      try {
        this.#voices = this.#synth.getVoices();
      } catch {
        this.#voices = [];
      }
    };
    load();
    if (typeof this.#synth.addEventListener === 'function') this.#synth.addEventListener('voiceschanged', load);
  }

  get supported() {
    return this.#synth !== null;
  }

  phrase(key, params = {}, lang = this.#settings().lang) {
    const entry = (PHRASES[lang] ?? PHRASES.es)[key];
    if (!entry) return null;
    return typeof entry === 'function' ? entry(params) : entry;
  }

  #voiceFor(lang) {
    const voices = this.#voices;
    for (const prefix of PREFERRED[lang] ?? PREFERRED.es) {
      const match = voices.find((voice) => voice.lang.replace('_', '-').toLowerCase().startsWith(prefix));
      if (match) return match;
    }
    return null;
  }

  // interrupt: corta lo que se esté diciendo (anuncios importantes). Sin él, si ya hay una
  // frase esperando se descarta la nueva para no acumular retrasos.
  say(key, params = {}, { interrupt = false } = {}) {
    if (!this.#synth) return false;
    const settings = this.#settings();
    if (settings.muted || !settings.voiceOn || settings.voice <= 0) return false;
    const activation = globalThis.navigator?.userActivation;
    if (activation && !activation.hasBeenActive) return false;
    const text = this.phrase(key, params, settings.lang);
    if (!text) return false;
    if (interrupt) {
      this.#synth.cancel();
    } else if (this.#synth.pending) {
      return false;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = settings.lang === 'en' ? 'en-US' : 'es-ES';
    const voice = this.#voiceFor(settings.lang);
    if (voice) utterance.voice = voice;
    utterance.volume = settings.voice;
    utterance.rate = settings.lang === 'en' ? 1 : 0.97;
    utterance.pitch = 0.92;
    utterance.addEventListener('error', () => {});
    this.#synth.speak(utterance);
    return true;
  }

  cancel() {
    this.#synth?.cancel();
  }
}
