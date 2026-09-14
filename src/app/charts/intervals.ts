import type { AnalysisResult } from '../../pipeline';
import { s } from '../dom';
import { linePath, niceTicks, scale, svgRoot } from './core';

/** Time between consecutive heartbeats across the recording. */
export function intervalsChart(r: AnalysisResult, w: number): SVGSVGElement {
  const hrv = r.hrv!;
  const off = r.analysisOffsetSec;
  const dur = r.pre!.ppg.length / r.pre!.fs;
  const valid = hrv.intervals.filter((i) => i.valid);
  const vals = valid.map((i) => i.ms);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const padV = Math.max(40, (hi - lo) * 0.25);
  const h = 210;
  const left = 46, right = w - 10, top = 34, bottom = h - 30;
  const X = scale(off, off + dur, left, right);
  const Y = scale(lo - padV, hi + padV, bottom, top);
  const svg = svgRoot(w, h, `Time between heartbeats: ${Math.round(lo)} to ${Math.round(hi)} milliseconds, average ${Math.round(hrv.meanIbiMs)}.`);

  for (const t of niceTicks(lo - padV, hi + padV, 4)) {
    const y = Y(t);
    svg.append(s('line', { x1: left, x2: right, y1: y, y2: y, stroke: 'var(--line)' }));
    svg.append(s('text', { x: left - 8, y: y + 4, 'text-anchor': 'end' }, `${t}`));
  }
  svg.append(s('text', { x: left - 8, y: 16, 'text-anchor': 'end' }, 'ms'));
  const ym = Y(hrv.meanIbiMs);
  svg.append(s('line', { x1: left, x2: right, y1: ym, y2: ym, stroke: 'var(--ink-2)', 'stroke-dasharray': '5 5' }));
  svg.append(s('line', { x1: right - 150, x2: right - 126, y1: 12, y2: 12, stroke: 'var(--ink-2)', 'stroke-dasharray': '5 5' }));
  svg.append(s('text', { x: right, y: 16, 'text-anchor': 'end', class: 'label-strong' }, `average ${Math.round(hrv.meanIbiMs)} ms`));

  const xs = hrv.intervals.map((i) => i.tSec + off);
  const ys = hrv.intervals.map((i) => (i.valid ? i.ms : NaN));
  svg.append(s('path', { d: linePath(xs, ys, X, Y), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
  for (const iv of valid) svg.append(s('circle', { cx: X(iv.tSec + off), cy: Y(iv.ms), r: 2.6, fill: 'var(--signal)' }));
  for (let t = Math.ceil(off / 10) * 10; t <= off + dur; t += 10) svg.append(s('text', { x: X(t), y: h - 8, 'text-anchor': 'middle' }, `${t} s`));
  return svg;
}
