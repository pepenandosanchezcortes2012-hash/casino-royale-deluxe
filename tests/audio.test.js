// Pruebas del sonido: preferencias independientes de música y efectos, y la teoría musical del
// motor de música de fondo (tempo, voicings, conducción de voces y registro del bajo).
// Ejecutar con: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSoundPrefs, saveSoundPref, SOUND_KEYS, MUSIC_LEVEL, SFX_LEVEL, loadMix, MIX_KEYS, DEFAULT_VOLUME } from '../js/audio.js';
import { splitPhrases, speakable, pickVoice, profileFor, PROFILES } from '../js/voice.js';
import { Settings, lowEndDevice } from '../js/settings.js';
import { MOODS, QUALITIES, VOICE_WINDOW, BASS_WINDOW, FADE_IN, FADE_OUT, chordTones, voiceLead, bassRoot } from '../js/engine/music.js';

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  return {
    map,
    read: (key, fallback = null) => (map.has(key) ? JSON.parse(map.get(key)) : fallback),
    write: (key, value) => map.set(key, JSON.stringify(value)),
    remove: (key) => map.delete(key),
  };
}

test('Preferencias: música y efectos encendidos por defecto y guardados por separado', () => {
  const store = memoryStore();
  assert.deepEqual(loadSoundPrefs(store), { music: true, sfx: true });
  assert.equal(store.read(SOUND_KEYS.music), 'on');
  assert.equal(store.read(SOUND_KEYS.sfx), 'on');
  saveSoundPref(store, 'music', false);
  assert.deepEqual(loadSoundPrefs(store), { music: false, sfx: true }, 'apagar la música no toca los efectos');
  saveSoundPref(store, 'sfx', false);
  saveSoundPref(store, 'music', true);
  assert.deepEqual(loadSoundPrefs(store), { music: true, sfx: false });
  assert.notEqual(SOUND_KEYS.music, SOUND_KEYS.sfx);
});

test('Preferencias: se migran desde el panel de sonido anterior y se borra la clave vieja', () => {
  const muted = memoryStore({ 'crd.audio.v2': { muted: true, sfx: 0.8, musicOn: true, music: 0.3, voiceOn: true } });
  assert.deepEqual(loadSoundPrefs(muted), { music: false, sfx: false });
  assert.equal(muted.map.has('crd.audio.v2'), false);
  const noMusic = memoryStore({ 'crd.audio.v2': { muted: false, sfx: 0.6, musicOn: false, music: 0.3 } });
  assert.deepEqual(loadSoundPrefs(noMusic), { music: false, sfx: true });
  // Si ya hay preferencias nuevas, mandan sobre las antiguas.
  const both = memoryStore({ 'crd.bgm.v1': 'on', 'crd.sfx.v1': 'off', 'crd.audio.v2': { muted: true } });
  assert.deepEqual(loadSoundPrefs(both), { music: true, sfx: false });
});

test('Mezcla: la música queda de fondo, por debajo de los efectos, con fundidos suaves', () => {
  assert.ok(MUSIC_LEVEL < SFX_LEVEL / 2, 'la música no debe tapar fichas y cartas');
  assert.ok(FADE_IN >= 2 && FADE_OUT >= 1);
});

test('Música: tempo pausado (65–75 BPM) y progresiones de 8 compases en todas las zonas', () => {
  for (const [name, mood] of Object.entries(MOODS)) {
    assert.ok(mood.tempo >= 65 && mood.tempo <= 75, `${name}: ${mood.tempo} BPM`);
    assert.equal(mood.progression.length, 8, name);
    for (const [degree, quality] of mood.progression) {
      assert.ok(Number.isInteger(degree) && degree >= 0 && degree < 12);
      assert.ok(QUALITIES[quality], `${name}: calidad ${quality}`);
    }
    assert.ok(mood.swing > 0.5 && mood.swing < 0.7, 'swing ligero');
  }
});

