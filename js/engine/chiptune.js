// Banda sonora chiptune 8 bits sintetizada en tiempo real con Web Audio API (ningún archivo).
// Cuatro canales como en una consola clásica: pulso al 25 % (melodía y arpegios), triángulo (bajo),
// seno (pasajes suaves) y ruido (percusión). Cada nota es un oscilador de un solo uso con su
// envolvente: al parar la música no queda ningún oscilador vivo.
// Escenas:
// - tower: misterio tecnológico de la torre (la historia de la escalada), una tonalidad por piso.
// - fish: melodía relajante de ondas seno, pentatónica mayor.
// - crash: arpegio que acelera y sube de tono con el multiplicador del avión (setIntensity).
// - boss: tema rápido para el Núcleo del Servidor.
// El programador mira LOOKAHEAD segundos por delante con un temporizador de TICK_MS.

import { randomFloat } from './rng.js';

const LOOKAHEAD = 0.25;
const TICK_MS = 80;
const SILENCE = 0.0001;
const FADE_IN = 1.2;
const FADE_OUT = 0.6;

export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export const MODES = Object.freeze({
  minor: Object.freeze([0, 2, 3, 5, 7, 8, 10]),
  phrygian: Object.freeze([0, 1, 3, 5, 7, 8, 10]),
  dorian: Object.freeze([0, 2, 3, 5, 7, 9, 10]),
  major: Object.freeze([0, 2, 4, 5, 7, 9, 11]),
  pentatonic: Object.freeze([0, 2, 4, 7, 9]),
});

// Ambientes de la torre (los «mood» de cada piso): tónica MIDI, modo, tempo y progresión de
// grados (1 acorde por compás de 16 semicorcheas).
export const TOWER_MOODS = Object.freeze({
  alley: Object.freeze({ root: 50, mode: 'phrygian', bpm: 92, chords: Object.freeze([0, 0, 5, 6]), drums: 0.3 }),
  neon: Object.freeze({ root: 52, mode: 'dorian', bpm: 104, chords: Object.freeze([0, 6, 5, 6]), drums: 0.6 }),
  gameover: Object.freeze({ root: 48, mode: 'minor', bpm: 96, chords: Object.freeze([0, 5, 3, 4]), drums: 0.5 }),
  penthouse: Object.freeze({ root: 53, mode: 'minor', bpm: 112, chords: Object.freeze([0, 5, 6, 4]), drums: 0.8 }),
  finale: Object.freeze({ root: 53, mode: 'major', bpm: 120, chords: Object.freeze([0, 4, 5, 3]), drums: 0.8 }),
});

export const SCENES = Object.freeze(['tower', 'fish', 'crash', 'boss']);

// Notas MIDI de la escala `mode` desde `root` durante `octaves` octavas.
export function scaleNotes(root, mode, octaves = 2) {
  const steps = MODES[mode] ?? MODES.minor;
  const out = [];
  for (let o = 0; o < octaves; o++) for (const s of steps) out.push(root + o * 12 + s);
  return out;
}

// Tríada sobre el grado `degree` (0 = tónica) de la escala.
export function triad(root, mode, degree) {
  const scale = scaleNotes(root, mode, 3);
  const n = (MODES[mode] ?? MODES.minor).length;
  const i = ((degree % n) + n) % n;
  return [scale[i], scale[i + 2], scale[i + 4]];
}

// Arpegio de Crash: el tempo y el tono suben con el multiplicador (log2: cada vez que se duplica,
// +34 BPM y +3 semitonos), con techo para que no se vuelva ruido.
export function crashArp(multiplier) {
  const lift = Math.log2(Math.max(1, Number(multiplier) || 1));
  return {
    bpm: Math.round(Math.min(260, 118 + lift * 34)),
    transpose: Math.min(15, Math.floor(lift * 3)),
    hats: lift >= 1,
  };
}

// Pulso al 25 % (el timbre «NES») a partir de su serie de Fourier.
function pulseWave(ctx, duty = 0.25, harmonics = 32) {
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let n = 1; n < harmonics; n++) real[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
  return ctx.createPeriodicWave(real, imag);
}

export class ChiptuneBgm {
  #ctx;
  #out;
  #echo;
  #noise;
  #pulse;
  #timer = 0;
  #running = false;
  #next = 0;
  #step = 0;
  #scene = 'tower';
  #mood = 'alley';
  #intensity = 1;
  #tension = 0;
  #lead = 0;

