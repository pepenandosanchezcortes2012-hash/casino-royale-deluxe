// Sintetizador procedural con Web Audio API: ningún archivo de audio externo.
// El contexto se crea y se reanuda tras el primer gesto del usuario (política de autoplay).

import { storage } from './storage.js';
import { randomFloat, randomBetween } from './rng.js';

const KEY = 'crd.audio.v1';
const SILENCE = 0.0001;

class AudioEngine {
  #ctx = null;
  #master = null;
  #noise = null;
  #muted;
  #volume = 0.75;

  constructor() {
    this.#muted = storage.read(KEY, null)?.muted === true;
  }

  get muted() {
    return this.#muted;
  }

  get unlocked() {
    return this.#ctx !== null && this.#ctx.state === 'running';
  }

  setMuted(muted) {
    this.#muted = Boolean(muted);
    storage.write(KEY, { muted: this.#muted });
    if (this.#master) {
      this.#master.gain.setTargetAtTime(this.#muted ? 0 : this.#volume, this.#ctx.currentTime, 0.03);
    }
  }

  unlock() {
    if (!this.#ctx) {
      const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctor) return false;
      try {
        this.#ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        return false;
      }
      const ctx = this.#ctx;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -16;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
      this.#master = ctx.createGain();
      this.#master.gain.value = this.#muted ? 0 : this.#volume;
      this.#master.connect(compressor).connect(ctx.destination);

      // 2 s de ruido blanco reutilizable como fuente de fricción, barajeo y rodadura.
      const length = Math.floor(ctx.sampleRate * 2);
      this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.#noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = randomFloat() * 2 - 1;
    }
    if (this.#ctx.state === 'suspended') this.#ctx.resume().catch(() => {});
    return true;
  }

  #ready() {
    return this.#ctx !== null && this.#ctx.state === 'running' && !this.#muted;
  }

  #time(delay = 0) {
    return this.#ctx.currentTime + Math.max(0, delay);
  }

