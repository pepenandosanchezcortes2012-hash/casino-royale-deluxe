// Motor de audio procedural con Web Audio API: ningún archivo de audio externo y ninguna voz.
// Dos buses independientes: efectos de juego (SFX, con capa chiptune para la interfaz) y música
// de fondo lounge/jazz (BGM), cada uno con su interruptor, más un volumen general y un silencio
// rápido.
// El contexto se crea y se reanuda tras el primer gesto del usuario (política de autoplay).

import { storage } from './storage.js';
import { randomFloat, randomBetween } from './engine/rng.js';
import { LoungeBgm } from './engine/music.js';

export const SOUND_KEYS = Object.freeze({ music: 'crd.bgm.v1', sfx: 'crd.sfx.v1' });
export const MIX_KEYS = Object.freeze({ volume: 'crd.volume.v1', muted: 'crd.mute.v1' });
export const DEFAULT_VOLUME = 0.8;
const LEGACY_KEYS = Object.freeze(['crd.audio.v2', 'crd.audio.v1']);
// Niveles de mezcla: la música queda de fondo, por debajo de fichas y cartas.
export const MUSIC_LEVEL = 0.3;
export const SFX_LEVEL = 0.85;
const SILENCE = 0.0001;

// Preferencias de sonido: música y efectos se guardan por separado ('on' / 'off').
// Si solo existe el panel de sonido antiguo (un objeto con silencio y volúmenes), se migra.
export function loadSoundPrefs(store = storage) {
  const read = (key) => {
    const value = store.read(key, null);
    return value === 'on' ? true : value === 'off' ? false : null;
  };
  let music = read(SOUND_KEYS.music);
  let sfx = read(SOUND_KEYS.sfx);
  if (music === null || sfx === null) {
    const legacy = LEGACY_KEYS.map((key) => store.read(key, null)).find((value) => value && typeof value === 'object');
    if (legacy) {
      const muted = legacy.muted === true;
      if (music === null) music = !muted && legacy.musicOn !== false && legacy.music !== 0;
      if (sfx === null) sfx = !muted && legacy.sfx !== 0;
    }
  }
  const prefs = { music: music ?? true, sfx: sfx ?? true };
  saveSoundPref(store, 'music', prefs.music);
  saveSoundPref(store, 'sfx', prefs.sfx);
  for (const key of LEGACY_KEYS) store.remove(key);
  return prefs;
}

export function saveSoundPref(store, kind, on) {
  store.write(SOUND_KEYS[kind], on ? 'on' : 'off');
}

// Volumen general (0–1) y silencio rápido.
export function loadMix(store = storage) {
  const raw = Number(store.read(MIX_KEYS.volume, DEFAULT_VOLUME));
  const volume = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : DEFAULT_VOLUME;
  return { volume, muted: store.read(MIX_KEYS.muted, false) === true };
}

class AudioEngine extends EventTarget {
  #ctx = null;
  #master = null;
  #sfx = null;
  #musicBus = null;
  #noise = null;
  #bgm = null;
  #hidden = false;
  #mood = 'alley';
  #tension = 0.12;
  #heartbeat = 0;
  #heartbeatStop = 0;
  #prefs;
  #mix;

  constructor() {
    super();
    this.#prefs = loadSoundPrefs(storage);
    this.#mix = loadMix(storage);
  }

