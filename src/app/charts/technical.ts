/** Technical evidence charts for the expandable "How this was measured" section. */
import type { AnalysisResult } from '../../pipeline';
import type { Frame } from '../../types';
import { powerSpectrum, dominantFrequency } from '../../dsp/fft';
import { s } from '../dom';
import { hatchPattern, linePath, nextId, niceTicks, scale, svgRoot } from './core';

function timeAxis(svg: SVGSVGElement, X: (v: number) => number, t0: number, t1: number, y: number) {
  for (const t of niceTicks(t0, t1, 6)) svg.append(s('text', { x: X(t), y, 'text-anchor': 'middle' }, `${t} s`));
}

/** Brightness as the camera recorded it, with corrected exposure changes marked. */
export function rawChart(r: AnalysisResult, frames: Frame[], w: number): SVGSVGElement {
  const pre = r.pre!;
  const h = 170, left = 44, right = w - 8, top = 12, bottom = h - 28;
  const t0 = frames[0].t;
  const xs = frames.map((f) => f.t - t0);
  const ys = frames.map((f) => (pre.channel === 'red' ? f.r : f.g));
  const fin = ys.filter(Number.isFinite);
  const lo = Math.min(...fin), hi = Math.max(...fin);
  const X = scale(0, xs[xs.length - 1], left, right);
  const Y = scale(lo - (hi - lo) * 0.05, hi + (hi - lo) * 0.05, bottom, top);
  const svg = svgRoot(w, h, `Raw ${pre.channel} brightness over ${Math.round(xs[xs.length - 1])} seconds, ${pre.exposureSteps.length} exposure changes corrected.`);
  for (const t of niceTicks(lo, hi, 3)) {
    svg.append(s('line', { x1: left, x2: right, y1: Y(t), y2: Y(t), stroke: 'var(--line)' }));
    svg.append(s('text', { x: left - 6, y: Y(t) + 4, 'text-anchor': 'end' }, `${Math.round(t)}`));
  }
  svg.append(s('path', { d: linePath(xs, ys, X, Y), fill: 'none', stroke: pre.channel === 'red' ? 'var(--signal)' : 'var(--good)', 'stroke-width': 1.2 }));
  for (const st of pre.exposureSteps) {
    const x = X(st.t + r.analysisOffsetSec);
    svg.append(s('line', { x1: x, x2: x, y1: top, y2: bottom, stroke: 'var(--ink)', 'stroke-dasharray': '3 3' }));
  }
  timeAxis(svg, X, 0, xs[xs.length - 1], h - 6);
  return svg;
}

/** Filtered pulse signal with detected beats and left-out stretches. */
export function signalChart(r: AnalysisResult, w: number, window?: [number, number]): SVGSVGElement {
  const pre = r.pre!;
  const off = r.analysisOffsetSec;
  const n = pre.detect.length;
  const [a, b] = window ?? [off, off + n / pre.fs];
  const h = 190, left = 8, right = w - 8, top = 12, bottom = h - 28;
  const i0 = Math.max(0, Math.floor((a - off) * pre.fs)), i1 = Math.min(n, Math.ceil((b - off) * pre.fs));
  const xs = Float64Array.from({ length: i1 - i0 }, (_, i) => (i0 + i) / pre.fs + off);
  const ys = pre.detect.slice(i0, i1);
  let amp = 0;
  for (let i = 0; i < ys.length; i++) if (!r.quality!.badMask[i0 + i]) amp = Math.max(amp, Math.abs(ys[i]));
  amp = amp || 1;
  const X = scale(a, b, left, right);
  const Y = scale(-amp * 1.15, amp * 1.15, bottom, top);
  const svg = svgRoot(w, h, `Filtered pulse signal from ${Math.round(a)} to ${Math.round(b)} seconds with ${r.beats.length} detected beats.`);
  const hatch = nextId('h');
  hatchPattern(svg, hatch, 'var(--line)', 'transparent');
  for (const iv of r.quality!.artifacts) {
    const x0 = Math.max(left, X(iv.start)), x1 = Math.min(right, X(iv.end));
    if (x1 > x0) svg.append(s('rect', { x: x0, y: top, width: x1 - x0, height: bottom - top, fill: `url(#${hatch})` }));
  }
  svg.append(s('line', { x1: left, x2: right, y1: Y(0), y2: Y(0), stroke: 'var(--line)' }));
  svg.append(s('path', { d: linePath(xs, Array.from(ys, (v) => Math.max(-amp * 1.15, Math.min(amp * 1.15, v))), X, Y), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.3 }));
  r.beats.forEach((bt, i) => {
    const t = bt.maxSlopePos / pre.fs + off;
    if (t < a || t > b) return;
    const v = pre.detect[Math.round(bt.maxSlopePos)];
    svg.append(s('circle', { cx: X(t), cy: Y(Math.max(-amp, Math.min(amp, v))), r: 3.2, fill: r.beatClean[i] ? 'var(--signal)' : 'var(--surface)', stroke: r.beatClean[i] ? 'none' : 'var(--ink-3)' }));
  });
  timeAxis(svg, X, a, b, h - 6);
  return svg;
}

