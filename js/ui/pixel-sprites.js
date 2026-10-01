// Biblioteca de sprites pixel art del casino. Los iconos y símbolos (16 × 16) están dibujados a
// mano celda a celda; los que son círculos o anillos se trazan con la rejilla. tools/
// build-pixel-sprites.mjs los convierte en los <symbol> SVG de index.html (crispEdges) y los
// juegos de Canvas usan los constructores de abajo (caza, peces, cañón) para sus fotogramas.

import { PixelGrid, sprite, mask } from './pixel-art.js';

// ---------- Paleta retro común ----------

export const PALETTE = Object.freeze({
  ink: '#0b0d14',
  night: '#141a2e',
  steel: '#8d97a8',
  steelHi: '#d6dde8',
  steelLo: '#4a5262',
  gold: '#ffcf3a',
  goldHi: '#fff3a8',
  goldLo: '#b07a0a',
  goldInk: '#3a2000',
  red: '#e8203a',
  redHi: '#ff7a8a',
  redLo: '#8e0f24',
  green: '#2fbf55',
  greenHi: '#a8f59a',
  greenLo: '#127a30',
  cyan: '#3fd8ff',
  cyanHi: '#c8f6ff',
  cyanLo: '#1d6fd6',
  magenta: '#ff3fd0',
  white: '#ffffff',
  fire: ['#ffffff', '#fff3a8', '#ffcf3a', '#ff8a1e', '#e8203a', '#8e0f24'],
  smoke: ['#6a7080', '#4a4f5c', '#2c303a'],
});

const P = PALETTE;
const SHADE = 'rgba(0,0,0,0.35)';
const SHINE = 'rgba(255,255,255,0.6)';

// ---------- Símbolos de las slots ----------

