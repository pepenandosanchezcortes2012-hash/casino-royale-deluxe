// Música de fondo (BGM) lounge / jazz nocturno, 100 % procedural con Web Audio API: ningún archivo.
// - Piano eléctrico tipo Rhodes: senos (fundamental, octava y una «púa» aguda muy breve) que pasan
//   por un paso bajo cálido y un trémolo estéreo lento.
// - Acordes de jazz con voicings sin fundamental y conducción de voces mínima entre acorde y acorde.
// - Contrabajo suave a dos tiempos con alguna nota de aproximación.
// - Escobillas, platillo y un bombo apenas rozado con ruido blanco filtrado, en swing ligero.
// - Tempo de 65 a 75 BPM y nivel de fondo; fundido de entrada al encender y de salida al pausar.
// Cada zona del casino tiene su tonalidad y su progresión; con tensión alta la música se aparta.

import { randomFloat, randomInt } from './rng.js';

const LOOKAHEAD = 0.35;
const TICK_MS = 100;
const SILENCE = 0.0001;
// Los fundidos recorren de -60 dB a 0 dB en línea recta en decibelios: así se perciben uniformes.
const FADE_FLOOR = 0.001;
export const FADE_IN = 3;
export const FADE_OUT = 1.6;
export const VOICE_WINDOW = Object.freeze([55, 77]);
export const BASS_WINDOW = Object.freeze([35, 50]);

export const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const pc = (midi) => ((midi % 12) + 12) % 12;

// Tonos de cada calidad de acorde sobre su fundamental (voicings sin fundamental, 4 voces).
export const QUALITIES = Object.freeze({
  maj9: Object.freeze([4, 7, 11, 2]),
  m9: Object.freeze([3, 7, 10, 2]),
  m11: Object.freeze([3, 10, 2, 5]),
  dom13: Object.freeze([4, 10, 2, 9]),
  '7b13': Object.freeze([4, 10, 2, 8]),
  sus9: Object.freeze([5, 7, 10, 2]),
  m7b5: Object.freeze([3, 6, 10, 5]),
});

// Estados de ánimo: tonalidad (clase de altura), tempo, progresión de 8 compases [grado, calidad],
// swing, densidad del acompañamiento y probabilidad de adornos agudos.
export const MOODS = Object.freeze({
  // Callejón: re menor humeante, el más lento.
  alley: Object.freeze({
    tonic: 2, tempo: 66, swing: 0.64, density: 0.45, ornament: 0.25,
    progression: [[5, 'm11'], [10, 'dom13'], [3, 'maj9'], [8, 'maj9'], [2, 'm7b5'], [7, '7b13'], [0, 'm9'], [0, 'm9']],
  }),
  // Salón de Neón: mi bemol mayor, algo más de pulso.
  neon: Object.freeze({
    tonic: 3, tempo: 72, swing: 0.62, density: 0.6, ornament: 0.35,
    progression: [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, 'dom13'], [4, 'm11'], [9, 'dom13'], [2, 'm9'], [7, 'sus9']],
  }),
  // Penthouse: la bemol mayor, lujoso y espacioso.
  penthouse: Object.freeze({
    tonic: 8, tempo: 68, swing: 0.63, density: 0.5, ornament: 0.3,
    progression: [[0, 'maj9'], [5, 'maj9'], [2, 'm9'], [7, 'dom13'], [4, 'm11'], [9, 'm9'], [2, 'm9'], [7, 'sus9']],
  }),
  // Final: re bemol mayor, cálido.
  finale: Object.freeze({
    tonic: 1, tempo: 70, swing: 0.62, density: 0.55, ornament: 0.45,
    progression: [[0, 'maj9'], [9, 'm9'], [2, 'm9'], [7, 'dom13'], [5, 'maj9'], [4, 'm11'], [2, 'm9'], [7, 'sus9']],
  }),
  // Game Over: mi menor, escaso y lento.
  gameover: Object.freeze({
    tonic: 4, tempo: 65, swing: 0.64, density: 0.3, ornament: 0.15,
    progression: [[0, 'm9'], [8, 'maj9'], [5, 'm11'], [7, '7b13'], [0, 'm9'], [8, 'maj9'], [2, 'm7b5'], [7, '7b13']],
  }),
});

