/**
 * Synthetic fingertip PPG, generated as raw camera frames.
 *
 * This exists so the demo cases exercise exactly the same pipeline as live capture: it emits
 * per-frame ROI statistics with jittered timestamps and dropped frames, not a clean waveform.
 *
 * Pulse model: each beat is the sum of a forward (systolic) wave and a later reflected wave, in
 * the spirit of PPG pulse-decomposition models (e.g. Baruch et al. 2011; Couceiro et al. 2015).
 * The forward wave is gamma-shaped (fast rise, slower fall, smooth in every derivative) because a
 * symmetric Gaussian puts the APG b-wave at the peak, which real pulses do not do. The reflected
 * wave is Gaussian. In a compliant
 * vascular tree the reflected wave arrives late and is visibly separate (a dicrotic notch and
 * diastolic peak); with stiffer arteries it returns earlier and merges into systole, the
 * systolic peak is reached later and the notch disappears.
 *
 * These profiles are illustrative. They are not recordings and are not patients.
 */
import type { Frame } from '../types';
import { gaussian, mulberry32 } from './random';

export interface PulseShape {
  sysPeak: number; // s after foot
  sysK: number;    // gamma shape; lower = more skewed
  diaMu: number;
  diaSigma: number;
  diaAmp: number;  // relative to systolic amplitude
}

export interface SynthCase {
  id: string;
  label: string;
  summary: string;
  ageYears: number;
  heightCm: number;
  sex: 'F' | 'M';
  heartRate: number;          // bpm
  rsaMs: number;              // respiratory sinus arrhythmia amplitude, ms
  beatJitterMs: number;       // random beat-to-beat variation, ms
  pulse: PulseShape;
  perfusion: number;          // pulsatile fraction of DC intensity
  noise: number;              // sensor noise, intensity units
  /** Failure injection for demonstrating the quality gate */
  artifact?: 'motion' | 'no-finger';
  seed: number;
}

// Ages and sex follow the three demo profiles in the original prototype. The clinical
// indications attached there (claudication, diabetic foot) are dropped on purpose.
export const SYNTH_CASES: SynthCase[] = [
  {
    id: 'a', label: 'Case A', summary: 'Compliant pulse contour: clear dicrotic notch, early crest',
    ageYears: 58, heightCm: 172, sex: 'M', heartRate: 64, rsaMs: 45, beatJitterMs: 18,
    pulse: { sysPeak: 0.15, sysK: 3, diaMu: 0.4, diaSigma: 0.07, diaAmp: 0.5 },
    perfusion: 0.012, noise: 0.25, seed: 11,
  },
  {
    id: 'b', label: 'Case B', summary: 'Intermediate contour: shallow notch, reflected wave arriving earlier',
    ageYears: 64, heightCm: 168, sex: 'M', heartRate: 72, rsaMs: 25, beatJitterMs: 12,
    pulse: { sysPeak: 0.15, sysK: 3, diaMu: 0.36, diaSigma: 0.07, diaAmp: 0.55 },
    perfusion: 0.009, noise: 0.25, seed: 23,
  },
  {
    id: 'c', label: 'Case C', summary: 'Stiff contour: reflected wave returns in systole, no notch',
    ageYears: 71, heightCm: 165, sex: 'M', heartRate: 78, rsaMs: 10, beatJitterMs: 8,
    pulse: { sysPeak: 0.12, sysK: 3, diaMu: 0.24, diaSigma: 0.08, diaAmp: 0.95 },
    perfusion: 0.006, noise: 0.25, seed: 37,
  },
  {
    id: 'motion', label: 'Movement during capture', summary: 'Case A with hand movement and a lifted finger',
    ageYears: 58, heightCm: 172, sex: 'M', heartRate: 64, rsaMs: 45, beatJitterMs: 18,
    pulse: { sysPeak: 0.15, sysK: 3, diaMu: 0.4, diaSigma: 0.07, diaAmp: 0.5 },
    perfusion: 0.012, noise: 0.25, artifact: 'motion', seed: 41,
  },
  {
    id: 'no-finger', label: 'Lens not covered', summary: 'Camera sees the room instead of a fingertip',
    ageYears: 58, heightCm: 172, sex: 'M', heartRate: 64, rsaMs: 45, beatJitterMs: 18,
    pulse: { sysPeak: 0.15, sysK: 3, diaMu: 0.4, diaSigma: 0.07, diaAmp: 0.5 },
    perfusion: 0.012, noise: 0.25, artifact: 'no-finger', seed: 53,
  },
];

