/**
 * Signal quality assessment and result gating.
 *
 * The rule is simple: if the recording cannot support a measurement, the app says so and says
 * how to fix it. It does not produce a number. Checks, roughly in the order a user would need to
 * fix them:
 *
 *  1. Camera frame rate high enough to resolve the pulse contour
 *  2. Finger covering the lens (per-frame colour and uniformity), lighting adequate
 *  3. A pulse is present: power concentrated at the heart rate (spectral SQI, cf. the
 *     relative-power SQI in Li & Clifford 2012, Physiol Meas 33:1491)
 *  4. Motion artifacts: sudden baseline (DC) shifts larger than the pulse itself, and bursts of
 *     amplitude far above the recording's typical level. Motion is the dominant failure mode of
 *     finger PPG.
 *  5. Enough clean signal left: a continuous clean stretch long enough for HRV
 *  6. Beat-to-beat contour consistency: correlation of each beat with the median beat
 *     (template-matching SQI; Orphanidou et al. 2015, IEEE JBHI 19:832)
 */
import type { Frame } from '../types';
import type { Preprocessed } from '../dsp/preprocess';
import { movingAverage } from '../dsp/filters';
import { classifyFrame, type FrameStatus } from './frame';

export interface Interval { start: number; end: number }

export type IssueCode =
  | 'low-frame-rate'
  | 'too-dark'
  | 'no-finger'
  | 'overexposed'
  | 'no-pulse'
  | 'motion'
  | 'inconsistent-beats'
  | 'implausible-rate'
  | 'short-recording';

export interface Issue {
  code: IssueCode;
  severity: 'fail' | 'warn';
  /** What went wrong, in plain language */
  problem: string;
  /** What the user should do */
  fix: string;
  /** Where in the recording, seconds from the start of analysis */
  intervals?: Interval[];
}

export interface QualityReport {
  pass: boolean;
  /** 0–100 summary for display; gating uses the explicit rules, not this number */
  score: number;
  issues: Issue[];
  metrics: {
    frameRate: number;
    frameStatusFraction: Record<FrameStatus, number>;
    spectralConcentration: number;
    cleanFraction: number;
    longestCleanSec: number;
    acceptedBeatFraction: number;
    acceptedBeats: number;
    splitHalfR: number;
  };
  /** Sample-level artifact mask over the analysis signal (true = unusable) */
  badMask: Uint8Array;
  artifacts: Interval[];
  /** Clean stretches, seconds from the start of the analysis signal */
  cleanSegments: Interval[];
}

export const QUALITY_THRESHOLDS = {
  minFrameRate: 15,
  warnFrameRate: 24,
  maxBadFrameFraction: 0.35,
  minSpectralConcentration: 0.3,
  /** Total clean signal required (may be split across stretches) */
  minCleanSec: 30,
  /** At least one uninterrupted stretch this long, for a stable beat template and HRV pairs */
  minLongestSec: 10,
  minAcceptedBeats: 20,
  /** Split-half reliability of the averaged pulse contour */
  minSplitHalfR: 0.9,
  /** Baseline shift over 1 s, as a multiple of the median pulse amplitude */
  dcJumpFactor: 6,
  /** Minimum baseline change over 1 s (log units ≈ fraction) counted as movement */
  minDcJump: 0.03,
  /** Local signal spread over 2 s, as a multiple of the recording median */
  burstFactor: 3,
};

function intervalsFromMask(mask: Uint8Array, fs: number, value: 0 | 1): Interval[] {
  const out: Interval[] = [];
  let start = -1;
  for (let i = 0; i <= mask.length; i++) {
    const on = i < mask.length && mask[i] === value;
    if (on && start < 0) start = i;
    if (!on && start >= 0) { out.push({ start: start / fs, end: i / fs }); start = -1; }
  }
  return out;
}

