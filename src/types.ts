/** One camera frame reduced to region-of-interest statistics. */
export interface Frame {
  /** Capture timestamp, seconds */
  t: number;
  /** Mean channel values over the ROI, 0–255 */
  r: number;
  g: number;
  b: number;
  /** Spatial standard deviation of red across the ROI (uniformity; a covered lens is uniform) */
  rStd: number;
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
