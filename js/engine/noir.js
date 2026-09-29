// Música noir-jazz procedural con Web Audio API: una atmósfera por zona del casino.
// Callejón: lluvia, contrabajo lento, piano escaso y trompeta con sordina. Salón de Neón: lounge
// con swing, escobillas y vibráfono. Penthouse: dron grave, reloj que marca el tiempo y clústeres
// de piano. Además, los estados de final (victoria) y de derrota. El parámetro de tensión (0–1)
// abre el filtro del dron, acelera el reloj y añade golpes graves en las jugadas críticas.

import { randomFloat, randomInt, pick } from './rng.js';

const LOOKAHEAD = 0.45;
const SILENCE = 0.0001;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

const MOODS = {
  alley: {
    tempo: 58,
    swing: 0.62,
    tonic: 38,
    chords: [
      { root: 38, tones: [0, 3, 7, 10, 14], voicing: [53, 57, 60, 64] },
      { root: 34, tones: [0, 4, 7, 11], voicing: [58, 62, 65, 69] },
      { root: 43, tones: [0, 3, 7, 10, 14], voicing: [53, 58, 62, 69] },
      { root: 45, tones: [0, 4, 7, 10, 13], voicing: [55, 61, 64, 70] },
    ],
    bass: 'half', comp: 'sparse', drums: 'none', rain: 0.05, drone: 0.22, lead: 0.45, vibes: 0, piano: 0.05,
  },
  neon: {
    tempo: 74,
    swing: 0.64,
    tonic: 36,
    chords: [
      { root: 36, tones: [0, 3, 7, 10, 14], voicing: [51, 55, 58, 62] },
      { root: 41, tones: [0, 3, 7, 10, 14], voicing: [56, 60, 63, 67] },
      { root: 38, tones: [0, 3, 6, 10], voicing: [53, 56, 60, 62] },
      { root: 43, tones: [0, 4, 7, 10, 13], voicing: [53, 59, 63, 68] },
    ],
    bass: 'walk', comp: 'swing', drums: 'brush', rain: 0, drone: 0.07, lead: 0.25, vibes: 0.45, piano: 0.06,
  },
  penthouse: {
    tempo: 64,
    swing: 0.6,
    tonic: 45,
    chords: [
      { root: 45, tones: [0, 3, 7, 14], voicing: [57, 60, 64, 71] },
      { root: 45, tones: [0, 3, 7, 8], voicing: [53, 57, 60, 64] },
      { root: 45, tones: [0, 2, 5, 8], voicing: [53, 57, 59, 62] },
      { root: 44, tones: [0, 3, 6, 8, 9], voicing: [56, 59, 62, 65] },
    ],
    bass: 'pedal', comp: 'cluster', drums: 'clock', rain: 0, drone: 0.5, lead: 0.15, vibes: 0, piano: 0.05,
  },
  finale: {
    tempo: 70,
    swing: 0.6,
    tonic: 37,
    chords: [
      { root: 37, tones: [0, 4, 7, 11, 14], voicing: [53, 56, 60, 63] },
      { root: 46, tones: [0, 3, 7, 10, 14], voicing: [61, 65, 68, 72] },
      { root: 42, tones: [0, 4, 7, 11, 14], voicing: [58, 61, 65, 68] },
      { root: 44, tones: [0, 4, 7, 10, 14], voicing: [54, 60, 65, 70] },
    ],
    bass: 'half', comp: 'lush', drums: 'brush', rain: 0, drone: 0.08, lead: 0.6, vibes: 0.5, piano: 0.07,
  },
  gameover: {
    tempo: 50,
    swing: 0.6,
    tonic: 40,
    chords: [
      { root: 40, tones: [0, 3, 7, 10, 14], voicing: [55, 59, 62, 66] },
      { root: 36, tones: [0, 4, 7, 11], voicing: [55, 60, 64, 71] },
      { root: 45, tones: [0, 3, 7, 10, 14], voicing: [55, 59, 60, 64] },
      { root: 47, tones: [0, 4, 7, 10, 13], voicing: [57, 60, 63, 66] },
    ],
    bass: 'half', comp: 'sparse', drums: 'none', rain: 0.06, drone: 0.42, lead: 0.2, vibes: 0, piano: 0.05,
  },
};

