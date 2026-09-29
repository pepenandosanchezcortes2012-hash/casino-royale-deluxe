// Motor de audio procedural con Web Audio API: ningún archivo de audio externo.
// Buses independientes: efectos (SFX) y música, más la voz del crupier (Web Speech API).
// El contexto se crea y se reanuda tras el primer gesto del usuario (política de autoplay).

import { storage } from './storage.js';
import { randomFloat, randomBetween } from './rng.js';
import { NoirMusic } from './noir.js';
import { DealerVoice } from './voice.js';

const KEY = 'crd.audio.v2';
const LEGACY_KEY = 'crd.audio.v1';
const SILENCE = 0.0001;
const LANGS = ['es', 'en'];

const DEFAULTS = Object.freeze({ muted: false, sfx: 0.8, musicOn: true, music: 0.3, voiceOn: true, voice: 0.9, lang: 'es' });

const level = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback);

function sanitize(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    muted: typeof source.muted === 'boolean' ? source.muted : DEFAULTS.muted,
    sfx: level(source.sfx, DEFAULTS.sfx),
    musicOn: typeof source.musicOn === 'boolean' ? source.musicOn : DEFAULTS.musicOn,
    music: level(source.music, DEFAULTS.music),
    voiceOn: typeof source.voiceOn === 'boolean' ? source.voiceOn : DEFAULTS.voiceOn,
    voice: level(source.voice, DEFAULTS.voice),
    lang: LANGS.includes(source.lang) ? source.lang : DEFAULTS.lang,
  };
}

class AudioEngine extends EventTarget {
  #ctx = null;
  #master = null;
  #sfx = null;
  #musicBus = null;
  #noise = null;
  #music = null;
  #hidden = false;
  #mood = 'alley';
  #tension = 0.12;
  #heartbeat = 0;
  #heartbeatStop = 0;
  #settings;
  voice;

