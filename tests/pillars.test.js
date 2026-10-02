// Pruebas de los 4 pilares: chiptune reactivo, trofeos y tienda, PWA y Salón de la Fama, piso 5
// (jefe) y desafíos diarios.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createStorage } from '../js/storage.js';
import { crashArp, scaleNotes, triad, TOWER_MOODS, MODES, SCENES } from '../js/engine/chiptune.js';
import { Trophies, TROPHIES, TROPHIES_KEY, SPECIES_IDS, TABLE_IDS } from '../js/arcade/trophies.js';
import { Shop, SHOP_ITEMS, SHOP_KEY } from '../js/arcade/shop.js';
import { HallOfFame, HOF_SIZE, cleanInitials, HOF_FORMAT } from '../js/arcade/hall-of-fame.js';
import { Daily, dailyFor, CHALLENGES, MODIFIERS, DAILY_COUNT, localDay, challengeById } from '../js/arcade/daily.js';
import { BossBattle, BOSS_HP, PLAYER_LIVES, phaseFor, bossScore } from '../js/arcade/boss-battle.js';
import { PLANE_SKINS, planeFrames, SVG_SPRITES } from '../js/ui/pixel-sprites.js';
import { precacheList, serviceWorker, ICONS, gridPng } from '../tools/build-pwa.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const store = () => createStorage(null);

// Monedero mínimo para la tienda.
function fakeWallet(balance) {
  return {
    balance,
    spend(amount) {
      if (amount > this.balance) return false;
      this.balance -= amount;
      return true;
    },
    canAfford(amount) {
      return amount <= this.balance;
    },
  };
}

// ---------- Pilar 1: música chiptune ----------

test('Chiptune: el arpegio de Crash acelera y sube de tono con el multiplicador, con techo', () => {
  assert.deepEqual(crashArp(1), { bpm: 118, transpose: 0, hats: false });
  const x2 = crashArp(2);
  const x10 = crashArp(10);
  const x1000 = crashArp(1000);
  assert.ok(x2.bpm > 118 && x10.bpm > x2.bpm, 'el tempo sube');
  assert.ok(x10.transpose > x2.transpose, 'el tono sube');
  assert.equal(x2.hats, true);
  assert.equal(x1000.bpm, 260);
  assert.equal(x1000.transpose, 15);
  assert.deepEqual(crashArp('nada'), crashArp(1));
});

test('Chiptune: escalas, tríadas y ambientes de la torre bien formados', () => {
  assert.deepEqual(scaleNotes(60, 'major', 1), [60, 62, 64, 65, 67, 69, 71]);
  assert.deepEqual(triad(57, 'minor', 0), [57, 60, 64]);
  for (const [mood, m] of Object.entries(TOWER_MOODS)) {
    assert.ok(MODES[m.mode], `${mood}: modo`);
    assert.ok(m.bpm >= 80 && m.bpm <= 140, `${mood}: tempo`);
    assert.equal(m.chords.length, 4);
  }
  assert.deepEqual(SCENES, ['tower', 'fish', 'crash', 'boss']);
  for (const mood of ['alley', 'neon', 'gameover', 'penthouse', 'finale']) assert.ok(TOWER_MOODS[mood], mood);
});

