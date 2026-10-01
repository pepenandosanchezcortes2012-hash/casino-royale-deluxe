// Fábrica de gráficos vectoriales dinámicos (cartas, fichas, símbolos) con createElementNS.
// Nunca se inserta HTML como texto: solo nodos y textContent.

const NS = 'http://www.w3.org/2000/svg';

export function svg(tag, attrs = {}, children = []) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  for (const child of children) node.append(child);
  return node;
}

export function svgText(content, attrs) {
  const node = svg('text', attrs);
  node.textContent = content;
  return node;
}

export function useRef(id, attrs = {}) {
  return svg('use', { href: `#${id}`, ...attrs });
}

export function el(tag, className = '', text = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== null) node.textContent = text;
  return node;
}

// ---------- Fichas ----------

const CHIP_COLORS = {
  1: { base: '#e9e4d8', inner: '#f6f2e8', text: '#2b2418', edge: '#8a1c1c' },
  5: { base: '#b3261e', inner: '#cc3a2f', text: '#ffffff', edge: '#ffffff' },
  10: { base: '#1f5fbf', inner: '#2a70d6', text: '#ffffff', edge: '#ffffff' },
  25: { base: '#1c8a3f', inner: '#23a24b', text: '#ffffff', edge: '#ffffff' },
  50: { base: '#d9661a', inner: '#ef7a2a', text: '#ffffff', edge: '#ffffff' },
  100: { base: '#15171b', inner: '#2a2d33', text: '#f7e08a', edge: '#ffffff' },
  250: { base: '#b0145e', inner: '#c91f70', text: '#ffffff', edge: '#ffd6e8' },
  500: { base: '#6a2ea3', inner: '#7d3cbd', text: '#ffffff', edge: '#ffffff' },
  1000: { base: '#c99a16', inner: '#e3b52c', text: '#3a2600', edge: '#ffffff' },
  2500: { base: '#2f6b1c', inner: '#3d8526', text: '#fff6c2', edge: '#f7e08a' },
  5000: { base: '#0e7c86', inner: '#14939e', text: '#ffffff', edge: '#f7e08a' },
  10000: { base: '#c6ccd4', inner: '#e3e7ec', text: '#1b1f24', edge: '#b3261e' },
  25000: { base: '#5c0a14', inner: '#7a1020', text: '#ffd166', edge: '#ffd166' },
  100000: { base: '#0b1a3a', inner: '#13285a', text: '#9fe8ff', edge: '#9fe8ff' },
  500000: { base: '#3b0a57', inner: '#521177', text: '#f5c542', edge: '#f5c542' },
  1000000: { base: '#e3b52c', inner: '#fff1a8', text: '#5c0a14', edge: '#5c0a14' },
};

const chipNumber = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });

export function chipLabel(value) {
  if (value >= 1_000_000) return `${chipNumber.format(value / 1_000_000)}M`;
  return value >= 1000 ? `${chipNumber.format(value / 1000)}K` : String(value);
}

export function chipSvg(value) {
  const colors = CHIP_COLORS[value] ?? CHIP_COLORS[1];
  const label = chipLabel(value);
  return svg('svg', { viewBox: '0 0 100 100', class: 'chip-svg', 'aria-hidden': 'true', focusable: 'false' }, [
    svg('circle', { cx: 50, cy: 50, r: 48, fill: colors.base, stroke: 'rgba(0,0,0,.45)', 'stroke-width': 2 }),
    svg('circle', { cx: 50, cy: 50, r: 43, fill: 'none', stroke: colors.edge, 'stroke-width': 9, 'stroke-dasharray': '11.26 11.26' }),
    svg('circle', { cx: 50, cy: 50, r: 33, fill: colors.inner, stroke: 'rgba(255,255,255,.75)', 'stroke-width': 1.6, 'stroke-dasharray': '3 2.4' }),
    svg('circle', { cx: 50, cy: 50, r: 28, fill: 'none', stroke: 'rgba(0,0,0,.25)', 'stroke-width': 1 }),
    svg('circle', { cx: 50, cy: 50, r: 48, fill: 'url(#chip-shade)' }),
    svgText(label, {
      x: 50,
      y: 51,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': label.length > 3 ? 19 : label.length > 2 ? 22 : 26,
      'font-weight': 800,
      'font-family': 'Georgia, serif',
      fill: colors.text,
    }),
  ]);
}

