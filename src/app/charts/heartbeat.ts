/**
 * The annotated heartbeat: the averaged pulse from this recording drawn like a textbook plate, with
 * its parts named in plain language. Every marker sits on a point the analysis actually measured.
 */
import type { AnalysisResult } from '../../pipeline';
import { contourFromEnsemble } from '../../features/morphology';
import { s } from '../dom';
import { linePath, scale, svgRoot } from './core';

export function heartbeatPlate(r: AnalysisResult, w: number): SVGSVGElement {
  const m = r.morphology!;
  const ens = r.ensemble!;
  const fs = m.fs;
  const n = m.contour.length;
  const compact = w < 560;
  const h = compact ? 380 : 420;
  const left = compact ? 12 : 24, right = w - (compact ? 12 : 24);
  const top = compact ? 64 : 70, base = h - (compact ? 100 : 104);
  const tMax = (n / fs) * 1000;
  const X = scale(0, tMax, left, right);
  const Y = scale(0, 1, base, top);
  const ms = (i: number) => (i / fs) * 1000;
  const svg = svgRoot(w, h, describe(r));
  svg.classList.add('plate');

  // Faint individual beats, re-baselined the same way as the average
  const { offset } = contourFromEnsemble(ens);
  const rows = ens.beats.filter((_, i) => ens.accepted[i]);
  const stride = Math.max(1, Math.floor(rows.length / 36));
  const faint = s('g', { class: 'plate-beats', opacity: 0.11 });
  for (let k = 0; k < rows.length; k += stride) {
    const row = rows[k];
    if (offset + n > row.length) continue;
    const seg = row.slice(offset, offset + n);
    const first = seg[0];
    const slope = (seg[n - 1] - first) / (n - 1);
    let peak = 0;
    for (let i = 0; i < n; i++) { seg[i] -= first + slope * i; peak = Math.max(peak, seg[i]); }
    if (peak <= 0) continue;
    const xs = Float64Array.from({ length: n }, (_, i) => ms(i));
    faint.append(s('path', { d: linePath(xs, seg.map((v) => v / peak), X, Y), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1 }));
  }
  svg.append(faint);

  // Baseline and time axis
  svg.append(s('line', { x1: left, x2: right, y1: base, y2: base, stroke: 'var(--line-strong)' }));
  for (let t = 0; t <= tMax; t += 200) {
    svg.append(s('line', { x1: X(t), x2: X(t), y1: base, y2: base + 5, stroke: 'var(--line-strong)' }));
    if (!compact || t % 400 === 0) svg.append(s('text', { x: X(t), y: base + 19, 'text-anchor': 'middle' }, `${t} ms`));
  }

  // The average beat
  const xs = Float64Array.from({ length: n }, (_, i) => ms(i));
  const d = linePath(xs, m.contour, X, Y);
  svg.append(s('path', { d: `${d}L${X(ms(n - 1))},${base}L${X(0)},${base}Z`, fill: 'var(--signal-soft)', opacity: 0.55, class: 'plate-area' }));
  svg.append(s('path', { d, fill: 'none', stroke: 'var(--signal)', 'stroke-width': 3.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', class: 'plate-line', pathLength: 1 }));

  const notes = s('g', { class: 'plate-notes' });
  svg.append(notes);
  const dot = (i: number, y: number) => notes.append(s('circle', { cx: X(ms(i)), cy: y, r: 5, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2 }));
  const label = (x: number, y: number, title: string, sub: string | null, anchor: 'start' | 'middle' | 'end', lx?: number, ly?: number) => {
    const g = s('g', { class: 'plate-note' });
    if (lx !== undefined && ly !== undefined) g.append(s('line', { x1: lx, y1: ly, x2: x, y2: y + (sub ? 20 : 6), stroke: 'var(--ink-3)', 'stroke-width': 1 }));
    g.append(s('text', { x, y, 'text-anchor': anchor, class: 'label-strong' }, title));
    if (sub) g.append(s('text', { x, y: y + 16, 'text-anchor': anchor }, sub));
    notes.append(g);
  };

  // Pulse begins
  const footX = X(ms(m.tangentFoot));
  notes.append(s('circle', { cx: footX, cy: base, r: 5, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2 }));

  // Main peak
  const sysX = X(ms(m.systolicIdx));
  const sysY = Y(m.contour[m.systolicIdx]);
  dot(m.systolicIdx, sysY);
  label(sysX, top - 38, 'Main peak', 'the push from the heart', compact ? 'start' : 'middle', sysX, sysY - 8);

  // Timing dimensions on one row below the axis: foot → peak, then peak → reflected wave
  const dimY = base + 44;
  const dim = (x0: number, x1: number, text: string, anchorX: number, anchor: 'start' | 'middle' | 'end', strong = true, textDy = 22) => {
    const g = s('g', { class: 'plate-note' });
    for (const [a, b] of [[x0, x1]]) g.append(s('line', { x1: a, x2: b, y1: dimY, y2: dimY, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    for (const x of [x0, x1]) g.append(s('line', { x1: x, x2: x, y1: dimY - 6, y2: dimY + 6, stroke: 'var(--ink)', 'stroke-width': 1.5 }));
    g.append(s('text', { x: anchorX, y: dimY + textDy, 'text-anchor': anchor, class: strong ? 'label-strong' : undefined }, text));
    notes.append(g);
  };
  const ctText = compact ? `${Math.round(m.crestTimeMs)} ms to peak` : `Time to peak ${Math.round(m.crestTimeMs)} ms`;
  dim(footX, sysX, ctText, footX, 'start');

  // Reflected wave
  if (m.diastolic) {
    const di = m.diastolic.idx;
    const dx = X(ms(di)), dy = Y(m.contour[di]);
    dot(di, dy);
    if (compact) {
      label(right - 4, Math.max(top + 30, dy - 58), 'Reflected wave', m.diastolic.method === 'peak' ? 'from further down the body' : 'a shoulder on the downslope', 'end', dx + 3, dy - 8);
    } else {
      const lx = Math.min(right - 4, dx + 30);
      label(lx, Math.max(top + 6, dy - 70), 'Reflected wave', m.diastolic.method === 'peak' ? 'returning from further down the body' : 'a shoulder on the downslope', lx > right - 230 ? 'end' : 'start', dx + 4, dy - 8);
    }
    if (m.notch.present) {
      const nx = X(ms(m.notch.idx)), ny = Y(m.contour[m.notch.idx]);
      dot(m.notch.idx, ny);
      label(nx, ny + 44, 'Notch', 'where the two waves meet', 'middle', nx, ny + 6);
    }
    const dtText = `then ${Math.round(m.deltaTMs!)} ms to the reflected wave`;
    if (compact) dim(sysX, dx, dtText, Math.min(sysX, right - 215), 'start', false, 40);
    else dim(sysX, dx, dtText, Math.min(right, Math.max(sysX + 8, dx)), dx > right - 220 ? 'end' : 'start', false);
  } else {
    // Merged: point at the late part of the broad peak, labelled lower and to the right so it
    // never collides with the main-peak label above
    const i = Math.min(n - 1, m.systolicIdx + Math.round(0.1 * n));
    const x = X(ms(i)), y = Y(m.contour[i]);
    const lx = Math.min(right - 4, x + (compact ? 34 : 60));
    const ly = Y(0.62);
    const anchor = lx > right - 170 ? 'end' : 'start';
    label(anchor === 'end' ? right - 4 : lx, ly, 'Reflected wave', 'merged into the main peak', anchor, x + 3, y + 4);
  }
  return svg;
}

function describe(r: AnalysisResult): string {
  const m = r.morphology!;
  const parts = [`Average heartbeat from ${r.quality?.metrics.acceptedBeats ?? 0} beats. Main peak ${Math.round(m.crestTimeMs)} milliseconds after the pulse begins.`];
  if (m.notch.present && m.deltaTMs !== null) parts.push(`A notch separates a reflected wave ${Math.round(m.deltaTMs)} milliseconds after the peak.`);
  else if (m.diastolic) parts.push(`The reflected wave appears as a shoulder ${Math.round(m.deltaTMs!)} milliseconds after the peak.`);
  else parts.push('The reflected wave has merged into the main peak.');
  return parts.join(' ');
}