  get prefs() {
    return { ...this.#prefs };
  }

  // Volumen general efectivo (0 con el silencio activo).
  get level() {
    return this.#mix.muted ? 0 : this.#mix.volume;
  }

  get volume() {
    return this.#mix.volume;
  }

  get muted() {
    return this.#mix.muted;
  }

  setVolume(value) {
    const volume = Math.min(1, Math.max(0, Number(value) || 0));
    if (volume === this.#mix.volume && !(this.#mix.muted && volume > 0)) return;
    // Subir el volumen desde el silencio lo desactiva.
    this.#mix = { volume, muted: volume > 0 ? false : this.#mix.muted };
    storage.write(MIX_KEYS.volume, volume);
    storage.write(MIX_KEYS.muted, this.#mix.muted);
    this.#applyLevels();
    this.dispatchEvent(new Event('change'));
  }

  setMuted(muted) {
    const value = Boolean(muted);
    if (value === this.#mix.muted) return;
    this.#mix = { ...this.#mix, muted: value };
    storage.write(MIX_KEYS.muted, value);
    this.#applyLevels();
    this.dispatchEvent(new Event('change'));
  }

  toggleMute() {
    this.setMuted(!this.#mix.muted);
    return this.#mix.muted;
  }


  get unlocked() {
    return this.#ctx !== null && this.#ctx.state === 'running';
  }

  setMusic(on) {
    this.#setPref('music', on);
  }

  setSfx(on) {
    this.#setPref('sfx', on);
  }

  toggleMusic() {
    this.setMusic(!this.#prefs.music);
    return this.#prefs.music;
  }

  toggleSfx() {
    this.setSfx(!this.#prefs.sfx);
    return this.#prefs.sfx;
  }

  #setPref(kind, on) {
    const value = Boolean(on);
    if (this.#prefs[kind] === value) return;
    this.#prefs = { ...this.#prefs, [kind]: value };
    saveSoundPref(storage, kind, value);
    this.#applyLevels();
    this.#syncMusic();
    this.dispatchEvent(new Event('change'));
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

      this.#bgm = new LoungeBgm(ctx, this.#musicBus, this.#mood);
      this.#bgm.setTension(this.#tension);
    }
    if (this.#ctx.state === 'suspended' && !this.#hidden) {
      this.#ctx.resume().then(() => this.#syncMusic(), () => {});
    }
    this.#syncMusic();
    return true;
  }

  // Con la pestaña oculta se detiene la música y se suspende el contexto (ahorro de batería).
  setHidden(hidden) {
    this.#hidden = hidden;
    if (!this.#ctx) return;
    if (hidden) {
      this.#bgm?.stop();
      this.#ctx.suspend().catch(() => {});
    } else {
      this.#ctx.resume().then(() => this.#syncMusic(), () => {});
    }
  }

  #applyLevels(immediate = false) {
    if (!this.#ctx) return;
    const now = this.#ctx.currentTime;
    const set = (param, value) => {
      if (immediate) param.value = value;
      else param.setTargetAtTime(value, now, 0.04);
    };
    set(this.#master.gain, this.level);
    set(this.#sfx.gain, this.#prefs.sfx ? SFX_LEVEL : 0);
    // El encendido y apagado de la música lo hace el propio motor con sus fundidos.
    set(this.#musicBus.gain, MUSIC_LEVEL);
  }

  #syncMusic() {
    if (!this.#bgm) return;
    const wanted = this.#prefs.music && !this.#hidden && this.#ctx.state === 'running';
    if (wanted) this.#bgm.start();
    else this.#bgm.stop();
  }

  #ready() {
    return this.#ctx !== null && this.#ctx.state === 'running' && this.#prefs.sfx;
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

  // ---------- Capa chiptune de la interfaz (onda cuadrada, cortes secos) ----------

  // Clic de interfaz: un «blip» corto de onda cuadrada.
  click() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'square', freq: 1568, attack: 0.001, peak: 0.035, decay: 0.028 });
    this.#tone(t + 0.022, { type: 'square', freq: 2093, attack: 0.001, peak: 0.025, decay: 0.02 });
  }

  // Aviso: dos notas descendentes (acción bloqueada, saldo insuficiente…).
  alert() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'square', freq: 880, attack: 0.002, peak: 0.05, decay: 0.07 });
    this.#tone(t + 0.09, { type: 'square', freq: 622.3, attack: 0.002, peak: 0.05, decay: 0.1 });
  }

  // Error: zumbido grave y corto.
  error() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'square', freq: 146.8, freqEnd: 110, attack: 0.003, peak: 0.06, decay: 0.16 });
  }

  // Recompensa: arpegio mayor ascendente; `tier` alarga y agudiza el arpegio (1–3).
  reward(tier = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    const notes = [523.3, 659.3, 784, 1046.5, 1318.5, 1568].slice(0, 2 + Math.min(3, Math.max(1, tier)) + 1);
    notes.forEach((freq, i) => this.#tone(t + i * 0.055, { type: 'square', freq, attack: 0.002, peak: 0.04, decay: i === notes.length - 1 ? 0.24 : 0.06 }));
  }

  // Ascensor del Sindicato: barrido de aire y un arpegio que sube un escalón por piso.
  floorUp(level = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 300, freqEnd: 2400, q: 0.9, attack: 0.3, peak: 0.12, decay: 0.4 });
    const base = [392, 440, 523.3, 587.3][Math.min(3, Math.max(0, level - 1))];
    [1, 1.25, 1.5, 2].forEach((ratio, i) => this.#tone(t + 0.35 + i * 0.08, { type: 'square', freq: base * ratio, attack: 0.002, peak: 0.035, decay: i === 3 ? 0.3 : 0.07 }));
  }


  // ---------- Ambiente: zona de la música, tensión y efectos dramáticos ----------

  // Cada zona tiene su tonalidad y su progresión lounge; el cambio entra en el siguiente compás.
  setMood(mood) {
    this.#mood = mood;
    this.#bgm?.setMood(mood);
  }

  // Con tensión alta la música se aparta para que se oigan el latido y el desenlace.
  setTension(value) {
    this.#tension = Math.min(1, Math.max(0, value));
    this.#bgm?.setTension(this.#tension);
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

  // ---------- Cripto-Casino ----------

  // Clavija de Plinko: golpecito de cristal cuyo tono sube hacia los extremos (`side` en -1…1).
  plinkoPeg(side = 0) {
    if (!this.#ready()) return;
    const t = this.#time();
    const freq = 1500 + Math.abs(side) * 1100 + randomFloat() * 80;
    this.#tone(t, { type: 'triangle', freq, peak: 0.045, decay: 0.05 });
    this.#noiseBurst(t, { type: 'highpass', freq: 5200, attack: 0.001, peak: 0.025, decay: 0.012 });
  }

  // Bola en la cubeta: golpe amortiguado y campanilla según el multiplicador.
  plinkoLand(multiplier = 1) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 240, freqEnd: 90, peak: 0.12, decay: 0.12 });
    if (multiplier >= 10) this.bell(1568, 0.02, 0.16);
    else if (multiplier >= 1) this.bell(1046.5, 0.02, 0.08);
  }