const SLOT_SYMBOLS = {
  // Estrella (scatter).
  'sym-X': sprite([
    '.......kk.......',
    '......kyyk......',
    '......kYyk......',
    '.....kyYyok.....',
    'kkkkkyYyyyokkkkk',
    'kyYYYYyyyyyyyook',
    '.kyyyyyyyyyyook.',
    '..kyyyyyyyyook..',
    '...kyyyyyyyok...',
    '...kyyyyyyyok...',
    '..kyyyykkyyyok..',
    '..kyyok..kyyok..',
    '.kyyok....kyook.',
    '.kyok......kyok.',
    '.kkk........kkk.',
    '................',
  ], { k: P.goldInk, y: P.gold, Y: P.goldHi, o: '#e08a10' }),
  // Chip cyber (comodín).
  'sym-W': sprite([
    '................',
    '....p.p.p.p.p...',
    '...kkkkkkkkkkk..',
    '..pkGGGGGGGGGkp.',
    '...kGgggggggGk..',
    '..pkGgCcccCgGkp.',
    '...kGgCcccCgGk..',
    '..pkGgCcCcCgGkp.',
    '...kGgCCcCCgGk..',
    '..pkGgcccccgGkp.',
    '...kGgggggggGk..',
    '..pkGGGGGGGGGkp.',
    '...kkkkkkkkkkk..',
    '....p.p.p.p.p...',
    '................',
    '................',
  ], { k: '#04140c', G: '#2f6b4a', g: '#173d2a', p: '#d9a92a', c: '#003d24', C: '#2bff9a' }),
  // Diamante.
  'sym-C': sprite([
    '................',
    '................',
    '....kkkkkkkk....',
    '...kCCwcccbbk...',
    '..kCwCCccbbbBk..',
    '.kkkkkkkkkkkkkk.',
    '.kCCccccccbbbBk.',
    '..kCcccccbbbBk..',
    '...kccccbbbBk...',
    '....kcccbbBk....',
    '.....kccbBk.....',
    '......kcbk......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ], { k: '#071a33', w: P.white, C: P.cyanHi, c: P.cyan, b: '#1d8fe0', B: '#0b4a9a' }),
  // 7 de oro.
  'sym-S': sprite([
    '................',
    '.kkkkkkkkkkkkk..',
    '.kRRRRRRRRRRrk..',
    '.krrrrrrrrrrdk..',
    '.kkkkkkkkkrrdk..',
    '........krrdk...',
    '.......krrdk....',
    '......krrdk.....',
    '......krrdk.....',
    '.....krrdk......',
    '.....krrdk......',
    '....krrdk.......',
    '....krrdk.......',
    '....kkkkk.......',
    '................',
    '................',
  ], { k: P.goldInk, R: P.goldHi, r: P.gold, d: P.goldLo }),
  // Campana.
  'sym-B': sprite([
    '.......kk.......',
    '......kyyk......',
    '.....kyYyyk.....',
    '....kyYyyyok....',
    '....kyYyyyok....',
    '...kyYyyyyook...',
    '...kyYyyyyook...',
    '...kyyyyyyook...',
    '..kyyyyyyyoook..',
    '..kyyyyyyyoook..',
    '.kyyyyyyyyyoook.',
    '.kkkkkkkkkkkkkk.',
    '......kddk......',
    '.......kk.......',
    '................',
    '................',
  ], { k: '#3a2500', Y: '#fff6c0', y: '#ffd84a', o: '#d08a10', d: '#7a4a00' }),
  // Herradura.
  'sym-H': sprite([
    '................',
    '.kkkk......kkkk.',
    '.kSsk......ksdk.',
    '.kSsk......ksdk.',
    '.kSnk......kndk.',
    '.kSsk......ksdk.',
    '.kSsk......ksdk.',
    '.kSnk......kndk.',
    '.kSsk......ksdk.',
    '..kSsk....ksdk..',
    '..kSssk..kssdk..',
    '...kSsskkssdk...',
    '....kSssssdk....',
    '.....kkkkkk.....',
    '................',
    '................',
  ], { k: '#15161c', S: '#f2f6fb', s: '#b8c2d0', d: '#6a7584', n: '#2a2a33' }),
  // Trébol de cuatro hojas.
  'sym-T': sprite([
    '................',
    '...kkk....kkk...',
    '..kGggk..kGggk..',
    '..kggggkkggggk..',
    '..kgggggggggdk..',
    '...kgggggggdk...',
    '.kkkkggggggkkkk.',
    'kGggggggggggggdk',
    'kgggggggggggggdk',
    '.kgggdkggkgggdk.',
    '..kkkk.kgk.kkkk.',
    '.......kgk......',
    '......kgk.......',
    '.....kgk........',
    '.....kk.........',
    '................',
  ], { k: '#062a12', G: P.greenHi, g: P.green, d: P.greenLo }),
  // Cerezas.
  'sym-R': sprite([
    '................',
    '..........gg....',
    '.........gGGg...',
    '........gGGg....',
    '.......gg.g.....',
    '......g...g.....',
    '.....g.....g....',
    '....g......g....',
    '..kkkk...kkkk...',
    '.krRwrk.krRwrk..',
    '.krRrrk.krRrrk..',
    '.krrrrk.krrrrk..',
    '.krrrdk.krrrdk..',
    '..kddk...kddk...',
    '...kk.....kk....',
    '................',
  ], { k: '#2a0508', r: P.red, R: P.redHi, w: P.white, d: P.redLo, g: '#2f9e3a', G: '#8ae06a' }),
};

// ---------- Palos de la baraja (color del texto de la carta) ----------

const SUITS = {
  'suit-S': mask([
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '.##############.',
    '.##############.',
    '.##############.',
    '..#####..#####..',
    '.......##.......',
    '......####......',
    '.....######.....',
    '................',
    '................',
  ]),
  'suit-H': mask([
    '................',
    '................',
    '..####....####..',
    '.######..######.',
    '################',
    '################',
    '################',
    '.##############.',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
    '................',
    '................',
  ]),
  'suit-D': mask([
    '................',
    '.......##.......',
    '......####......',
    '.....######.....',
    '....########....',
    '...##########...',
    '..############..',
    '.##############.',
    '.##############.',
    '..############..',
    '...##########...',
    '....########....',
    '.....######.....',
    '......####......',
    '.......##.......',
    '................',
  ]),
  'suit-C': mask([
    '................',
    '......####......',
    '.....######.....',
    '.....######.....',
    '.....######.....',
    '..###.####.###..',
    '.#####.##.#####.',
    '################',
    '################',
    '.#####.##.#####.',
    '..###..##..###..',
    '.......##.......',
    '......####......',
    '.....######.....',
    '................',
    '................',
  ]),
};

// ---------- Minas, gema y corona ----------

const OBJECTS = {
  gem: sprite([
    '................',
    '................',
    '....kkkkkkkk....',
    '...kWWWxxxxdk...',
    '..kWWxxxxxxddk..',
    '.kkkkkkkkkkkkkk.',
    '.kwWxxxxxxxxddk.',
    '..kwxxxxxxxxdk..',
    '...kwxxxxxxdk...',
    '....kwxxxxdk....',
    '.....kxxxxk.....',
    '......kxdk......',
    '.......kk.......',
    '................',
    '................',
    '................',
  ], { k: 'rgba(0,0,0,0.55)', W: SHINE, w: 'rgba(255,255,255,0.3)', x: 'currentColor', d: SHADE }),
  mine: sprite([
    '................',
    '.......xx.......',
    '..x....xx....x..',
    '...x.xxxxxx.x...',
    '....xxxxxxxx....',
    '...xxWWxxxxxx...',
    '...xxWWxxxxxx...',
    '.xxxxxxxxxxxxxx.',
    '.xxxxxxxxxxxxxx.',
    '...xxxxxxxxxx...',
    '...xxxxxxxxdx...',
    '....xxxxxxdd....',
    '...x.xxxxxx.x...',
    '..x....xx....x..',
    '.......xx.......',
    '................',
  ], { x: 'currentColor', W: SHINE, d: SHADE }),
  crown: sprite([
    '................',
    '................',
    '................',
    '..k....kk....k..',
    '.kyk..kyyk..kyk.',
    '.kyyk.kyyk.kyyk.',
    '.kyYykyYYykyYyk.',
    '.kyyyyyyyyyyyyk.',
    '.kyrryybbyyrryk.',
    '.kyrryybbyyrryk.',
    '.kyyyyyyyyyyyyk.',
    '.kooooooooooook.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
  ], { k: P.goldInk, y: P.gold, Y: P.goldHi, o: P.goldLo, r: P.red, b: P.cyanLo }),
};

// ---------- Iconos de pestañas y botones (monocromos: toman el color del texto) ----------

function ring(size, outer, inner, extra) {
  const g = new PixelGrid(size, size);
  const c = size / 2;
  g.ellipse(c, c, outer, outer, 1, (x, y) => {
    const dx = x + 0.5 - c;
    const dy = y + 0.5 - c;
    return dx * dx + dy * dy > inner * inner;
  });
  extra?.(g, c);
  return { grid: g, palette: [null, 'currentColor'] };
}

const ICONS = {
  'px-dice': mask([
    '................',
    '.##############.',
    '.##############.',
    '.##..........##.',
    '.##.##....##.##.',
    '.##.##....##.##.',
    '.##..........##.',
    '.##....##....##.',
    '.##....##....##.',
    '.##..........##.',
    '.##.##....##.##.',
    '.##.##....##.##.',
    '.##..........##.',
    '.##############.',
    '.##############.',
    '................',
  ]),
  'px-tower': mask([
    '................',
    '.##.##.##.##.##.',
    '.##############.',
    '..############..',
    '..############..',
    '..###.####.###..',
    '..###.####.###..',
    '..############..',
    '..############..',
    '..#####..#####..',
    '..####....####..',
    '..####....####..',
    '..####....####..',
    '.##############.',
    '.##############.',
    '................',
  ]),
  'px-fish': mask([
    '................',
    '................',
    '....######......',
    '..##########..##',
    '.############.##',
    '.#.##########.##',
    '################',
    '################',
    '.############.##',
    '..##########..##',
    '....######......',
    '......##........',
    '................',
    '................',
    '................',
    '................',
  ]),
  'px-plinko': mask([
    '................',
    '.......##.......',
    '.......##.......',
    '................',
    '.....##..##.....',
    '.....##..##.....',
    '................',
    '...##..##..##...',
    '...##..##..##...',
    '................',
    '.##..##..##..##.',
    '.##..##..##..##.',
    '................',
    '################',
    '################',
    '................',
  ]),
  'px-plane': mask([
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '......####......',
    '.....######.....',
    '...##########...',
    '.##############.',
    '################',
    '.....######.....',
    '......####......',
    '......####......',
    '.....######.....',
    '....########....',
    '....##....##....',
    '................',
  ]),
  'px-roulette': ring(16, 7.6, 5.4, (g) => g.rect(6, 6, 4, 4, 1).rect(7, 2, 2, 2, 1)),
  'px-wheel': ring(16, 7.6, 5.6, (g) => g.rect(7, 2, 2, 12, 1).rect(2, 7, 12, 2, 1).line(4, 4, 11, 11, 1).line(11, 4, 4, 11, 1).rect(6, 6, 4, 4, 1)),
  'px-card': mask([
    '................',
    '...##########...',
    '...##########...',
    '...##......##...',
    '...##.#..#.##...',
    '...##.####.##...',
    '...##.####.##...',
    '...##..##..##...',
    '...##......##...',
    '...##......##...',
    '...##......##...',
    '...##......##...',
    '...##########...',
    '...##########...',
    '................',
    '................',
  ]),
  'px-bolt': mask([
    '................',
    '.........####...',
    '........####....',
    '.......####.....',
    '......####......',
    '.....####.......',
    '....#########...',
    '...#########....',
    '.......####.....',
    '......####......',
    '.....###........',
    '....###.........',
    '...##...........',
    '..#.............',
    '................',
    '................',
  ]),
  'px-speaker': mask([
    '................',
    '.......##.......',
    '......###...#...',
    '.....####....#..',
    '.#######..#...#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######...#..#.',
    '.#######..#...#.',
    '.....####....#..',
    '......###...#...',
    '.......##.......',
    '................',
    '................',
    '................',
  ]),
  'px-speaker-low': mask([
    '................',
    '.......##.......',
    '......###.......',
    '.....####.......',
    '.#######..#.....',
    '.#######...#....',
    '.#######...#....',
    '.#######...#....',
    '.#######...#....',
    '.#######..#.....',
    '.....####.......',
    '......###.......',
    '.......##.......',
    '................',
    '................',
    '................',
  ]),
  'px-speaker-off': mask([
    '................',
    '.......##.......',
    '......###.......',
    '.....####.......',
    '.#######..#...#.',
    '.#######...#.#..',
    '.#######....#...',
    '.#######...#.#..',
    '.#######..#...#.',
    '.#######........',
    '.....####.......',
    '......###.......',
    '.......##.......',
    '................',
    '................',
    '................',
  ]),
  'px-gear': ring(16, 6.2, 2.6, (g) => g.rect(7, 0, 2, 3, 1).rect(7, 13, 2, 3, 1).rect(0, 7, 3, 2, 1).rect(13, 7, 3, 2, 1)
    .rect(2, 2, 2, 2, 1).rect(12, 2, 2, 2, 1).rect(2, 12, 2, 2, 1).rect(12, 12, 2, 2, 1)),
  'px-warning': mask([
    '................',
    '.......##.......',
    '......####......',
    '......####......',
    '.....##..##.....',
    '.....##..##.....',
    '....###..###....',
    '....###..###....',
    '...####..####...',
    '...##########...',
    '..#####..#####..',
    '..#####..#####..',
    '.##############.',
    '.##############.',
    '................',
    '................',
  ]),
  'px-repeat': mask([
    '................',
    '..........#.....',
    '..##########....',
    '.###########....',
    '.##.......#.....',
    '.##.............',
    '.##.........##..',
    '.##.........##..',
    '..##........##..',
    '..##........##..',
    '.............##.',
    '.....#.......##.',
    '....###########.',
    '....##########..',
    '.....#..........',
    '................',
  ]),
  'px-target': ring(16, 7.6, 6, (g) => {
    g.ellipse(8, 8, 4.4, 4.4, 1, (x, y) => (x + 0.5 - 8) ** 2 + (y + 0.5 - 8) ** 2 > 2.8 ** 2);
    g.rect(7, 7, 2, 2, 1);
  }),
  'px-music': mask([
    '................',
    '.....#########..',
    '.....#########..',
    '.....##.....##..',
    '.....##.....##..',
    '.....##.....##..',
    '.....##.....##..',
    '.....##.....##..',
    '.....##.....##..',
    '..####...####...',
    '.#####..#####...',
    '.#####..#####...',
    '..###....###....',
    '................',
    '................',
    '................',
  ]),
  'px-feather': mask([
    '................',
    '...........###..',
    '.........#####..',
    '........######..',
    '.......######...',
    '......######....',
    '.....######.....',
    '.....#####......',
    '....#####.......',
    '....####........',
    '...###..........',
    '...##...........',
    '..##............',
    '.##.............',
    '................',
    '................',
  ]),
  'px-rain': mask([
    '................',
    '.#...#...#...#..',
    '.#.......#......',
    '.#...#...#...#..',
    '.....#.......#..',
    '.#...#...#...#..',
    '.#.......#......',
    '.#...#...#...#..',
    '.....#.......#..',
    '.#...#...#......',
    '.#.......#...#..',
    '.....#.......#..',
    '.#...#...#......',
    '.#.......#...#..',
    '................',
    '................',
  ]),
  'px-crt': mask([
    '................',
    '.##############.',
    '.#............#.',
    '.#.##########.#.',
    '.#............#.',
    '.#.##########.#.',
    '.#............#.',
    '.#.##########.#.',
    '.#............#.',
    '.##############.',
    '......####......',
    '....########....',
    '................',
    '................',
    '................',
    '................',
  ]),
  'px-close': mask([
    '................',
    '................',
    '..###......###..',
    '...###....###...',
    '....###..###....',
    '.....######.....',
    '......####......',
    '......####......',
    '.....######.....',
    '....###..###....',
    '...###....###...',
    '..###......###..',
    '................',
    '................',
    '................',
    '................',
  ]),
  'px-lock': mask([
    '................',
    '.....######.....',
    '....##....##....',
    '....##....##....',
    '....##....##....',
    '..############..',
    '..############..',
    '..#####..#####..',
    '..#####..#####..',
    '..######.#####..',
    '..############..',
    '..############..',
    '................',
    '................',
    '................',
    '................',
  ]),
  'px-star': mask([
    '.......##.......',
    '.......##.......',
    '......####......',
    '......####......',
    '##############..',
    '.############...',
    '...########.....',
    '....######......',
    '...########.....',
    '...###..###.....',
    '..##......##....',
    '................',
    '................',
    '................',
    '................',
    '................',
  ].map((row) => `.${row.slice(0, 15)}`)),
};

// ---------- Iconos de color: monedas, reliquias, pociones y trampas ----------

const COLOR_ICONS = {
  'px-coin': sprite([
    '................',
    '.....kkkkkk.....',
    '...kkYYyyyykk...',
    '..kYYyyyyyyyok..',
    '..kYyyykkyyyok..',
    '.kYyyyk$kyyyyok.',
    '.kYyyykkyyyyyok.',
    '.kyyyyyykkyyyok.',
    '.kyyyyyk$kyyyok.',
    '.kyyyyykkyyyyok.',
    '..kyyyyyyyyyok..',
    '..kyyyyyyyyook..',
    '...kkooooookk...',
    '.....kkkkkk.....',
    '................',
    '................',
  ], { k: P.goldInk, Y: P.goldHi, y: P.gold, o: P.goldLo, $: P.goldLo }),
  'px-dice-color': sprite([
    '................',
    '..kkkkkkkkkkkk..',
    '.kWwwwwwwwwwwwk.',
    '.kwwrrwwwwwwwsk.',
    '.kwwrrwwwwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwrrwwwwsk.',
    '.kwwwwwrrwwwwsk.',
    '.kwwwwwwwwwwwsk.',
    '.kwwwwwwwwwrrsk.',
    '.kwwwwwwwwwrrsk.',
    '.kwwwwwwwwwwwsk.',
    '.kssssssssssssk.',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
  ], { k: P.ink, W: P.white, w: '#e9e4d8', s: '#a8a092', r: P.red }),
  'px-shield': sprite([
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kBBBBBBbbbbbbk.',
    '.kBBBBBBbbbbbbk.',
    '.kBBBByyybbbbbk.',
    '.kBBByyyyybbbbk.',
    '.kBBByyyyybbbbk.',
    '.kBBBByyybbbbbk.',
    '.kBBBBBBbbbbbbk.',
    '..kBBBBBbbbbbk..',
    '..kBBBBBbbbbbk..',
    '...kBBBBbbbbk...',
    '....kBBBbbbk....',
    '.....kkBbkk.....',
    '.......kk.......',
    '................',
  ], { k: '#071a33', B: '#5a8cff', b: '#2a4fb0', y: P.gold }),
  'px-magnet': sprite([
    '................',
    '..kkkkk..kkkkk..',
    '..kRRrk..kRRrk..',
    '..kRRrk..kRRrk..',
    '..kRRrk..kRRrk..',
    '..kRRrk..kRRrk..',
    '..kRRrkkkkRRrk..',
    '..kRRrrrrrrRrk..',
    '..kRRrrrrrrrrk..',
    '...kRrrrrrrrk...',
    '....kkkkkkkk....',
    '................',
    '..kssk....kssk..',
    '..kSSk....kSSk..',
    '..kkkk....kkkk..',
    '................',
  ], { k: P.ink, R: P.redHi, r: P.red, s: P.steel, S: P.steelHi }),
  'px-battery': sprite([
    '................',
    '......kkkk......',
    '....kkkkkkkk....',
    '....kSSSSSSk....',
    '....kSggggsk....',
    '....kSGgggsk....',
    '....kSGgggsk....',
    '....kSggggsk....',
    '....kSssssk.....',
    '....kSggggsk....',
    '....kSGgggsk....',
    '....kSggggsk....',
    '....kSssssssk...',
    '....kkkkkkkk....',
    '................',
    '................',
  ].map((row) => row.slice(0, 16)), { k: P.ink, S: P.steelHi, s: P.steelLo, g: P.green, G: P.greenHi }),
  'px-antenna': sprite([
    '................',
    '.c..........c...',
    '..c..kkkk..c....',
    '.c..kCCCck..c...',
    '...kCccccck.....',
    '...kccccccck....',
    '....kccccck.....',
    '.....kkkkk......',
    '.......kk.......',
    '.......ss.......',
    '......ksSk......',
    '......ksSk......',
    '.....kssSSk.....',
    '....kssssSSk....',
    '....kkkkkkkk....',
    '................',
  ], { k: P.ink, c: P.cyan, C: P.cyanHi, s: P.steel, S: P.steelLo }),
  'px-ticket': sprite([
    '................',
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kyyyyyyy.yyyyk.',
    'kyyrrrryyyyyyyyk',
    '.kyyrryyy.yyyk..',
    '..kyyrryy.yyk...',
    '.kyyrrrryyyyyk..',
    'kyyyyyyyy.yyyyyk',
    '.kyyyyyyyyyyyyk.',
    '.kkkkkkkkkkkkkk.',
    '................',
    '................',
    '................',
    '................',
  ], { k: P.goldInk, y: P.gold, r: P.redLo }),
  'px-skull': sprite([
    '................',
    '....kkkkkkkk....',
    '...kwwwwwwwwk...',
    '..kwWwwwwwwwsk..',
    '..kwwwwwwwwwsk..',
    '..kwkkkwwkkksk..',
    '..kwkkkwwkkksk..',
    '..kwwwwkkwwwsk..',
    '...kwwwwwwwsk...',
    '....kwkwkwsk....',
    '....kwkwkwsk....',
    '.....kkkkkk.....',
    '................',
    '................',
    '................',
    '................',
  ], { k: P.ink, W: P.white, w: '#e9e4d8', s: '#a8a092' }),
  'px-potion': sprite([
    '................',
    '......kkkk......',
    '......kssk......',
    '......kwwk......',
    '.....kwwwwk.....',
    '....kwppppwk....',
    '...kwpPppppwk...',
    '...kppPpppppk...',
    '...kpppppppdk...',
    '...kpppppppdk...',
    '....kpppppdk....',
    '.....kkkkkk.....',
    '................',
    '................',
    '................',
    '................',
  ], { k: P.ink, s: '#9a6a3a', w: 'rgba(200,240,255,0.55)', p: '#36e07a', P: P.greenHi, d: P.greenLo }),
  'px-gift': sprite([
    '................',
    '....kk....kk....',
    '...kyyk..kyyk...',
    '....kyykkyyk....',
    '.kkkkkkkkkkkkkk.',
    '.kRRRRRyyRRRRrk.',
    '.kkkkkkkkkkkkkk.',
    '..kRRRRyyRRRrk..',
    '..kRRRRyyRRRrk..',
    '..kRRRRyyRRRrk..',
    '..kRRRRyyRRRrk..',
    '..kRrrryyrrrrk..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
  ], { k: P.ink, R: P.redHi, r: P.redLo, y: P.gold }),
  'px-hourglass': sprite([
    '................',
    '...kkkkkkkkkk...',
    '...kbbbbbbbbk...',
    '....kyyyyyyk....',
    '....kyyyyyyk....',
    '.....kyyyyk.....',
    '......kyyk......',
    '.......kk.......',
    '......k..k......',
    '.....k.yy.k.....',
    '....k.yyyy.k....',
    '....kyyyyyyk....',
    '...kbbbbbbbbk...',
    '...kkkkkkkkkk...',
    '................',
    '................',
  ], { k: P.ink, b: '#9a6a3a', y: P.gold }),
  'px-chip': sprite([
    '................',
    '................',
    '..kkkkkkkkkkkk..',
    '..kyyyykyyyyok..',
    '..kyYyykyyyyok..',
    '..kkkkkkkkkkkk..',
    '..kyyykyykyyok..',
    '..kyyykyykyyok..',
    '..kkkkkkkkkkkk..',
    '..kyyyykyyyyok..',
    '..kooooooooook..',
    '..kkkkkkkkkkkk..',
    '................',
    '................',
    '................',
    '................',
  ], { k: P.goldInk, y: P.gold, Y: P.goldHi, o: P.goldLo }),
};

// ---------- Retratos de los anfitriones (16 × 16) ----------

const PORTRAITS = {
  // Moss: crupier veterano del subsuelo, pelo cano, pajarita y visera verde.
  'npc-moss': sprite([
    '................',
    '....kkkkkkkk....',
    '...kgggggggggk..',
    '..kGGGGGGGGGGGk.',
    '...khhhhhhhhk...',
    '...khssssssshk..',
    '...ksskssksssk..',
    '...ksssssssssk..',
    '...kssmmmmsssk..',
    '....ksssssssk...',
    '.....kkssskk....',
    '...kkwwkkkwwkk..',
    '..kwwwrrkrrwwwk.',
    '..kwwwwrrrwwwwk.',
    '..kwwwwwkwwwwwk.',
    '..kkkkkkkkkkkkk.',
  ], { k: P.ink, g: '#1c6b3a', G: '#36c070', h: '#c9ccd4', s: '#e0a878', m: '#9a9aa6', w: '#f2f2f2', r: P.red }),
  // Vera: jefa de sala de la Bahía, melena magenta y visor neón.
  'npc-vera': sprite([
    '................',
    '....kkkkkkk.....',
    '...kmmmmmmmk....',
    '..kmMMmmmmmmk...',
    '..kmmkkkkkkmmk..',
    '..kmkccccccckmk.',
    '..kmkCCccccckmk.',
    '..kmksssssssmk..',
    '..kmmsssrrsssmk.',
    '..kmmksssssskmk.',
    '..kmm.kkkkkk.mk.',
    '..kmmkpppppkmmk.',
    '...kkpppPpppkk..',
    '...kppppPppppk..',
    '...kppppPppppk..',
    '...kkkkkkkkkkk..',
  ], { k: P.ink, m: '#d6287e', M: '#ff86c4', c: P.cyan, C: P.cyanHi, s: '#f0b48a', r: '#c41a4a', p: '#3a1f6e', P: P.magenta }),
  // Ferro: mayordomo androide, cráneo de acero y ojo rojo.
  'npc-ferro': sprite([
    '................',
    '.....kkkkkk.....',
    '....kSSSSSsk....',
    '...kSSssssssk...',
    '...kSsssssssk...',
    '...kskkkskkkk...',
    '...kskRrsskwk...',
    '...kskkkskkkk...',
    '...ksssssssdk...',
    '...ksdkdkdkdk...',
    '....kssssssk....',
    '.....kkddkk.....',
    '...kkbbkkbbkk...',
    '..kbbbbwwbbbbk..',
    '..kbbbbwwbbbbk..',
    '..kkkkkkkkkkkk..',
  ], { k: P.ink, S: P.steelHi, s: P.steel, d: P.steelLo, R: '#ff2b4a', r: '#8e0f24', w: P.white, b: '#1c2030' }),
  // SIBILA: IA soberana, rostro holográfico.
  'npc-sibila': sprite([
    '................',
    '.....cccccc.....',
    '....cCCCCCCc....',
    '...cC......Cc...',
    '...cC.c..c.Cc...',
    '..ccC.C..C.Ccc..',
    '...cC......Cc...',
    '...cC..cc..Cc...',
    '...cC......Cc...',
    '....cC.CC.Cc....',
    '.....cCCCCc.....',
    '......cccc......',
    '....c.c..c.c....',
    '...c..c..c..c...',
    '..c...c..c...c..',
    '................',
  ], { c: '#1d8fe0', C: '#7ff6ff' }),
  // El Sindicato: silueta con sombrero de ala.
  'npc-syndicate': sprite([
    '................',
    '.....kkkkkk.....',
    '....kffffffk....',
    '....kffffffk....',
    '....kbbbbbbk....',
    '.kkkkffffffkkkk.',
    'kffffffffffffffk',
    '.kkkksssssskkkk.',
    '....kskksksk....',
    '....kssssssk....',
    '.....kssssk.....',
    '...kkkwrrwkkk...',
    '..kddddwrwddddk.',
    '..kdddddwddddd k',
    '..kdddddwdddddk.',
    '..kkkkkkkkkkkkk.',
  ].map((row) => row.replace(' ', 'k')), { k: P.ink, f: '#2a2a33', b: P.red, s: '#3a3a46', w: '#c9ccd4', r: P.redLo, d: '#14141a' }),
  // Narrador: terminal con cursor.
  'npc-narrator': sprite([
    '................',
    '................',
    '.kkkkkkkkkkkkkk.',
    '.kssssssssssssk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbgbbbbbbbbsk.',
    '.ksbbgbbbbbbbsk.',
    '.ksbgbbggggbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.ksbbbbbbbbbbsk.',
    '.kssssssssssssk.',
    '.kkkkkkkkkkkkkk.',
    '......kssk......',
    '....kkkkkkkk....',
    '................',
    '................',
  ], { k: P.ink, s: P.steelLo, b: '#04140c', g: '#2bff9a' }),
};

// Cofre pixel (tapa y cuerpo por separado para la animación de apertura). 24 de ancho.
const CHEST = {
  'chest-lid': sprite([
    '....kkkkkkkkkkkkkkkk....',
    '..kkWWWWWWWWWWWWWWWWkk..',
    '.kWwwwwwwwwwyywwwwwwwdk.',
    'kWwwwwwwwwwyYYywwwwwwwdk',
    'kyyyyyyyyyyyyyyyyyyyyyyk',
    'kWwwwwwwwwwyYYywwwwwwwdk',
    'kwwwwwwwwwwyyyywwwwwwwdk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
  ], { k: P.ink, W: '#c07a3a', w: '#8a4f1e', d: '#5a3010', y: P.gold, Y: P.goldHi }),
  'chest-body': sprite([
    'kkkkkkkkkkkkkkkkkkkkkkkk',
    'kyyyyyyyyykkkkyyyyyyyyyk',
    'kWwwwwwwwkyYYyk wwwwwwdk',
    'kwwwwwwwwkykkyk wwwwwwdk',
    'kwwwwwwwwkyykyk wwwwwwdk',
    'kwwwwwwwwwkkkkwwwwwwwwdk',
    'kyyyyyyyyyyyyyyyyyyyyyyk',
    'kwwwwwwwwwwwwwwwwwwwwwdk',
    'kwwwwwwwwwwwwwwwwwwwwwdk',
    'kddddddddddddddddddddddk',
    'kkkkkkkkkkkkkkkkkkkkkkkk',
  ].map((row) => row.replace(/ /g, 'w')), { k: P.ink, W: '#c07a3a', w: '#8a4f1e', d: '#5a3010', y: P.gold, Y: P.goldHi }),
};

// Todo lo que se publica como <symbol> en el sprite SVG de index.html.
export const SVG_SPRITES = Object.freeze({ ...SLOT_SYMBOLS, ...SUITS, ...OBJECTS, ...ICONS, ...COLOR_ICONS, ...PORTRAITS, ...CHEST });

// Retrato de cada voz de la bitácora.
export const PORTRAIT_OF = Object.freeze({
  Moss: 'npc-moss',
  Vera: 'npc-vera',
  Ferro: 'npc-ferro',
  SIBILA: 'npc-sibila',
  Sindicato: 'npc-syndicate',
  Crupier: 'npc-moss',
  Narrador: 'npc-narrator',
});

// ---------- Caza de Crash (16 bits, de perfil y mirando a la derecha) ----------

const PLANE_ROWS = [
  '......kk..................',
  '.....kdbk.................',
  '.....kdbbk................',
  '....kddbbbk.......kkkk....',
  '....kddbbbbkkkkkkkcCCck...',
  'kk..kdbbbbbbbbbbbkcccCCk..',
  'kbkkkbBBBBBBBBBBBBBBBBBkk.',
  'kbrrrrrrrrrrrrrrbbbbbbbbbk',
  'kbkkkddddddddddddddddddkk.',
  'kk..kkddkkkkkkdddddkkkk...',
  '.....kddddk...kkkkk.......',
  '.....kkkkkk...............',
];
const PLANE_COLORS = { k: '#0a0e1a', b: '#8fa3c0', B: '#dfe8f5', d: '#4a5a78', c: '#1d8fe0', C: P.cyanHi, r: P.red };
// Llama del postquemador: 2 fotogramas que se alternan.
const FLAME = [
  ['....', '..oy', 'oyWW', '..oy', '....'],
  ['....', '.roy', 'royW', '.roy', '....'],
];

export function planeFrames() {
  const base = sprite(PLANE_ROWS, PLANE_COLORS);
  const keys = Object.keys(PLANE_COLORS).join('');
  return FLAME.map((flame) => {
    const grid = new PixelGrid(base.grid.w + 4, base.grid.h);
    for (const { x, y, n, c } of base.grid.runs()) grid.rect(x + 4, y, n, 1, c);
    const extra = { y: keys.length + 1, o: keys.length + 2, W: keys.length + 3, r: keys.indexOf('r') + 1 };
    flame.forEach((row, j) => {
      for (let i = 0; i < 4; i++) if (row[i] !== '.') grid.set(i, 5 + j, extra[row[i]]);
    });
    return { grid, palette: [...base.palette, P.gold, '#ff8a1e', P.white] };
  });
}

// ---------- Criaturas de Cyber-Fish (rejillas en píxeles de lienzo, mirando a la derecha) ----------

// Índices de color comunes a todas las criaturas.
const C = { body: 1, light: 2, dark: 3, accent: 4, eye: 5, pupil: 6, outline: 7, glow: 8 };

const FISH_COLORS = {
  neon: ['#2ce8a8', '#a8ffd8', '#128a6a', '#ff3fd0', '#ffffff', '#05060a', '#04201a', '#fff3a8'],
  jelly: ['#b45cff', '#f0c0ff', '#5a1f90', '#7ff6ff', '#ffffff', '#05060a', '#1a0628', '#ffffff'],
  manta: ['#2a9dff', '#9fd8ff', '#145090', '#00ffe0', '#ffffff', '#05060a', '#04162a', '#c8f6ff'],
  shark: ['#8d97a8', '#d6dde8', '#4a5262', '#ff8a3d', '#ff2b4a', '#05060a', '#12151c', '#ffd166'],
  kraken: ['#d6286e', '#ff86b4', '#6e0e38', '#ffd0e0', '#ffffff', '#ff2b4a', '#22020e', '#ffe14a'],
};

const finish = (grid) => grid.bevel(C.body, C.light, C.dark).outline(C.outline);

function neonFrame(f) {
  const g = new PixelGrid(22, 13);
  const spread = [4, 3, 2][f];
  g.poly([[1, 6.5 - spread], [6, 6.5], [1, 6.5 + spread]], C.body);
  g.ellipse(12, 6.5, 8, 4.5, C.body);
  g.poly([[9, 2.5], [13, 0.5], [14, 2.5]], C.body);
  g.poly([[10, 10.5], [12, 12.5 - (f === 1 ? 1 : 0)], [13, 10.5]], C.body);
  finish(g);
  g.rect(7, 6, 10, 1, C.accent);
  g.rect(16, 4, 2, 2, C.eye).set(17, 5, C.pupil);
  return g;
}

function jellyFrame(f) {
  const g = new PixelGrid(22, 26);
  const squash = [0, 1, 2][f];
  g.ellipse(11, 10, 9.5, 9 - squash, C.body, (x, y) => y < 10);
  g.rect(2, 9, 18, 2, C.body);
  finish(g);
  for (let t = 0; t < 5; t++) {
    const x0 = 4 + t * 3.5;
    for (let y = 12; y < 25 - squash; y++) {
      const sway = Math.round(Math.sin(y / 2.4 + f * 2.1 + t) * 1.2);
      g.set(Math.round(x0 + sway), y, (y + t) % 3 ? C.accent : C.light);
    }
  }
  g.rect(6, 4 + squash, 2, 2, C.glow).rect(13, 6 + squash, 1, 1, C.glow).rect(9, 7, 1, 1, C.glow);
  return g;
}

function mantaFrame(f) {
  const g = new PixelGrid(40, 24);
  const flap = [-3, 0, 3][f];
  g.poly([[6, 12], [20, 1 - flap], [32, 9], [38, 12], [32, 15], [20, 23 + flap]], C.body);
  g.rect(0, 11, 8, 2, C.body);
  finish(g);
  g.line(14, 12, 30, 12, C.accent).line(20, 5 - flap, 22, 10, C.accent).line(20, 19 + flap, 22, 14, C.accent);
  g.set(33, 10, C.eye).set(33, 14, C.eye);
  return g;
}

function sharkFrame(f) {
  const g = new PixelGrid(52, 26);
  const swing = [-2, 0, 2][f];
  g.poly([[1, 4 + swing], [9, 12], [9, 14], [1, 22 + swing]], C.body);
  g.ellipse(26, 13, 19, 6, C.body);
  g.poly([[20, 8], [26, 0], [29, 8]], C.body);
  g.rect(42, 5, 4, 16, C.body).rect(38, 10, 8, 6, C.body);
  g.poly([[24, 18], [28, 24 + (f === 1 ? -1 : 0)], [31, 18]], C.body);
  finish(g);
  for (let x = 14; x <= 36; x += 5) g.rect(x, 8, 1, 4, C.accent);
  g.rect(43, 5, 2, 2, C.eye).rect(43, 19, 2, 2, C.eye);
  g.rect(46, 12, 1, 3, C.dark);
  return g;
}

function krakenFrame(f) {
  const g = new PixelGrid(88, 86);
  g.ellipse(44, 26, 23, 25, C.body, (x, y) => y < 42);
  g.ellipse(44, 40, 20, 6, C.body);
  for (let t = 0; t < 8; t++) {
    const x0 = 18 + t * 7.4;
    const len = 34 + ((t * 5) % 9);
    for (let y = 40; y < 40 + len; y++) {
      const k = (y - 40) / len;
      const sway = Math.round(Math.sin(k * 4 + f * 2.1 + t * 0.9) * (2 + k * 5));
      const w = k < 0.4 ? 4 : k < 0.75 ? 3 : 2;
      g.rect(Math.round(x0 + sway - w / 2), y, w, 1, C.body);
    }
  }
  finish(g);
  // Ventosas, manchas y ojos con pupila roja.
  for (let t = 0; t < 8; t++) for (let y = 50; y < 70; y += 5) g.map((x, yy, c) => (yy === y && c === C.body && (x + t) % 7 === 0 ? C.accent : undefined));
  for (const [x, y] of [[34, 10], [52, 12], [44, 6], [28, 22], [58, 24]]) g.rect(x, y, 2, 2, C.light);
  for (const x of [33, 51]) {
    g.rect(x, 26, 6, 6, C.eye);
    g.rect(x + 2, 28 + (f === 2 ? 1 : 0), 2, 2, C.pupil);
  }
  g.rect(40, 36, 8, 2, C.dark);
  return g;
}

const BUILDERS = { neon: neonFrame, jelly: jellyFrame, manta: mantaFrame, shark: sharkFrame, kraken: krakenFrame };

// Tres fotogramas de nado por especie: [{ grid, palette }].
export function fishFrames(id) {
  const palette = [null, ...FISH_COLORS[id]];
  return [0, 1, 2].map((f) => ({ grid: BUILDERS[id](f), palette }));
}

export const fishColor = (id) => FISH_COLORS[id][0];

// Cañón del acuario: base (cúpula) y tubo.
export function cannonSprites() {
  const base = new PixelGrid(26, 16);
  base.ellipse(13, 15, 12.5, 13, 1, (x, y) => y < 15);
  base.rect(0, 13, 26, 3, 1);
  base.bevel(1, 2, 3).outline(4);
  base.rect(11, 6, 4, 4, 5).rect(12, 7, 2, 2, 6);
  const barrel = new PixelGrid(48, 10);
  // El tubo ocupa la mitad derecha: el centro del sprite es el eje de giro.
  barrel.rect(24, 2, 18, 6, 1).rect(40, 1, 6, 8, 1);
  barrel.bevel(1, 2, 3).outline(4);
  barrel.rect(28, 4, 10, 1, 5);
  const palette = [null, '#1aa5c4', '#9ff8ff', '#063a4a', '#02141c', '#ff3fd0', '#ffffff'];
  return { base: { grid: base, palette }, barrel: { grid: barrel, palette } };
}

// Bala: cruz de 5 × 5 con núcleo blanco.
export function bulletSprite() {
  return sprite([
    '..c..',
    '.cWc.',
    'cWWWc',
    '.cWc.',
    '..c..',
  ], { c: '#00e5ff', W: '#e8fdff' });
}
