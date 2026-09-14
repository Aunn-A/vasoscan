/**
 * Translation layer: analysis results → plain-language findings.
 *
 * Every sentence here is built from a value the pipeline actually computed, and says no more than
 * that value supports. There is deliberately no wording that names a disease, estimates risk, or
 * classifies a rhythm. Tests in tests/findings.test.ts check this.
 */
import type { AnalysisResult } from '../pipeline';
import type { Issue } from '../quality/sqi';
import { TERMS } from '../model/score';

export type Level = 'good' | 'fair' | 'poor' | 'neutral';

export interface Metric {
  label: string;
  value: string;
  unit?: string;
  /** Short qualifier, e.g. an uncertainty range or why it is missing */
  note?: string;
}

export interface Finding {
  id: 'quality' | 'rate' | 'shape' | 'stiffness';
  title: string;
  status: { level: Level; label: string };
  /** The takeaway: one or two sentences a layperson can act on or remember */
  takeaway: string;
  /** What the evidence shows, in plain words */
  explanation: string;
  /** Why it matters, including the limits of what it means */
  context: string;
  metrics: Metric[];
  experimental?: boolean;
}

export interface Summary {
  usable: boolean;
  verdict: string;
  sentence: string;
  /** For failed recordings: the problems and fixes, most important first */
  problems: Issue[];
  warnings: Issue[];
}

const round = (v: number, step = 1) => Math.round(v / step) * step;
const secs = (v: number) => `${Math.round(v)}`;

export function analysedSeconds(r: AnalysisResult): number {
  return r.pre ? r.pre.ppg.length / r.pre.fs : 0;
}

export function cleanSeconds(r: AnalysisResult): number {
  return r.quality ? r.quality.metrics.cleanFraction * analysedSeconds(r) : 0;
}

export type ShapePattern = 'separate' | 'shoulder' | 'merged';

export function shapePattern(r: AnalysisResult): ShapePattern | null {
  const m = r.morphology;
  if (!m) return null;
  if (m.notch.present) return 'separate';
  if (m.diastolic) return 'shoulder';
  return 'merged';
}

export function summarise(r: AnalysisResult): Summary {
  const q = r.quality;
  const problems = q?.issues.filter((i) => i.severity === 'fail') ?? [];
  const warnings = q?.issues.filter((i) => i.severity === 'warn') ?? [];
  if (r.error || !q) {
    return {
      usable: false,
      verdict: 'Recording not usable',
      sentence: r.error ?? 'The recording could not be analysed.',
      problems: [{ code: 'short-recording', severity: 'fail', problem: r.error ?? 'The recording could not be analysed.', fix: 'Start a new recording and keep your finger in place until it finishes.' }],
      warnings: [],
    };
  }
  if (!q.pass || !r.score || !r.hrv) {
    return {
      usable: false,
      verdict: 'Recording not usable',
      sentence: problems[0]?.problem ?? 'The recording did not meet the quality checks, so nothing was measured.',
      problems,
      warnings,
    };
  }
  const hr = round(r.hrv.heartRateBpm);
  const pattern = shapePattern(r);
  const shape = pattern === 'separate'
    ? 'the reflected wave stays separate from the main peak'
    : pattern === 'shoulder'
      ? 'the reflected wave appears as a shoulder without a clear notch'
      : 'the reflected wave has merged into the main peak';
  return {
    usable: true,
    verdict: warnings.length ? 'Recording usable, with parts left out' : 'Recording usable',
    sentence: `A clear pulse was recorded for ${secs(cleanSeconds(r))} of ${secs(analysedSeconds(r))} seconds. Your heart rate averaged ${hr} beats per minute, and in the shape of your pulse ${shape}.`,
    problems,
    warnings,
  };
}

