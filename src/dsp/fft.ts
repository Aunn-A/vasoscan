/**
 * Spectral analysis.
 *
 * `fft` is the in-place iterative radix-2 transform from the original VasoScan prototype
 * (reference/VasoScan_Prototype.html), unchanged in substance. What is new: a Hann window
 * before the transform, zero padding, and a properly scaled one-sided power spectrum with
 * physical frequency axis, which the prototype lacked.
 */

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n !== im.length || n === 0 || (n & (n - 1)) !== 0) {
    throw new Error('fft: arrays must have equal power-of-two length');
  }
  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  // Butterfly passes, doubling the block length each stage
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cwr = 1;
      let cwi = 0;
      for (let k = 0; k < half; k++) {
        const p = i + k;
        const q = p + half;
        const br = re[q] * cwr - im[q] * cwi;
        const bi = re[q] * cwi + im[q] * cwr;
        re[q] = re[p] - br;
        im[q] = im[p] - bi;
        re[p] += br;
        im[p] += bi;
        const t = cwr * wr - cwi * wi;
        cwi = cwr * wi + cwi * wr;
        cwr = t;
      }
    }
  }
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Symmetric Hann window. Suppresses spectral leakage from the finite capture window. */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) { w[0] = 1; return w; }
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  return w;
}

export interface Spectrum {
  /** Frequency of each bin, Hz */
  freqs: Float64Array;
  /** One-sided power, window-energy normalised (arbitrary units, comparable within a spectrum) */
  power: Float64Array;
  /** Bin spacing, Hz */
  df: number;
}

/**
 * Hann-windowed, mean-removed, zero-padded power spectrum.
 * Zero padding interpolates the spectrum (finer bin spacing); it does not add resolution.
 */
export function powerSpectrum(x: ArrayLike<number>, fs: number, minLength = 4096): Spectrum {
  const n = x.length;
  const N = Math.max(nextPow2(n), minLength);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const w = hann(n);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n || 1;
  let wEnergy = 0;
  for (let i = 0; i < n; i++) {
    re[i] = (x[i] - mean) * w[i];
    wEnergy += w[i] * w[i];
  }
  fft(re, im);
  const half = N >> 1;
  const power = new Float64Array(half);
  const freqs = new Float64Array(half);
  const df = fs / N;
  for (let k = 0; k < half; k++) {
    power[k] = (re[k] * re[k] + im[k] * im[k]) / (wEnergy || 1);
    freqs[k] = k * df;
  }
  return { freqs, power, df };
}

/** Sum of power between f0 and f1 (inclusive), Hz. */
export function bandPower(spec: Spectrum, f0: number, f1: number): number {
  const k0 = Math.max(0, Math.ceil(f0 / spec.df));
  const k1 = Math.min(spec.power.length - 1, Math.floor(f1 / spec.df));
  let s = 0;
  for (let k = k0; k <= k1; k++) s += spec.power[k];
  return s;
}

/** Strongest spectral peak in [fmin, fmax], refined by parabolic interpolation. */
export function dominantFrequency(spec: Spectrum, fmin: number, fmax: number): { freq: number; power: number } {
  const k0 = Math.max(1, Math.ceil(fmin / spec.df));
  const k1 = Math.min(spec.power.length - 2, Math.floor(fmax / spec.df));
  let best = k0;
  for (let k = k0; k <= k1; k++) if (spec.power[k] > spec.power[best]) best = k;
  const a = spec.power[best - 1];
  const b = spec.power[best];
  const c = spec.power[best + 1];
  const denom = a - 2 * b + c;
  const offset = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { freq: (best + offset) * spec.df, power: b };
}