// Desglose voraz de un importe en fichas, para pintar pilas realistas.
export function breakdown(amount, denominations = [1_000_000, 500_000, 100_000, 25_000, 10_000, 5000, 2500, 1000, 500, 250, 100, 50, 25, 10, 5, 1]) {
  const chips = [];
  let rest = amount;
  for (const value of denominations) {
    while (rest >= value && chips.length < 12) {
      chips.push(value);
      rest -= value;
    }
  }
  if (rest > 0 && chips.length === 0) chips.push(1);
  return chips;
}

export function chipStack(amount, maxVisible = 8) {
  const stack = el('span', 'chip-stack');
  const chips = breakdown(amount).slice(0, maxVisible).reverse();
  chips.forEach((value, i) => {
    const holder = el('span', 'chip-stack-item');
    holder.style.setProperty('--i', String(i));
    holder.append(chipSvg(value));
    stack.append(holder);
  });
  return stack;
}

// ---------- Cartas ----------

const SUIT_NAMES = { S: 'Picas', H: 'Corazones', D: 'Diamantes', C: 'Tréboles' };
const RANK_NAMES = { A: 'As', J: 'Jota', Q: 'Reina', K: 'Rey' };
const RED_SUITS = new Set(['H', 'D']);

// Posiciones de pips en una carta de 250x350 (baraja francesa clásica).
const PIPS = {
  2: [[125, 78], [125, 272]],
  3: [[125, 78], [125, 175], [125, 272]],
  4: [[80, 78], [170, 78], [80, 272], [170, 272]],
  5: [[80, 78], [170, 78], [125, 175], [80, 272], [170, 272]],
  6: [[80, 78], [170, 78], [80, 175], [170, 175], [80, 272], [170, 272]],
  7: [[80, 78], [170, 78], [125, 126], [80, 175], [170, 175], [80, 272], [170, 272]],
  8: [[80, 78], [170, 78], [125, 126], [80, 175], [170, 175], [125, 224], [80, 272], [170, 272]],
  9: [[80, 78], [170, 78], [80, 143], [170, 143], [125, 175], [80, 207], [170, 207], [80, 272], [170, 272]],
  10: [[80, 78], [170, 78], [125, 110], [80, 143], [170, 143], [80, 207], [170, 207], [125, 240], [80, 272], [170, 272]],
};

export const cardRank = (code) => code.slice(0, -1);
export const cardSuit = (code) => code.slice(-1);

export function cardName(code) {
  const rank = cardRank(code);
  return `${RANK_NAMES[rank] ?? rank} de ${SUIT_NAMES[cardSuit(code)]}`;
}

function pip(suit, x, y, size, flip = false) {
  const attrs = { x: x - size / 2, y: y - size / 2, width: size, height: size };
  if (flip) attrs.transform = `rotate(180 ${x} ${y})`;
  return useRef(`suit-${suit}`, attrs);
}

// Índices grandes ("jumbo") para que el rango se lea aunque la carta mida menos de 50 px.
function corner(rank, suit) {
  return svg('g', {}, [
    svgText(rank, {
      x: 34,
      y: 64,
      'text-anchor': 'middle',
      'font-size': rank === '10' ? 46 : 62,
      'font-weight': 700,
      'font-family': 'Georgia, "Times New Roman", serif',
      'letter-spacing': rank === '10' ? -5 : 0,
      fill: 'currentColor',
    }),
    pip(suit, 34, 98, 38),
  ]);
}

