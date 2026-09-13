/**
 * Pulse contour features from the ensemble-averaged beat.
 *
 * Fingertip PPG is a volume pulse: the local blood-volume change produced by the forward
 * pressure wave from the heart plus waves reflected back from the lower body and from branch
 * points. Arterial stiffness raises pulse-wave velocity, so the reflected wave returns sooner,
 * merges with systole and changes the contour in characteristic, measurable ways.
 *
 * Features (all computed on the normalised single-beat contour, foot to next foot):
 *  - Crest time: tangent foot → systolic peak. Rises with stiffness (Alty et al. 2007,
 *    IEEE TBME 54:2268).
 *  - Diastolic point: the diastolic peak when present, otherwise the inflection point where the
 *    first derivative comes closest to zero after systole (Millasseau et al. 2002, Clin Sci 103:371).
 *  - Reflection index RI = diastolic height / systolic height. Mainly reflects small-artery tone
 *    (vasoconstriction/dilation) rather than large-artery stiffness (Millasseau 2002; Chowienczyk
 *    et al. 1999, JACC 34:2007).
 *  - ΔT_DVP: time from systolic peak to diastolic point, which is roughly the round-trip transit
 *    time of the reflected wave. Stiffness index SI_DVP = height / ΔT_DVP (m/s) scales with aortic
 *    pulse-wave velocity (Millasseau 2002). It needs the person's height.
 *  - Second-derivative ("acceleration") PPG waves a–e and their ratios (Takazawa et al. 1998,
 *    Hypertension 32:365; review: Elgendi 2012, Curr Cardiol Rev 8:14). b/a rises and d/a falls with
 *    age and stiffness. The aging index AGI = (b − c − d − e)/a increases with age.
 */
import { refineExtremum, sgFirstDerivative, sgSecondDerivative } from '../dsp/derivative';
import type { Ensemble } from '../dsp/ensemble';

export interface WavePoint { idx: number; value: number }

export interface Apg {
  a: WavePoint; b: WavePoint; c: WavePoint; d: WavePoint; e: WavePoint;
  /** False when c and d merge into an inflection and were estimated rather than seen as separate extrema */
  cdResolved: boolean;
  ba: number; ca: number; da: number; ea: number;
  agi: number;
}

export interface Morphology {
  fs: number;
  periodSec: number;
  /** Normalised contour, foot to next foot, peak = 1 */
  contour: Float64Array;
  d1: Float64Array;
  d2: Float64Array;
  /** Fractional index of the tangent-intersection foot within the contour */
  tangentFoot: number;
  systolicIdx: number;
  crestTimeMs: number;
  /** Crest time as a fraction of the beat period */
  crestTimeRatio: number;
  /** idx is the notch when present, otherwise the APG e-wave (its usual timing) or -1 */
  notch: { present: boolean; idx: number; depth: number };
  /**
   * Null when neither a diastolic peak nor a post-systolic inflection exists: the reflected wave
   * has merged into systole, so RI, ΔT and SI cannot be measured from the contour. Reported as
   * such rather than guessed.
   */
  diastolic: { idx: number; method: 'peak' | 'inflection'; height: number } | null;
  reflectionIndexPct: number | null;
  deltaTMs: number | null;
  /** m/s, null when height is unknown */
  stiffnessIndex: number | null;
  apg: Apg | null;
}

const argmax = (x: ArrayLike<number>, a: number, b: number) => {
  let best = a;
  for (let i = a; i <= b; i++) if (x[i] > x[best]) best = i;
  return best;
};
const argmin = (x: ArrayLike<number>, a: number, b: number) => {
  let best = a;
  for (let i = a; i <= b; i++) if (x[i] < x[best]) best = i;
  return best;
};

