// Voz del Sindicato: anuncios hablados con Web Speech API y personalidad cibernética.
// - Cada anfitrión tiene su perfil (tono y velocidad): Moss grave y lento, Vera ágil, Ferro
//   mecánico, SIBILA sintética y profunda, y el Sindicato como locutor de terminal.
// - El texto se corta en frases por la puntuación y se dicen con pausas naturales entre ellas.
// - Cada mensaje abre y cierra un canal de radio (chasquido y estática con Web Audio).
// - Prioridades: los avisos importantes interrumpen; los normales se descartan si ya se está
//   hablando o si acaba de hablarse (sin colas eternas ni voces encadenadas).
// - Respeta el volumen general, el silencio rápido, su propio interruptor y la pestaña oculta.
// Este es el único módulo que usa speechSynthesis.

import { storage } from './storage.js';
import { audio } from './audio.js';

export const VOICE_KEY = 'crd.voice.v1';
export const VOICE_COOLDOWN_MS = 3500;
export const PRIORITY = Object.freeze({ low: 0, normal: 1, high: 2 });

// Tono (0–2) y velocidad (0,1–10) por anfitrión.
export const PROFILES = Object.freeze({
  Moss: Object.freeze({ pitch: 0.72, rate: 0.94 }),
  Vera: Object.freeze({ pitch: 1.18, rate: 1.06 }),
  Ferro: Object.freeze({ pitch: 0.62, rate: 0.9 }),
  SIBILA: Object.freeze({ pitch: 0.5, rate: 0.9 }),
  Sindicato: Object.freeze({ pitch: 0.8, rate: 1.0 }),
  Narrador: Object.freeze({ pitch: 0.92, rate: 1.0 }),
});
export const profileFor = (speaker) => PROFILES[speaker] ?? PROFILES.Narrador;

// Pausa tras cada signo (ms).
const PAUSES = Object.freeze({ ',': 140, ';': 220, ':': 220, '.': 320, '!': 320, '?': 320, '…': 420 });

// Texto apto para leer en voz alta: sin emojis ni comillas, con los signos del juego en palabras.
export function speakable(text) {
  return String(text ?? '')
    .replace(/[«»"“”]/g, '')
    .replace(/×\s?(\d)/g, 'por $1')
    .replace(/\+(\d)/g, 'más $1')
    .replace(/&/g, 'y')
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Frases con su pausa posterior, cortadas tras , ; : . ! ? …
export function splitPhrases(text) {
  const clean = speakable(text);
  const phrases = [];
  let current = '';
  for (const char of clean) {
    current += char;
    if (char in PAUSES) {
      const phrase = current.trim();
      if (phrase.replace(/[\s,;:.!?…¿¡]/g, '')) phrases.push({ text: phrase, pause: PAUSES[char] });
      current = '';
    }
  }
  if (current.trim()) phrases.push({ text: current.trim(), pause: PAUSES['.'] });
  return phrases;
}

// La mejor voz en español disponible (primero es-ES, luego cualquier es-*), si la hay.
export function pickVoice(voices) {
  const spanish = voices.filter((voice) => /^es(-|_|$)/i.test(voice.lang));
  if (!spanish.length) return null;
  const score = (voice) => (/^es[-_]ES/i.test(voice.lang) ? 4 : 0) + (/google|natural|neural|online/i.test(voice.name) ? 2 : 0) + (voice.localService ? 0 : 1);
  return [...spanish].sort((a, b) => score(b) - score(a))[0];
}

class Voice extends EventTarget {
  #synth = globalThis.speechSynthesis ?? null;
  #enabled;
  #voice = null;
  #speaking = false;
  #token = 0;
  #timer = 0;
  #lastEnd = -Infinity;
  #priority = PRIORITY.low;

  constructor() {
    super();
    this.#enabled = storage.read(VOICE_KEY, 'on') !== 'off';
    if (!this.#synth) return;
    const load = () => {
      this.#voice = pickVoice(this.#synth.getVoices());
      this.dispatchEvent(new Event('change'));
    };
    load();
    this.#synth.addEventListener?.('voiceschanged', load);
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (globalThis.document.hidden) this.stop();
    });
    audio.addEventListener('change', () => {
      if (audio.level === 0) this.stop();
    });
  }

  get supported() {
    return this.#synth !== null;
  }

  // Nombre de la voz elegida (o null si el sistema no tiene ninguna en español).
  get voiceName() {
    return this.#voice?.name ?? null;
  }

  get enabled() {
    return this.#enabled;
  }

  setEnabled(on) {
    this.#enabled = Boolean(on);
    storage.write(VOICE_KEY, this.#enabled ? 'on' : 'off');
    if (!this.#enabled) this.stop();
    this.dispatchEvent(new Event('change'));
  }

  toggle() {
    this.setEnabled(!this.#enabled);
    return this.#enabled;
  }

  // Calla al instante y vacía lo pendiente.
  stop() {
    this.#token++;
    clearTimeout(this.#timer);
    this.#speaking = false;
    this.#priority = PRIORITY.low;
    if (this.#synth?.speaking || this.#synth?.pending) this.#synth.cancel();
  }

  // Dice un mensaje con la voz de `speaker`. Devuelve si se va a decir.
  say(text, { speaker = 'Sindicato', priority = PRIORITY.normal, force = false } = {}) {
    if (!this.#synth || (!this.#enabled && !force) || audio.level === 0) return false;
    if (globalThis.document?.hidden) return false;
    const phrases = splitPhrases(text);
    if (!phrases.length) return false;
    const now = performance.now();
    if (this.#speaking && priority <= this.#priority) return false;
    if (!this.#speaking && priority < PRIORITY.high && now - this.#lastEnd < VOICE_COOLDOWN_MS) return false;
    this.stop();
    const token = this.#token;
    this.#speaking = true;
    this.#priority = priority;
    const profile = profileFor(speaker);
    audio.radioIn();
    const next = (index) => {
      if (token !== this.#token) return;
      if (index >= phrases.length) {
        this.#speaking = false;
        this.#priority = PRIORITY.low;
        this.#lastEnd = performance.now();
        audio.radioOut();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(phrases[index].text);
      utterance.lang = this.#voice?.lang ?? 'es-ES';
      if (this.#voice) utterance.voice = this.#voice;
      utterance.pitch = profile.pitch;
      utterance.rate = profile.rate;
      utterance.volume = Math.min(1, audio.level * 1.1);
      const done = () => {
        if (token !== this.#token) return;
        this.#timer = setTimeout(() => next(index + 1), phrases[index].pause);
      };
      utterance.addEventListener('end', done, { once: true });
      utterance.addEventListener('error', done, { once: true });
      this.#synth.speak(utterance);
    };
    this.#timer = setTimeout(() => next(0), 140);
    return true;
  }
}

export const voice = new Voice();
