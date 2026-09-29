// Música lounge/jazz procedural con Web Audio API: piano eléctrico FM con trémolo, contrabajo
// "walking", escobillas y ride con swing, vibráfono ocasional y reverb por convolución.
// Nada está pregrabado: cada compás se genera con variaciones aleatorias.

import { randomFloat, randomInt, pick } from './rng.js';

const TEMPO = 76;
const BEAT = 60 / TEMPO;
const BAR = BEAT * 4;
const SWING = 0.64;
const LOOKAHEAD = 0.45;
const SILENCE = 0.0001;

const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

// Progresión de 8 compases en Do mayor (I–vi–ii–V–iii–VI–ii–V) con voicings sin fundamental.
const CHORDS = [
  { root: 36, tones: [0, 4, 7, 11, 14], voicing: [52, 55, 59, 62] },
  { root: 45, tones: [0, 3, 7, 10, 14], voicing: [55, 59, 60, 64] },
  { root: 38, tones: [0, 3, 7, 10, 14], voicing: [53, 57, 60, 64] },
  { root: 43, tones: [0, 4, 7, 10, 14], voicing: [53, 59, 64, 69] },
  { root: 40, tones: [0, 3, 7, 10], voicing: [55, 59, 62, 64] },
  { root: 45, tones: [0, 4, 7, 10, 13], voicing: [55, 61, 65, 70] },
  { root: 38, tones: [0, 3, 7, 10, 14], voicing: [53, 57, 60, 64] },
  { root: 43, tones: [0, 4, 7, 10, 13], voicing: [53, 56, 59, 64] },
];

// Patrones de acompañamiento del piano: [inicio en pulsos, duración en pulsos].
const COMPING = [
  [[0, 1.8]],
  [[0, 0.9], [2 + SWING, 1.2]],
  [[SWING, 1.3], [2, 1.1]],
  [[1 + SWING, 1.8]],
  [[0, 0.6], [1 + SWING, 0.5], [3, 0.8]],
];

export class LoungeMusic {
  #ctx;
  #out;
  #piano;
  #dry;
  #send;
  #noise;
  #timer = 0;
  #running = false;
  #nextBar = 0;
  #bar = 0;

  constructor(ctx, destination) {
    this.#ctx = ctx;
    this.#out = ctx.createGain();
    this.#out.gain.value = SILENCE;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 6500;
    this.#out.connect(tone).connect(destination);

    this.#dry = ctx.createGain();
    this.#dry.gain.value = 0.9;
    this.#dry.connect(this.#out);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.#impulse(2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.45;
    this.#send = ctx.createGain();
    this.#send.connect(reverb).connect(wet).connect(this.#out);

    // Bus del piano con trémolo estéreo tipo "suitcase".
    this.#piano = ctx.createGain();
    this.#piano.gain.value = 1;
    const panner = ctx.createStereoPanner();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.1;
    const depth = ctx.createGain();
    depth.gain.value = 0.28;
    lfo.connect(depth).connect(panner.pan);
    lfo.start();
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2600;
    this.#piano.connect(warmth).connect(panner);
    panner.connect(this.#dry);
    const pianoSend = ctx.createGain();
    pianoSend.gain.value = 0.4;
    panner.connect(pianoSend).connect(this.#send);

    const length = Math.floor(ctx.sampleRate * 1.5);
    this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.#noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = randomFloat() * 2 - 1;
  }

  get running() {
    return this.#running;
  }

  #impulse(seconds) {
    const ctx = this.#ctx;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (randomFloat() * 2 - 1) * (1 - i / length) ** 3.2;
    }
    return buffer;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    const now = this.#ctx.currentTime;
    this.#nextBar = now + 0.15;
    this.#bar = 0;
    const gain = this.#out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, SILENCE), now);
    gain.exponentialRampToValueAtTime(1, now + 2.5);
    this.#timer = setInterval(() => this.#tick(), 90);
    this.#tick();
  }

