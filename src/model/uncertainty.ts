/**
 * Measurement uncertainty by bootstrap over beats.
 *
 * The accepted beats are resampled with replacement, the ensemble template is rebuilt, and every
 * feature and the score are recomputed, many times. The spread of results shows how much the
 * numbers depend on which beats happened to be recorded: noise, residual movement, and
 * breath-to-breath variation in contour.
 *
 * What this band does NOT include: whether the model's coefficients are right (they are
 * untrained), device and camera differences, finger pressure and temperature effects, or
 * disagreement with a reference standard. It is a lower bound on the real uncertainty, and it is
 * labelled that way.
 *
 * When some score terms cannot be computed at all (e.g. no height, so no SI), the band is widened
 * in logit space by sqrt(total weight / available weight), so fewer inputs never look as certain
 * as more.
 */
import type { Ensemble } from '../dsp/ensemble';
import { contourFromEnsemble, extractMorphology } from '../features/morphology';
import { mulberry32 } from '../sim/random';
import { featureValues, scoreFromValues } from './score';

export interface Interval90 { lo: number; hi: number; median: number; n: number }

export interface Uncertainty {
  score: Interval90;
  features: {
    crestTimeMs: Interval90 | null;
    stiffnessIndex: Interval90 | null;
    reflectionIndexPct: Interval90 | null;
    agi: Interval90 | null;
    ba: Interval90 | null;
    da: Interval90 | null;
  };
  /** Fraction of resamples in which a dicrotic notch was found */
  notchPresentFraction: number;
  iterations: number;
  coverageWidening: number;
}

function interval(values: number[]): Interval90 | null {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 10) return null;
  const q = (p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))];
  return { lo: q(0.05), hi: q(0.95), median: q(0.5), n: v.length };
}

export function bootstrap(ens: Ensemble, heightCm: number | undefined, iterations = 200, seed = 1): Uncertainty {
  const rand = mulberry32(seed);
  const rows = ens.beats.filter((_, i) => ens.accepted[i]);
  const len = ens.template.length;
  const acc = {
    score: [] as number[], ct: [] as number[], si: [] as number[], ri: [] as number[],
    agi: [] as number[], ba: [] as number[], da: [] as number[], notch: 0, coverage: [] as number[],
  };
  for (let it = 0; it < iterations; it++) {
    const template = new Float64Array(len);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[Math.floor(rand() * rows.length)];
      for (let j = 0; j < len; j++) template[j] += r[j];
    }
    for (let j = 0; j < len; j++) template[j] /= rows.length;
    const m = extractMorphology(contourFromEnsemble({ ...ens, template }).contour, ens.fs, heightCm);
    const s = scoreFromValues(featureValues(m));
    acc.score.push(s.score);
    acc.coverage.push(s.coverage);
    acc.ct.push(m.crestTimeMs);
    if (m.stiffnessIndex !== null) acc.si.push(m.stiffnessIndex);
    if (m.reflectionIndexPct !== null) acc.ri.push(m.reflectionIndexPct);
    if (m.apg) { acc.agi.push(m.apg.agi); acc.ba.push(m.apg.ba); acc.da.push(m.apg.da); }
    if (m.notch.present) acc.notch++;
  }

  // Widen the score band in logit space for missing inputs
  const meanCoverage = acc.coverage.reduce((a, b) => a + b, 0) / iterations;
  const widen = Math.sqrt(1 / Math.max(0.25, meanCoverage));
  const logit = (p: number) => Math.log(Math.max(1e-6, p / 100) / Math.max(1e-6, 1 - p / 100));
  const inv = (l: number) => 100 / (1 + Math.exp(-l));
  const raw = interval(acc.score)!;
  const mid = logit(raw.median);
  const score: Interval90 = {
    median: raw.median,
    lo: inv(mid - (mid - logit(raw.lo)) * widen),
    hi: inv(mid + (logit(raw.hi) - mid) * widen),
    n: raw.n,
  };

  // A feature found in fewer than half the resamples is not reported as an interval
  const half = (arr: number[]) => (arr.length >= iterations / 2 ? interval(arr) : null);
  return {
    score,
    features: {
      crestTimeMs: interval(acc.ct),
      stiffnessIndex: half(acc.si),
      reflectionIndexPct: half(acc.ri),
      agi: half(acc.agi),
      ba: half(acc.ba),
      da: half(acc.da),
    },
    notchPresentFraction: acc.notch / iterations,
    iterations,
    coverageWidening: widen,
  };
}
