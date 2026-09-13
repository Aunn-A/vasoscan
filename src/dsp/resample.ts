/**
 * Resampling.
 *
 * Phone cameras do not deliver frames at a fixed rate: frame intervals jitter by milliseconds,
 * frames get dropped under load, and iOS may throttle between 24 and 60 fps. Filters and the
 * FFT assume uniform sampling, so every frame is timestamped at capture and the series is
 * interpolated onto a uniform grid here, before any other processing.
 */

export interface Uniform {
  x: Float64Array;
  fs: number;
  /** Time of x[0], seconds (same timebase as the input timestamps) */
  t0: number;
}

/**
 * Natural cubic spline through non-uniformly spaced samples, evaluated on a uniform grid.
 * Samples with non-increasing timestamps are discarded.
 */
export function resampleUniform(t: ArrayLike<number>, x: ArrayLike<number>, fs: number): Uniform {
  const tt: number[] = [];
  const xx: number[] = [];
  for (let i = 0; i < t.length; i++) {
    if (tt.length === 0 || t[i] > tt[tt.length - 1]) {
      tt.push(t[i]);
      xx.push(x[i]);
    }
  }
  const n = tt.length;
  if (n < 4) throw new Error('resampleUniform: need at least 4 samples');

  // Second derivatives at the knots (tridiagonal solve, natural boundary conditions)
  const y2 = new Float64Array(n);
  const u = new Float64Array(n);
  for (let i = 1; i < n - 1; i++) {
    const sig = (tt[i] - tt[i - 1]) / (tt[i + 1] - tt[i - 1]);
    const p = sig * y2[i - 1] + 2;
    y2[i] = (sig - 1) / p;
    const slope = (xx[i + 1] - xx[i]) / (tt[i + 1] - tt[i]) - (xx[i] - xx[i - 1]) / (tt[i] - tt[i - 1]);
    u[i] = ((6 * slope) / (tt[i + 1] - tt[i - 1]) - sig * u[i - 1]) / p;
  }
  for (let k = n - 2; k >= 0; k--) y2[k] = y2[k] * y2[k + 1] + u[k];

  const t0 = tt[0];
  const count = Math.floor((tt[n - 1] - t0) * fs) + 1;
  const out = new Float64Array(count);
  let lo = 0;
  for (let j = 0; j < count; j++) {
    const tq = t0 + j / fs;
    while (lo < n - 2 && tt[lo + 1] < tq) lo++;
    const hi = lo + 1;
    const h = tt[hi] - tt[lo];
    const a = (tt[hi] - tq) / h;
    const b = (tq - tt[lo]) / h;
    out[j] = a * xx[lo] + b * xx[hi] + (((a * a * a - a) * y2[lo] + (b * b * b - b) * y2[hi]) * h * h) / 6;
  }
  return { x: out, fs, t0 };
}

/**
 * Catmull-Rom interpolation of a uniformly sampled signal at a fractional index.
 * Used for sub-sample beat alignment during ensemble averaging.
 */
export function interpAt(x: ArrayLike<number>, pos: number): number {
  const n = x.length;
  const i = Math.floor(pos);
  const f = pos - i;
  const p0 = x[Math.min(n - 1, Math.max(0, i - 1))];
  const p1 = x[Math.min(n - 1, Math.max(0, i))];
  const p2 = x[Math.min(n - 1, Math.max(0, i + 1))];
  const p3 = x[Math.min(n - 1, Math.max(0, i + 2))];
  return p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
}

/** Intervals between consecutive timestamps longer than maxGap seconds (dropped frames). */
export function findGaps(t: ArrayLike<number>, maxGap: number): Array<{ start: number; end: number }> {
  const gaps: Array<{ start: number; end: number }> = [];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > maxGap) gaps.push({ start: t[i - 1], end: t[i] });
  }
  return gaps;
}