/** Pulse contour at time s after the foot, peak-normalised so the systolic Gaussian has height 1. */
export function pulseAt(p: PulseShape, s: number): number {
  if (s <= 0) return p.diaAmp * Math.exp(-0.5 * ((s - p.diaMu) / p.diaSigma) ** 2);
  const theta = p.sysPeak / p.sysK;
  const sys = Math.pow(s / theta, p.sysK) * Math.exp(-s / theta) / (Math.pow(p.sysK, p.sysK) * Math.exp(-p.sysK));
  const dia = p.diaAmp * Math.exp(-0.5 * ((s - p.diaMu) / p.diaSigma) ** 2);
  return sys + dia;
}

/** One noise-free beat at fs, foot to foot, baseline-corrected and peak-normalised, for a fixed period. */
export function idealContour(p: PulseShape, periodSec: number, fs = 250): Float64Array {
  const n = Math.round(periodSec * fs);
  const f = (s: number) => pulseAt(p, s) + pulseAt(p, s + periodSec) + pulseAt(p, s - periodSec);
  const x = Float64Array.from({ length: n }, (_, i) => f(i / fs));
  const x0 = x[0];
  const slope = (f(periodSec) - x0) / n;
  for (let i = 0; i < n; i++) x[i] -= x0 + slope * i;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, x[i]);
  for (let i = 0; i < n; i++) x[i] /= peak;
  return x;
}

export interface SynthOutput {
  frames: Frame[];
  /** Pulse foot times, seconds */
  beatTimes: number[];
  ibis: number[];
}

export interface SynthOptions {
  durationSec: number;
  fps?: number;
  frameJitterMs?: number;
  dropProbability?: number;
}

export function synthesize(c: SynthCase, opts: SynthOptions): SynthOutput {
  const rand = mulberry32(c.seed);
  const fps = opts.fps ?? 30;
  const jitter = (opts.frameJitterMs ?? 2) / 1000;
  const drop = opts.dropProbability ?? 0.01;
  const dur = opts.durationSec;

  // Beat schedule: mean interval, respiratory sinus arrhythmia (0.25 Hz), slow Mayer-wave
  // modulation (~0.1 Hz), and random jitter.
  const beatTimes: number[] = [];
  const ibis: number[] = [];
  let tb = -1.5;
  const mean = 60 / c.heartRate;
  while (tb < dur + 2) {
    beatTimes.push(tb);
    const ibi = mean
      + (c.rsaMs / 1000) * Math.sin(2 * Math.PI * 0.25 * tb)
      + (c.rsaMs / 2000) * Math.sin(2 * Math.PI * 0.1 * tb + 1.3)
      + (c.beatJitterMs / 1000) * gaussian(rand);
    ibis.push(ibi);
    tb += ibi;
  }

  const blood = (t: number): number => {
    let v = 0;
    for (let k = 0; k < beatTimes.length; k++) {
      const s = t - beatTimes[k];
      if (s < -0.1) break;
      if (s < 1.2) v += pulseAt(c.pulse, s);
    }
    return v;
  };

  const frames: Frame[] = [];
  let t = 0;
  const dcBase = 200;
  while (t < dur) {
    t += 1 / fps + jitter * gaussian(rand);
    if (rand() < drop) continue;

    // Slow drift (thermal/pressure) and respiration-induced intensity modulation
    const drift = 1 + 0.02 * (t / dur) + 0.003 * Math.sin(2 * Math.PI * 0.25 * t);
    let dc = dcBase * drift;
    let pulsatile = c.perfusion;
    let covered = true;
    let extraNoise = 0;

    if (c.artifact === 'motion') {
      // Two movement episodes and a brief finger lift
      if (t > 14 && t < 17) {
        dc *= 0.86 + 0.08 * Math.sin(2 * Math.PI * 1.7 * t);
        extraNoise = 6;
      }
      if (t > 31 && t < 32.2) covered = false;
      if (t > 44 && t < 47.5) {
        dc *= 1.1 + 0.1 * Math.sin(2 * Math.PI * 0.9 * t);
        extraNoise = 5;
      }
    }
    if (c.artifact === 'no-finger') covered = false;

    if (!covered) {
      const r = 110 + 20 * Math.sin(t * 0.7) + 3 * gaussian(rand);
      frames.push({ t, r, g: r * 0.95, b: r * 0.85, rStd: 45 + 5 * rand(), rSat: 0.02, gSat: 0.01 });
      continue;
    }

    // Blood volume increase absorbs light, so transmitted intensity falls during systole
    const bv = blood(t);
    const r = dc * (1 - pulsatile * bv) + c.noise * gaussian(rand) + extraNoise * gaussian(rand);
    const g = dc * 0.09 * (1 - pulsatile * 1.6 * bv) + c.noise * 0.6 * gaussian(rand);
    const b = dc * 0.05 + c.noise * 0.5 * gaussian(rand);
    frames.push({ t, r, g, b, rStd: 4 + rand(), rSat: 0, gSat: 0 });
  }
  return { frames, beatTimes: beatTimes.filter((x) => x >= 0 && x <= dur), ibis };
}
