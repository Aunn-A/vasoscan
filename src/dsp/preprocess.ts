/**
 * Frames → uniform PPG signals.
 *
 * 1. Channel choice. Under the phone torch, haemoglobin absorbs green strongly and red weakly,
 *    so red carries most light through the finger and green carries a stronger relative pulse.
 *    Red is usually clean but can clip at 255; green is dim but pulsatile. Both are scored by
 *    how concentrated their power is around the heart rate, and the better one is used.
 * 2. Resample to a uniform 60 Hz grid from the frame timestamps.
 * 3. Take log intensity and correct camera exposure steps (see correctExposure), then convert to
 *    absorbance change −ln(I/Ī) (Beer–Lambert). Blood volume up means intensity down, so the sign
 *    gives the conventional upward systolic PPG, and the log makes amplitude independent of torch
 *    brightness and camera gain.
 * 4. Linear detrend, then two zero-phase bandpass versions:
 *    - detection band 0.5–4 Hz: fundamental plus low harmonics, smooth enough for robust peaks
 *    - morphology band 0.4 Hz to min(12 Hz, 0.4 × frame rate): keeps the harmonics that form the
 *      dicrotic notch and the second-derivative waves. A 4 Hz cutoff would erase exactly the features
 *      being measured. Testing on the synthetic model showed an 8 Hz cutoff inflates APG ratios
 *      (b/a −1.04 against a true −0.64) because the sharp a-wave is attenuated most; 12 Hz halves
 *      that bias. The cap at 0.4 × frame rate keeps the cutoff safely below the camera's Nyquist
 *      frequency. See scripts/compare-synthetic.ts.
 */
import type { Frame } from '../types';
import { bandPower, dominantFrequency, powerSpectrum } from './fft';
import { bandpass, detrendLinear, movingAverage } from './filters';
import { resampleUniform } from './resample';
import { classifyFrame } from '../quality/frame';

export const ANALYSIS_FS = 60;
export const DETECT_BAND: [number, number] = [0.5, 4];
export const MORPH_LOW = 0.4;
export const MORPH_HIGH_MAX = 12;

export type Channel = 'red' | 'green';

export interface Preprocessed {
  fs: number;
  t0: number;
  channel: Channel;
  /** Resampled raw intensity of the chosen channel (for DC and perfusion) */
  raw: Float64Array;
  /** Log intensity of the chosen channel after exposure-step correction */
  logCorrected: Float64Array;
  /** Camera exposure changes that were detected and corrected */
  exposureSteps: ExposureStep[];
  /** Single-frame glitches replaced before resampling */
  glitchFrames: number;
  /** Capture timestamps of replaced frames */
  glitchTimes: number[];
  /** Absorbance change −ln(I/Ī) after exposure correction, detrended, unfiltered */
  ppg: Float64Array;
  detect: Float64Array;
  morph: Float64Array;
  /** Upper cutoff actually used for the morphology band, Hz */
  morphHigh: number;
  /** Fraction of 0.5–8 Hz power within ±0.15 Hz of the heart rate and its 2nd harmonic */
  spectralConcentration: Record<Channel, number>;
  /** Effective camera frame rate, frames per second */
  frameRate: number;
}

function cardiacConcentration(x: Float64Array, fs: number): number {
  const spec = powerSpectrum(x, fs, 16384);
  const f = dominantFrequency(spec, 0.6, 3.5).freq;
  const total = bandPower(spec, 0.5, 8);
  const cardiac = bandPower(spec, f - 0.15, f + 0.15) + bandPower(spec, 2 * f - 0.15, 2 * f + 0.15);
  return total > 0 ? cardiac / total : 0;
}

export interface ExposureStep {
  /** Seconds from the start of the analysis signal */
  t: number;
  /** Brightness ratio after / before */
  ratio: number;
}

/**
 * Camera exposure compensation.
 *
 * Phone cameras adjust exposure and gain continuously, and they cannot be locked from a browser
 * on iOS. A gain change multiplies every colour channel by the same factor, so in log intensity it
 * is an equal additive step in red and green. (A power-law tone curve preserves this: (kI)^γ shifts
 * log intensity by γ·log k in every channel.) Movement or finger pressure instead changes how much
 * blood is in the light path, which changes red and green by different amounts.
 *
 * Steps are found as abrupt level changes in 1 s averages of log red and log green that are larger
 * than 3%, flat on either side, and agree in sign and size between the channels. Each is removed by subtracting a
 * ramped offset across the transition. Level changes that do not agree between channels are left
 * in place for the motion detector.
 */
