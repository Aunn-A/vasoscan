/**
 * Frames → uniform PPG signals.
 *
 * 1. Channel choice. Under the phone torch, haemoglobin absorbs green strongly and red weakly,
 *    so red carries most light through the finger and green carries a stronger relative pulse.
 *    Red is usually clean but can clip at 255; green is dim but pulsatile. Both are scored by
 *    how concentrated their power is around the heart rate, and the better one is used.
 * 2. Resample to a uniform 60 Hz grid from the frame timestamps.
 * 3. Convert to relative absorbance change: −(I − Ī)/Ī. Blood volume up means intensity down,
 *    so the sign is flipped to give the conventional upward systolic PPG. Dividing by the mean
 *    makes amplitude independent of torch brightness and exposure.
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
import { bandpass, detrendLinear } from './filters';
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
  /** Relative absorbance, detrended, unfiltered */
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

function relative(u: Float64Array): Float64Array {
  let mean = 0;
  for (let i = 0; i < u.length; i++) mean += u[i];
  mean /= u.length || 1;
  const out = new Float64Array(u.length);
  for (let i = 0; i < u.length; i++) out[i] = mean > 0 ? -(u[i] - mean) / mean : 0;
  return detrendLinear(out);
}

export function preprocess(frames: Frame[], forceChannel?: Channel): Preprocessed {
  if (frames.length < 60) throw new Error('preprocess: fewer than 60 frames');
  const t = frames.map((f) => f.t);
  const red = resampleUniform(t, frames.map((f) => f.r), ANALYSIS_FS);
  const green = resampleUniform(t, frames.map((f) => f.g), ANALYSIS_FS);

  const redPpg = relative(red.x);
  const greenPpg = relative(green.x);

  // Channel scoring uses only frames with a finger on the lens, so that moments of an uncovered
  // lens (large, non-cardiac intensity swings) do not decide which channel looks best.
  const good = frames.filter((f) => classifyFrame(f) === 'ok');
  const scoring = good.length >= 0.5 * frames.length ? good : frames;
  const st = scoring.map((f) => f.t);
  const score = (vals: number[]) => cardiacConcentration(
    bandpass(relative(resampleUniform(st, vals, ANALYSIS_FS).x), ANALYSIS_FS, 0.5, 8), ANALYSIS_FS);
  const conc = { red: score(scoring.map((f) => f.r)), green: score(scoring.map((f) => f.g)) };
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
    ppg,
    detect: bandpass(ppg, ANALYSIS_FS, DETECT_BAND[0], DETECT_BAND[1]),
    morph: bandpass(ppg, ANALYSIS_FS, MORPH_LOW, morphHigh),
    morphHigh,
    spectralConcentration: conc,
    frameRate,
  };
}
