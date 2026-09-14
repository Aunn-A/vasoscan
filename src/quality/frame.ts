/**
 * Per-frame checks that a fingertip is actually covering the lens.
 *
 * A fingertip lit from behind by the torch (or by ambient light) passes mostly red light:
 * haemoglobin and tissue absorb blue and green strongly. A covered lens also shows no texture,
 * because the finger sits too close to focus. It is not necessarily uniform: the flash sits to one
 * side of the lens and lights the finger unevenly, so overall spread is a poor test (the first
 * version used it and rejected real fingertips). An uncovered camera sees a scene with edges.
 */
import type { Frame } from '../types';

export type FrameStatus = 'ok' | 'uncovered' | 'dark' | 'overexposed';

export const FRAME_THRESHOLDS = {
  /** Mean red below this is too dark to carry a usable pulse */
  minRed: 15,
  /**
   * Red must clearly exceed green and blue. Deliberately tolerant: phone auto-white-balance pulls
   * the finger's colour towards neutral, but a lit fingertip stays red-dominant.
   */
  minRedOverGreen: 1.2,
  minRedOverBlue: 1.2,
  /** Local texture (rEdge). A defocused fingertip is smooth; a scene has edges. */
  maxRedEdge: 0.12,
  /** Fallback for recordings without rEdge: overall spread, loose because flash light is uneven */
  maxRedCv: 0.6,
  /** Fraction of clipped pixels in both red and green: the sensor is saturated */
  maxClipped: 0.9,
};

export function classifyFrame(f: Frame): FrameStatus {
  const T = FRAME_THRESHOLDS;
  if (f.r < T.minRed) return 'dark';
  if (f.r < T.minRedOverGreen * f.g || f.r < T.minRedOverBlue * f.b) return 'uncovered';
  const textured = f.rEdge !== undefined ? f.rEdge > T.maxRedEdge : f.rStd / f.r > T.maxRedCv;
  if (textured) return 'uncovered';
  if (f.rSat > T.maxClipped && f.gSat > T.maxClipped) return 'overexposed';
  return 'ok';
}