test('Música: voicings cerrados en el registro medio con conducción de voces suave', () => {
  const [low, high] = VOICE_WINDOW;
  for (const [name, mood] of Object.entries(MOODS)) {
    let previous = null;
    const moves = [];
    // Dos vueltas a la progresión para incluir el paso del último acorde al primero.
    for (const spec of [...mood.progression, ...mood.progression]) {
      const tones = chordTones(mood.tonic, spec);
      const voicing = voiceLead(tones, previous);
      assert.equal(voicing.length, 4, name);
      assert.equal(new Set(voicing).size, 4, `${name}: notas repetidas`);
      assert.ok(voicing[0] >= low && voicing[3] <= high, `${name}: fuera de registro ${voicing}`);
      assert.ok(voicing[3] - voicing[0] <= 16, `${name}: voicing demasiado abierto ${voicing}`);
      assert.deepEqual([...voicing.map((m) => m % 12)].sort(), [...tones].sort(), `${name}: tonos del acorde`);
      if (previous) voicing.forEach((m, i) => moves.push(Math.abs(m - previous[i])));
      previous = voicing;
    }
    const average = moves.reduce((a, b) => a + b, 0) / moves.length;
    assert.ok(Math.max(...moves) <= 7, `${name}: salto de ${Math.max(...moves)} semitonos`);
    assert.ok(average <= 3, `${name}: movimiento medio ${average.toFixed(2)}`);
  }
});

test('Música: el contrabajo se mueve entre C2 y B2, con quinta y aproximaciones en registro', () => {
  const [low, high] = BASS_WINDOW;
  for (const mood of Object.values(MOODS)) {
    for (const spec of mood.progression) {
      const root = bassRoot(mood.tonic, spec);
      assert.ok(root >= 36 && root <= 47, `fundamental ${root}`);
      const fifth = root + 7 <= high ? root + 7 : root - 5;
      for (const note of [root, fifth, root - 1, root + 1]) assert.ok(note >= low && note <= high, `nota ${note}`);
    }
  }
});

test('Mezcla: volumen general (0–1, por defecto 0,8) y silencio guardados y saneados', () => {
  const store = memoryStore();
  assert.deepEqual(loadMix(store), { volume: DEFAULT_VOLUME, muted: false });
  store.write(MIX_KEYS.volume, 3);
  store.write(MIX_KEYS.muted, true);
  assert.deepEqual(loadMix(store), { volume: 1, muted: true });
  store.write(MIX_KEYS.volume, 'nada');
  assert.equal(loadMix(store).volume, DEFAULT_VOLUME);
});

test('Voz: texto apto para leer, frases con pausas naturales y perfil por anfitrión', () => {
  assert.equal(speakable('«Hola» ×8 y +10 🔒 & más'), 'Hola por 8 y más 10 y más');
  const phrases = splitPhrases('Piso dos: La Bahía Arcade. ¡Alerta, Kraken!');
  assert.deepEqual(phrases.map((p) => p.text), ['Piso dos:', 'La Bahía Arcade.', '¡Alerta,', 'Kraken!']);
  assert.deepEqual(phrases.map((p) => p.pause), [220, 320, 140, 320]);
  assert.deepEqual(splitPhrases('...'), []);
  assert.ok(profileFor('SIBILA').pitch < profileFor('Vera').pitch, 'SIBILA más grave que Vera');
  assert.equal(profileFor('desconocido'), PROFILES.Narrador);
  for (const profile of Object.values(PROFILES)) {
    assert.ok(profile.pitch > 0 && profile.pitch <= 2);
    assert.ok(profile.rate >= 0.5 && profile.rate <= 1.5);
  }
  const voices = [{ name: 'English', lang: 'en-US' }, { name: 'Sabina', lang: 'es-MX', localService: true }, { name: 'Google español', lang: 'es-ES' }];
  assert.equal(pickVoice(voices).name, 'Google español');
  assert.equal(pickVoice([{ name: 'English', lang: 'en-US' }]), null);
});

test('Modo ligero: automático en equipos modestos, elegible y apaga lluvia y scanlines', () => {
  assert.equal(lowEndDevice({ hardwareConcurrency: 4, deviceMemory: 8 }), true);
  assert.equal(lowEndDevice({ hardwareConcurrency: 8, deviceMemory: 2 }), true);
  assert.equal(lowEndDevice({ hardwareConcurrency: 8 }), false);
  const weak = new Settings({ store: memoryStore(), lowEnd: true });
  assert.equal(weak.lite, true);
  assert.equal(weak.liteAuto, true);
  assert.equal(weak.matrix, false);
  assert.equal(weak.scanlines, false);
  weak.setLite(false);
  assert.equal(weak.liteAuto, false);
  assert.equal(weak.matrix, true);
  const strong = new Settings({ store: memoryStore(), lowEnd: false });
  assert.equal(strong.lite, false);
});