export function qualityFinding(r: AnalysisResult): Finding {
  const q = r.quality!;
  const total = analysedSeconds(r);
  const clean = cleanSeconds(r);
  const warns = q.issues.filter((i) => i.severity === 'warn');
  let level: Level = 'poor';
  let label = 'Not usable';
  if (q.pass) {
    const excellent = warns.length === 0 && q.metrics.cleanFraction >= 0.9 && q.metrics.splitHalfR >= 0.95;
    level = excellent ? 'good' : 'fair';
    label = excellent ? 'Good' : 'Usable';
  }
  const excluded = q.artifacts.length
    ? ` ${q.artifacts.length === 1 ? 'One stretch was' : `${q.artifacts.length} stretches were`} left out because the signal was disturbed.`
    : ' Nothing had to be left out.';
  const exposure = r.pre?.exposureSteps.length ?? 0;
  const metrics: Metric[] = [
    { label: 'Steady signal', value: secs(clean), unit: `of ${secs(total)} s` },
    { label: 'Heartbeats used', value: String(q.metrics.acceptedBeats) },
    { label: 'Beat shape reproducibility', value: q.metrics.splitHalfR.toFixed(2), note: '1.00 means both halves of the recording gave the same shape' },
    { label: 'Camera frame rate', value: q.metrics.frameRate.toFixed(0), unit: 'frames/s' },
  ];
  if (r.perfusionIndexPct !== null) {
    metrics.push({ label: 'Pulse strength', value: r.perfusionIndexPct.toFixed(2), unit: '%', note: 'relative; only comparable on the same phone' });
  }
  return {
    id: 'quality',
    title: 'Recording quality',
    status: { level, label },
    takeaway: q.pass
      ? `A clear pulse was recorded for ${secs(clean)} of ${secs(total)} seconds.${excluded}`
      : q.issues.find((i) => i.severity === 'fail')?.problem ?? 'The recording did not pass the quality checks.',
    explanation: `Before measuring anything, VasoScan checks every camera frame for a covered lens and usable light, corrects the camera's automatic brightness changes${exposure ? ` (${exposure} in this recording)` : ''}, and leaves out moments of movement.`,
    context: q.pass
      ? 'Measurements below use only the steady parts of the recording. A recording that fails these checks produces no measurements at all, rather than unreliable ones.'
      : 'No measurements were made from this recording, because numbers from a disturbed signal would be unreliable.',
    metrics,
  };
}

export function rateFinding(r: AnalysisResult): Finding | null {
  const h = r.hrv;
  if (!h || !r.quality?.pass) return null;
  const hr = round(h.heartRateBpm);
  const valid = h.intervals.filter((i) => i.valid).map((i) => i.ms);
  const minBpm = round(60000 / Math.max(...valid));
  const maxBpm = round(60000 / Math.min(...valid));
  const variation = h.rmssdMs !== null && h.rmssdAboveNoise
    ? `The time between beats changed by about ${round(h.rmssdMs)} milliseconds from one beat to the next.`
    : 'The change in timing from one beat to the next was too small to separate from measurement noise in this recording, so it is not reported as a number.';
  const metrics: Metric[] = [
    { label: 'Average heart rate', value: String(hr), unit: 'beats/min' },
    { label: 'Slowest to fastest beat', value: `${minBpm}–${maxBpm}`, unit: 'beats/min' },
  ];
  if (h.rmssdMs !== null) {
    metrics.push(h.rmssdAboveNoise
      ? { label: 'Beat-to-beat variation (RMSSD)', value: String(round(h.rmssdMs)), unit: 'ms' }
      : { label: 'Beat-to-beat variation (RMSSD)', value: 'Not reported', note: `below the ${round(2 * (h.rmssdNoiseFloorMs ?? 0))} ms this recording can resolve` });
  }
  if (h.sdnnMs !== null) metrics.push({ label: 'Overall variation (SDNN)', value: String(round(h.sdnnMs)), unit: 'ms', note: 'from 1 minute; standard SDNN uses 5 minutes' });
  return {
    id: 'rate',
    title: 'Heart rate and beat timing',
    status: { level: 'neutral', label: 'Measured' },
    takeaway: `Your pulse averaged ${hr} beats per minute, ranging from ${minBpm} to ${maxBpm} across the recording. ${variation}`,
    explanation: `Each heartbeat was located in the signal and the time between neighbouring beats measured. ${h.validIntervals} of ${h.totalIntervals} intervals were usable.`,
    context: 'Some change in beat timing is normal: the heart speeds up slightly when you breathe in and slows when you breathe out. Heart rate and its variation also change with activity, posture, caffeine, stress and sleep, so a single one-minute reading describes this moment only. VasoScan does not assess heart rhythm or detect arrhythmias.',
    metrics,
  };
}

