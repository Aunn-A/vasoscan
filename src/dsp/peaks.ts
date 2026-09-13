/**
 * Beat detection and per-beat fiducial points.
 *
 * Detection follows Elgendi et al. (2013), "Systolic peak detection in acceleration
 * photoplethysmograms measured from emergency responders in tropical conditions", PLoS ONE
 * 8(10):e76585. That method compares two moving averages of the squared, positive-clipped
 * signal: a short window (~111 ms, one systolic peak) and a long window (~667 ms, one beat).
 * Regions where the short average exceeds the long one are candidate systolic blocks. The
 * dicrotic wave is lower and narrower than systole, so it rarely forms a block of sufficient
 * width.
 *
 * On top of that, a refractory period derived from the dominant spectral heart rate stops a
 * prominent diastolic peak being counted as a second beat.
 *
 * Timing fiducials (max slope, tangent foot) are located on the smoother detection band: they
 * only need to be consistent from beat to beat, and the 8 Hz morphology band carries more noise
 * into a derivative. Amplitude fiducials (foot, peak) use the morphology band.
 *
 * Fiducials per beat:
 *  - foot: minimum preceding the systolic peak
 *  - max slope: steepest point of the upstroke (sub-sample, parabolic refinement)
 *  - tangent foot: intersection of the max-slope tangent with the horizontal through the foot.
 *    This is the standard, noise-robust pulse-onset definition used in pulse-wave analysis.
 *  - systolic peak
 */
import { dominantFrequency, powerSpectrum } from './fft';
import { movingAverage } from './filters';
import { refineExtremum, sgFirstDerivative } from './derivative';

export interface Beat {
  footIdx: number;
  peakIdx: number;
  /** Fractional sample index of maximum upstroke slope */
  maxSlopePos: number;
  /** Fractional sample index of the tangent-intersection foot */
  tangentFootPos: number;
  /** Pulse amplitude peak − foot, signal units */
  amplitude: number;
}

export interface BeatDetection {
  beats: Beat[];
  /** Dominant cardiac frequency from the spectrum, Hz */
  spectralHr: number;
  refractorySec: number;
}

export function detectBeats(detect: Float64Array, morph: Float64Array, fs: number): BeatDetection {
  const n = detect.length;
  const spec = powerSpectrum(detect, fs, 16384);
  let { freq } = dominantFrequency(spec, 0.6, 3.5);
  // Guard against locking onto the second harmonic when the fundamental is only slightly weaker.
  const sub = dominantFrequency(spec, Math.max(0.6, freq / 2 - 0.15), freq / 2 + 0.15);
  const main = dominantFrequency(spec, freq - 0.05, freq + 0.05);
  if (freq / 2 >= 0.6 && sub.power > 0.6 * main.power) freq = sub.freq;
  const period = 1 / freq;
  const refractorySec = Math.max(0.3, 0.6 * period);

  // Elgendi: clip, square, two moving averages, offset threshold
  const y = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) { const v = Math.max(0, detect[i]); y[i] = v * v; mean += y[i]; }
  mean /= n || 1;
  const w1 = Math.round(0.111 * fs);
  const w2 = Math.round(0.667 * fs);
  const maPeak = movingAverage(y, w1);
  const maBeat = movingAverage(y, w2);
  const beta = 0.02;

  const candidates: number[] = [];
  let blockStart = -1;
  for (let i = 0; i <= n; i++) {
    const inBlock = i < n && maPeak[i] > maBeat[i] + beta * mean;
    if (inBlock && blockStart < 0) blockStart = i;
    if (!inBlock && blockStart >= 0) {
      if (i - blockStart >= w1) {
        let best = blockStart;
        for (let j = blockStart; j < i; j++) if (detect[j] > detect[best]) best = j;
        candidates.push(best);
      }
      blockStart = -1;
    }
  }

  // Refractory period: of two peaks closer than refractorySec keep the taller
  const peaks: number[] = [];
  for (const c of candidates) {
    const last = peaks[peaks.length - 1];
    if (last !== undefined && (c - last) / fs < refractorySec) {
      if (detect[c] > detect[last]) peaks[peaks.length - 1] = c;
    } else {
      peaks.push(c);
    }
  }

  // Fiducials on the morphology signal
  const d1 = sgFirstDerivative(detect, fs, Math.max(2, Math.round(0.035 * fs)));
  const beats: Beat[] = [];
  const searchBack = Math.round(0.45 * period * fs);
  const peakWin = Math.round(0.08 * fs);
  let prevPeak = -1;
  for (const p0 of peaks) {
    // Morphology-band systolic peak near the detection peak
    let pk = p0;
    for (let j = Math.max(0, p0 - peakWin); j <= Math.min(n - 1, p0 + peakWin); j++) if (morph[j] > morph[pk]) pk = j;
    const lo = Math.max(prevPeak + 1, pk - searchBack, 1);
    if (pk - lo < 2) { prevPeak = pk; continue; }
    let foot = pk;
    for (let j = pk; j >= lo; j--) if (morph[j] < morph[foot]) foot = j;
    if (foot >= pk - 1 || foot <= 0) { prevPeak = pk; continue; }
    let ms = foot;
    for (let j = foot; j <= pk; j++) if (d1[j] > d1[ms]) ms = j;
    const msPos = refineExtremum(d1, ms);
    const slope = d1[ms];
    let dFoot = ms;
    for (let j = ms; j >= lo; j--) if (detect[j] < detect[dFoot]) dFoot = j;
    const tangentFootPos = slope > 0 ? msPos - ((detect[ms] - detect[dFoot]) / slope) * fs : foot;
    beats.push({
      footIdx: foot,
      peakIdx: pk,
      maxSlopePos: msPos,
      tangentFootPos,
      amplitude: morph[pk] - morph[foot],
    });
    prevPeak = pk;
  }

  return { beats, spectralHr: freq * 60, refractorySec };
}
