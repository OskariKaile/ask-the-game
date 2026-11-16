// SVG rink in the feed's own units: 1000 x 500 = 60 m x 30 m (Liiga/IIHF rink).
// The home team always attacks to the right, the away team to the left.

import type { Game, GameEvent } from './shared/types.ts';

const M = 1000 / 60; // units per metre
const NS = 'http://www.w3.org/2000/svg';
const BG = '#04060a'; // page background: separates overlapping markers
const CYAN = '#00ffcc';

const GOAL_X = 4 * M; // goal line 4 m from the end boards
const BLUE_X = 22.86 * M; // blue line from the end boards
const DOT_X = GOAL_X + 6 * M; // end-zone faceoff dots
const DOT_Y = 7 * M; // from the long axis
const CIRCLE = 4.5 * M;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.appendChild(node);
  return node;
}

export function buildRink(svg: SVGSVGElement): SVGGElement {
  svg.setAttribute('viewBox', '-6 -6 1012 512');
  const defs = el('defs', {}, svg);
  const clip = el('clipPath', { id: 'ice' }, defs);
  el('rect', { x: 0, y: 0, width: 1000, height: 500, rx: 8.5 * M }, clip);

  el('rect', { x: 0, y: 0, width: 1000, height: 500, rx: 8.5 * M, class: 'ice' }, svg);
  const lines = el('g', { 'clip-path': 'url(#ice)' }, svg);
  for (const side of [0, 1]) {
    const mx = (x: number) => (side ? 1000 - x : x);
    el('line', { x1: mx(GOAL_X), y1: 0, x2: mx(GOAL_X), y2: 500, class: 'red thin' }, lines);
    el('line', { x1: mx(BLUE_X), y1: 0, x2: mx(BLUE_X), y2: 500, class: 'blue' }, lines);
    const r = 1.83 * M;
    const dir = side ? 0 : 1;
    el('path', { d: `M ${mx(GOAL_X)} ${250 - r} A ${r} ${r} 0 0 ${dir} ${mx(GOAL_X)} ${250 + r} Z`, class: 'crease' }, lines);
    const netX = side ? 1000 - GOAL_X : GOAL_X - 1.12 * M;
    el('rect', { x: netX, y: 250 - 0.915 * M, width: 1.12 * M, height: 1.83 * M, class: 'net' }, lines);
    for (const dy of [-DOT_Y, DOT_Y]) {
      el('circle', { cx: mx(DOT_X), cy: 250 + dy, r: CIRCLE, class: 'red circle' }, lines);
      el('circle', { cx: mx(DOT_X), cy: 250 + dy, r: 0.3 * M, class: 'dot' }, lines);
      el('circle', { cx: mx(BLUE_X + 1.5 * M), cy: 250 + dy, r: 0.3 * M, class: 'dot' }, lines);
    }
  }
  el('line', { x1: 500, y1: 0, x2: 500, y2: 500, class: 'red' }, lines);
  el('circle', { cx: 500, cy: 250, r: CIRCLE, class: 'blue thin circle' }, lines);
  el('rect', { x: 0, y: 0, width: 1000, height: 500, rx: 8.5 * M, class: 'boards' }, svg);
  return el('g', { class: 'marks' }, svg);
}

export const radius = (e: GameEvent) => 6 + 17 * Math.sqrt(e.xg ?? 0.04);

export function drawEvents(
  layer: SVGGElement,
  events: GameEvent[],
  game: Game,
  opts: { selected?: string; label: (e: GameEvent) => string; onPick: (id: string) => void; onHover: (id?: string) => void },
) {
  layer.replaceChildren();
  const onRink = events.filter((e) => e.x !== undefined && e.y !== undefined);
  // goals and the selected event on top
  const z = (e: GameEvent) => (e.id === opts.selected ? 2 : e.type === 'goal' ? 1 : 0);
  onRink.sort((a, b) => z(a) - z(b));

  const sel = events.find((e) => e.id === opts.selected);
  for (const e of onRink) {
    const color = game.teams[e.side].color;
    const r = radius(e);
    const g = el('g', { class: `mark ${e.type}${e.id === opts.selected ? ' sel' : ''}`, 'data-id': e.id, tabindex: 0, role: 'button' }, layer);
    el('title', {}, g).textContent = opts.label(e);
    const x = e.x!;
    const y = e.y!;
    // the ring is only visible on hover or selection (CSS), so hovering never redraws
    el('circle', { cx: x, cy: y, r: r + 8, class: 'ring' }, g);
    if (e.type === 'goal') {
      el('circle', { cx: x, cy: y, r: r + 4, fill: 'none', stroke: color, 'stroke-width': 3 }, g);
      el('circle', { cx: x, cy: y, r, fill: color, stroke: BG, 'stroke-width': 2 }, g);
    } else if (e.type === 'save') {
      el('circle', { cx: x, cy: y, r, fill: color, 'fill-opacity': 0.78, stroke: BG, 'stroke-width': 1.5 }, g);
    } else if (e.type === 'miss') {
      el('circle', { cx: x, cy: y, r, fill: BG, stroke: color, 'stroke-width': 3 }, g);
    } else {
      const k = r * 0.8;
      el('path', { d: `M ${x - k} ${y - k} L ${x + k} ${y + k} M ${x + k} ${y - k} L ${x - k} ${y + k}`, stroke: color, 'stroke-width': 4, 'stroke-linecap': 'round' }, g);
      el('circle', { cx: x, cy: y, r: r + 2, fill: 'transparent' }, g); // bigger hit area
    }
    g.addEventListener('click', () => opts.onPick(e.id));
    g.addEventListener('keydown', (ev) => {
      if ((ev as KeyboardEvent).key === 'Enter') opts.onPick(e.id);
    });
    g.addEventListener('mouseenter', () => opts.onHover(e.id));
    g.addEventListener('mouseleave', () => opts.onHover(undefined));
  }

  // Where everyone stood when the shot was taken (from the feed's tracking data).
  if (sel?.positions) {
    const pl = new Map(game.players.map((p) => [p.id, p]));
    const grp = el('g', { class: 'onice' }, layer);
    for (const pos of sel.positions) {
      const p = pl.get(pos.player);
      if (!p) continue;
      const isShooter = p.id === sel.player;
      el('circle', { cx: pos.x, cy: pos.y, r: 11, fill: game.teams[p.side].color, stroke: isShooter ? CYAN : BG, 'stroke-width': isShooter ? 4 : 2 }, grp);
      const t = el('text', { x: pos.x, y: pos.y + 4, 'text-anchor': 'middle', class: 'num' }, grp);
      t.textContent = String(p.jersey);
      el('title', {}, t).textContent = `#${p.jersey} ${p.first} ${p.last} (${game.teams[p.side].name})`;
    }
  }
}

/** Hover highlight without redrawing (redrawing under the cursor would re-fire mouseenter). */
export function setHover(layer: SVGGElement, id?: string) {
  layer.querySelectorAll('.mark').forEach((m) => m.classList.toggle('hl', m.getAttribute('data-id') === id));
}