export function contourFromEnsemble(ens: Ensemble): { contour: Float64Array; offset: number } {
  const t = ens.template;
  const fs = ens.fs;
  const foot = argmin(t, 0, ens.alignIdx);
  const lo = Math.min(t.length - 1, foot + Math.round(0.85 * ens.period * fs));
  const hi = Math.min(t.length - 1, foot + Math.round(1.12 * ens.period * fs));
  const next = lo < hi ? argmin(t, lo, hi) : Math.min(t.length - 1, foot + Math.round(ens.period * fs));
  const n = next - foot + 1;
  const c = new Float64Array(n);
  const slope = (t[next] - t[foot]) / (n - 1 || 1);
  for (let i = 0; i < n; i++) c[i] = t[foot + i] - (t[foot] + slope * i);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, c[i]);
  if (peak > 0) for (let i = 0; i < n; i++) c[i] /= peak;
  return { contour: c, offset: foot };
}

/** Local maxima of y in (lo, hi) whose topographic prominence is at least minProminence. */
function prominentMaxima(y: Float64Array, lo: number, hi: number, minProminence: number): number[] {
  const peaks: number[] = [];
  for (let i = lo + 1; i < hi; i++) {
    if (y[i] > y[i - 1] && y[i] >= y[i + 1]) {
      // Walk out on each side until a higher value or the window edge; the lowest point on
      // each side is that side's base.
      let l = y[i], r = y[i];
      for (let j = i - 1; j >= lo && y[j] <= y[i]; j--) l = Math.min(l, y[j]);
      for (let j = i + 1; j <= hi && y[j] <= y[i]; j++) r = Math.min(r, y[j]);
      if (y[i] - Math.max(l, r) >= minProminence) peaks.push(i);
    }
  }
  return peaks;
}

/**
 * APG wave labelling on the second derivative d2 (indices within one beat, foot = 0).
 *  a: largest positive wave before the systolic peak (early systolic acceleration)
 *  b: deepest negative wave after a, around peak upstroke (early systolic deceleration)
 *  After b, prominent positive waves are c (late systolic re-acceleration) and e (early
 *  diastole, around the dicrotic notch), with d the trough between them. In stiffer vessels
 *  c and d fade into a single rising limb; then only e is prominent and c = d is estimated at
 *  the flattest point of that limb, flagged cdResolved = false.
 */
export function extractApg(d2: Float64Array, sys: number, n: number): Apg | null {
  const a = argmax(d2, 0, Math.max(1, sys));
  const bHi = Math.min(n - 1, sys + Math.round(0.08 * n));
  if (bHi <= a + 1) return null;
  const b = argmin(d2, a + 1, bHi);
  if (d2[a] <= 0 || d2[b] >= 0) return null;

  const hi = Math.min(n - 2, Math.round(0.7 * n));
  const maxima = prominentMaxima(d2, b, hi, 0.04 * d2[a]).filter((i) => d2[i] > d2[b] + 0.2 * (d2[a] - d2[b]));
  if (!maxima.length) return null;

  let c: number, d: number, e: number;
  let cdResolved: boolean;
  if (maxima.length >= 2) {
    c = maxima[0];
    e = maxima[1];
    d = argmin(d2, c + 1, e - 1);
    cdResolved = true;
  } else {
    e = maxima[0];
    // Merged c/d: the point on the rising limb b→e where the slope of d2 is smallest, i.e. the
    // lowest local minimum of d3, away from both ends (d3 is also zero at the extrema themselves).
    const lo = b + Math.max(2, Math.round(0.15 * (e - b)));
    const hiLimb = e - Math.max(2, Math.round(0.15 * (e - b)));
    let flat = Math.round((b + e) / 2);
    let flatVal = Infinity;
    for (let i = lo; i <= hiLimb; i++) {
      const d3 = d2[i + 1] - d2[i - 1];
      const prev = d2[i] - d2[i - 2];
      const next = d2[i + 2] - d2[i];
      if (d3 <= prev && d3 <= next && d3 < flatVal) { flatVal = d3; flat = i; }
    }
    c = flat;
    d = flat;
    cdResolved = false;
  }
  const av = d2[a];
  const pt = (i: number): WavePoint => ({ idx: i, value: d2[i] / av });
  const P = { a: pt(a), b: pt(b), c: pt(c), d: pt(d), e: pt(e) };
  return {
    ...P,
    cdResolved,
    ba: P.b.value, ca: P.c.value, da: P.d.value, ea: P.e.value,
    agi: P.b.value - P.c.value - P.d.value - P.e.value,
  };
}