export function shapeFinding(r: AnalysisResult, heightCm?: number): Finding | null {
  const m = r.morphology;
  const u = r.score?.uncertainty;
  if (!m || !u) return null;
  const pattern = shapePattern(r)!;
  const ct = round(m.crestTimeMs);
  const takeaway = {
    separate: `Your pulse wave has two distinct parts: the main push from your heart, which peaked ${ct} ms after the pulse began, and a smaller reflected wave ${round(m.deltaTMs!)} ms later, separated by a clear notch.`,
    shoulder: `Your pulse peaked ${ct} ms after it began. The reflected wave follows ${round(m.deltaTMs!)} ms later as a shoulder on the downslope, without a clear notch.`,
    merged: `Your pulse peaked ${ct} ms after it began. The reflected wave has merged into the main peak, so its timing cannot be measured separately.`,
  }[pattern];
  const notchPct = Math.round(u.notchPresentFraction * 100);
  const metrics: Metric[] = [
    { label: 'Time to peak (crest time)', value: String(round(m.crestTimeMs)), unit: 'ms', note: u.features.crestTimeMs ? `likely ${round(u.features.crestTimeMs.lo)}–${round(u.features.crestTimeMs.hi)}` : undefined },
    { label: 'Dicrotic notch', value: m.notch.present ? 'Present' : 'Not seen', note: `found in ${notchPct}% of resampled averages` },
  ];
  if (m.deltaTMs !== null) metrics.push({ label: 'Peak to reflected wave', value: String(round(m.deltaTMs)), unit: 'ms' });
  if (m.reflectionIndexPct !== null) {
    metrics.push({ label: 'Reflected wave height', value: String(round(m.reflectionIndexPct)), unit: '% of peak', note: 'reflection index; mostly reflects small-vessel tone' });
  }
  if (m.stiffnessIndex !== null) {
    const iv = u.features.stiffnessIndex;
    metrics.push({ label: 'Stiffness index', value: m.stiffnessIndex.toFixed(1), unit: 'm/s', note: iv ? `likely ${iv.lo.toFixed(1)}–${iv.hi.toFixed(1)}; height ÷ reflected-wave delay` : 'height ÷ reflected-wave delay' });
  } else {
    metrics.push({ label: 'Stiffness index', value: 'Not measured', note: heightCm ? 'needs a separate reflected wave' : 'needs your height' });
  }
  if (m.apg) metrics.push({ label: 'Aging index (APG)', value: m.apg.agi.toFixed(2), note: u.features.agi ? `likely ${u.features.agi.lo.toFixed(2)} to ${u.features.agi.hi.toFixed(2)}` : undefined });
  return {
    id: 'shape',
    title: 'Pulse wave shape',
    status: { level: 'neutral', label: 'Measured' },
    takeaway,
    explanation: 'All usable heartbeats were lined up and averaged into one clean beat, shown on the right. Averaging cancels random noise, so the shape of the wave can be measured.',
    context: 'Each heartbeat sends a pressure wave along your arteries, and part of it reflects back from further down the body. In more elastic arteries the reflection travels slowly, arriving late and staying separate from the main peak. In stiffer arteries it travels faster and returns sooner, merging with the peak. That is why pulse shape carries information about arterial stiffness. It is also affected by blood vessel tone, temperature and finger pressure.',
    metrics,
  };
}

