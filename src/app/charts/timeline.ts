import type { AnalysisResult } from '../../pipeline';
import { s } from '../dom';
import { hatchPattern, nextId, scale, svgRoot } from './core';

/** The whole recording as one strip: every detected heartbeat, and the stretches left out. */
export function timelineChart(r: AnalysisResult, w: number): SVGSVGElement {
  const pre = r.pre!;
  const q = r.quality!;
  const off = r.analysisOffsetSec;
  const dur = pre.ppg.length / pre.fs;
  const h = 104;
  const left = 4, right = w - 4;
  const X = scale(off, off + dur, left, right);
  const beatsUsed = r.beatClean.filter(Boolean).length;
  const svg = svgRoot(w, h, `Recording timeline from ${Math.round(off)} to ${Math.round(off + dur)} seconds: ${beatsUsed} heartbeats used, ${q.artifacts.length} stretches left out.`);
  const hatch = nextId('hatch');
  hatchPattern(svg, hatch, 'var(--line-strong)', 'var(--surface-sunk)');

  const top = 26, trackH = 44;
  svg.append(s('rect', { x: left, y: top, width: right - left, height: trackH, rx: 6, fill: 'var(--surface-sunk)', stroke: 'var(--line)' }));
  for (const a of q.artifacts) {
    const x0 = Math.max(left, X(a.start)), x1 = Math.min(right, X(a.end));
    if (x1 <= x0) continue;
    svg.append(s('rect', { x: x0, y: top, width: x1 - x0, height: trackH, fill: `url(#${hatch})` }));
    if (x1 - x0 > 58) svg.append(s('text', { x: (x0 + x1) / 2, y: top - 8, 'text-anchor': 'middle' }, 'Left out'));
  }
  r.beats.forEach((b, i) => {
    const x = X(b.maxSlopePos / pre.fs + off);
    svg.append(s('line', {
      x1: x, x2: x, y1: top + 9, y2: top + trackH - 9,
      stroke: r.beatClean[i] ? 'var(--signal)' : 'var(--line-strong)', 'stroke-width': r.beatClean[i] ? 2 : 1.5, 'stroke-linecap': 'round',
    }));
  });
  const step = dur > 40 ? 10 : 5;
  for (let t = Math.ceil(off / step) * step; t <= off + dur; t += step) {
    const x = X(t);
    svg.append(s('line', { x1: x, x2: x, y1: top + trackH, y2: top + trackH + 5, stroke: 'var(--line-strong)' }));
    svg.append(s('text', { x, y: top + trackH + 20, 'text-anchor': 'middle' }, `${t} s`));
  }
  return svg;
}