  stop() {
    if (!this.#running) return;
    this.#running = false;
    clearInterval(this.#timer);
    const now = this.#ctx.currentTime;
    const gain = this.#out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, SILENCE), now);
    gain.exponentialRampToValueAtTime(SILENCE, now + 0.7);
  }

  #tick() {
    const now = this.#ctx.currentTime;
    // Si el temporizador se retrasó (pestaña en segundo plano), se salta lo perdido.
    if (this.#nextBar < now - 0.2) this.#nextBar = now + 0.1;
    while (this.#nextBar < now + LOOKAHEAD) {
      this.#scheduleBar(this.#bar, this.#nextBar);
      this.#nextBar += BAR;
      this.#bar = (this.#bar + 1) % CHORDS.length;
    }
  }

  #scheduleBar(index, t) {
    const chord = CHORDS[index];
    const next = CHORDS[(index + 1) % CHORDS.length];

    const pattern = index === 0 ? [[0, 2.6]] : pick(COMPING);
    for (const [at, length] of pattern) {
      const velocity = 0.055 + randomFloat() * 0.02;
      chord.voicing.forEach((midi, i) => this.#rhodes(t + at * BEAT + i * 0.012, midi, length * BEAT, velocity));
    }

    const line = this.#walk(chord, next);
    line.forEach((midi, beat) => this.#bass(t + beat * BEAT, midi, BEAT * 0.92, beat === 0 ? 0.3 : 0.24));

    for (let beat = 0; beat < 4; beat++) {
      const at = t + beat * BEAT;
      this.#ride(at, beat % 2 === 0 ? 0.05 : 0.038);
      if (beat === 1 || beat === 3) {
        this.#ride(at + SWING * BEAT, 0.03);
        this.#hat(at);
        this.#brushTap(at);
      } else {
        this.#brushSwish(at, BEAT * 1.6);
        this.#kick(at, beat === 0 ? 0.11 : 0.07);
      }
    }

    if (randomFloat() < 0.55) this.#motif(chord, t);
  }

  // Contrabajo walking: fundamental, notas del acorde y aproximación cromática al siguiente.
  #walk(chord, next) {
    const fit = (midi) => {
      let value = midi;
      while (value > 52) value -= 12;
      while (value < 31) value += 12;
      return value;
    };
    const root = fit(chord.root);
    const tone = (steps) => fit(chord.root + steps);
    const second = tone(pick([chord.tones[1], chord.tones[2], 12]));
    const third = tone(pick([chord.tones[2], chord.tones[3] ?? 7, chord.tones[1]]));
    const target = fit(next.root);
    const approach = fit(target + pick([-1, 1, -2, 2]));
    return [root, second, third, approach];
  }

  #motif(chord, t) {
    const notes = 2 + randomInt(3);
    let slot = randomInt(3);
    for (let i = 0; i < notes && slot < 8; i++) {
      const step = pick(chord.tones);
      const midi = 72 + ((chord.root + step) % 12) + (randomFloat() < 0.3 ? 12 : 0);
      const at = t + (Math.floor(slot / 2) + (slot % 2 ? SWING : 0)) * BEAT;
      this.#vibe(at, midi, BEAT * (1 + randomFloat()));
      slot += 1 + randomInt(3);
    }
  }

  #envelope(param, t, attack, peak, hold, release) {
    param.setValueAtTime(SILENCE, t);
    param.exponentialRampToValueAtTime(peak, t + attack);
    param.setTargetAtTime(peak * 0.35, t + attack, hold / 3);
    param.setTargetAtTime(SILENCE, t + attack + hold, release / 4);
  }

  // Piano eléctrico por FM 1:1 con índice decreciente: ataque metálico que se vuelve cálido.
  #rhodes(t, midi, length, velocity) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const carrier = ctx.createOscillator();
    carrier.frequency.value = f;
    const modulator = ctx.createOscillator();
    modulator.frequency.value = f;
    const index = ctx.createGain();
    index.gain.setValueAtTime(f * 1.3, t);
    index.gain.exponentialRampToValueAtTime(f * 0.06, t + 0.45);
    modulator.connect(index).connect(carrier.frequency);
    const amp = ctx.createGain();
    this.#envelope(amp.gain, t, 0.006, velocity, length, 0.4);
    carrier.connect(amp).connect(this.#piano);
    const end = t + length + 0.6;
    carrier.start(t);
    modulator.start(t);
    carrier.stop(end);
    modulator.stop(end);
  }

  #bass(t, midi, length, velocity) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(f * 1.012, t);
    body.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    const sub = ctx.createOscillator();
    sub.frequency.value = f;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1100, t);
    filter.frequency.exponentialRampToValueAtTime(420, t + 0.3);
    const amp = ctx.createGain();
    this.#envelope(amp.gain, t, 0.012, velocity, length * 0.75, 0.12);
    body.connect(filter);
    sub.connect(filter);
    filter.connect(amp).connect(this.#dry);
    const end = t + length + 0.3;
    body.start(t);
    sub.start(t);
    body.stop(end);
    sub.stop(end);
  }

  #noiseHit(t, { type, freq, q = 0.8, attack, peak, decay, send = 0 }) {
    const ctx = this.#ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(peak, t + attack);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + attack + decay);
    src.connect(filter).connect(amp).connect(this.#dry);
    if (send > 0) {
      const tap = ctx.createGain();
      tap.gain.value = send;
      amp.connect(tap).connect(this.#send);
    }
    src.start(t, randomFloat());
    src.stop(t + attack + decay + 0.05);
  }

  #ride(t, level) {
    this.#noiseHit(t, { type: 'bandpass', freq: 8200, q: 0.7, attack: 0.002, peak: level, decay: 0.38, send: 0.3 });
    const ping = this.#ctx.createOscillator();
    ping.frequency.value = 4650;
    const amp = this.#ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(level * 0.12, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + 0.5);
    ping.connect(amp).connect(this.#dry);
    ping.start(t);
    ping.stop(t + 0.55);
  }

  #hat(t) {
    this.#noiseHit(t, { type: 'highpass', freq: 7000, attack: 0.001, peak: 0.022, decay: 0.045 });
  }

  #brushTap(t) {
    this.#noiseHit(t, { type: 'bandpass', freq: 1900, q: 0.9, attack: 0.003, peak: 0.035, decay: 0.14 });
  }

  #brushSwish(t, length) {
    this.#noiseHit(t, { type: 'bandpass', freq: 2400, q: 0.6, attack: length * 0.55, peak: 0.014, decay: length * 0.45 });
  }

  #kick(t, level) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(72, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.2);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(level, t + 0.005);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + 0.28);
    osc.connect(amp).connect(this.#dry);
    osc.start(t);
    osc.stop(t + 0.3);
  }

  // Vibráfono: fundamental + parcial ≈4× con trémolo del motor.
  #vibe(t, midi, length) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(0.045, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + length + 1.2);
    const tremolo = ctx.createGain();
    tremolo.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(tremolo.gain);
    const end = t + length + 1.3;
    for (const [ratio, level] of [[1, 1], [3.94, 0.18]]) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f * ratio;
      const partial = ctx.createGain();
      partial.gain.value = level;
      osc.connect(partial).connect(amp);
      osc.start(t);
      osc.stop(end);
    }
    amp.connect(tremolo).connect(this.#dry);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    tremolo.connect(send).connect(this.#send);
    lfo.start(t);
    lfo.stop(end);
  }
}