export function stiffnessFinding(r: AnalysisResult, ageYears?: number): Finding | null {
  const s = r.score;
  if (!s) return null;
  const lo = round(s.uncertainty.score.lo);
  const hi = round(s.uncertainty.score.hi);
  const bandWord = { lower: 'lower', intermediate: 'intermediate', higher: 'higher' }[s.band];
  const bandOf = (v: number) => (v <= 35 ? 'lower' : v <= 65 ? 'intermediate' : 'higher');
  const spans = bandOf(lo) !== bandOf(hi);
  const top = [...s.contributions].sort((a, b) => b.share - a.share).slice(0, 2);
  const noun = (key: string, stiff: boolean) => ({
    si: stiff ? 'a high stiffness index' : 'a low stiffness index',
    crestRatio: stiff ? 'a late peak' : 'an early peak',
    agi: stiff ? 'a high aging index' : 'a low aging index',
    notchShallowness: stiff ? 'a shallow or missing notch' : 'a clear notch',
  } as Record<string, string>)[key];
  const dir = (z: number) => (z > 0 ? 'stiffer' : 'more elastic');
  let drivers: string;
  if (top.length === 1) {
    drivers = `Mainly because of ${noun(top[0].key, top[0].z > 0)}, a pattern associated with ${dir(top[0].z)} arteries.`;
  } else if (Math.sign(top[0].z) === Math.sign(top[1].z)) {
    drivers = `Mainly because of ${noun(top[0].key, top[0].z > 0)} and ${noun(top[1].key, top[1].z > 0)}, both associated with ${dir(top[0].z)} arteries.`;
  } else {
    drivers = `${noun(top[0].key, top[0].z > 0)[0].toUpperCase()}${noun(top[0].key, top[0].z > 0).slice(1)} points toward ${dir(top[0].z)} arteries, while ${noun(top[1].key, top[1].z > 0)} points toward ${dir(top[1].z)} ones.`;
  }
  const missing = TERMS.filter((t) => !s.contributions.some((c) => c.key === t.key)).map((t) => t.label.toLowerCase());
  const metrics: Metric[] = [
    { label: 'Indicator', value: String(round(s.score)), unit: 'of 100' },
    { label: 'Likely range', value: `${lo}–${hi}`, note: 'from measurement variation only' },
    { label: 'Inputs available', value: `${s.contributions.length} of ${TERMS.length}`, note: missing.length ? `missing: ${missing.join(', ')}` : undefined },
  ];
  const ageNote = ageYears
    ? ` Arterial stiffness normally increases with age; this indicator does not adjust for your age (${ageYears}).`
    : '';
  return {
    id: 'stiffness',
    title: 'Pulse stiffness indicator',
    status: { level: 'neutral', label: `${bandWord[0].toUpperCase()}${bandWord.slice(1)} range` },
    takeaway: `The shape of your pulse places this indicator at ${round(s.score)} out of 100, in the ${bandWord} range${spans ? `, though its likely range of ${lo}–${hi} crosses into the ${bandOf(lo) === s.band ? bandOf(hi) : bandOf(lo)} range` : ` (likely ${lo}–${hi})`}. ${drivers}`,
    explanation: 'The indicator combines the pulse shape measurements above into one number: higher values mean the pulse looks more like the pattern associated with stiffer arteries.',
    context: `This indicator is experimental. Its weights were set by hand from published research, not learned from patient data, and it has not been checked against the clinical reference test for arterial stiffness (carotid–femoral pulse wave velocity). It is not a measurement of your arteries and cannot show whether any condition is present.${ageNote}`,
    metrics,
    experimental: true,
  };
}

export function allFindings(r: AnalysisResult): Finding[] {
  const out: Finding[] = [];
  if (r.quality) out.push(qualityFinding(r));
  const rate = rateFinding(r);
  if (rate) out.push(rate);
  const shape = shapeFinding(r, r.subject.heightCm);
  if (shape) out.push(shape);
  const stiff = stiffnessFinding(r, r.subject.ageYears);
  if (stiff) out.push(stiff);
  return out;
}