/** Derivatives on a periodically extended copy, so the foot is not at an array edge. */
function periodicDerivatives(contour: Float64Array, fs: number, hw: number): { d1: Float64Array; d2: Float64Array } {
  const n = contour.length;
  const pad = Math.min(n - 1, Math.round(0.15 * n));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < ext.length; i++) ext[i] = contour[(((i - pad) % n) + n) % n];
  return {
    d1: sgFirstDerivative(ext, fs, hw).slice(pad, pad + n),
    d2: sgSecondDerivative(ext, fs, hw).slice(pad, pad + n),
  };
}

export function extractMorphology(contour: Float64Array, fs: number, heightCm?: number): Morphology {
  const n = contour.length;
  const periodSec = n / fs;
  const hw = Math.max(2, Math.round(0.024 * fs));
  const { d1, d2 } = periodicDerivatives(contour, fs, hw);

  const sys = argmax(contour, 0, Math.round(0.5 * n));
  const ms = argmax(d1, 0, sys);
  const msPos = refineExtremum(d1, ms);
  const tangentFoot = d1[ms] > 0 ? msPos - (contour[ms] / d1[ms]) * fs : 0;
  const crestTimeMs = ((sys - tangentFoot) / fs) * 1000;

  // Dicrotic notch and diastolic peak: a local minimum on the falling limb, clearly above
  // baseline, followed within 0.3 T by a local maximum at least 1% of pulse height higher.
  const searchLo = sys + Math.round(0.05 * n);
  const searchHi = Math.round(0.75 * n);
  let notchIdx = -1;
  let diaIdx = -1;
  for (let i = searchLo; i < searchHi; i++) {
    if (contour[i] < contour[i - 1] && contour[i] <= contour[i + 1] && contour[i] > 0.1) {
      const peak = argmax(contour, i, Math.min(n - 1, i + Math.round(0.3 * n)));
      if (peak > i && contour[peak] - contour[i] >= 0.01) { notchIdx = i; diaIdx = peak; break; }
    }
  }

  const apg = extractApg(d2, sys, n);
  let method: 'peak' | 'inflection' = 'peak';
  const notchPresent = notchIdx > 0;
  if (!notchPresent) {
    // Inflection: local maximum of the first derivative (closest approach to zero) after systole
    // Candidates must sit on the falling limb well above baseline: noise in the diastolic tail
    // also produces small first-derivative maxima.
    const peaks = prominentMaxima(d1, searchLo, searchHi, 0.02 * Math.max(...d1))
      .filter((i) => contour[i] >= 0.25 && d1[i] <= 0.1 * Math.max(...d1));
    const infl = peaks.length ? peaks.reduce((best, i) => (d1[i] > d1[best] ? i : best)) : -1;
    // An inflection within ~0.12 T of the peak is a systolic shoulder (reflected wave arriving in
    // late systole), not the diastolic component, so it is not used for ΔT.
    diaIdx = infl > 0 && infl - sys >= 0.12 * n ? infl : -1;
    method = 'inflection';
    notchIdx = apg ? apg.e.idx : -1;
  }

  const hasDia = diaIdx > sys;
  const deltaTMs = hasDia ? ((diaIdx - sys) / fs) * 1000 : null;
  return {
    fs,
    periodSec,
    contour,
    d1,
    d2,
    tangentFoot,
    systolicIdx: sys,
    crestTimeMs,
    crestTimeRatio: crestTimeMs / 1000 / periodSec,
    notch: { present: notchPresent, idx: notchIdx, depth: notchPresent ? contour[diaIdx] - contour[notchIdx] : 0 },
    diastolic: hasDia ? { idx: diaIdx, method, height: contour[diaIdx] } : null,
    reflectionIndexPct: hasDia ? (contour[diaIdx] / contour[sys]) * 100 : null,
    deltaTMs,
    stiffnessIndex: heightCm && deltaTMs ? heightCm / 100 / (deltaTMs / 1000) : null,
    apg,
  };
}