/** Stage 1: sample-level mask from frame status and motion detection. */
export function artifactMask(frames: Frame[], pre: Preprocessed, medianPulseAmplitude: number): {
  mask: Uint8Array;
  statusFraction: Record<FrameStatus, number>;
  reasons: { frame: Interval[]; motion: Interval[] };
} {
  const n = pre.ppg.length;
  const fs = pre.fs;
  const mask = new Uint8Array(n);
  const counts: Record<FrameStatus, number> = { ok: 0, uncovered: 0, dark: 0, overexposed: 0 };
  const frameBad = new Uint8Array(n);
  const pad = Math.round(0.5 * fs);
  // A run of bad frames must last 0.3 s to count: single odd frames (a flicker, a dropped decode)
  // are not a lifted finger.
  const statuses = frames.map(classifyFrame);
  let runStart = -1;
  for (let k = 0; k <= frames.length; k++) {
    const bad = k < frames.length && statuses[k] !== 'ok';
    if (k < frames.length) counts[statuses[k]]++;
    if (bad && runStart < 0) runStart = k;
    if (!bad && runStart >= 0) {
      if (frames[k - 1].t - frames[runStart].t >= 0.3) {
        const a = Math.round((frames[runStart].t - pre.t0) * fs) - pad;
        const b = Math.round((frames[k - 1].t - pre.t0) * fs) + pad;
        for (let j = Math.max(0, a); j <= Math.min(n - 1, b); j++) frameBad[j] = 1;
      }
      runStart = -1;
    }
  }
  const statusFraction = Object.fromEntries(
    Object.entries(counts).map(([k, v]) => [k, v / (frames.length || 1)]),
  ) as Record<FrameStatus, number>;

  // Baseline shifts in exposure-corrected log intensity (≈ relative change) across 1 s. Exposure
  // steps were already removed in preprocessing, so what remains is pressure or movement. The
  // threshold is the larger of 6× the pulse amplitude and 3%, so ordinary slow drift and
  // breathing do not count.
  const motion = new Uint8Array(n);
  const dc = movingAverage(pre.logCorrected, Math.round(fs));
  const half = Math.round(0.5 * fs);
  const jumpThreshold = Math.max(QUALITY_THRESHOLDS.dcJumpFactor * Math.max(medianPulseAmplitude, 1e-4), QUALITY_THRESHOLDS.minDcJump);
  for (let i = half; i < n - half; i++) {
    if (Math.abs(dc[i + half] - dc[i - half]) > jumpThreshold) {
      for (let j = i - half; j <= i + half; j++) motion[j] = 1;
    }
  }

  // Amplitude bursts: rolling RMS of the detection band over 2 s
  const sq = new Float64Array(n);
  for (let i = 0; i < n; i++) sq[i] = pre.detect[i] * pre.detect[i];
  const rms = movingAverage(sq, Math.round(2 * fs)).map(Math.sqrt);
  // Reference is the quiet level of the recording (25th percentile), not the median: when movement
  // covers a large share of a recording the median is itself raised by movement.
  const sorted = Float64Array.from(rms).sort();
  const quietRms = sorted[Math.floor(sorted.length * 0.25)];
  for (let i = 0; i < n; i++) {
    if (rms[i] > QUALITY_THRESHOLDS.burstFactor * quietRms) motion[i] = 1;
  }

  // Clusters of glitch frames (3 or more within 1 s) mean sustained disturbance, not isolated
  // camera hiccups: mark them as movement.
  const gt = pre.glitchTimes;
  for (let k = 0; k + 2 < gt.length; k++) {
    if (gt[k + 2] - gt[k] <= 1) {
      const a = Math.round((gt[k] - pre.t0) * fs);
      const b = Math.round((gt[k + 2] - pre.t0) * fs);
      for (let j = Math.max(0, a); j <= Math.min(n - 1, b); j++) motion[j] = 1;
    }
  }

  // Dilate motion by 0.5 s: the signal is disturbed slightly before and after the visible event
  const dilated = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (motion[i]) for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) dilated[j] = 1;
  }

  // Filter edge regions are unreliable
  const edge = Math.round(1 * fs);
  for (let i = 0; i < n; i++) {
    mask[i] = frameBad[i] || dilated[i] || i < edge || i >= n - edge ? 1 : 0;
  }
  const inner = (m: Uint8Array) => intervalsFromMask(m, fs, 1).filter((iv) => iv.end - iv.start > 0.05);
  return { mask, statusFraction, reasons: { frame: inner(frameBad), motion: inner(dilated) } };
}