export function correctExposure(logR: Float64Array, logG: Float64Array, fs: number): { r: Float64Array; g: Float64Array; steps: ExposureStep[] } {
  const n = logR.length;
  const r = Float64Array.from(logR);
  const g = Float64Array.from(logG);
  const w = Math.round(0.6 * fs);
  const steps: ExposureStep[] = [];
  const mr = movingAverage(r, Math.round(fs));
  const mg = movingAverage(g, Math.round(fs));
  const dr = new Float64Array(n);
  const dg = new Float64Array(n);
  for (let i = w; i < n - w; i++) { dr[i] = mr[i + w] - mr[i - w]; dg[i] = mg[i + w] - mg[i - w]; }
  let i = w;
  while (i < n - w) {
    // local extremum of |dr| above threshold
    if (Math.abs(dr[i]) > 0.03 && Math.abs(dr[i]) >= Math.abs(dr[i - 1]) && Math.abs(dr[i]) >= Math.abs(dr[i + 1])) {
      const consistent = Math.sign(dr[i]) === Math.sign(dg[i]) && Math.abs(dr[i] - dg[i]) < 0.35 * Math.abs(dr[i]);
      // Step-like: the level is roughly flat in the second before and the second after the change,
      // which separates an exposure jump from slow drift or breathing.
      const before = i - 2 * w >= 0 ? Math.abs(mr[i - w] - mr[i - 2 * w]) : 0;
      const after = i + 2 * w < n ? Math.abs(mr[i + 2 * w] - mr[i + w]) : 0;
      const stepLike = before < 0.4 * Math.abs(dr[i]) && after < 0.4 * Math.abs(dr[i]);
      if (consistent && stepLike) {
        const sr = dr[i], sg = dg[i];
        for (let j = i - w; j < n; j++) {
          const ramp = Math.min(1, Math.max(0, (j - (i - w)) / (2 * w)));
          r[j] -= sr * ramp;
          g[j] -= sg * ramp;
        }
        steps.push({ t: i / fs, ratio: Math.exp(sr) });
        // recompute differences after the correction
        const mr2 = movingAverage(r, Math.round(fs));
        const mg2 = movingAverage(g, Math.round(fs));
        for (let k = w; k < n - w; k++) { dr[k] = mr2[k + w] - mr2[k - w]; dg[k] = mg2[k + w] - mg2[k - w]; }
        i += w;
        continue;
      }
    }
    i++;
  }
  return { r, g, steps };
}

/** Absorbance change −ln(I/Ī) (Beer–Lambert), detrended. Input is already log intensity. */
function absorbance(logI: Float64Array): Float64Array {
  let mean = 0;
  for (let i = 0; i < logI.length; i++) mean += logI[i];
  mean /= logI.length || 1;
  const out = new Float64Array(logI.length);
  for (let i = 0; i < logI.length; i++) out[i] = -(logI[i] - mean);
  return detrendLinear(out);
}

const logOf = (x: Float64Array) => x.map((v) => Math.log(Math.max(1, v)));

/**
 * Single-frame glitch removal. Phone cameras occasionally deliver a frame that is much brighter or
 * darker than its neighbours (a decode hiccup, a momentary exposure jump). One such frame carries
 * energy at every frequency and can swamp a pulse that changes intensity by about 1%. A frame is
 * replaced by the median of its six neighbours when it differs from that median by more than
 * max(3%, 6 × the recording's median absolute frame-to-median deviation). The pulse changes
 * intensity by a fraction of a percent between frames at 30 fps, so real signal is never touched.
 * Returns the number of frames replaced.
 */