function cardFront(code) {
  const rank = cardRank(code);
  const suit = cardSuit(code);
  const face = svg('svg', { viewBox: '0 0 250 350', class: `card-svg ${RED_SUITS.has(suit) ? 'is-red' : 'is-black'}`, 'aria-hidden': 'true' });
  face.append(svg('rect', { x: 1.5, y: 1.5, width: 247, height: 347, rx: 16, fill: 'url(#card-paper)', stroke: '#c9c2b2', 'stroke-width': 3 }));
  face.append(corner(rank, suit));
  const bottom = corner(rank, suit);
  bottom.setAttribute('transform', 'rotate(180 125 175)');
  face.append(bottom);

  if (PIPS[rank]) {
    for (const [x, y] of PIPS[rank]) face.append(pip(suit, x, y, 46, y > 175));
  } else if (rank === 'A') {
    face.append(pip(suit, 125, 175, suit === 'S' ? 120 : 96));
    if (suit === 'S') face.append(svg('circle', { cx: 125, cy: 175, r: 78, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-dasharray': '4 5', opacity: 0.5 }));
  } else {
    face.append(svg('rect', { x: 54, y: 62, width: 142, height: 226, rx: 10, fill: 'url(#face-bg)', stroke: '#b8912a', 'stroke-width': 4 }));
    face.append(svg('rect', { x: 62, y: 70, width: 126, height: 210, rx: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, opacity: 0.45 }));
    if (rank === 'K' || rank === 'Q') {
      const size = rank === 'K' ? 70 : 54;
      face.append(useRef('sym-C', { x: 125 - size / 2, y: 82, width: size, height: size }));
    } else {
      face.append(pip(suit, 125, 112, 44));
    }
    face.append(svgText(rank, {
      x: 125,
      y: 222,
      'text-anchor': 'middle',
      'font-size': 96,
      'font-weight': 700,
      'font-family': 'Georgia, "Times New Roman", serif',
      fill: 'currentColor',
    }));
    face.append(pip(suit, 125, 258, 34));
  }
  return face;
}

function cardBack() {
  return svg('svg', { viewBox: '0 0 250 350', class: 'card-svg', 'aria-hidden': 'true' }, [
    svg('rect', { x: 1.5, y: 1.5, width: 247, height: 347, rx: 16, fill: '#fbf7ee', stroke: '#c9c2b2', 'stroke-width': 3 }),
    svg('rect', { x: 14, y: 14, width: 222, height: 322, rx: 10, fill: 'url(#card-back-pattern)', stroke: '#d4af37', 'stroke-width': 3 }),
    svg('circle', { cx: 125, cy: 175, r: 44, fill: '#5e0715', stroke: '#d4af37', 'stroke-width': 4 }),
    useRef('sym-C', { x: 95, y: 143, width: 60, height: 60 }),
  ]);
}

// Carta con volteo 3D: .card > .card-inner(preserve-3d) > caras con backface-visibility oculto.
export function cardElement(code) {
  const card = el('div', 'card');
  card.dataset.code = code;
  card.setAttribute('role', 'img');
  card.setAttribute('aria-label', 'Carta boca abajo');
  const inner = el('div', 'card-inner');
  const front = el('div', 'card-face card-front');
  front.append(cardFront(code));
  const back = el('div', 'card-face card-back');
  back.append(cardBack());
  inner.append(front, back);
  card.append(inner);
  return card;
}

export function setCardFaceUp(card, faceUp) {
  card.classList.toggle('is-face-up', faceUp);
  card.setAttribute('aria-label', faceUp ? cardName(card.dataset.code) : 'Carta boca abajo');
}

// ---------- Símbolos de slots ----------

export function symbolSvg(id, label) {
  const node = svg('svg', { viewBox: '0 0 100 100', class: 'symbol-svg', role: 'img', 'aria-label': label });
  node.append(useRef(`sym-${id}`, { width: 100, height: 100 }));
  return node;
}
