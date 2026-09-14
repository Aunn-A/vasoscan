/** Shared SVG chart plumbing. Charts render at the container's real pixel width so text stays legible. */
import { s } from '../dom';

export interface Box { w: number; h: number; left: number; right: number; top: number; bottom: number }

export const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) =>
  r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);

export function svgRoot(w: number, h: number, label: string): SVGSVGElement {
  const el = s('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h, role: 'img', 'aria-label': label });
  return el;
}

/**
 * Path through (x, y) points. When there are more points than pixels, each pixel column keeps its
 * minimum and maximum so peaks are never lost.
 */
export function linePath(xs: ArrayLike<number>, ys: ArrayLike<number>, X: (v: number) => number, Y: (v: number) => number): string {
  const n = Math.min(xs.length, ys.length);
  let d = '';
  let started = false;
  let col = NaN, cmin = 0, cmax = 0, cminY = 0, cmaxY = 0, lastPx = 0, lastPy = 0;
  const flush = () => {
    if (Number.isNaN(col)) return;
    const pts: Array<[number, number]> = cmin <= cmax ? [[col, cminY], [col, cmaxY]] : [[col, cmaxY], [col, cminY]];
    for (const [px, py] of pts) {
      d += `${started ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      started = true;
    }
  };
  const dense = n > 1 && Math.abs(X(xs[n - 1]) - X(xs[0])) < n * 0.8;
  for (let i = 0; i < n; i++) {
    const yv = ys[i];
    if (!Number.isFinite(yv)) { flush(); col = NaN; started = false; continue; }
    const px = X(xs[i]);
    const py = Y(yv);
    if (!dense) {
      d += `${started ? 'L' : 'M'}${px.toFixed(1)},${py.toFixed(1)}`;
      started = true;
      continue;
    }
    const c = Math.round(px);
    if (c !== col) {
      flush();
      col = c; cminY = py; cmaxY = py; cmin = i; cmax = i;
    } else {
      if (py < cminY) { cminY = py; cmin = i; }
      if (py > cmaxY) { cmaxY = py; cmax = i; }
    }
    lastPx = px; lastPy = py;
  }
  flush();
  void lastPx; void lastPy;
  return d;
}

export function niceTicks(min: number, max: number, target = 5): number[] {
  const span = max - min || 1;
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= target) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

export function xAxis(svg: SVGSVGElement, ticks: number[], X: (v: number) => number, y: number, fmt: (v: number) => string, grid?: { top: number }) {
  for (const t of ticks) {
    const x = X(t);
    if (grid) svg.append(s('line', { x1: x, x2: x, y1: grid.top, y2: y, stroke: 'var(--line)', 'stroke-width': 1 }));
    svg.append(s('text', { x, y: y + 16, 'text-anchor': 'middle' }, fmt(t)));
  }
}

export function hatchPattern(svg: SVGSVGElement, id: string, color: string, bg = 'transparent'): void {
  const defs = svg.querySelector('defs') ?? svg.insertBefore(s('defs'), svg.firstChild);
  defs.append(
    s('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' },
      s('rect', { width: 8, height: 8, fill: bg }),
      s('line', { x1: 0, y1: 0, x2: 0, y2: 8, stroke: color, 'stroke-width': 3 })),
  );
}

let uid = 0;
export const nextId = (p: string) => `${p}-${++uid}`;

/** Render into a container at its current width; re-render when the width changes. */
export function responsive(container: HTMLElement, render: (width: number) => SVGSVGElement): void {
  let lastW = 0;
  const draw = () => {
    const w = Math.max(280, Math.floor(container.clientWidth));
    if (w === lastW) return;
    lastW = w;
    container.replaceChildren(render(w));
  };
  draw();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => requestAnimationFrame(draw)).observe(container);
}