export function despike(values: number[]): { values: number[]; replaced: number; indices: number[] } {
  const n = values.length;
  const logv = values.map((v) => Math.log(Math.max(1, v)));
  const med = new Array<number>(n);
  const dev = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const nb: number[] = [];
    for (let k = -3; k <= 3; k++) if (k && i + k >= 0 && i + k < n) nb.push(logv[i + k]);
    nb.sort((a, b) => a - b);
    med[i] = nb[nb.length >> 1];
    dev[i] = Math.abs(logv[i] - med[i]);
  }
  const sorted = [...dev].sort((a, b) => a - b);
  const mad = sorted[sorted.length >> 1] || 0;
  const threshold = Math.max(0.03, 6 * mad);
  const indices: number[] = [];
  const out = values.slice();
  for (let i = 0; i < n; i++) {
    if (dev[i] > threshold) { out[i] = Math.exp(med[i]); indices.push(i); }
  }
  return { values: out, replaced: indices.length, indices };
}

function channelSignals(t: number[], rv0: number[], gv0: number[]) {
  const rv = despike(rv0);
  const gv = despike(gv0);
  const red = resampleUniform(t, rv.values, ANALYSIS_FS);
  const green = resampleUniform(t, gv.values, ANALYSIS_FS);
  const corrected = correctExposure(logOf(red.x), logOf(green.x), ANALYSIS_FS);
  const glitchTimes = [...new Set([...rv.indices, ...gv.indices])].sort((a, b) => a - b).map((i) => t[i]);
  return { red, green, corrected, glitches: Math.max(rv.replaced, gv.replaced), glitchTimes, redPpg: absorbance(corrected.r), greenPpg: absorbance(corrected.g) };
}

export function preprocess(frames: Frame[], forceChannel?: Channel): Preprocessed {
  if (frames.length < 60) throw new Error('preprocess: fewer than 60 frames');
  const t = frames.map((f) => f.t);
  const { red, green, corrected, glitches, glitchTimes, redPpg, greenPpg } = channelSignals(t, frames.map((f) => f.r), frames.map((f) => f.g));

  // Channel scoring uses only frames with a finger on the lens, so that moments of an uncovered
  // lens (large, non-cardiac intensity swings) do not decide which channel looks best.
  const good = frames.filter((f) => classifyFrame(f) === 'ok');
  const scoring = good.length >= 0.5 * frames.length ? good : frames;
  const sc = scoring === frames ? { redPpg, greenPpg } : channelSignals(scoring.map((f) => f.t), scoring.map((f) => f.r), scoring.map((f) => f.g));
  const conc = {
    red: cardiacConcentration(bandpass(sc.redPpg, ANALYSIS_FS, 0.5, 8), ANALYSIS_FS),
    green: cardiacConcentration(bandpass(sc.greenPpg, ANALYSIS_FS, 0.5, 8), ANALYSIS_FS),
  };
  const meanSat = (k: 'rSat' | 'gSat') => scoring.reduce((s, f) => s + f[k], 0) / scoring.length;
  const greenMean = scoring.reduce((s, f) => s + f.g, 0) / scoring.length;

  let channel: Channel = 'red';
  if (forceChannel) channel = forceChannel;
  else if (meanSat('rSat') > 0.2 && meanSat('gSat') < 0.05 && greenMean > 8) channel = 'green';
  else if (greenMean > 8 && conc.green > conc.red + 0.1) channel = 'green';

  const chosen = channel === 'red' ? red : green;
  const ppg = channel === 'red' ? redPpg : greenPpg;
  const duration = t[t.length - 1] - t[0];
  const frameRate = duration > 0 ? (frames.length - 1) / duration : 0;
  const morphHigh = Math.max(4, Math.min(MORPH_HIGH_MAX, 0.4 * frameRate));

  return {
    fs: ANALYSIS_FS,
    t0: chosen.t0,
    channel,
    raw: chosen.x,
    logCorrected: channel === 'red' ? corrected.r : corrected.g,
    exposureSteps: corrected.steps,
    glitchFrames: glitches,
    glitchTimes,
    ppg,
    detect: bandpass(ppg, ANALYSIS_FS, DETECT_BAND[0], DETECT_BAND[1]),
    morph: bandpass(ppg, ANALYSIS_FS, MORPH_LOW, morphHigh),
    morphHigh,
    spectralConcentration: conc,
    frameRate,
  };
}