export function cleanSegments(mask: Uint8Array, fs: number): Interval[] {
  return intervalsFromMask(mask, fs, 0);
}

const fmtTime = (iv: Interval) => `${Math.floor(iv.start)}–${Math.ceil(iv.end)} s`;

export interface GateInputs {
  pre: Preprocessed;
  statusFraction: Record<FrameStatus, number>;
  mask: Uint8Array;
  frameIntervals: Interval[];
  motionIntervals: Interval[];
  acceptedBeats: number;
  /** Beats inside clean signal that were offered to the ensemble */
  candidateBeats: number;
  splitHalfR: number;
  heartRateBpm: number | null;
  durationSec: number;
}

export function assessQuality(g: GateInputs): QualityReport {
  const T = QUALITY_THRESHOLDS;
  const issues: Issue[] = [];
  const { pre } = g;
  const conc = pre.spectralConcentration[pre.channel];
  const segments = cleanSegments(g.mask, pre.fs);
  const longest = segments.reduce((m, s) => Math.max(m, s.end - s.start), 0);
  const cleanSamples = g.mask.reduce((a, v) => a + (v ? 0 : 1), 0);
  const cleanFraction = cleanSamples / (g.mask.length || 1);
  const acceptedFraction = g.candidateBeats ? g.acceptedBeats / g.candidateBeats : 0;
  const sf = g.statusFraction;

  if (g.durationSec < T.minCleanSec) {
    issues.push({
      code: 'short-recording', severity: 'fail',
      problem: `The recording was ${Math.round(g.durationSec)} seconds long. At least ${T.minCleanSec} seconds of steady signal are needed.`,
      fix: 'Keep your finger in place until the progress bar is full.',
    });
  }
  if (pre.frameRate < T.minFrameRate) {
    issues.push({
      code: 'low-frame-rate', severity: 'fail',
      problem: `The camera delivered only ${pre.frameRate.toFixed(0)} frames per second, too few to trace the pulse shape.`,
      fix: 'Close other apps, turn off low-power mode, and try again.',
    });
  } else if (pre.frameRate < T.warnFrameRate) {
    issues.push({
      code: 'low-frame-rate', severity: 'warn',
      problem: `The camera delivered ${pre.frameRate.toFixed(0)} frames per second. Pulse-shape timing is less precise below 24.`,
      fix: 'Close other apps or turn off low-power mode for a sharper recording.',
    });
  }
  if (sf.dark > T.maxBadFrameFraction) {
    issues.push({
      code: 'too-dark', severity: 'fail',
      problem: 'Too little light reached the camera to see the pulse.',
      fix: 'Turn on the flashlight, and cover both the camera and the flash with your fingertip.',
      intervals: g.frameIntervals,
    });
  } else if (sf.uncovered > T.maxBadFrameFraction) {
    issues.push({
      code: 'no-finger', severity: 'fail',
      problem: 'The camera was not fully covered by a fingertip for much of the recording.',
      fix: 'Rest the pad of your index finger flat over the camera lens and flash, covering both completely.',
      intervals: g.frameIntervals,
    });
  } else if (sf.overexposed > T.maxBadFrameFraction) {
    issues.push({
      code: 'overexposed', severity: 'fail',
      problem: 'The image was saturated with light, which flattens the pulse.',
      fix: 'Cover the flash completely with the fleshy pad of your finger, not the fingertip edge.',
    });
  }
  if (!issues.some((i) => i.severity === 'fail') && conc < T.minSpectralConcentration) {
    issues.push({
      code: 'no-pulse', severity: 'fail',
      problem: 'No clear, regular pulse was found in the signal.',
      fix: 'Press more lightly: pressing hard squeezes blood out of the fingertip. If your hands are cold, warm them first.',
    });
  }
  const cleanTotal = cleanFraction * g.mask.length / pre.fs;
  if (!issues.some((i) => i.severity === 'fail') && (cleanTotal < T.minCleanSec || longest < T.minLongestSec)) {
    const parts: string[] = [];
    if (g.frameIntervals.length) parts.push(`your finger came off the lens at ${g.frameIntervals.map(fmtTime).join(', ')}`);
    const movementOnly = g.motionIntervals.filter((m) => !g.frameIntervals.some((f) => f.start < m.end && f.end > m.start));
    if (movementOnly.length) parts.push(`movement disturbed the signal at ${movementOnly.map(fmtTime).join(', ')}`);
    const cause = parts.length ? parts.join(', and ') : `the steady parts of the recording were too short or too broken up`;
    issues.push({
      code: 'motion', severity: 'fail',
      problem: `${cause.charAt(0).toUpperCase()}${cause.slice(1)}, leaving ${Math.round(cleanTotal)} seconds of steady signal. At least ${T.minCleanSec} seconds are needed.`,
      fix: g.frameIntervals.length
        ? 'Keep your fingertip resting on the camera for the whole recording. Rest your hand and phone on a table so you can relax your finger without lifting it.'
        : 'Rest your hand and phone on a table, keep your finger still and relaxed, and try again.',
      intervals: [...g.frameIntervals, ...g.motionIntervals].sort((a, b) => a.start - b.start),
    });
  }
  if (!issues.some((i) => i.severity === 'fail') && (g.acceptedBeats < T.minAcceptedBeats || g.splitHalfR < T.minSplitHalfR)) {
    issues.push({
      code: 'inconsistent-beats', severity: 'fail',
      problem: g.acceptedBeats < T.minAcceptedBeats
        ? `Only ${g.acceptedBeats} usable beats were recorded; at least ${T.minAcceptedBeats} are needed to measure the pulse shape.`
        : 'The pulse shape was not reproducible: the first and second halves of the beats gave different averages. Small finger movements or changing finger pressure cause this. So can an irregular heart rhythm, which this app is not designed to assess.',
      fix: 'Rest your hand on a table, keep light, steady pressure on the camera, and try again.',
    });
  }
  if (!issues.some((i) => i.severity === 'fail') && g.heartRateBpm !== null &&
      (g.heartRateBpm < 40 || g.heartRateBpm > 180)) {
    issues.push({
      code: 'implausible-rate', severity: 'fail',
      problem: `The detected rate of ${Math.round(g.heartRateBpm)} beats per minute is outside the range this app can measure reliably (40–180).`,
      fix: 'Try again sitting at rest. If the reading repeats, it may be a detection error rather than your real pulse.',
    });
  }
  if (!issues.some((i) => i.severity === 'fail') && g.motionIntervals.length) {
    issues.push({
      code: 'motion', severity: 'warn',
      problem: `Movement at ${g.motionIntervals.map(fmtTime).join(', ')} was excluded from analysis.`,
      fix: 'Resting your hand on a table gives a cleaner recording.',
      intervals: g.motionIntervals,
    });
  }

  const reliability = Math.max(0, Math.min(1, (g.splitHalfR - 0.8) / 0.19));
  const score = Math.round(100 * (0.3 * cleanFraction + 0.2 * acceptedFraction + 0.3 * reliability + 0.2 * Math.min(1, conc / 0.6)));
  return {
    pass: !issues.some((i) => i.severity === 'fail'),
    score,
    issues,
    metrics: {
      frameRate: pre.frameRate,
      frameStatusFraction: sf,
      spectralConcentration: conc,
      cleanFraction,
      longestCleanSec: longest,
      acceptedBeatFraction: acceptedFraction,
      acceptedBeats: g.acceptedBeats,
      splitHalfR: g.splitHalfR,
    },
    badMask: g.mask,
    artifacts: [...g.frameIntervals, ...g.motionIntervals].sort((a, b) => a.start - b.start),
    cleanSegments: segments,
  };
}
