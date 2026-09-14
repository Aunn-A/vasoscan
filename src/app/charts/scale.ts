import type { AnalysisResult } from '../../pipeline';
import { s } from '../dom';
import { scale, svgRoot } from './core';

/** Experimental stiffness indicator on its 0–100 scale, with the likely range. Neutral tones only. */
export function stiffnessScale(r: AnalysisResult, w: number): SVGSVGElement {
  const sc = r.score!;
  const h = 132;
  const left = 10, right = w - 10;
  const X = scale(0, 100, left, right);
  const top = 58, trackH = 16;
  const svg = svgRoot(w, h, `Stiffness indicator ${Math.round(sc.score)} out of 100, likely between ${Math.round(sc.uncertainty.score.lo)} and ${Math.round(sc.uncertainty.score.hi)}. Ranges: lower 0 to 35, intermediate 35 to 65, higher 65 to 100.`);
  const ranges: Array<[number, number, string, string]> = [
    [0, 35, 'Lower', '#e3e8e5'],
    [35, 65, 'Intermediate', '#cdd6d1'],
    [65, 100, 'Higher', '#b3bfb9'],
  ];
  for (const [a, b, name, fill] of ranges) {
    svg.append(s('rect', { x: X(a), y: top, width: X(b) - X(a), height: trackH, fill }));
    svg.append(s('text', { x: (X(a) + X(b)) / 2, y: top + trackH + 22, 'text-anchor': 'middle', class: sc.band === name.toLowerCase() ? 'label-strong' : undefined }, name));
  }
  for (const t of [35, 65]) svg.append(s('line', { x1: X(t), x2: X(t), y1: top - 4, y2: top + trackH + 4, stroke: 'var(--surface)', 'stroke-width': 2 }));
  svg.append(s('text', { x: left, y: h - 6 }, '0'));
  svg.append(s('text', { x: right, y: h - 6, 'text-anchor': 'end' }, '100'));

  const lo = X(sc.uncertainty.score.lo), hi = X(sc.uncertainty.score.hi);
  const by = top - 12;
  svg.append(s('line', { x1: lo, x2: hi, y1: by, y2: by, stroke: 'var(--ink)', 'stroke-width': 2 }));
  svg.append(s('line', { x1: lo, x2: lo, y1: by - 5, y2: by + 5, stroke: 'var(--ink)', 'stroke-width': 2 }));
  svg.append(s('line', { x1: hi, x2: hi, y1: by - 5, y2: by + 5, stroke: 'var(--ink)', 'stroke-width': 2 }));
  const x = X(sc.score);
  svg.append(s('path', { d: `M${x - 7},${top - 2} L${x + 7},${top - 2} L${x},${top + 9} Z`, fill: 'var(--ink)' }));
  svg.append(s('line', { x1: x, x2: x, y1: top, y2: top + trackH, stroke: 'var(--ink)', 'stroke-width': 2.5 }));
  const anchor = x < 90 ? 'start' : x > w - 90 ? 'end' : 'middle';
  svg.append(s('text', { x, y: by - 14, 'text-anchor': anchor, class: 'label-strong' }, `${Math.round(sc.score)}  (likely ${Math.round(sc.uncertainty.score.lo)}–${Math.round(sc.uncertainty.score.hi)})`));
  return svg;
}