  // Motor del cohete de Crash: ruido filtrado y un zumbido grave que suben con el multiplicador.
  // Devuelve un control { update(multiplicador), stop() }.
  rocket() {
    if (!this.#ready()) return { update() {}, stop() {} };
    const ctx = this.#ctx;
    const t = this.#time();
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.4;
    band.frequency.value = 380;
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 52;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 260;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(SILENCE, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.35);
    src.connect(band).connect(gain);
    hum.connect(low).connect(gain);
    gain.connect(this.#sfx);
    src.start(t);
    hum.start(t);
    let stopped = false;
    return {
      update: (multiplier) => {
        if (stopped) return;
        const now = ctx.currentTime;
        const lift = Math.min(1, Math.log(Math.max(1, multiplier)) / Math.log(20));
        band.frequency.setTargetAtTime(380 + lift * 2600, now, 0.12);
        hum.frequency.setTargetAtTime(52 + lift * 140, now, 0.12);
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        const now = ctx.currentTime;
        gain.gain.cancelScheduledValues(now);
        gain.gain.setTargetAtTime(SILENCE, now, 0.05);
        src.stop(now + 0.3);
        hum.stop(now + 0.3);
      },
    };
  }

  // Explosión del cohete: estallido grave con cola de ruido.
  crashBoom() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { type: 'lowpass', freq: 2200, freqEnd: 120, q: 0.7, attack: 0.003, peak: 0.5, decay: 0.9 });
    this.#tone(t, { freq: 75, freqEnd: 28, attack: 0.004, peak: 0.55, decay: 0.7 });
    this.#noiseBurst(t + 0.03, { type: 'highpass', freq: 5000, attack: 0.001, peak: 0.14, decay: 0.3 });
  }

  // Retiro a tiempo: cascada de fichas y tintineo ascendente.
  cashout() {
    if (!this.#ready()) return;
    for (let i = 0; i < 6; i++) this.chip(i * 0.05);
    this.bell(1318.5, 0.05, 0.14);
    this.bell(1760, 0.16, 0.12);
  }

  // Alarma del Radar de Crash: dos pitidos agudos.
  radar() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (const at of [0, 0.16]) this.#tone(t + at, { type: 'square', freq: 1760, attack: 0.003, peak: 0.05, decay: 0.08 });
  }

