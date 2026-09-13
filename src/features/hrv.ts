/**
 * Heart rate and ultra-short-term heart rate variability from pulse intervals.
 *
 * Pulse-to-pulse intervals from PPG are a surrogate for ECG R–R intervals ("pulse rate
 * variability"). Agreement is good at rest in healthy people but degrades with movement, arrhythmia
 * and changes in pulse transit time (Schäfer & Vagedes 2013, Int J Cardiol 166:15).
 *
 * The standard SDNN window is 5 minutes (Task Force of ESC/NASPE 1996, Circulation 93:1043). This
 * app analyses about 60 s, which counts as ultra-short-term. RMSSD over 60 s tracks 5-minute RMSSD
 * reasonably well; SDNN over 60 s systematically underestimates the 5-minute value because it misses
 * slower oscillations (Munoz et al. 2015, PLoS ONE 10:e0138921; Shaffer & Ginsberg 2017, Front
 * Public Health 5:258). Both are reported with that label.
 *
 * Timing-noise floor. Each detected beat time carries error roughly equal to sensor noise divided
 * by upstroke slope. White timing error of σ adds √2·σ to RMSSD in quadrature, so when true
 * variability is low the measured RMSSD is dominated by noise. The floor is estimated per
 * recording from the noise level above the cardiac band (10–14 Hz, extrapolated to the 0.5–4 Hz
 * detection band) and the median upstroke slope. On synthetic recordings this estimate came out
 * 1.0–1.9× the true timing error, so it errs on the side of warning. It assumes roughly white noise,
 * which real camera noise (compression, auto-exposure) only approximates.
 */
import { bandPower, powerSpectrum } from '../dsp/fft';
import { sgFirstDerivative } from '../dsp/derivative';
import type { Preprocessed } from '../dsp/preprocess';
import type { Beat } from '../dsp/peaks';

export function estimateTimingNoiseMs(pre: Preprocessed, beats: Beat[]): number | null {
  if (beats.length < 5) return null;
  const spec = powerSpectrum(pre.ppg, pre.fs, 16384);
  const bins = (f0: number, f1: number) => Math.floor(f1 / spec.df) - Math.ceil(f0 / spec.df) + 1;
  const hi = Math.min(14, 0.45 * pre.frameRate);
  const lo = Math.min(10, hi - 2);
  if (lo <= 4.5) return null; // frame rate too low to see a noise-only band
  const perBin = bandPower(spec, lo, hi) / bins(lo, hi);
  const variance = (2 * perBin * bins(0.5, 4)) / pre.ppg.length;
  const d1 = sgFirstDerivative(pre.detect, pre.fs, Math.max(2, Math.round(0.035 * pre.fs)));
  const slopes = beats.map((b) => d1[Math.round(b.maxSlopePos)]).filter((v) => v > 0).sort((a, b) => a - b);
  if (!slopes.length) return null;
  return (1000 * Math.sqrt(variance)) / slopes[slopes.length >> 1];
}

export interface Hrv {
  heartRateBpm: number;
  meanIbiMs: number;
  sdnnMs: number | null;
  rmssdMs: number | null;
  pnn50Pct: number | null;
  /** Estimated per-beat timing error, ms (see header) */
  timingNoiseMs: number | null;
  /** RMSSD that timing noise alone would produce, √2·σ, ms */
  rmssdNoiseFloorMs: number | null;
  /** False unless RMSSD exceeds twice the noise floor. Deliberately strict: on synthetic data the
   * inflation from timing error was larger than white-noise theory predicts. */
  rmssdAboveNoise: boolean;
  /** Intervals retained after artifact rejection */
  validIntervals: number;
  totalIntervals: number;
  durationSec: number;
  /** Interval values in ms with validity, for plotting a tachogram */
  intervals: Array<{ tSec: number; ms: number; valid: boolean }>;
}

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param beatTimes seconds, ascending (e.g. max-slope times)
 * @param contiguous for each interval i (between beat i and i+1), whether both beats lie in the
 *   same clean segment. Intervals spanning an artifact are never used.
 */
export function computeHrv(beatTimes: number[], contiguous?: boolean[], timingNoiseMs: number | null = null): Hrv | null {
  const intervals: Hrv['intervals'] = [];
  for (let i = 1; i < beatTimes.length; i++) {
    intervals.push({ tSec: beatTimes[i], ms: (beatTimes[i] - beatTimes[i - 1]) * 1000, valid: contiguous ? contiguous[i - 1] : true });
  }
  if (intervals.length < 5) return null;

  // Artifact rejection: physiological range, then deviation > 20% from the local median of
  // 7 intervals (a common threshold for ectopic or missed-beat detection).
  for (const iv of intervals) if (iv.ms < 300 || iv.ms > 2000) iv.valid = false;
  intervals.forEach((iv, i) => {
    if (!iv.valid) return;
    const win = intervals.slice(Math.max(0, i - 3), i + 4).filter((x) => x.ms >= 300 && x.ms <= 2000).map((x) => x.ms);
    if (Math.abs(iv.ms - median(win)) / median(win) > 0.2) iv.valid = false;
  });

  const valid = intervals.filter((x) => x.valid).map((x) => x.ms);
  if (valid.length < 5) return null;
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const sdnn = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / (valid.length - 1));

  // Successive differences only between adjacent intervals that are both valid
  const diffs: number[] = [];
  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].valid && intervals[i - 1].valid) diffs.push(intervals[i].ms - intervals[i - 1].ms);
  }
  const rmssd = diffs.length >= 4 ? Math.sqrt(diffs.reduce((a, d) => a + d * d, 0) / diffs.length) : null;
  const pnn50 = diffs.length >= 4 ? (diffs.filter((d) => Math.abs(d) > 50).length / diffs.length) * 100 : null;

  const floor = timingNoiseMs !== null ? Math.SQRT2 * timingNoiseMs : null;
  return {
    timingNoiseMs,
    rmssdNoiseFloorMs: floor,
    rmssdAboveNoise: rmssd !== null && (floor === null || rmssd > 2 * floor),
    heartRateBpm: 60000 / mean,
    meanIbiMs: mean,
    sdnnMs: valid.length >= 10 ? sdnn : null,
    rmssdMs: rmssd,
    pnn50Pct: pnn50,
    validIntervals: valid.length,
    totalIntervals: intervals.length,
    durationSec: beatTimes[beatTimes.length - 1] - beatTimes[0],
    intervals,
  };
}