  constructor(ctx, destination, mood = 'alley') {
    this.#ctx = ctx;
    this.#mood = TOWER_MOODS[mood] ? mood : 'alley';
    this.#out = ctx.createGain();
    this.#out.gain.value = SILENCE;
    this.#out.connect(destination);
    // Eco corto de cinta para dar aire a los arpegios.
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.27;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    delay.connect(feedback).connect(delay);
    delay.connect(wet).connect(this.#out);
    this.#echo = delay;
    this.#pulse = pulseWave(ctx);
    const length = Math.floor(ctx.sampleRate * 0.5);
    this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.#noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = randomFloat() * 2 - 1;
  }

  get running() {
    return this.#running;
  }

  get scene() {
    return this.#scene;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    const t = this.#ctx.currentTime;
    const g = this.#out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(SILENCE, g.value), t);
    g.exponentialRampToValueAtTime(this.#level(), t + FADE_IN);
    this.#next = t + 0.08;
    this.#timer = setInterval(() => this.#schedule(), TICK_MS);
    this.#schedule();
  }

  // Fundido de salida y fin del programador: las notas ya programadas terminan solas.
  stop() {
    if (!this.#running) return;
    this.#running = false;
    clearInterval(this.#timer);
    this.#timer = 0;
    const t = this.#ctx.currentTime;
    const g = this.#out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.max(SILENCE, g.value), t);
    g.exponentialRampToValueAtTime(SILENCE, t + FADE_OUT);
  }

  setMood(mood) {
    if (TOWER_MOODS[mood]) this.#mood = mood;
  }

  setScene(scene) {
    if (!SCENES.includes(scene) || scene === this.#scene) return;
    this.#scene = scene;
    this.#step = 0;
    if (scene !== 'crash') this.#intensity = 1;
  }

  // Multiplicador actual del avión (1 en tierra).
  setIntensity(multiplier) {
    this.#intensity = Math.max(1, Number(multiplier) || 1);
  }

  // Con tensión alta (jugada crítica) la música baja para dejar oír el latido.
  setTension(value) {
    this.#tension = Math.min(1, Math.max(0, value));
    if (!this.#running) return;
    this.#out.gain.setTargetAtTime(this.#level(), this.#ctx.currentTime, 0.4);
  }

  #level() {
    return Math.max(SILENCE * 2, 0.9 - this.#tension * 0.55);
  }

  #bpm() {
    if (this.#scene === 'fish') return 76;
    if (this.#scene === 'boss') return 150;
    if (this.#scene === 'crash') return crashArp(this.#intensity).bpm;
    return TOWER_MOODS[this.#mood].bpm;
  }

  #schedule() {
    if (!this.#running) return;
    const ctx = this.#ctx;
    // Pestaña dormida o contexto suspendido: no se acumulan notas atrasadas.
    if (this.#next < ctx.currentTime - 0.2) this.#next = ctx.currentTime + 0.05;
    while (this.#next < ctx.currentTime + LOOKAHEAD) {
      const sixteenth = 60 / this.#bpm() / 4;
      this.#play(this.#step, this.#next, sixteenth);
      this.#step = (this.#step + 1) % 64;
      this.#next += sixteenth;
    }
  }

  #play(step, t, len) {
    if (this.#scene === 'fish') this.#fish(step, t, len);
    else if (this.#scene === 'crash') this.#crash(step, t, len);
    else if (this.#scene === 'boss') this.#boss(step, t, len);
    else this.#tower(step, t, len);
  }

  // ---------- Escenas ----------

  #tower(step, t, len) {
    const m = TOWER_MOODS[this.#mood];
    const bar = Math.floor(step / 16) % m.chords.length;
    const chord = triad(m.root, m.mode, m.chords[bar]);
    const s = step % 16;
    if (s === 0 || s === 8) this.#note('triangle', chord[0] - 12, t, len * 6, 0.22);
    if (s === 12 && randomFloat() < 0.5) this.#note('triangle', chord[2] - 12, t, len * 3, 0.16);
    // Arpegio de pulso en eco: subida y bajada por el acorde.
    const arp = [0, 1, 2, 1][s % 4];
    this.#note('pulse', chord[arp] + 12, t, len * 0.8, 0.045, true);
    // Melodía escasa: paseo aleatorio por la escala.
    if (s % 4 === 2 && randomFloat() < 0.35) {
      const scale = scaleNotes(m.root + 24, m.mode, 1);
      this.#lead = Math.min(scale.length - 1, Math.max(0, this.#lead + Math.round((randomFloat() - 0.5) * 3)));
      this.#note('pulse', scale[this.#lead], t, len * 3, 0.05, true);
    }
    if (m.drums > 0) {
      if (s % 4 === 0) this.#hit(t, 'hat', 0.03 * m.drums);
      if ((s === 4 || s === 12) && m.drums >= 0.5) this.#hit(t, 'snare', 0.08 * m.drums);
    }
  }

  #fish(step, t, len) {
    const scale = scaleNotes(57, 'pentatonic', 3);
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const roots = [45, 50, 52, 50];
    if (s === 0) this.#note('sine', roots[bar], t, len * 14, 0.2);
    if (s % 2 === 0) this.#note('triangle', scale[5 + ((s / 2 + bar) % 4)], t, len * 1.6, 0.05, true);
    if (s % 4 === 1 && randomFloat() < 0.6) {
      this.#lead = Math.min(scale.length - 1, Math.max(5, this.#lead + Math.round((randomFloat() - 0.5) * 2.6)));
      this.#note('sine', scale[this.#lead] + 12, t, len * 4, 0.09, true);
    }
    // Burbujas: blips seno muy cortos que suben.
    if (randomFloat() < 0.06) this.#note('sine', 96 + Math.floor(randomFloat() * 6), t, 0.05, 0.02, false, 4);
  }

  #crash(step, t, len) {
    const { transpose, hats } = crashArp(this.#intensity);
    const base = 45 + transpose;
    const chord = [0, 3, 7, 12, 15, 19];
    const s = step % 16;
    this.#note('pulse', base + 12 + chord[s % chord.length], t, len * 0.7, 0.05);
    if (s % 2 === 0) this.#note('triangle', base - 12 + (s % 8 === 6 ? 7 : 0), t, len * 1.5, 0.2);
    if (hats) this.#hit(t, 'hat', 0.025);
    if (s % 8 === 4) this.#hit(t, 'snare', 0.06);
  }

  #boss(step, t, len) {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = triad(45, 'phrygian', [0, 1, 5, 6][bar]);
    if (s % 2 === 0) this.#note('triangle', chord[0] - 12 + (s % 4 === 2 ? 12 : 0), t, len * 1.6, 0.24);
    const riff = [0, 2, 1, 2, 0, 1, 2, 1];
    this.#note('pulse', chord[riff[s % 8]] + 12, t, len * 0.8, 0.05);
    if (s === 0 || s === 6 || s === 10) this.#note('pulse', chord[2] + 24, t, len * 2, 0.04, true);
    this.#hit(t, 'hat', 0.025);
    if (s === 4 || s === 12) this.#hit(t, 'snare', 0.1);
    if (s === 0 || s === 8) this.#hit(t, 'kick', 0.25);
  }

  // ---------- Instrumentos ----------

  #note(wave, midi, t, duration, peak, echo = false, slide = 0) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    if (wave === 'pulse') osc.setPeriodicWave(this.#pulse);
    else osc.type = wave;
    osc.frequency.setValueAtTime(hz(midi), t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(hz(midi + slide), t + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    gain.gain.setValueAtTime(peak, t + duration * 0.6);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t + duration);
    osc.connect(gain).connect(this.#out);
    if (echo) gain.connect(this.#echo);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  #hit(t, kind, peak) {
    const ctx = this.#ctx;
    if (kind === 'kick') {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(150, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.12);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(peak, t);
      gain.gain.exponentialRampToValueAtTime(SILENCE, t + 0.14);
      osc.connect(gain).connect(this.#out);
      osc.start(t);
      osc.stop(t + 0.16);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const filter = ctx.createBiquadFilter();
    filter.type = kind === 'hat' ? 'highpass' : 'bandpass';
    filter.frequency.value = kind === 'hat' ? 7000 : 1800;
    const gain = ctx.createGain();
    const decay = kind === 'hat' ? 0.04 : 0.12;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(SILENCE, t + decay);
    src.connect(filter).connect(gain).connect(this.#out);
    src.start(t, randomFloat() * 0.3);
    src.stop(t + decay + 0.02);
  }
}
