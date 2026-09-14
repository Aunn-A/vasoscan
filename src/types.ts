/** One camera frame reduced to region-of-interest statistics. */
export interface Frame {
  /** Capture timestamp, seconds */
  t: number;
  /** Mean channel values over the ROI, 0–255 */
  r: number;
  g: number;
  b: number;
  /** Spatial standard deviation of red across the ROI */
  rStd: number;
  /**
   * Mean absolute difference between neighbouring ROI pixels in red, divided by mean red: local
   * texture. A fingertip on the lens is out of focus and has almost none, even when the flash
   * lights it unevenly; a scene has edges. Optional for recordings made before it existed.
   */
  rEdge?: number;
  /** Fraction of ROI pixels with red ≥ 250 / green ≥ 250 (sensor clipping) */
  rSat: number;
  gSat: number;
}

export interface Subject {
  heightCm?: number;
  ageYears?: number;
}

/** Where a signal came from. Carried through the pipeline so results can never be mislabelled. */
export type Provenance = { kind: 'measured'; device: string } | { kind: 'simulated'; caseId: string };