test('Chiptune: sin osciladores vivos, música parada con la pestaña oculta y panel de mezcla', () => {
  const source = read('js/engine/chiptune.js');
  assert.match(source, /osc\.stop\(t \+ duration/);
  assert.match(source, /clearInterval\(this\.#timer\)/);
  const audio = read('js/audio.js');
  assert.match(audio, /setHidden\(hidden\) \{[\s\S]*this\.#bgm\?\.stop\(\);[\s\S]*suspend\(\)/);
  assert.match(audio, /setBusVolume\(kind, value\)/);
  for (const sfx of ['coin(', 'danger()', 'crashBoom()', 'click()']) assert.ok(audio.includes(`  ${sfx}`), sfx);
  const html = read('index.html');
  assert.match(html, /id="btn-sound-panel"[^>]*aria-controls="sound-panel"/);
  for (const id of ['vol-music', 'vol-sfx', 'panel-mute']) assert.match(html, new RegExp(`id="${id}"`), id);
});

// ---------- Pilar 2: trofeos y tienda ----------

test('Trofeos: 12 con medalla, progreso y desbloqueo único que persiste', () => {
  assert.equal(TROPHIES.length, 12);
  for (const item of TROPHIES) {
    assert.ok(SVG_SPRITES[`medal-${item.tier}`], `${item.id}: medalla`);
    assert.ok(item.goal >= 1);
  }
  const s = store();
  const t = new Trophies({ store: s, now: () => 1000 });
  const unlocked = [];
  t.addEventListener('unlock', (event) => unlocked.push(event.detail.trophy.id));
  t.recordRound({ game: 'crash', stake: 10, returned: 120, tags: [] });
  assert.equal(t.progress('ace-pilot').value, 12);
  assert.equal(t.isUnlocked('ace-pilot'), false);
  t.recordRound({ game: 'crash', stake: 10, returned: 160, tags: [] });
  assert.ok(t.isUnlocked('ace-pilot'));
  for (const species of SPECIES_IDS) t.recordRound({ game: 'fish', stake: 1, returned: 2, tags: [`fish-${species}`, 'fish-capture'] });
  assert.ok(t.isUnlocked('marine-biologist'));
  t.recordRound({ game: 'slots', stake: 1, returned: 150, tags: [] });
  assert.ok(t.isUnlocked('jackpot'));
  t.bump('victories');
  t.bump('signatures');
  assert.deepEqual(unlocked, ['ace-pilot', 'marine-biologist', 'jackpot', 'grade-hacker', 'legend']);
  t.recordRound({ game: 'crash', stake: 10, returned: 500, tags: [] });
  assert.equal(unlocked.length, 5, 'lo desbloqueado no se repite');
  const again = new Trophies({ store: s });
  assert.equal(again.unlockedCount, 5);
  assert.ok(again.isUnlocked('legend'));
  assert.equal(again.progress('tourist').value, 3);
  for (const game of TABLE_IDS) again.recordRound({ game, stake: 1, returned: 0, tags: [] });
  assert.ok(again.isUnlocked('tourist'));
  s.write(TROPHIES_KEY, { stats: { rounds: 'x', species: ['dragón', 'neon'] }, unlocked: { falso: 1 } });
  const clean = new Trophies({ store: s });
  assert.equal(clean.stats.rounds, 0);
  assert.deepEqual(clean.stats.species, ['neon']);
  assert.equal(clean.unlockedCount, 0);
});

test('Tienda: 3 skins de avión y 3 paletas de pago, compra atómica y lo comprado es permanente', () => {
  assert.deepEqual(SHOP_ITEMS.filter((i) => i.kind === 'plane').map((i) => i.id), ['fighter', 'prop', 'ship', 'cyberbird']);
  assert.deepEqual(SHOP_ITEMS.filter((i) => i.kind === 'palette').map((i) => i.id), ['classic', 'neon', 'amber', 'gameboy']);
  for (const skin of PLANE_SKINS) {
    const frames = planeFrames(skin);
    assert.equal(frames.length, 2, skin);
    // Anima cambiando celdas (hélice, alas, llama) o colores (postquemador de la nave).
    assert.ok(String(frames[0].grid.cells) !== String(frames[1].grid.cells) || String(frames[0].palette) !== String(frames[1].palette), `${skin}: anima`);
  }
  const s = store();
  const shop = new Shop({ store: s });
  assert.equal(shop.equipped('plane'), 'fighter');
  assert.equal(shop.equipped('palette'), 'classic');
  const poor = fakeWallet(100);
  assert.equal(shop.buy('ship', poor), false);
  assert.equal(poor.balance, 100, 'sin saldo no cobra');
  const rich = fakeWallet(60_000);
  assert.equal(shop.buy('ship', rich), true);
  assert.equal(rich.balance, 10_000);
  assert.equal(shop.equipped('plane'), 'ship');
  assert.equal(shop.buy('ship', rich), false, 'no se compra dos veces');
  assert.equal(shop.equip('fighter'), true);
  assert.equal(shop.equip('gameboy'), false, 'no se equipa sin comprar');
  const later = new Shop({ store: s });
  assert.ok(later.owns('ship'));
  assert.equal(later.equipped('plane'), 'fighter');
  s.write(SHOP_KEY, { owned: ['hackeo'], equipped: { plane: 'cyberbird', palette: 'gameboy' } });
  const sane = new Shop({ store: s });
  assert.equal(sane.equipped('plane'), 'fighter');
  assert.equal(sane.equipped('palette'), 'classic');
  const html = read('index.html');
  const css = read('css/meta.css');
  for (const id of ['gameboy', 'amber', 'neon']) {
    assert.match(html, new RegExp(`<filter id="pal-${id}"`), id);
    assert.match(css, new RegExp(`html\\[data-palette="${id}"\\] \\{\\s*filter: url\\("#pal-${id}"\\)`), id);
  }
});

// ---------- Pilar 3: PWA y Salón de la Fama ----------

test('PWA: manifest con iconos 192 y 512, service worker al día y todo el juego en caché', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const size of ['192x192', '512x512']) assert.ok(manifest.icons.some((i) => i.sizes === size && i.type === 'image/png'), size);
  for (const icon of manifest.icons) assert.ok(existsSync(new URL(icon.src, root)), icon.src);
  for (const icon of ICONS) {
    const png = readFileSync(new URL(icon.file, root));
    assert.equal(png.readUInt32BE(16), icon.size, `${icon.file}: ancho`);
    assert.equal(png.readUInt32BE(20), icon.size, `${icon.file}: alto`);
  }
  assert.equal(read('service-worker.js'), serviceWorker(), 'ejecuta node tools/build-pwa.mjs');
  const list = precacheList();
  const html = read('index.html');
  for (const [, href] of html.matchAll(/(?:href|src)="((?:css|js|fonts|icons)\/[^"]+)"/g)) assert.ok(list.includes(href), `falta en la caché: ${href}`);
  for (const file of list) assert.ok(existsSync(new URL(file, root)), `no existe ${file}`);
  assert.ok(list.includes('js/ui/matrix-worker.js'), 'el worker de la lluvia también');
  assert.match(html, /<link rel="manifest" href="manifest.json">/);
  assert.match(read('js/arcade/pwa.js'), /serviceWorker\.register\('service-worker\.js'/);
  const png = gridPng({ grid: { w: 2, h: 2, get: () => 1 }, palette: [null, '#ff0000'] }, 4);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.subarray(-8, -4).toString(), 'IEND');
});

test('Salón de la Fama: 10 mejores con 3 iniciales, partida destacada, exportar y restablecer', () => {
  assert.equal(cleanInitials('ñú'), 'NUA');
  assert.equal(cleanInitials('cyb3rpunk'), 'CYB');
  assert.equal(cleanInitials(''), 'AAA');
  let now = 0;
  const s = store();
  const hof = new HallOfFame({ store: s, now: () => ++now });
  assert.equal(hof.isHighlight(240, 10, 50), false, 'menos de 25 apuestas mínimas');
  assert.equal(hof.isHighlight(250, 10, 3), false, 'multiplicador bajo');
  assert.equal(hof.isHighlight(250, 10, 5), true);
  for (let i = 1; i <= HOF_SIZE; i++) assert.ok(hof.add({ initials: 'aaa', score: i * 100, game: 'dice' }) > 0);
  assert.equal(hof.qualifies(100), false, 'empatar con el último no entra');
  assert.equal(hof.add({ initials: 'cyb', score: 550, game: 'crash', detail: '×55' }), 6);
  const entries = hof.entries;
  assert.equal(entries.length, HOF_SIZE);
  assert.equal(entries[0].score, 1000);
  assert.equal(entries[5].initials, 'CYB');
  assert.ok(!entries.some((e) => e.score === 100), 'el último sale de la tabla');
  const exported = JSON.parse(hof.exportJson());
  assert.equal(exported.format, HOF_FORMAT);
  assert.equal(exported.entries.length, HOF_SIZE);
  assert.equal(new HallOfFame({ store: s }).entries.length, HOF_SIZE, 'persiste');
  hof.reset();
  assert.equal(new HallOfFame({ store: s }).entries.length, 0);
});

// ---------- Pilar 4: jefe y desafíos diarios ----------

test('Núcleo: 3 fases por vida, disparo automático, vidas y final del combate', () => {
  assert.equal(phaseFor(BOSS_HP), 1);
  assert.equal(phaseFor(BOSS_HP * 0.6), 2);
  assert.equal(phaseFor(BOSS_HP * 0.2), 3);
  assert.ok(bossScore({ damage: 300, lives: 3, seconds: 30, won: true }) > bossScore({ damage: 300, lives: 1, seconds: 90, won: true }));
  const battle = new BossBattle({ rand: () => 0.5 });
  battle.update(1, { dir: 0 });
  assert.equal(battle.time, 0, 'no avanza antes de empezar');
  battle.start();
  let t = 0;
  while (battle.state === 'playing' && t < 600) {
    battle.update(1 / 60, { targetX: battle.boss.x });
    battle.drainEvents();
    t += 1 / 60;
  }
  assert.ok(battle.damage > 0, 'hace daño');
  assert.ok(['won', 'lost'].includes(battle.state), 'termina');
  if (battle.state === 'lost') assert.equal(battle.player.lives, 0);
  // Siempre invulnerable: gana y pasa por las 3 fases con el pool de balas acotado.
  const god = new BossBattle({ rand: () => 0.3 });
  god.start();
  const seen = new Set([god.phase]);
  for (let i = 0; i < 60 * 300 && god.state === 'playing'; i++) {
    god.player.invulnerable = 10;
    god.update(1 / 60, { targetX: god.boss.x });
    seen.add(god.phase);
    assert.ok(god.enemy.length <= 220, 'pool acotado');
  }
  assert.equal(god.state, 'won');
  assert.deepEqual([...seen], [1, 2, 3]);
  assert.equal(god.player.lives, PLAYER_LIVES);
  assert.ok(god.score > 3000);
});

test('Desafíos diarios: deterministas por fecha, respetan el piso y dan cofres al completarse', () => {
  assert.equal(localDay(new Date(2026, 9, 1, 23, 59).getTime()), '2026-10-01');
  const a = dailyFor('2026-10-01', 4);
  assert.deepEqual(a, dailyFor('2026-10-01', 4), 'mismo día, mismos retos');
  assert.equal(a.challenges.length, DAILY_COUNT);
  assert.equal(new Set(a.challenges).size, DAILY_COUNT);
  const days = Array.from({ length: 30 }, (_, i) => dailyFor(`2026-11-${String(i + 1).padStart(2, '0')}`, 1));
  assert.ok(new Set(days.map((d) => d.modifier)).size >= 3, 'el modificador cambia');
  for (const d of days) for (const id of d.challenges) assert.equal(challengeById(id).minFloor, 1, 'piso 1: solo retos jugables');
  for (const m of MODIFIERS) assert.ok(challengeById(m.featured), m.id);
  assert.ok(CHALLENGES.length >= 10);

  const s = store();
  let now = new Date(2026, 9, 1, 12).getTime();
  const daily = new Daily({ store: s, now: () => now, level: () => 4 });
  const today = daily.today;
  const done = [];
  let bonus = 0;
  daily.addEventListener('complete', (e) => done.push(e.detail.challenge.id));
  daily.addEventListener('bonus', () => bonus++);
  const rounds = ['crash', 'mines', 'dice', 'plinko', 'slots', 'roulette', 'video_poker', 'blackjack'].map((game) => ({ game, stake: 10, returned: 30, tags: [] }));
  rounds.push({ game: 'fish', stake: 10, returned: 30, captures: 5, tags: [] }, { game: 'towers', stake: 10, returned: 30, safe: 2, tags: [] });
  for (let i = 0; i < 60; i++) for (const r of rounds) daily.record(r);
  assert.deepEqual(done.sort(), today.challenges.map((c) => c.id).sort());
  assert.equal(bonus, 1);
  assert.ok(daily.today.challenges.every((c) => c.done));
  now += 24 * 3600 * 1000;
  assert.notEqual(daily.today.day, today.day);
  assert.ok(daily.today.challenges.every((c) => !c.done && c.progress === 0));
  // Los modificadores no tocan las matemáticas de las mesas.
  for (const file of ['js/games/crash-math.js', 'js/games/fish-math.js', 'js/games/slots-engine.js']) assert.equal(/daily/.test(read(file)), false, file);
});

test('Sala Arcade: diálogos, puerta secreta del piso 5 y bucles que se detienen', () => {
  const html = read('index.html');
  for (const id of ['btn-arcade', 'arcade-dialog', 'trophy-grid', 'shop-planes', 'shop-palettes', 'hof-list', 'hof-export', 'hof-reset', 'daily-list', 'core-enter', 'pwa-install', 'initials-dialog', 'boss-dialog', 'boss-canvas', 'trophy-toasts']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(read('js/ui/climb-ui.js'), /floor-door-secret/);
  const boss = read('js/ui/boss-ui.js');
  assert.match(boss, /cancelAnimationFrame\(this\.#raf\)/);
  assert.match(boss, /visibilitychange/);
  assert.match(boss, /addEventListener\('close', \(\) => this\.#stop\(\)\)/);
  assert.match(read('js/ui/arcade-hub.js'), /new Blob\(\[hallOfFame\.exportJson\(\)\]/);
});