/** Power spectrum of the pulse signal: the tallest peak is the heart rate. */
export function spectrumChart(r: AnalysisResult, w: number): SVGSVGElement {
  const pre = r.pre!;
  const spec = powerSpectrum(pre.detect.filter((_, i) => !r.quality!.badMask[i]), pre.fs, 16384);
  const fMax = 5;
  const k1 = Math.floor(fMax / spec.df);
  const xs = Array.from({ length: k1 }, (_, k) => spec.freqs[k]);
  const ys = Array.from({ length: k1 }, (_, k) => spec.power[k]);
  const peak = dominantFrequency(spec, 0.6, 3.5);
  const pmax = Math.max(...ys);
  const h = 170, left = 8, right = w - 8, top = 26, bottom = h - 28;
  const X = scale(0, fMax, left, right);
  const Y = scale(0, pmax * 1.05, bottom, top);
  const svg = svgRoot(w, h, `Frequency spectrum with the strongest peak at ${peak.freq.toFixed(2)} hertz, ${Math.round(peak.freq * 60)} beats per minute.`);
  svg.append(s('path', { d: `${linePath(xs, ys, X, Y)}L${X(xs[xs.length - 1])},${bottom}L${X(0)},${bottom}Z`, fill: 'var(--signal-soft)', stroke: 'var(--signal)', 'stroke-width': 1.5 }));
  const px = X(peak.freq);
  svg.append(s('text', { x: px + 8, y: top - 8 + 10, class: 'label-strong' }, `${peak.freq.toFixed(2)} Hz = ${Math.round(peak.freq * 60)} beats/min`));
  for (let f = 0; f <= fMax; f++) svg.append(s('text', { x: X(f), y: h - 6, 'text-anchor': 'middle' }, `${f} Hz`));
  return svg;
}

/** Every usable beat overlaid, and their average. */
export function ensembleChart(r: AnalysisResult, w: number): SVGSVGElement {
  const ens = r.ensemble!;
  const len = ens.template.length;
  const h = 220, left = 8, right = w - 8, top = 12, bottom = h - 28;
  const tAxis = Float64Array.from({ length: len }, (_, i) => ((i - ens.alignIdx) / ens.fs) * 1000);
  const X = scale(tAxis[0], tAxis[len - 1], left, right);
  const Y = scale(-0.35, 1.15, bottom, top);
  const kept = ens.accepted.filter(Boolean).length;
  const svg = svgRoot(w, h, `${ens.beats.length} beats overlaid; ${kept} used in the average, ${ens.beats.length - kept} rejected as outliers.`);
  ens.beats.forEach((b, i) => svg.append(s('path', { d: linePath(tAxis, b, X, Y), fill: 'none', stroke: ens.accepted[i] ? 'var(--ink-3)' : 'var(--poor)', 'stroke-width': 1, opacity: ens.accepted[i] ? 0.18 : 0.5 })));
  svg.append(s('path', { d: linePath(tAxis, ens.template, X, Y), fill: 'none', stroke: 'var(--signal)', 'stroke-width': 3 }));
  svg.append(s('line', { x1: X(0), x2: X(0), y1: top, y2: bottom, stroke: 'var(--ink)', 'stroke-dasharray': '3 3' }));
  svg.append(s('text', { x: X(0) + 6, y: top + 12 }, 'aligned on steepest upstroke'));
  for (const t of niceTicks(tAxis[0], tAxis[len - 1], 6)) svg.append(s('text', { x: X(t), y: h - 6, 'text-anchor': 'middle' }, `${t} ms`));
  return svg;
}

/** Average beat with its second derivative (acceleration) and the a–e waves. */
export function apgChart(r: AnalysisResult, w: number): SVGSVGElement {
  const m = r.morphology!;
  const n = m.contour.length;
  const h = 260, left = 8, right = w - 8;
  const tAxis = Float64Array.from({ length: n }, (_, i) => (i / m.fs) * 1000);
  const X = scale(0, tAxis[n - 1], left, right);
  const Yc = scale(0, 1, 100, 14);
  const d2max = Math.max(...Array.from(m.d2, Math.abs)) || 1;
  const Yd = scale(-1, 1, 232, 128);
  const svg = svgRoot(w, h, m.apg
    ? `Second derivative waves: b/a ${m.apg.ba.toFixed(2)}, d/a ${m.apg.da.toFixed(2)}, aging index ${m.apg.agi.toFixed(2)}.`
    : 'Second derivative of the average beat; the a to e waves could not be identified.');
  svg.append(s('text', { x: left, y: 12 }, 'Average beat'));
  svg.append(s('path', { d: linePath(tAxis, m.contour, X, Yc), fill: 'none', stroke: 'var(--signal)', 'stroke-width': 2.2 }));
  svg.append(s('text', { x: left, y: 124 }, 'Acceleration (second derivative)'));
  svg.append(s('line', { x1: left, x2: right, y1: Yd(0), y2: Yd(0), stroke: 'var(--line)' }));
  svg.append(s('path', { d: linePath(tAxis, Array.from(m.d2, (v) => v / d2max), X, Yd), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.8 }));
  if (m.apg) {
    for (const k of ['a', 'b', 'c', 'd', 'e'] as const) {
      const p = m.apg[k];
      const x = X(tAxis[p.idx]), y = Yd(m.d2[p.idx] / d2max);
      svg.append(s('circle', { cx: x, cy: y, r: 4, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2 }));
      svg.append(s('text', { x, y: p.value >= 0 ? y - 9 : y + 19, 'text-anchor': 'middle', class: 'label-strong' }, k));
    }
  }
  for (const t of niceTicks(0, tAxis[n - 1], 5)) svg.append(s('text', { x: X(t), y: h - 4, 'text-anchor': 'middle' }, `${t} ms`));
  return svg;
}
