/**
 * Per-frame checks that a fingertip is actually covering the lens.
 *
 * A fingertip lit from behind by the torch (or by ambient light) passes mostly red light:
 * haemoglobin and tissue absorb blue and green strongly. A covered lens is also spatially uniform,
 * because the finger sits too close to focus and diffuses the light. An uncovered camera sees a
 * scene with mixed colours and edges.
 */
import type { Frame } from '../types';

export type FrameStatus = 'ok' | 'uncovered' | 'dark' | 'overexposed';

export const FRAME_THRESHOLDS = {
  /** Mean red below this is too dark to carry a usable pulse */
  minRed: 20,
  /** Red share of total intensity; tissue-transmitted light is strongly red */
  minRedRatio: 0.5,
  /** Spatial coefficient of variation of red across the ROI */
  maxRedCv: 0.25,
  /** Fraction of clipped pixels in both red and green: the sensor is saturated */
  maxClipped: 0.9,
};

export function classifyFrame(f: Frame): FrameStatus {
  const T = FRAME_THRESHOLDS;
  if (f.r < T.minRed) return 'dark';
  const sum = f.r + f.g + f.b;
  const redRatio = sum > 0 ? f.r / sum : 0;
  if (redRatio < T.minRedRatio || f.rStd / f.r > T.maxRedCv) return 'uncovered';
  if (f.rSat > T.maxClipped && f.gSat > T.maxClipped) return 'overexposed';
  return 'ok';
}