// Clases de altura de un acorde de la progresión.
export function chordTones(tonic, [degree, quality]) {
  const root = pc(tonic + degree);
  return QUALITIES[quality].map((interval) => pc(root + interval));
}

// Coloca los tonos del acorde en la ventana de registro con el menor movimiento posible respecto
// al voicing anterior, sin notas repetidas y en posición cerrada (como mucho una décima).
export function voiceLead(pitchClasses, previous = null, [low, high] = VOICE_WINDOW) {
  const center = (low + high) / 2;
  const options = pitchClasses.map((target) => {
    const list = [];
    for (let m = low; m <= high; m++) if (pc(m) === target) list.push(m);
    return list;
  });
  let best = null;
  let bestCost = Infinity;
  const chosen = [];
  const walk = (i) => {
    if (i === options.length) {
      const voicing = [...chosen].sort((a, b) => a - b);
      for (let k = 1; k < voicing.length; k++) if (voicing[k] === voicing[k - 1]) return;
      if (voicing[voicing.length - 1] - voicing[0] > 16) return;
      const motion = previous ? voicing.reduce((sum, m, k) => sum + Math.abs(m - previous[k]), 0) : 0;
      const drift = Math.abs((voicing[0] + voicing[voicing.length - 1]) / 2 - center);
      const cost = motion + drift * 0.35;
      if (cost < bestCost) {
        bestCost = cost;
        best = voicing;
      }
      return;
    }
    for (const m of options[i]) {
      chosen.push(m);
      walk(i + 1);
      chosen.pop();
    }
  };
  walk(0);
  // Sin combinación válida: posición cerrada desde el grave de la ventana.
  return best ?? pitchClasses.map((p) => low + ((p - pc(low) + 12) % 12)).sort((a, b) => a - b);
}

// Fundamental del acorde en el registro del contrabajo (de C2 a B2).
export function bassRoot(tonic, [degree]) {
  return 36 + pc(tonic + degree);
}

// Patrones del piano por compás: [inicio en pulsos, duración en pulsos, intensidad].
const COMPING = Object.freeze({
  pad: [[0, 3.7, 0.95]],
  charleston: [[0, 1.4, 1], ['swing', 2.2, 0.72]],
  halves: [[0, 1.8, 0.95], [2, 1.7, 0.78]],
  late: [[0.5, 3.2, 0.85]],
});

export class LoungeBgm {
  #ctx;
  #out;
  #duck;
  #keys;
  #bassBus;
  #drums;
  #reverb;
  #noise;
  #mood = MOODS.alley;
  #pending = null;
  #running = false;
  #timer = 0;
  #nextBar = 0;
  #bar = 0;
  #voicing = null;
  #lastPattern = '';

