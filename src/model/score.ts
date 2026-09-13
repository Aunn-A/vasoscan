/**
 * Pulse-contour stiffness score: a heuristic composite, NOT a trained or validated model.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE USING THE NUMBER FOR ANYTHING
 * The centres, scales and weights below are hand-set from the direction and rough magnitude of
 * effects reported in the literature. They were not fitted to any dataset, and the score has not
 * been compared with a reference measurement of arterial stiffness (carotid–femoral pulse-wave
 * velocity, the accepted standard). It is a structured way of combining contour features that
 * each move with stiffness, so the pipeline can be demonstrated end to end. See LIMITATIONS.md.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Form: logistic. Each available feature is converted to a z-like deviation
 *   z = clamp((value − centre) / scale, −3, 3),   signed so that positive = stiffer contour,
 * combined as a weighted mean, scaled by a gain, and mapped to 0–100 with a sigmoid.
 *
 * Features and why they are included:
 *  - SI_DVP (m/s): the most direct contour correlate of large-artery stiffness; scales with
 *    carotid–femoral PWV (Millasseau et al. 2002). Needs height, and a measurable diastolic point.
 *  - Crest time / period: a later systolic peak accompanies stiffer arteries (Alty et al. 2007).
 *  - Aging index (b−c−d−e)/a: rises with age and with stiffness (Takazawa et al. 1998). Camera
 *    sampling biases APG ratios (see preprocess.ts), so its centre is set loosely.
 *  - Dicrotic notch depth: loss of the notch is the contour typical of stiff arteries (Dawber et
 *    al. 1973, Angiology 24:244). Depth (diastolic peak minus notch, as a fraction of pulse height,
 *    0 when absent) is used rather than present/absent: a binary term flipped with noise on
 *    borderline contours and made the score jump by tens of points between repeat recordings.
 *
 * Deliberately excluded:
 *  - Reflection index: mainly small-artery tone. Shown separately, not scored.
 *  - Age: including it would make the score partly an age readout. Age is used only for context.
 *  - Heart rate and HRV: autonomic state, not vessel wall properties.
 *  - Anything from the Doppler channel: that channel is simulated.
 */
import type { Morphology } from '../features/morphology';

export interface ScoreTerm {
  key: 'si' | 'crestRatio' | 'agi' | 'notchShallowness';
  label: string;
  centre: number;
  scale: number;
  weight: number;
}

export const MODEL_VERSION = 'heuristic-0.1 (untrained)';

export const TERMS: ScoreTerm[] = [
  { key: 'si', label: 'Stiffness index', centre: 8.5, scale: 2.0, weight: 1.0 },
  { key: 'crestRatio', label: 'Crest time', centre: 0.19, scale: 0.04, weight: 0.8 },
  { key: 'agi', label: 'Aging index', centre: -0.6, scale: 0.4, weight: 0.6 },
  // value = −depth, so a shallower or absent notch scores as stiffer
  { key: 'notchShallowness', label: 'Dicrotic notch depth', centre: -0.02, scale: 0.03, weight: 0.5 },
];

const GAIN = 1.6;

export const BANDS = [
  { id: 'lower', max: 35 },
  { id: 'intermediate', max: 65 },
  { id: 'higher', max: 100 },
] as const;
export type BandId = (typeof BANDS)[number]['id'];

export function bandOf(score: number): BandId {
  return BANDS.find((b) => score <= b.max)!.id;
}

export function featureValues(m: Morphology): Partial<Record<ScoreTerm['key'], number>> {
  const v: Partial<Record<ScoreTerm['key'], number>> = {
    crestRatio: m.crestTimeRatio,
    notchShallowness: -m.notch.depth,
  };
  if (m.stiffnessIndex !== null && m.stiffnessIndex >= 3 && m.stiffnessIndex <= 20) v.si = m.stiffnessIndex;
  if (m.apg) v.agi = m.apg.agi;
  return v;
}

export interface PointScore {
  score: number;
  contributions: Array<{ key: ScoreTerm['key']; label: string; value: number; z: number; share: number }>;
  /** Sum of weights of terms that could be computed, over the sum of all weights */
  coverage: number;
}

export function scoreFromValues(v: Partial<Record<ScoreTerm['key'], number>>): PointScore {
  let wz = 0, w = 0, wAll = 0;
  const contributions: PointScore['contributions'] = [];
  for (const t of TERMS) {
    wAll += t.weight;
    const value = v[t.key];
    if (value === undefined || !Number.isFinite(value)) continue;
    const z = Math.max(-3, Math.min(3, (value - t.centre) / t.scale));
    wz += t.weight * z;
    w += t.weight;
    contributions.push({ key: t.key, label: t.label, value, z, share: 0 });
  }
  const logit = w > 0 ? (GAIN * wz) / w : 0;
  const totalAbs = contributions.reduce((a, c) => a + Math.abs(c.z) * TERMS.find((t) => t.key === c.key)!.weight, 0);
  for (const c of contributions) c.share = totalAbs ? (Math.abs(c.z) * TERMS.find((t) => t.key === c.key)!.weight) / totalAbs : 0;
  return { score: 100 / (1 + Math.exp(-logit)), contributions, coverage: wAll ? w / wAll : 0 };
}