  constructor() {
    super();
    const legacy = storage.read(LEGACY_KEY, null);
    const saved = storage.read(KEY, null) ?? (legacy ? { muted: legacy.muted === true } : null);
    this.#settings = sanitize(saved);
    this.voice = new DealerVoice(() => this.#settings);
  }

  get settings() {
    return { ...this.#settings };
  }

  get muted() {
    return this.#settings.muted;
  }

  get unlocked() {
    return this.#ctx !== null && this.#ctx.state === 'running';
  }

  update(patch) {
    this.#settings = sanitize({ ...this.#settings, ...patch });
    storage.write(KEY, this.#settings);
    this.#applyLevels();
    this.#syncMusic();
    if (this.#settings.muted || !this.#settings.voiceOn) this.voice.cancel();
    this.dispatchEvent(new Event('change'));
  }

  setMuted(muted) {
    this.update({ muted: Boolean(muted) });
  }

  say(key, params, options) {
    return this.voice.say(key, params, options);
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
      this.#master.connect(compressor).connect(ctx.destination);
      this.#sfx = ctx.createGain();
      this.#sfx.connect(this.#master);
      this.#musicBus = ctx.createGain();
      this.#musicBus.connect(this.#master);
      this.#applyLevels(true);

      // 2 s de ruido blanco reutilizable como fuente de fricción, barajeo y rodadura.
      const length = Math.floor(ctx.sampleRate * 2);
      this.#noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.#noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = randomFloat() * 2 - 1;

      this.#music = new NoirMusic(ctx, this.#musicBus, this.#mood);
      this.#music.setTension(this.#tension);
    }
    if (this.#ctx.state === 'suspended' && !this.#hidden) {
      this.#ctx.resume().then(() => this.#syncMusic(), () => {});
    }
    this.#syncMusic();
    return true;
  }

  // Con la pestaña oculta se suspende el contexto (ahorro de batería) y se detiene la música.
  setHidden(hidden) {
    this.#hidden = hidden;
    if (!this.#ctx) return;
    if (hidden) {
      this.#music?.stop();
      this.#ctx.suspend().catch(() => {});
    } else {
      this.#ctx.resume().then(() => this.#syncMusic(), () => {});
    }
  }

  #applyLevels(immediate = false) {
    if (!this.#ctx) return;
    const s = this.#settings;
    const now = this.#ctx.currentTime;
    const set = (param, value) => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, 0.04);
    };
    set(this.#master.gain, s.muted ? 0 : 1);
    set(this.#sfx.gain, s.sfx);
    set(this.#musicBus.gain, s.music);
  }

  #syncMusic() {
    if (!this.#music) return;
    const s = this.#settings;
    const wanted = s.musicOn && !s.muted && s.music > 0 && !this.#hidden && this.#ctx.state === 'running';
    if (wanted) this.#music.start();
    else this.#music.stop();
  }

  #ready() {
    return this.#ctx !== null && this.#ctx.state === 'running' && !this.#settings.muted && this.#settings.sfx > 0;
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
    src.connect(filter).connect(gain).connect(this.#sfx);
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
    osc.connect(gain).connect(this.#sfx);
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
    for (const [hit, amount] of [[0, 1], [0.042, 0.45]]) {
      this.#tone(t + hit, { freq: base, peak: 0.26 * amount, decay: 0.075 });
      this.#tone(t + hit, { freq: base * 1.53, peak: 0.18 * amount, decay: 0.05 });
      this.#noiseBurst(t + hit, { type: 'highpass', freq: 3500, attack: 0.001, peak: 0.22 * amount, decay: 0.014 });
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
    src.connect(band).connect(amp).connect(this.#sfx);
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
    gain.gain.setValueAtTime(0.06, Math.max(t + 0.15, t + duration - 0.2));
    gain.gain.exponentialRampToValueAtTime(SILENCE, t + duration);
    motor.connect(low).connect(gain).connect(this.#sfx);
    motor.start(t);
    motor.stop(t + duration + 0.05);
  }

  reelStop() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 150, freqEnd: 55, peak: 0.4, decay: 0.12 });
    this.#noiseBurst(t, { type: 'lowpass', freq: 500, q: 0.8, attack: 0.001, peak: 0.25, decay: 0.07 });
  }

  // Explosión de símbolos ganadores en la avalancha: estallido filtrado + golpe grave.
  explode(strength = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 1800, freqEnd: 300, q: 0.7, attack: 0.004, peak: 0.3 * strength, decay: 0.28 });
    this.#tone(t, { freq: 110, freqEnd: 42, peak: 0.35 * strength, decay: 0.2 });
    this.#noiseBurst(t + 0.02, { type: 'highpass', freq: 5200, attack: 0.001, peak: 0.12 * strength, decay: 0.12 });
  }

  // Caída de símbolos nuevos: golpecitos de madera escalonados.
  drop(count = 4) {
    if (!this.#ready()) return;
    const t = this.#time();
    for (let i = 0; i < count; i++) {
      this.#tone(t + i * 0.045, { type: 'triangle', freq: randomBetween(520, 700), freqEnd: 260, peak: 0.12, decay: 0.07 });
    }
  }

  // Escalón del multiplicador de cascada: tono ascendente según el nivel.
  cascade(step) {
    if (!this.#ready()) return;
    const t = this.#time();
    const base = [660, 880, 1046.5, 1318.5][Math.min(step, 3)];
    this.#tone(t, { type: 'triangle', freq: base, freqEnd: base * 1.5, attack: 0.01, peak: 0.14, decay: 0.22 });
    this.bell(base * 2, 0.08, 0.1);
  }

  // Brillo del multiplicador dorado: barrido de campanillas agudas.
  shimmer() {
    if (!this.#ready()) return;
    for (let i = 0; i < 7; i++) this.bell(1567.98 * 2 ** (i / 12), i * 0.05, 0.08);
  }

  // Campana armónica: parciales inarmónicos de una campana real (1, 2, 2.76, 4.07, 5.4).
  bell(freq = 880, delay = 0, peak = 0.22) {
    if (!this.#ready()) return;
    const t = this.#time(delay);
    const partials = [[1, 1, 1.6], [2, 0.5, 1.1], [2.76, 0.42, 0.9], [4.07, 0.24, 0.6], [5.4, 0.14, 0.4]];
    for (const [ratio, amount, decay] of partials) {
      this.#tone(t, { freq: freq * ratio, peak: peak * amount, decay });
    }
  }

  win(tier = 1) {
    if (!this.#ready()) return;
    const scale = [1046.5, 1318.5, 1568, 2093];
    if (tier <= 1) {
      this.bell(1318.5, 0, 0.18);
      this.bell(1975.5, 0.12, 0.14);
      return;
    }
    const rounds = tier >= 3 ? 3 : 1;
    for (let r = 0; r < rounds; r++) {
      scale.forEach((freq, i) => this.bell(freq, r * 0.6 + i * 0.1, 0.2));
    }
    if (tier >= 3) {
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

  // ---------- Atmósfera noir: estado de ánimo, tensión y efectos dramáticos ----------

  setMood(mood) {
    this.#mood = mood;
    this.#music?.setMood(mood);
  }

  setTension(value) {
    this.#tension = Math.min(1, Math.max(0, value));
    this.#music?.setTension(this.#tension);
  }

  // Latido grave «lub-dub».
  heartbeat(strength = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 62, freqEnd: 40, attack: 0.008, peak: 0.5 * strength, decay: 0.2 });
    this.#tone(t + 0.21, { freq: 55, freqEnd: 36, attack: 0.008, peak: 0.34 * strength, decay: 0.22 });
  }

  // Latido continuo mientras dura una jugada crítica (con tope de seguridad).
  startHeartbeat(bpm = 84, maxSeconds = 14) {
    this.stopHeartbeat();
    this.heartbeat(1);
    this.#heartbeat = setInterval(() => this.heartbeat(0.9), 60000 / bpm);
    this.#heartbeatStop = setTimeout(() => this.stopHeartbeat(), maxSeconds * 1000);
  }

  stopHeartbeat() {
    clearInterval(this.#heartbeat);
    clearTimeout(this.#heartbeatStop);
    this.#heartbeat = 0;
  }

  // Subida de ruido filtrado que anticipa un desenlace.
  riser(duration = 1.6) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 300, freqEnd: 4200, q: 1.2, attack: duration * 0.85, peak: 0.16, decay: duration * 0.15 });
    this.#tone(t, { type: 'sawtooth', freq: 110, freqEnd: 440, attack: duration * 0.8, peak: 0.035, decay: duration * 0.2 });
  }

  // Acorde disonante de tensión (tritono) al empezar una jugada crítica.
  sting() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (const [freq, peak] of [[155.6, 0.14], [220, 0.1], [311.1, 0.09], [329.6, 0.05]]) {
      this.#tone(t, { type: 'triangle', freq, attack: 0.02, peak, decay: 1.4 });
    }
  }

  // Golpe de impacto para una victoria crítica.
  impact() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 80, freqEnd: 34, attack: 0.004, peak: 0.6, decay: 1.1 });
    this.#noiseBurst(t, { type: 'lowpass', freq: 1200, freqEnd: 200, q: 0.7, attack: 0.003, peak: 0.35, decay: 0.7 });
    this.bell(1568, 0.08, 0.16);
    this.bell(2093, 0.2, 0.12);
  }

  // Derrota severa: acorde grave menor que se hunde.
  doom() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (const [freq, peak] of [[55, 0.3], [65.4, 0.2], [77.8, 0.16]]) {
      this.#tone(t, { type: 'sawtooth', freq, freqEnd: freq * 0.94, attack: 0.03, peak: peak * 0.4, decay: 2.2 });
    }
    this.#noiseBurst(t, { type: 'lowpass', freq: 400, q: 0.7, attack: 0.01, peak: 0.2, decay: 0.9 });
  }

  // Fanfarria de metales sintetizados para la libertad.
  fanfare() {
    if (!this.#ready()) return;
    const t = this.#time();
    const chords = [[277.2, 349.2, 415.3], [370, 466.2, 554.4], [415.3, 523.3, 622.3], [277.2, 349.2, 415.3, 554.4]];
    chords.forEach((chord, i) => {
      const at = t + i * 0.42;
      const length = i === chords.length - 1 ? 2.4 : 0.38;
      for (const freq of chord) this.#tone(at, { type: 'sawtooth', freq, attack: 0.04, peak: 0.05, decay: length });
    });
    this.win(3);
  }

  // Tecla de máquina de escribir para los textos cinemáticos.
  typeTick() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { type: 'highpass', freq: 3000, q: 0.7, attack: 0.001, peak: 0.05, decay: 0.018 });
    this.#tone(t, { type: 'square', freq: 180 + randomFloat() * 60, attack: 0.001, peak: 0.02, decay: 0.02 });
  }

  // Barrido de aire para las transiciones entre zonas.
  whoosh() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 200, freqEnd: 3000, q: 0.8, attack: 0.45, peak: 0.2, decay: 0.6 });
  }

  // Zumbido eléctrico de neón al encenderse.
  neonBuzz() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (let i = 0; i < 4; i++) {
      this.#tone(t + i * 0.09 + randomFloat() * 0.04, { type: 'sawtooth', freq: 120, attack: 0.005, peak: 0.03, decay: 0.06 });
    }
  }
}

export const audio = new AudioEngine();