  constructor(ctx, destination, mood = 'alley') {
    this.#ctx = ctx;
    this.#mood = MOODS[mood] ?? MOODS.alley;

    // Salida: fundido (out) ← apartado por tensión (duck) ← ecualizador cálido ← instrumentos.
    this.#out = ctx.createGain();
    this.#out.gain.value = SILENCE;
    this.#out.connect(destination);
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'highshelf';
    warmth.frequency.value = 5200;
    warmth.gain.value = -3;
    warmth.connect(this.#out);
    this.#duck = ctx.createGain();
    this.#duck.connect(warmth);

    // Reverb de sala pequeña (respuesta al impulso generada, sin archivos).
    this.#reverb = ctx.createConvolver();
    this.#reverb.buffer = this.#impulse(2.3);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.55;
    this.#reverb.connect(reverbReturn).connect(this.#duck);

    // Rhodes: paso bajo cálido y trémolo estéreo lento.
    this.#keys = ctx.createGain();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 2100;
    lowpass.Q.value = 0.5;
    this.#keys.connect(lowpass);
    let keysOut = lowpass;
    if (typeof ctx.createStereoPanner === 'function') {
      const pan = ctx.createStereoPanner();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 3.6;
      const depth = ctx.createGain();
      depth.gain.value = 0.22;
      lfo.connect(depth).connect(pan.pan);
      lfo.start();
      lowpass.connect(pan);
      keysOut = pan;
    }
    keysOut.connect(this.#duck);
    const keysSend = ctx.createGain();
    keysSend.gain.value = 0.3;
    keysOut.connect(keysSend).connect(this.#reverb);

    // Contrabajo: paso bajo para un tono redondo.
    this.#bassBus = ctx.createGain();
    const bassTone = ctx.createBiquadFilter();
    bassTone.type = 'lowpass';
    bassTone.frequency.value = 620;
    bassTone.Q.value = 0.7;
    this.#bassBus.connect(bassTone).connect(this.#duck);
    const bassSend = ctx.createGain();
    bassSend.gain.value = 0.06;
    bassTone.connect(bassSend).connect(this.#reverb);

    // Batería de escobillas.
    this.#drums = ctx.createGain();
    this.#drums.connect(this.#duck);
    const drumSend = ctx.createGain();
    drumSend.gain.value = 0.14;
    this.#drums.connect(drumSend).connect(this.#reverb);

    // 2 s de ruido blanco reutilizable para escobillas y platillo.
    const length = Math.floor(ctx.sampleRate * 2);
    this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.#noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = randomFloat() * 2 - 1;
  }

  get running() {
    return this.#running;
  }

  // Respuesta al impulso estéreo: ruido con caída exponencial y cada vez más oscuro.
  #impulse(seconds) {
    const ctx = this.#ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let i = 0; i < length; i++) {
        const progress = i / length;
        smooth += (randomFloat() * 2 - 1 - smooth) * (0.6 - 0.45 * progress);
        data[i] = smooth * (1 - progress) ** 3.2;
      }
    }
    return buffer;
  }

  // ---------- Transporte ----------

  start() {
    if (this.#running) return;
    this.#running = true;
    const now = this.#ctx.currentTime;
    const gain = this.#out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, FADE_FLOOR), now);
    gain.exponentialRampToValueAtTime(1, now + FADE_IN);
    this.#nextBar = now + 0.12;
    this.#bar = 0;
    this.#voicing = null;
    this.#timer = setInterval(() => this.#tick(), TICK_MS);
    this.#tick();
  }

  stop() {
    if (!this.#running) return;
    this.#running = false;
    clearInterval(this.#timer);
    const now = this.#ctx.currentTime;
    const gain = this.#out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, FADE_FLOOR), now);
    gain.exponentialRampToValueAtTime(FADE_FLOOR, now + FADE_OUT);
    gain.setValueAtTime(0, now + FADE_OUT + 0.02);
  }

  // El cambio de zona entra en el siguiente compás, empezando su progresión.
  setMood(name) {
    const mood = MOODS[name];
    if (mood && mood !== this.#mood) this.#pending = mood;
  }

  // Con tensión alta (jugadas críticas) la música se aparta para dejar sitio al latido.
  setTension(value) {
    const t = Math.min(1, Math.max(0, value));
    const level = t <= 0.5 ? 1 : 1 - 0.55 * ((t - 0.5) / 0.5);
    this.#duck.gain.setTargetAtTime(level, this.#ctx.currentTime, 0.6);
  }

  #tick() {
    const now = this.#ctx.currentTime;
    // Si el temporizador se retrasó (pestaña en segundo plano), se salta lo perdido.
    if (this.#nextBar < now - 0.2) this.#nextBar = now + 0.1;
    while (this.#nextBar < now + LOOKAHEAD) {
      if (this.#pending) {
        this.#mood = this.#pending;
        this.#pending = null;
        this.#bar = 0;
      }
      const beat = 60 / this.#mood.tempo;
      this.#scheduleBar(this.#nextBar, beat);
      this.#nextBar += beat * 4;
      this.#bar += 1;
    }
  }

  // ---------- Composición por compás ----------

  #scheduleBar(t, beat) {
    const mood = this.#mood;
    const length = mood.progression.length;
    const spec = mood.progression[this.#bar % length];
    const next = mood.progression[(this.#bar + 1) % length];
    const voicing = voiceLead(chordTones(mood.tonic, spec), this.#voicing);
    this.#voicing = voicing;
    const at = (beats) => t + (beats === 'swing' ? 1 + mood.swing : beats) * beat;

    // Piano: patrón de acompañamiento distinto del anterior, más escaso con densidad baja.
    const names = randomFloat() < mood.density ? ['charleston', 'halves', 'late'] : ['pad', 'pad', 'late'];
    let name = names[randomInt(names.length)];
    if (name === this.#lastPattern && name !== 'pad') name = 'pad';
    this.#lastPattern = name;
    for (const [start, beats, intensity] of COMPING[name]) {
      const when = at(start) + (randomFloat() - 0.5) * 0.012;
      const velocity = intensity * (0.72 + randomFloat() * 0.18);
      voicing.forEach((midi, i) => {
        // Arpegio mínimo de abajo arriba, como una mano real; la voz aguda un poco más suave.
        const roll = i * (0.007 + randomFloat() * 0.006);
        this.#rhodes(when + roll, midi, velocity * (i === voicing.length - 1 ? 0.9 : 1), beats * beat);
      });
    }

    // Adorno agudo ocasional en los compases 4 y 8 de la frase.
    const position = this.#bar % length;
    if ((position === 3 || position === 7) && randomFloat() < mood.ornament) {
      const top = voicing.map((m) => m + 12).filter((m) => m <= 86);
      const notes = 2 + randomInt(2);
      for (let i = 0; i < notes && top.length; i++) {
        const midi = top[randomInt(top.length)];
        this.#rhodes(at(2 + i * 0.5 + (i % 2 ? mood.swing - 0.5 : 0)), midi, 0.42 + randomFloat() * 0.12, beat * 1.4);
      }
    }

    // Contrabajo a dos tiempos: fundamental, quinta (o fundamental) y aproximación opcional.
    const root = bassRoot(mood.tonic, spec);
    const fifth = root + 7 <= BASS_WINDOW[1] ? root + 7 : root - 5;
    this.#bass(at(0), root, 0.9 + randomFloat() * 0.08, beat * 1.85);
    this.#bass(at(2), randomFloat() < 0.65 ? fifth : root, 0.72 + randomFloat() * 0.1, beat * 1.35);
    if (randomFloat() < 0.35) {
      const target = bassRoot(mood.tonic, next);
      const approach = target + (randomFloat() < 0.5 ? -1 : 1);
      this.#bass(at(3 + mood.swing), approach, 0.55, beat * 0.4);
    }

    // Escobillas: barrido en cada pulso, toque en 2 y 4, platillo en swing y bombo rozado.
    for (let b = 0; b < 4; b++) this.#swish(at(b), beat * 0.9, b % 2 ? 0.8 : 1);
    this.#tap(at(1));
    this.#tap(at(3));
    for (const [pos, level] of [[0, 1], [1, 0.8], [1 + mood.swing, 0.55], [2, 0.9], [3, 0.8], [3 + mood.swing, 0.55]]) {
      this.#ride(at(pos), level);
    }
    this.#kick(at(0), 1);
    this.#kick(at(2), 0.7);
  }

  // ---------- Instrumentos ----------

  // Rhodes: fundamental (con una desafinación mínima), octava que se apaga antes y púa aguda.
  #rhodes(t, midi, velocity, duration) {
    const ctx = this.#ctx;
    const f = hz(midi) * 2 ** ((randomFloat() - 0.5) * 0.004);
    const voice = ctx.createGain();
    const peak = 0.15 * velocity;
    const end = t + duration;
    voice.gain.setValueAtTime(SILENCE, t);
    voice.gain.exponentialRampToValueAtTime(peak, t + 0.007);
    voice.gain.setTargetAtTime(peak * 0.34, t + 0.007, 0.95);
    voice.gain.setTargetAtTime(SILENCE, end, 0.2);

    const fundamental = ctx.createOscillator();
    fundamental.frequency.value = f;
    const octave = ctx.createOscillator();
    octave.frequency.value = f * 2;
    const octaveLevel = ctx.createGain();
    octaveLevel.gain.setValueAtTime(0.32, t);
    octaveLevel.gain.setTargetAtTime(0.05, t, 0.28);
    const tine = ctx.createOscillator();
    tine.frequency.value = f * 7.03;
    const tineLevel = ctx.createGain();
    tineLevel.gain.setValueAtTime(0.1 * velocity, t);
    tineLevel.gain.setTargetAtTime(SILENCE, t, 0.018);

    fundamental.connect(voice);
    octave.connect(octaveLevel).connect(voice);
    tine.connect(tineLevel).connect(voice);
    voice.connect(this.#keys);
    const stopAt = end + 1.3;
    for (const osc of [fundamental, octave, tine]) {
      osc.start(t);
      osc.stop(stopAt);
    }
    fundamental.onended = () => voice.disconnect();
  }

  // Contrabajo: seno con un triángulo suave para dar definición; ataque redondo.
  #bass(t, midi, velocity, duration) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const voice = ctx.createGain();
    const peak = 0.16 * velocity;
    const end = t + duration;
    voice.gain.setValueAtTime(SILENCE, t);
    voice.gain.exponentialRampToValueAtTime(peak, t + 0.014);
    voice.gain.setTargetAtTime(peak * 0.45, t + 0.014, 0.55);
    voice.gain.setTargetAtTime(SILENCE, end, 0.1);
    const body = ctx.createOscillator();
    body.frequency.value = f;
    const edge = ctx.createOscillator();
    edge.type = 'triangle';
    edge.frequency.value = f;
    const edgeLevel = ctx.createGain();
    edgeLevel.gain.value = 0.28;
    body.connect(voice);
    edge.connect(edgeLevel).connect(voice);
    voice.connect(this.#bassBus);
    for (const osc of [body, edge]) {
      osc.start(t);
      osc.stop(end + 0.6);
    }
    body.onended = () => voice.disconnect();
  }

  #noiseHit(t, { type, freq, q = 0.7, attack, peak, decay, pan = 0 }) {
    const ctx = this.#ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.setTargetAtTime(SILENCE, t + attack, decay);
    src.connect(filter).connect(gain);
    let last = gain;
    if (pan && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner);
      last = panner;
    }
    last.connect(this.#drums);
    src.start(t, randomFloat() * 1.5);
    src.stop(t + attack + decay * 6);
    src.onended = () => last.disconnect();
  }

  // Barrido circular de escobilla sobre el parche.
  #swish(t, length, level) {
    this.#noiseHit(t, { type: 'bandpass', freq: 2900 + randomFloat() * 500, q: 0.6, attack: length * 0.35, peak: 0.05 * level, decay: length * 0.18, pan: -0.25 });
  }

  // Golpe de escobilla en 2 y 4.
  #tap(t) {
    this.#noiseHit(t, { type: 'highpass', freq: 4200, q: 0.5, attack: 0.003, peak: 0.075, decay: 0.035, pan: -0.15 });
  }

  // Platillo ride muy suave: ruido agudo con caída larga.
  #ride(t, level) {
    this.#noiseHit(t + (randomFloat() - 0.5) * 0.008, { type: 'bandpass', freq: 7400, q: 0.8, attack: 0.002, peak: 0.07 * level, decay: 0.16, pan: 0.3 });
  }

  // Bombo apenas rozado («feathering»).
  #kick(t, level) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.18);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(0.035 * level, t + 0.01);
    gain.gain.setTargetAtTime(SILENCE, t + 0.01, 0.07);
    osc.connect(gain).connect(this.#drums);
    osc.start(t);
    osc.stop(t + 0.5);
    osc.onended = () => gain.disconnect();
  }
}
