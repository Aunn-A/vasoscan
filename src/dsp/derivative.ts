/**
 * Savitzky–Golay derivatives.
 *
 * A least-squares quadratic is fitted to each (2m+1)-sample window and differentiated
 * analytically. Compared with plain finite differences this is far less noise-amplifying, which
 * is essential for the second derivative: differencing roughly multiplies noise at frequency f
 * by (2πf)², so high-frequency noise would otherwise swamp the APG waves.
 *
 * For a quadratic fit on offsets k = -m..m:
 *   first derivative  = Σ k·y_k / Σ k²
 *   second derivative = 2 · Σ (k² − mean(k²))·y_k / Σ (k² − mean(k²))²
 * (the regressors 1, k and k² − mean(k²) are mutually orthogonal on a symmetric window).
 */

function applyKernel(x: ArrayLike<number>, kernel: Float64Array, scale: number): Float64Array {
  const n = x.length;
  const m = (kernel.length - 1) / 2;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -m; k <= m; k++) {
      const j = Math.min(n - 1, Math.max(0, i + k)); // clamp at edges
      s += kernel[k + m] * x[j];
    }
    out[i] = s * scale;
  }
  return out;
}

export function sgFirstDerivative(x: ArrayLike<number>, fs: number, halfWidth: number): Float64Array {
  const m = Math.max(1, Math.round(halfWidth));
  const kernel = new Float64Array(2 * m + 1);
  let s2 = 0;
  for (let k = -m; k <= m; k++) s2 += k * k;
  for (let k = -m; k <= m; k++) kernel[k + m] = k / s2;
  return applyKernel(x, kernel, fs);
}

export function sgSecondDerivative(x: ArrayLike<number>, fs: number, halfWidth: number): Float64Array {
  const m = Math.max(1, Math.round(halfWidth));
  const N = 2 * m + 1;
  let s2 = 0;
  for (let k = -m; k <= m; k++) s2 += k * k;
  const meanK2 = s2 / N;
  let denom = 0;
  for (let k = -m; k <= m; k++) denom += (k * k - meanK2) ** 2;
  const kernel = new Float64Array(N);
  for (let k = -m; k <= m; k++) kernel[k + m] = (2 * (k * k - meanK2)) / denom;
  return applyKernel(x, kernel, fs * fs);
}

/** Parabolic refinement of an extremum at integer index i. Returns a fractional index. */
export function refineExtremum(y: ArrayLike<number>, i: number): number {
  if (i <= 0 || i >= y.length - 1) return i;
  const a = y[i - 1], b = y[i], c = y[i + 1];
  const denom = a - 2 * b + c;
  if (denom === 0) return i;
  return i + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom));
}
