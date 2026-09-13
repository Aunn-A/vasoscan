/**
 * End-to-end analysis: camera frames → quality-gated measurements.
 *
 * Live capture and demo cases both enter here as Frame[]; the only difference is the provenance
 * tag, which is carried on the result so a simulated recording can never be displayed as measured.
 */
import type { Frame, Provenance, Subject } from './types';
import { preprocess, type Preprocessed } from './dsp/preprocess';
import { detectBeats, type Beat } from './dsp/peaks';
import { buildEnsemble, median, type Ensemble } from './dsp/ensemble';
import { contourFromEnsemble, extractMorphology, type Morphology } from './features/morphology';
import { computeHrv, estimateTimingNoiseMs, type Hrv } from './features/hrv';
import { perfusionIndex } from './features/perfusion';
import { artifactMask, assessQuality, type QualityReport } from './quality/sqi';
import { featureValues, scoreFromValues, bandOf, MODEL_VERSION, type PointScore, type BandId } from './model/score';
import { bootstrap, type Uncertainty } from './model/uncertainty';

export interface AnalysisOptions {
  /** Seconds discarded at the start while auto-exposure settles */
  settleSec?: number;
  bootstrapIterations?: number;
}

export interface AnalysisResult {
  provenance: Provenance;
  subject: Subject;
  analysedAt: string;
  pre: Preprocessed | null;
  beats: Beat[];
  /** Per beat: lies entirely within clean signal */
  beatClean: boolean[];
  ensemble: Ensemble | null;
  morphology: Morphology | null;
  hrv: Hrv | null;
  perfusionIndexPct: number | null;
  /** Interval times in quality are seconds from capture start; the analysis signal starts at this offset */
  analysisOffsetSec: number;
  quality: QualityReport | null;
  /** Present only when quality.pass */
  score: (PointScore & { band: BandId; uncertainty: Uncertainty; modelVersion: string }) | null;
  /** Set when analysis could not even start (e.g. too few frames) */
  error?: string;
}

export function analyse(allFrames: Frame[], subject: Subject, provenance: Provenance, opts: AnalysisOptions = {}): AnalysisResult {
  const base: AnalysisResult = {
    provenance, subject, analysedAt: new Date().toISOString(),
    pre: null, beats: [], beatClean: [], ensemble: null, morphology: null, hrv: null,
    perfusionIndexPct: null, analysisOffsetSec: 0, quality: null, score: null,
  };
  if (allFrames.length < 60) return { ...base, error: 'Too few camera frames were recorded to analyse.' };

  const settle = opts.settleSec ?? 5;
  const tStart = allFrames[0].t + settle;
  const frames = allFrames.filter((f) => f.t >= tStart);
  if (frames.length < 60) return { ...base, error: 'The recording ended before the camera had settled.' };

  // Channel choice and filtering use only frames where a finger was present, where possible,
  // so an uncovered lens does not dominate the spectrum. Timestamps keep gaps honest.
  const pre = preprocess(frames);
  const { beats, spectralHr } = detectBeats(pre.detect, pre.morph, pre.fs);
  const amps = beats.map((b) => b.amplitude).filter((a) => a > 0);
  const medAmp = amps.length ? median(amps) : 0;

  const { mask, statusFraction, reasons } = artifactMask(frames, pre, medAmp);
  // Report artifact times from the start of the capture, as the user experienced it
  const offset = pre.t0 - allFrames[0].t;
  const shift = (ivs: Array<{ start: number; end: number }>) => ivs.map((iv) => ({ start: iv.start + offset, end: iv.end + offset }));
  reasons.frame = shift(reasons.frame);
  reasons.motion = shift(reasons.motion);
  const period = beats.length > 2 ? median(beats.slice(1).map((b, i) => (b.maxSlopePos - beats[i].maxSlopePos) / pre.fs)) : 60 / spectralHr;

  const beatClean = beats.map((b) => {
    const a = Math.max(0, Math.floor(b.footIdx - 0.1 * pre.fs));
    const z = Math.min(mask.length - 1, Math.ceil(b.maxSlopePos + period * pre.fs));
    for (let i = a; i <= z; i++) if (mask[i]) return false;
    return true;
  });
  const clean = beats.filter((_, i) => beatClean[i]);

  const ensemble = clean.length >= 5 ? buildEnsemble(pre.morph, pre.fs, clean, period) : null;
  const accepted = ensemble ? ensemble.accepted.filter(Boolean).length : 0;

  // HRV: intervals only between consecutive clean beats not separated by an artifact
  const times = beats.map((b) => b.maxSlopePos / pre.fs);
  const contiguous = beats.slice(1).map((b, i) => {
    if (!beatClean[i] || !beatClean[i + 1]) return false;
    for (let j = Math.floor(beats[i].maxSlopePos); j <= Math.ceil(b.maxSlopePos); j++) if (mask[j]) return false;
    return true;
  });
  const hrv = computeHrv(times, contiguous, estimateTimingNoiseMs(pre, clean));

  const quality = assessQuality({
    pre, statusFraction, mask,
    frameIntervals: reasons.frame, motionIntervals: reasons.motion,
    acceptedBeats: accepted, candidateBeats: beats.length,
    heartRateBpm: hrv?.heartRateBpm ?? spectralHr,
    durationSec: frames[frames.length - 1].t - frames[0].t,
  });

  const result: AnalysisResult = {
    ...base, pre, beats, beatClean, ensemble, hrv, quality, analysisOffsetSec: offset,
    perfusionIndexPct: perfusionIndex(pre.raw, beats, pre.fs, (b) => beatClean[beats.indexOf(b)]),
  };
  if (!quality.pass || !ensemble || accepted < 5) return result;

  const morphology = extractMorphology(contourFromEnsemble(ensemble).contour, ensemble.fs, subject.heightCm);
  const point = scoreFromValues(featureValues(morphology));
  const uncertainty = bootstrap(ensemble, subject.heightCm, opts.bootstrapIterations ?? 200);
  return {
    ...result,
    morphology,
    score: { ...point, band: bandOf(point.score), uncertainty, modelVersion: MODEL_VERSION },
  };
}
