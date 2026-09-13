/**
 * Ensemble averaging.
 *
 * Individual camera-PPG beats are too noisy for second-derivative analysis. Beats are aligned
 * on the maximum-slope point of the upstroke (the most temporally precise fiducial), each is
 * re-sampled at sub-sample precision onto a fine common grid, baseline-corrected,
 * amplitude-normalised, and averaged.
 *
 * Because heartbeats are not phase-locked to the camera's frame clock, each beat samples the
 * waveform at a different sub-frame offset. Averaging aligned beats therefore recovers timing
 * detail finer than the frame interval (the principle behind equivalent-time sampling). The
 * signal still has to be band-limited below the camera's Nyquist frequency for this to hold.
 *
 * Alignment uses the max-slope fiducial from the smooth 4 Hz detection band. Iterative
 * cross-correlation re-alignment (Woody 1967) was tried and removed: on the 12 Hz morphology band
 * it fitted noise, and on 18 synthetic recordings it increased aging-index error (RMS 0.25 → 0.35)
 * and doubled b/a error.
 *
 * Outlier beats (low correlation with the median beat) are rejected before the final average.
 */
import { interpAt } from './resample';
import type { Beat } from './peaks';

export const TEMPLATE_FS = 250;

export interface Ensemble {
  /** Mean of accepted beats, TEMPLATE_FS Hz, aligned so max slope is at index `alignIdx` */
  template: Float64Array;
  /** Every candidate beat, normalised, on the same grid */
  beats: Float64Array[];
  /** Index into the input beat list for each row of `beats` (edge beats are skipped) */
  beatIndex: number[];
  correlations: number[];
  accepted: boolean[];
  alignIdx: number;
  /** Median beat period used for the window, seconds */
  period: number;
  fs: number;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function pearson(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma, db = b[i] - mb;
    sab += da * db; saa += da * da; sbb += db * db;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

export function buildEnsemble(
  morph: Float64Array,
  fs: number,
  beats: Beat[],
  period: number,
  minCorrelation = 0.85,
): Ensemble {
  const pre = 0.3 * period;
  const post = 1.05 * period;
  const alignIdx = Math.round(pre * TEMPLATE_FS);
  const len = alignIdx + Math.round(post * TEMPLATE_FS);
  const step = fs / TEMPLATE_FS;

  const cut = (centre: number): Float64Array | null => {
    const start = centre - pre * fs;
    const end = centre + post * fs;
    if (start < 0 || end >= morph.length - 2) return null;
    const seg = new Float64Array(len);
    for (let k = 0; k < len; k++) seg[k] = interpAt(morph, start + k * step);
    return normalise(seg);
  };

  const normalise = (seg: Float64Array): Float64Array | null => {
    // Baseline: straight line from this foot to the next foot, so slow drift within the beat
    // does not tilt the contour.
    let foot = 0;
    for (let k = 0; k <= alignIdx; k++) if (seg[k] < seg[foot]) foot = k;
    const expectedNext = foot + Math.round(period * TEMPLATE_FS);
    const w = Math.round(0.12 * period * TEMPLATE_FS);
    let next = Math.min(len - 1, expectedNext);
    for (let k = Math.max(foot + 1, expectedNext - w); k <= Math.min(len - 1, expectedNext + w); k++) {
      if (seg[k] < seg[next]) next = k;
    }
    const slope = next > foot ? (seg[next] - seg[foot]) / (next - foot) : 0;
    for (let k = 0; k < len; k++) seg[k] -= seg[foot] + slope * (k - foot);
    let peak = 0;
    for (let k = foot; k < Math.min(len, foot + Math.round(0.6 * period * TEMPLATE_FS)); k++) peak = Math.max(peak, seg[k]);
    if (peak <= 0) return null;
    for (let k = 0; k < len; k++) seg[k] /= peak;
    return seg;
  };

  const out: Float64Array[] = [];
  const beatIndex: number[] = [];
  beats.forEach((b, bi) => {
    const seg = cut(b.maxSlopePos);
    if (seg) { out.push(seg); beatIndex.push(bi); }
  });

  const meanOf = (rows: Float64Array[]) => {
    const m = new Float64Array(len);
    for (const r of rows) for (let k = 0; k < len; k++) m[k] += r[k];
    for (let k = 0; k < len; k++) m[k] /= rows.length || 1;
    return m;
  };

  const medianBeat = () => {
    const med = new Float64Array(len);
    for (let k = 0; k < len; k++) med[k] = median(out.map((r) => r[k]));
    return med;
  };

  const med = medianBeat();
  const correlations = out.map((r) => pearson(r, med));
  const accepted = correlations.map((r) => r >= minCorrelation);
  const template = meanOf(out.filter((_, i) => accepted[i]));

  return { template, beats: out, beatIndex, correlations, accepted, alignIdx, period, fs: TEMPLATE_FS };
}

export { median };