  #envelope(param, t, attack, peak, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(SILENCE, t);
    param.exponentialRampToValueAtTime(Math.max(peak, SILENCE * 2), t + attack);
    param.exponentialRampToValueAtTime(SILENCE, t + attack + decay);
  }

  #noiseBurst(t, { type = 'bandpass', freq = 2000, freqEnd = null, q = 1, attack = 0.004, peak = 0.3, decay = 0.1 }) {
    const ctx = this.#ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, t);
    if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const gain = ctx.createGain();
    this.#envelope(gain.gain, t, attack, peak, decay);
    src.connect(filter).connect(gain).connect(this.#master);
    src.start(t, randomFloat() * 1.5);
    src.stop(t + attack + decay + 0.05);
  }

  #tone(t, { type = 'sine', freq = 440, freqEnd = null, attack = 0.002, peak = 0.2, decay = 0.3 }) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + attack + decay);
    const gain = ctx.createGain();
    this.#envelope(gain.gain, t, attack, peak, decay);
    osc.connect(gain).connect(this.#master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // Deslizamiento de carta: ruido blanco en paso banda con barrido descendente y caída exponencial.
  cardSlide(delay = 0) {
    if (!this.#ready()) return;
    const t = this.#time(delay);
    this.#noiseBurst(t, { freq: 3400, freqEnd: 1300, q: 0.9, attack: 0.006, peak: 0.42, decay: 0.15 });
    this.#noiseBurst(t + 0.12, { type: 'highpass', freq: 4500, q: 0.7, attack: 0.001, peak: 0.16, decay: 0.03 });
  }

  // Barajeo en cascada (riffle) seguido del "puente" de cartas.
  shuffle() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (let i = 0; i < 34; i++) {
      const at = t + i * 0.024 + randomFloat() * 0.008;
      this.#noiseBurst(at, { freq: randomBetween(2400, 4200), q: 1.4, attack: 0.001, peak: 0.2, decay: 0.028 });
    }
    this.#noiseBurst(t + 0.9, { freq: 2600, freqEnd: 900, q: 0.7, attack: 0.03, peak: 0.3, decay: 0.28 });
  }

  // Choque de fichas cerámicas: dos resonancias inarmónicas con decaimiento rápido + rebote.
  chip(delay = 0) {
    if (!this.#ready()) return;
    const t = this.#time(delay);
    const base = randomBetween(2500, 3100);
    for (const [hit, level] of [[0, 1], [0.042, 0.45]]) {
      this.#tone(t + hit, { freq: base, peak: 0.26 * level, decay: 0.075 });
      this.#tone(t + hit, { freq: base * 1.53, peak: 0.18 * level, decay: 0.05 });
      this.#noiseBurst(t + hit, { type: 'highpass', freq: 3500, attack: 0.001, peak: 0.22 * level, decay: 0.014 });
    }
  }

  // Golpe de la bola contra un traste metálico del plato.
  ballTick(strength = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'triangle', freq: randomBetween(3600, 4600), peak: 0.12 * strength, decay: 0.03 });
    this.#noiseBurst(t, { freq: 6000, q: 2, attack: 0.001, peak: 0.14 * strength, decay: 0.02 });
  }

  // Traqueteo de la bola en la pista: ruido resonante modulado por un LFO que se ralentiza.
  ballRoll(duration) {
    if (!this.#ready()) return;
    const ctx = this.#ctx;
    const t = this.#time();
    const end = t + duration;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 3;
    band.frequency.setValueAtTime(1500, t);
    band.frequency.exponentialRampToValueAtTime(700, end);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(0.2, t + 0.15);
    amp.gain.setValueAtTime(0.2, Math.max(t + 0.2, end - 1.2));
    amp.gain.exponentialRampToValueAtTime(SILENCE, end + 0.2);
    const lfo = ctx.createOscillator();
    lfo.frequency.setValueAtTime(22, t);
    lfo.frequency.exponentialRampToValueAtTime(5, end);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0.09, t);
    depth.gain.linearRampToValueAtTime(0, end + 0.2);
    lfo.connect(depth).connect(amp.gain);
    src.connect(band).connect(amp).connect(this.#master);
    src.start(t);
    lfo.start(t);
    src.stop(end + 0.3);
    lfo.stop(end + 0.3);
  }

  // Giro mecánico de rodillos: tren de clics del mecanismo + zumbido del motor.
  reelSpin(duration) {
    if (!this.#ready()) return;
    const ctx = this.#ctx;
    const t = this.#time();
    for (let at = 0; at < duration; at += 1 / 16) {
      this.#tone(t + at, { type: 'square', freq: 1150 + randomFloat() * 120, peak: 0.035, decay: 0.012 });
    }
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.value = 58;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 280;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.1);
    gain.gain.setValueAtTime(0.06, t + duration - 0.2);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t + duration);
    motor.connect(low).connect(gain).connect(this.#master);
    motor.start(t);
    motor.stop(t + duration + 0.05);
  }

  reelStop() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 150, freqEnd: 55, peak: 0.4, decay: 0.12 });
    this.#noiseBurst(t, { type: 'lowpass', freq: 500, q: 0.8, attack: 0.001, peak: 0.25, decay: 0.07 });
  }

  // Campana armónica: parciales inarmónicos de una campana real (1, 2, 2.76, 4.07, 5.4).
  bell(freq = 880, delay = 0, peak = 0.22) {
    if (!this.#ready()) return;
    const t = this.#time(delay);
    const partials = [[1, 1, 1.6], [2, 0.5, 1.1], [2.76, 0.42, 0.9], [4.07, 0.24, 0.6], [5.4, 0.14, 0.4]];
    for (const [ratio, level, decay] of partials) {
      this.#tone(t, { freq: freq * ratio, peak: peak * level, decay });
    }
  }

  win(level = 1) {
    if (!this.#ready()) return;
    const scale = [1046.5, 1318.5, 1568, 2093];
    if (level <= 1) {
      this.bell(1318.5, 0, 0.18);
      this.bell(1975.5, 0.12, 0.14);
      return;
    }
    const rounds = level >= 3 ? 3 : 1;
    for (let r = 0; r < rounds; r++) {
      scale.forEach((freq, i) => this.bell(freq, r * 0.6 + i * 0.1, 0.2));
    }
    if (level >= 3) {
      for (let i = 0; i < 14; i++) this.chip(1.8 + i * 0.07);
    }
  }

  lose() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'triangle', freq: 330, freqEnd: 196, attack: 0.01, peak: 0.1, decay: 0.45 });
  }

  click() {
    if (!this.#ready()) return;
    this.#tone(this.#time(), { type: 'triangle', freq: 1800, peak: 0.06, decay: 0.03 });
  }
}

export const audio = new AudioEngine();