  // Gema descubierta: cristal cuyo tono sube con cada acierto seguido.
  gem(step = 0) {
    if (!this.#ready()) return;
    const freq = 880 * 2 ** (Math.min(step, 24) / 12);
    this.bell(freq, 0, 0.1);
    this.#tone(this.#time(0.02), { freq: freq * 2, peak: 0.035, decay: 0.2 });
  }

  // Mina: detonación seca con metralla.
  mine() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 2400, freqEnd: 180, q: 0.6, attack: 0.002, peak: 0.45, decay: 0.5 });
    this.#tone(t, { freq: 95, freqEnd: 28, attack: 0.003, peak: 0.6, decay: 0.45 });
    this.#noiseBurst(t + 0.02, { type: 'highpass', freq: 6000, attack: 0.001, peak: 0.16, decay: 0.25 });
  }

  // Dados: traqueteo en el cubilete y golpe final sobre el tapete.
  diceRoll(duration = 0.5) {
    if (!this.#ready()) return;
    const t = this.#time();
    const hits = Math.max(4, Math.round(duration * 22));
    for (let i = 0; i < hits; i++) {
      const at = t + (i / hits) * duration + randomFloat() * 0.012;
      this.#noiseBurst(at, { freq: randomBetween(1800, 3400), q: 2.2, attack: 0.001, peak: 0.1, decay: 0.022 });
    }
    this.#tone(t + duration, { type: 'triangle', freq: 320, freqEnd: 140, peak: 0.12, decay: 0.08 });
  }

  // Piso seguro de la torre: nota que sube con la altura y golpe de madera.
  towerStep(floor = 0) {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'triangle', freq: 440 * 2 ** (floor / 12 * 2), peak: 0.1, decay: 0.18 });
    this.#tone(t, { freq: 180, freqEnd: 90, peak: 0.1, decay: 0.06 });
  }

  // Trampa de la torre: caída al vacío y golpe sordo.
  trap() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { freq: 2600, freqEnd: 200, q: 0.9, attack: 0.02, peak: 0.2, decay: 0.55 });
    this.#tone(t + 0.45, { freq: 70, freqEnd: 30, attack: 0.004, peak: 0.5, decay: 0.4 });
  }

  // Botón HOLD del video póker: clic mecánico.
  hold() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'square', freq: 1200, peak: 0.04, decay: 0.02 });
    this.#noiseBurst(t, { type: 'highpass', freq: 3800, attack: 0.001, peak: 0.08, decay: 0.015 });
  }

  // Rueda de la fortuna: tic del puntero contra cada clavo.
  wheelTick() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'square', freq: 2300 + randomFloat() * 200, peak: 0.035, decay: 0.014 });
    this.#noiseBurst(t, { type: 'highpass', freq: 4200, attack: 0.001, peak: 0.05, decay: 0.01 });
  }

  // Cofre: traqueteo de madera mientras tiembla.
  chestShake() {
    if (!this.#ready()) return;
    const t = this.#time();
    for (let i = 0; i < 14; i++) {
      const at = t + i * 0.09 + randomFloat() * 0.02;
      this.#tone(at, { type: 'triangle', freq: randomBetween(140, 220), freqEnd: 90, peak: 0.08 + i * 0.006, decay: 0.05 });
    }
    this.riser(1.3);
  }

  // Cofre abierto: crujido de bisagra y destello.
  chestOpen() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { type: 'sawtooth', freq: 190, freqEnd: 95, attack: 0.02, peak: 0.04, decay: 0.3 });
    this.#noiseBurst(t, { freq: 800, freqEnd: 5000, q: 0.8, attack: 0.05, peak: 0.16, decay: 0.3 });
    this.shimmer();
  }

  // Revelado de una reliquia: arpegio más largo cuanto más rara.
  relicReveal(rarity = 'common') {
    if (!this.#ready()) return;
    const notes = { common: 2, rare: 3, epic: 4, legendary: 6 }[rarity] ?? 2;
    const scale = [1046.5, 1318.5, 1568, 2093, 2637, 3136];
    for (let i = 0; i < notes; i++) this.bell(scale[i], i * 0.09, 0.14);
    if (rarity === 'legendary') this.fanfare();
  }

  // Subida de nivel: arpegio mayor brillante con fichas.
  levelUp() {
    if (!this.#ready()) return;
    [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => this.bell(freq * 2, i * 0.08, 0.16));
    for (let i = 0; i < 4; i++) this.chip(0.4 + i * 0.06);
  }

  // Abundancia: marimba suave de dos notas.
  abundance() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#tone(t, { freq: 783.99, attack: 0.004, peak: 0.07, decay: 0.28 });
    this.#tone(t + 0.1, { freq: 1174.66, attack: 0.004, peak: 0.055, decay: 0.34 });
    this.#noiseBurst(t, { type: 'bandpass', freq: 2400, q: 3, attack: 0.001, peak: 0.03, decay: 0.02 });
  }

  // Interferencia digital para los efectos de glitch.
  glitch() {
    if (!this.#ready()) return;
    const t = this.#time();
    this.#noiseBurst(t, { type: 'highpass', freq: 2800, q: 3, attack: 0.001, peak: 0.07, decay: 0.05 });
    this.#tone(t, { type: 'square', freq: randomBetween(200, 900), peak: 0.025, decay: 0.04 });
  }
}

export const audio = new AudioEngine();
