/**
 * "What happens to the signal": the real processing stages, run in the visitor's browser on a
 * simulated phone-camera recording when the section scrolls into view.
 */
import { h, s } from '../dom';
import { SYNTH_CASES, synthesize } from '../../sim/ppgSynth';
import { analyse, type AnalysisResult } from '../../pipeline';
import { linePath, scale } from '../charts/core';
import type { Frame } from '../../types';

const W = 300, H = 120;

function mini(label: string): SVGSVGElement {
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pipe-svg', role: 'img', 'aria-label': label, preserveAspectRatio: 'none' });
}

function windowed(r: AnalysisResult, sec: number) {
  const pre = r.pre!;
  const a = Math.round(20 * pre.fs), b = Math.min(pre.ppg.length, a + Math.round(sec * pre.fs));
  return { a, b, pre };
}

function stageRaw(frames: Frame[]): SVGSVGElement {
  const sel = frames.filter((f) => f.t > 25 && f.t < 33);
  const xs = sel.map((f) => f.t), ys = sel.map((f) => f.r);
  const svg = mini('Raw brightness from the camera: slow drift, a jump, and noise, with the pulse as tiny ripples.');
  // Robust scale (2nd–98th percentile) so one glitch frame pokes out without hiding the pulse ripples
  const sorted = [...ys].sort((p, q) => p - q);
  const lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.floor(sorted.length * 0.98)];
  const pad = (hi - lo) * 0.15;
  const clipped = ys.map((v) => Math.max(lo - pad * 1.5, Math.min(hi + pad * 1.5, v)));
  svg.append(s('path', { d: linePath(xs, clipped, scale(xs[0], xs[xs.length - 1], 4, W - 4), scale(lo - pad * 1.5, hi + pad * 1.5, H - 6, 6)), fill: 'none', stroke: 'var(--signal)', 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function stageClean(r: AnalysisResult): SVGSVGElement {
  const { a, b, pre } = windowed(r, 8);
  const ys = Array.from(pre.detect.slice(a, b));
  const xs = ys.map((_, i) => i);
  const amp = Math.max(...ys.map(Math.abs)) || 1;
  const svg = mini('The pulse signal after camera corrections and filtering.');
  svg.append(s('path', { d: linePath(xs, ys, scale(0, xs.length - 1, 4, W - 4), scale(-amp, amp, H - 8, 8)), fill: 'none', stroke: 'var(--ink)', 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function stageBeats(r: AnalysisResult): SVGSVGElement {
  const { a, b, pre } = windowed(r, 8);
  const ys = Array.from(pre.detect.slice(a, b));
  const xs = ys.map((_, i) => i);
  const amp = Math.max(...ys.map(Math.abs)) || 1;
  const X = scale(0, xs.length - 1, 4, W - 4), Y = scale(-amp, amp, H - 8, 8);
  const svg = mini('Each heartbeat located in the signal.');
  svg.append(s('path', { d: linePath(xs, ys, X, Y), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }));
  for (const bt of r.beats) {
    const i = Math.round(bt.maxSlopePos) - a;
    if (i < 0 || i >= ys.length) continue;
    svg.append(s('line', { x1: X(i), x2: X(i), y1: 6, y2: H - 6, stroke: 'var(--signal)', 'stroke-width': 1.2, opacity: 0.35, 'vector-effect': 'non-scaling-stroke' }));
    svg.append(s('circle', { cx: X(i), cy: Y(ys[i]), r: 3.4, fill: 'var(--signal)' }));
  }
  return svg;
}

function stageAverage(r: AnalysisResult): SVGSVGElement {
  const e = r.ensemble!;
  const len = e.template.length;
  const xs = Array.from({ length: len }, (_, i) => i);
  const X = scale(0, len - 1, 4, W - 4), Y = scale(-0.3, 1.1, H - 6, 6);
  const svg = mini('Individual beats overlaid, and their average.');
  e.beats.filter((_, i) => e.accepted[i]).slice(0, 40).forEach((row) => svg.append(s('path', { d: linePath(xs, row, X, Y), fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': 1, opacity: 0.16, 'vector-effect': 'non-scaling-stroke' })));
  svg.append(s('path', { d: linePath(xs, e.template, X, Y), fill: 'none', stroke: 'var(--signal)', 'stroke-width': 2.6, 'vector-effect': 'non-scaling-stroke' }));
  return svg;
}

function stageShape(r: AnalysisResult): SVGSVGElement {
  const m = r.morphology!;
  const n = m.contour.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const X = scale(0, n - 1, 6, W - 6), Y = scale(0, 1.05, H - 10, 10);
  const svg = mini('The average beat with its measured points marked.');
  svg.append(s('path', { d: `${linePath(xs, m.contour, X, Y)}L${X(n - 1)},${H - 10}L${X(0)},${H - 10}Z`, fill: 'var(--signal-soft)', opacity: 0.7 }));
  svg.append(s('path', { d: linePath(xs, m.contour, X, Y), fill: 'none', stroke: 'var(--signal)', 'stroke-width': 2.4, 'vector-effect': 'non-scaling-stroke' }));
  const pts = [m.systolicIdx, m.notch.present ? m.notch.idx : -1, m.diastolic?.idx ?? -1].filter((i) => i >= 0);
  for (const i of pts) svg.append(s('circle', { cx: X(i), cy: Y(m.contour[i]), r: 4.5, fill: 'var(--surface)', stroke: 'var(--ink)', 'stroke-width': 2 }));
  return svg;
}

export function pipelineSection(): { el: HTMLElement; start(): () => void } {
  const grid = h('ol', { class: 'pipe' });
  const stamp = h('p', { class: 'pipe-stamp', 'aria-live': 'polite' }, 'The analysis runs when this section comes into view.');
  const el = h('section', { class: 'band', 'aria-labelledby': 'pipe-title' },
    h('div', { class: 'wrap' },
      h('div', { class: 'pipe-head' },
        h('div', {},
          h('p', { class: 'kicker' }, 'Under the hood'),
          h('h2', { id: 'pipe-title', class: 'section-title' }, 'What happens to the signal'),
          h('p', { class: 'section-lede' }, 'A raw camera recording is noisy: the camera keeps adjusting its brightness, and the pulse is a ripple of about 1%. Five steps turn it into something that can be measured.'),
        ),
        stamp,
      ),
      grid,
    ),
  );

  const stage = (n: string, title: string, fact: string, body: string, svg: SVGSVGElement) =>
    h('li', { class: 'pipe-stage', style: `--i:${n}` },
      h('div', { class: 'pipe-chart' }, svg),
      h('h3', {}, title),
      h('p', { class: 'pipe-fact num' }, fact),
      h('p', {}, body));

  const start = () => {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      const t0 = performance.now();
      const c = SYNTH_CASES[0];
      const { frames } = synthesize({ ...c, seed: 1 + Math.floor(Math.random() * 500) }, { durationSec: 65, camera: 'phone' });
      const r = analyse(frames, { heightCm: c.heightCm }, { kind: 'simulated', caseId: 'pipeline-demo' }, { bootstrapIterations: 60 });
      const ms = performance.now() - t0;
      if (!r.pre || !r.ensemble || !r.morphology) { stamp.textContent = 'The demonstration recording did not pass the quality checks this time. Reload to try another.'; return; }
      grid.replaceChildren(
        stage('0', 'Read brightness', `${frames.length.toLocaleString()} frames`, 'The average colour of each camera frame, timestamped. Video is never stored.', stageRaw(frames)),
        stage('1', 'Correct the camera', `${r.pre.exposureSteps.length} jumps fixed`, 'Automatic brightness changes and glitch frames are removed, then drift and noise are filtered out.', stageClean(r)),
        stage('2', 'Find heartbeats', `${r.beats.length} beats`, 'Each beat is located at its steepest rise. Moments of movement are left out.', stageBeats(r)),
        stage('3', 'Average the beats', `${r.ensemble.accepted.filter(Boolean).length} averaged`, 'Beats are lined up and averaged, which cancels random noise and keeps their shared shape.', stageAverage(r)),
        stage('4', 'Measure the shape', `peak at ${Math.round(r.morphology.crestTimeMs)} ms`, 'Peak timing, notch and reflected wave are measured, and checked by resampling the beats.', stageShape(r)),
      );
      grid.classList.add('ran');
      stamp.replaceChildren(h('strong', {}, `Ran in ${Math.round(ms)} ms in your browser`), ' on a simulated phone-camera recording, using the same code as a live reading.');
    };
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { run(); io?.disconnect(); } }, { rootMargin: '200px' })
      : null;
    if (io) io.observe(el); else run();
    return () => io?.disconnect();
  };
  return { el, start };
}
