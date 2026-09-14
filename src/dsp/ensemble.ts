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
 * cross-correlation re-alignment (Woody 1967) was evaluated on 24 synthetic recordings and left
 * out: it slightly reduced APG error (aging index RMS 0.39 → 0.34) but increased crest-time error
 * (6.8 → 8.4 ms) and stiffness-index error (1.2 → 1.6 m/s), so it did not earn its complexity.
 *
 * Beat rejection targets outliers, not noise: a beat is rejected when its correlation with the
 * median beat is below 0.5, or more than 3 robust standard deviations below the recording's median
 * correlation. A fixed high threshold (the first version used r ≥ 0.85) rejected most beats of
 * noisy but perfectly usable phone recordings, although averaging is exactly what removes that
 * noise.
 *
 * Reliability of the average is measured by split-half correlation: accepted beats are divided
 * alternately into two groups, each is averaged, and the two averages are correlated. This is the
 * standard reliability check for averaged waveforms (as used for evoked potentials). If two
 * independent halves of the recording give the same contour, the contour is reproducible.
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
  /** Correlation between the averages of alternate accepted beats (1 = perfectly reproducible) */
  splitHalfR: number;
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
  absoluteMinCorrelation = 0.5,
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
    const footVal = seg[foot];
    const slope = next > foot ? (seg[next] - footVal) / (next - foot) : 0;
    for (let k = 0; k < len; k++) seg[k] -= footVal + slope * (k - foot);
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
  const rMed = median(correlations);
  const rMad = median(correlations.map((r) => Math.abs(r - rMed))) * 1.4826;
  const cutoff = Math.max(absoluteMinCorrelation, rMed - 3 * Math.max(rMad, 0.01));
  const accepted = correlations.map((r) => r >= cutoff);
  const kept = out.filter((_, i) => accepted[i]);
  const template = meanOf(kept);
  const splitHalfR = kept.length >= 4
    ? pearson(meanOf(kept.filter((_, i) => i % 2 === 0)), meanOf(kept.filter((_, i) => i % 2 === 1)))
    : 0;

  return { template, beats: out, beatIndex, correlations, accepted, splitHalfR, alignIdx, period, fs: TEMPLATE_FS };
}

export { median };