const COMPING = {
  swing: [[[0, 1.8]], [[0, 0.9], [2.64, 1.2]], [[0.64, 1.3], [2, 1.1]], [[1.64, 1.8]], [[0, 0.6], [1.64, 0.5], [3, 0.8]]],
  sparse: [[[0, 3.6]], [[0, 1.8], [2, 1.6]], [[1.64, 2.2]]],
  lush: [[[0, 3.8]], [[0, 1.9], [2, 1.9]]],
  cluster: [[[0, 3.6]], [[2, 1.8]], [[0.64, 2.8]]],
};

export const MOOD_NAMES = Object.freeze(Object.keys(MOODS));

export class NoirMusic {
  #ctx;
  #out;
  #dry;
  #send;
  #piano;
  #noise;
  #mood = MOODS.alley;
  #tension = 0.15;
  #timer = 0;
  #running = false;
  #nextBar = 0;
  #bar = 0;
  #rain = null;
  #drone = null;

  constructor(ctx, destination, mood = 'alley') {
    this.#ctx = ctx;
    this.#mood = MOODS[mood] ?? MOODS.alley;
    this.#out = ctx.createGain();
    this.#out.gain.value = SILENCE;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 7000;
    this.#out.connect(tone).connect(destination);

    this.#dry = ctx.createGain();
    this.#dry.gain.value = 0.9;
    this.#dry.connect(this.#out);

    const reverb = ctx.createConvolver();
    reverb.buffer = this.#impulse(2.8);
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    this.#send = ctx.createGain();
    this.#send.connect(reverb).connect(wet).connect(this.#out);

    // Piano eléctrico con trémolo estéreo tipo "suitcase".
    this.#piano = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.1;
    const depth = ctx.createGain();
    depth.gain.value = 0.28;
    lfo.connect(depth).connect(panner.pan);
    lfo.start();
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2400;
    this.#piano.connect(warmth).connect(panner);
    panner.connect(this.#dry);
    const pianoSend = ctx.createGain();
    pianoSend.gain.value = 0.45;
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
      for (let i = 0; i < length; i++) data[i] = (randomFloat() * 2 - 1) * (1 - i / length) ** 3;
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
    this.#startLayers();
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
    this.#stopLayers(now + 0.8);
  }

  // Cambia de atmósfera con un fundido breve; el nuevo tempo entra en el siguiente compás.
  setMood(name) {
    const mood = MOODS[name];
    if (!mood || mood === this.#mood) return;
    this.#mood = mood;
    this.#bar = 0;
    if (!this.#running) return;
    const now = this.#ctx.currentTime;
    const gain = this.#out.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(Math.max(gain.value, SILENCE), now);
    gain.exponentialRampToValueAtTime(0.25, now + 0.5);
    gain.exponentialRampToValueAtTime(1, now + 2.2);
    this.#nextBar = Math.max(this.#nextBar, now + 0.55);
    this.#updateLayers();
  }

  setTension(value) {
    this.#tension = Math.min(1, Math.max(0, value));
    if (this.#running) this.#updateLayers();
  }

  #tick() {
    const now = this.#ctx.currentTime;
    // Si el temporizador se retrasó (pestaña en segundo plano), se salta lo perdido.
    if (this.#nextBar < now - 0.2) this.#nextBar = now + 0.1;
    while (this.#nextBar < now + LOOKAHEAD) {
      const beat = 60 / this.#mood.tempo;
      this.#scheduleBar(this.#bar, this.#nextBar, beat);
      this.#nextBar += beat * 4;
      this.#bar = (this.#bar + 1) % this.#mood.chords.length;
    }
  }

  // ---------- Capas continuas: lluvia y dron ----------

  #startLayers() {
    const ctx = this.#ctx;
    const now = ctx.currentTime;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.#noise;
    rainSrc.loop = true;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 900;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 6500;
    const rainGain = ctx.createGain();
    rainGain.gain.value = SILENCE;
    rainSrc.connect(high).connect(low).connect(rainGain).connect(this.#dry);
    rainSrc.start(now);
    this.#rain = { src: rainSrc, gain: rainGain };

    const droneGain = ctx.createGain();
    droneGain.gain.value = SILENCE;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    filter.Q.value = 2;
    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.06;
    const sweepDepth = ctx.createGain();
    sweepDepth.gain.value = 110;
    sweep.connect(sweepDepth).connect(filter.frequency);
    const oscillators = [-12, -12, -5].map((offset, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = hz(this.#mood.tonic + offset);
      osc.detune.value = [-7, 6, 0][i];
      osc.connect(filter);
      osc.start(now);
      return { osc, offset };
    });
    filter.connect(droneGain).connect(this.#dry);
    const droneSend = ctx.createGain();
    droneSend.gain.value = 0.3;
    droneGain.connect(droneSend).connect(this.#send);
    sweep.start(now);
    this.#drone = { oscillators, sweep, filter, gain: droneGain };
    this.#updateLayers();
  }

  #stopLayers(at) {
    if (this.#rain) {
      this.#rain.gain.gain.setTargetAtTime(SILENCE, this.#ctx.currentTime, 0.15);
      this.#rain.src.stop(at);
      this.#rain = null;
    }
    if (this.#drone) {
      this.#drone.gain.gain.setTargetAtTime(SILENCE, this.#ctx.currentTime, 0.15);
      for (const { osc } of this.#drone.oscillators) osc.stop(at);
      this.#drone.sweep.stop(at);
      this.#drone = null;
    }
  }

  #updateLayers() {
    const now = this.#ctx.currentTime;
    const mood = this.#mood;
    const t = this.#tension;
    if (this.#rain) this.#rain.gain.gain.setTargetAtTime(Math.max(SILENCE, mood.rain), now, 0.8);
    if (this.#drone) {
      const level = Math.max(SILENCE, mood.drone * 0.09 * (0.45 + t * 0.9));
      this.#drone.gain.gain.setTargetAtTime(level, now, 0.6);
      this.#drone.filter.frequency.setTargetAtTime(260 + t * 900, now, 0.5);
      for (const { osc, offset } of this.#drone.oscillators) {
        osc.frequency.setTargetAtTime(hz(mood.tonic + offset), now, 0.8);
      }
    }
  }

  // ---------- Composición por compás ----------

  #scheduleBar(index, t, beat) {
    const mood = this.#mood;
    const chord = mood.chords[index % mood.chords.length];
    const next = mood.chords[(index + 1) % mood.chords.length];
    const swing = mood.swing;
    const at = (beats) => t + beats * beat;

    const patterns = COMPING[mood.comp] ?? COMPING.sparse;
    const pattern = index === 0 ? patterns[0] : pick(patterns);
    if (mood.comp !== 'sparse' || randomFloat() < 0.8) {
      for (const [start, length] of pattern) {
        const velocity = mood.piano + randomFloat() * 0.015;
        const voicing = mood.comp === 'cluster' && randomFloat() < 0.4 ? [...chord.voicing, chord.voicing[0] + 1] : chord.voicing;
        const spread = mood.comp === 'sparse' || mood.comp === 'lush' ? 0.06 : 0.012;
        voicing.forEach((midi, i) => this.#rhodes(at(start) + i * spread, midi, length * beat, velocity));
      }
    }

    this.#bassLine(mood, chord, next, t, beat);
    this.#drums(mood, t, beat, swing);

    if (randomFloat() < mood.lead) this.#trumpetPhrase(chord, t, beat, swing);
    if (randomFloat() < mood.vibes) this.#motif(chord, t, beat, swing);
    if (mood.rain > 0) this.#droplets(t, beat * 4);
    if (this.#tension > 0.6 && index % 2 === 0) this.#boom(t, this.#tension);
  }

  #fitBass(midi) {
    let value = midi;
    while (value > 52) value -= 12;
    while (value < 31) value += 12;
    return value;
  }

  #bassLine(mood, chord, next, t, beat) {
    const tone = (steps) => this.#fitBass(chord.root + steps);
    if (mood.bass === 'walk') {
      const line = [
        this.#fitBass(chord.root),
        tone(pick([chord.tones[1], chord.tones[2], 12])),
        tone(pick([chord.tones[2], chord.tones[3] ?? 7, chord.tones[1]])),
        this.#fitBass(next.root + pick([-1, 1, -2, 2])),
      ];
      line.forEach((midi, i) => this.#bass(t + i * beat, midi, beat * 0.92, i === 0 ? 0.3 : 0.24));
    } else if (mood.bass === 'pedal') {
      this.#bass(t, this.#fitBass(mood.tonic), beat * 3.6, 0.28);
      if (this.#tension > 0.4) this.#bass(t + beat * 2.5, this.#fitBass(mood.tonic), beat * 1.2, 0.16);
    } else {
      this.#bass(t, this.#fitBass(chord.root), beat * 1.9, 0.28);
      this.#bass(t + beat * 2, tone(pick([7, 12, chord.tones[1]])), beat * 1.8, 0.22);
    }
  }

  #drums(mood, t, beat, swing) {
    if (mood.drums === 'brush') {
      for (let b = 0; b < 4; b++) {
        const at = t + b * beat;
        this.#ride(at, b % 2 === 0 ? 0.045 : 0.034);
        if (b === 1 || b === 3) {
          this.#ride(at + swing * beat, 0.026);
          this.#hat(at);
          this.#brushTap(at);
        } else {
          this.#brushSwish(at, beat * 1.6);
          this.#kick(at, b === 0 ? 0.1 : 0.06);
        }
      }
    } else if (mood.drums === 'clock') {
      const subdivisions = this.#tension > 0.55 ? 2 : 1;
      for (let b = 0; b < 4 * subdivisions; b++) this.#clock(t + (b * beat) / subdivisions, b % (2 * subdivisions) === 0);
    } else if (randomFloat() < 0.5) {
      this.#brushSwish(t + beat * 2, beat * 2);
    }
  }

  // Trompeta con sordina: frase corta con notas del acorde y portamento.
  #trumpetPhrase(chord, t, beat, swing) {
    const notes = 2 + randomInt(4);
    let slot = randomInt(3);
    let previous = null;
    for (let i = 0; i < notes && slot < 8; i++) {
      const midi = 62 + ((chord.root + pick(chord.tones)) % 12) + (randomFloat() < 0.35 ? 12 : 0);
      const at = t + (Math.floor(slot / 2) + (slot % 2 ? swing : 0)) * beat;
      const last = i === notes - 1 || slot >= 6;
      const length = last ? beat * (1.5 + randomFloat()) : beat * (0.45 + randomFloat() * 0.5);
      this.#trumpet(at, midi, length, previous);
      previous = midi;
      slot += 1 + randomInt(2);
    }
  }

  #motif(chord, t, beat, swing) {
    const notes = 2 + randomInt(3);
    let slot = randomInt(3);
    for (let i = 0; i < notes && slot < 8; i++) {
      const midi = 72 + ((chord.root + pick(chord.tones)) % 12) + (randomFloat() < 0.3 ? 12 : 0);
      const at = t + (Math.floor(slot / 2) + (slot % 2 ? swing : 0)) * beat;
      this.#vibe(at, midi, beat * (1 + randomFloat()));
      slot += 1 + randomInt(3);
    }
  }

  // ---------- Instrumentos ----------

  #envelope(param, t, attack, peak, hold, release) {
    param.setValueAtTime(SILENCE, t);
    param.exponentialRampToValueAtTime(Math.max(peak, SILENCE * 2), t + attack);
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
    filter.frequency.setValueAtTime(1000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + 0.3);
    const amp = ctx.createGain();
    this.#envelope(amp.gain, t, 0.012, velocity, length * 0.75, 0.14);
    body.connect(filter);
    sub.connect(filter);
    filter.connect(amp).connect(this.#dry);
    const end = t + length + 0.3;
    body.start(t);
    sub.start(t);
    body.stop(end);
    sub.stop(end);
  }

  #trumpet(t, midi, length, from) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    if (from !== null) {
      osc.frequency.setValueAtTime(hz(from), t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    } else {
      osc.frequency.setValueAtTime(f * 0.985, t);
      osc.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    }
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.setValueAtTime(0, t);
    vibratoDepth.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.4, length));
    vibrato.connect(vibratoDepth).connect(osc.frequency);
    const mute = ctx.createBiquadFilter();
    mute.type = 'bandpass';
    mute.frequency.value = 1350;
    mute.Q.value = 1.4;
    const soften = ctx.createBiquadFilter();
    soften.type = 'lowpass';
    soften.frequency.value = 2600;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(0.06, t + 0.06);
    amp.gain.setTargetAtTime(0.045, t + 0.06, 0.2);
    amp.gain.setTargetAtTime(SILENCE, t + length, 0.08);
    osc.connect(mute).connect(soften).connect(amp).connect(this.#dry);
    const send = ctx.createGain();
    send.gain.value = 0.55;
    amp.connect(send).connect(this.#send);
    const end = t + length + 0.5;
    osc.start(t);
    vibrato.start(t);
    osc.stop(end);
    vibrato.stop(end);
  }

  #vibe(t, midi, length) {
    const ctx = this.#ctx;
    const f = hz(midi);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
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
  }

  #hat(t) {
    this.#noiseHit(t, { type: 'highpass', freq: 7000, attack: 0.001, peak: 0.02, decay: 0.045 });
  }

  #brushTap(t) {
    this.#noiseHit(t, { type: 'bandpass', freq: 1900, q: 0.9, attack: 0.003, peak: 0.032, decay: 0.14 });
  }

  #brushSwish(t, length) {
    this.#noiseHit(t, { type: 'bandpass', freq: 2400, q: 0.6, attack: length * 0.55, peak: 0.013, decay: length * 0.45 });
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

  // Reloj del Penthouse: bloque de madera seco con acento en el primer tiempo.
  #clock(t, accent) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = accent ? 1850 : 1500;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(accent ? 0.05 : 0.032, t + 0.002);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + 0.05);
    osc.connect(amp).connect(this.#dry);
    osc.start(t);
    osc.stop(t + 0.06);
    this.#noiseHit(t, { type: 'bandpass', freq: 3200, q: 3, attack: 0.001, peak: 0.02, decay: 0.02 });
  }

  // Gotas de lluvia sobre el cristal: destellos agudos y breves repartidos por el compás.
  #droplets(t, length) {
    const count = 4 + randomInt(8);
    for (let i = 0; i < count; i++) {
      const at = t + randomFloat() * length;
      const osc = this.#ctx.createOscillator();
      osc.frequency.value = 2400 + randomFloat() * 2200;
      const amp = this.#ctx.createGain();
      amp.gain.setValueAtTime(SILENCE, at);
      amp.gain.exponentialRampToValueAtTime(0.008 + randomFloat() * 0.01, at + 0.001);
      amp.gain.exponentialRampToValueAtTime(SILENCE, at + 0.05);
      osc.connect(amp).connect(this.#dry);
      osc.start(at);
      osc.stop(at + 0.06);
    }
  }

  // Timbal grave de suspense cuando la tensión es alta.
  #boom(t, tension) {
    const ctx = this.#ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(62, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.9);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(SILENCE, t);
    amp.gain.exponentialRampToValueAtTime(0.14 * tension, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(SILENCE, t + 1.1);
    osc.connect(amp).connect(this.#dry);
    osc.start(t);
    osc.stop(t + 1.2);
    this.#noiseHit(t, { type: 'lowpass', freq: 500, attack: 0.004, peak: 0.05 * tension, decay: 0.5, send: 0.4 });
  }
}
