/**
 * IIR filtering.
 *
 * Butterworth filters (maximally flat passband) built from second-order sections using the
 * bilinear transform (RBJ Audio EQ Cookbook forms), and applied forward then backward
 * ("filtfilt"). Forward-backward filtering cancels phase delay. That matters here: an ordinary
 * causal IIR filter delays the systolic upstroke by tens of milliseconds, which would bias
 * crest time and every other timing feature by roughly the same amount.
 */

export interface Biquad {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

function section(type: 'lowpass' | 'highpass', fc: number, fs: number, q: number): Biquad {
  const w0 = (2 * Math.PI * fc) / fs;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  const a0 = 1 + alpha;
  if (type === 'lowpass') {
    return { b0: (1 - cos) / 2 / a0, b1: (1 - cos) / a0, b2: (1 - cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
  }
  return { b0: (1 + cos) / 2 / a0, b1: -(1 + cos) / a0, b2: (1 + cos) / 2 / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

/** Butterworth filter of even order as a cascade of biquads. */
export function butterworth(type: 'lowpass' | 'highpass', order: 2 | 4 | 6 | 8, fc: number, fs: number): Biquad[] {
  if (fc <= 0 || fc >= fs / 2) throw new Error(`butterworth: cutoff ${fc} Hz outside (0, ${fs / 2})`);
  const sos: Biquad[] = [];
  for (let k = 0; k < order / 2; k++) {
    const q = 1 / (2 * Math.cos(((2 * k + 1) * Math.PI) / (2 * order)));
    sos.push(section(type, fc, fs, q));
  }
  return sos;
}

function dcGain(s: Biquad): number {
  return (s.b0 + s.b1 + s.b2) / (1 + s.a1 + s.a2);
}

/**
 * Causal cascade filter (transposed direct form II). State is initialised to the steady
 * state for a constant input equal to x[0], which avoids a start-up transient.
 */
export function sosfilt(sos: Biquad[], x: ArrayLike<number>): Float64Array {
  let y = Float64Array.from(x as ArrayLike<number>);
  let v = y.length ? y[0] : 0;
  for (const s of sos) {
    const out = new Float64Array(y.length);
    const g = dcGain(s);
    const yss = v * g;
    let z2 = s.b2 * v - s.a2 * yss;
    let z1 = s.b1 * v - s.a1 * yss + z2;
    for (let i = 0; i < y.length; i++) {
      const xi = y[i];
      const yi = s.b0 * xi + z1;
      z1 = s.b1 * xi - s.a1 * yi + z2;
      z2 = s.b2 * xi - s.a2 * yi;
      out[i] = yi;
    }
    y = out;
    v = yss;
  }
  return y;
}

/**
 * Zero-phase filtering: filter, reverse, filter, reverse. Ends are extended by odd reflection
 * so edge transients fall in the padding and are discarded.
 */
export function filtfilt(sos: Biquad[], x: ArrayLike<number>, padSamples: number): Float64Array {
  const n = x.length;
  const pad = Math.max(0, Math.min(n - 1, Math.round(padSamples)));
  const ext = new Float64Array(n + 2 * pad);
  for (let i = 0; i < pad; i++) ext[i] = 2 * x[0] - x[pad - i];
  for (let i = 0; i < n; i++) ext[pad + i] = x[i];
  for (let i = 0; i < pad; i++) ext[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i];
  const fwd = sosfilt(sos, ext);
  fwd.reverse();
  const bwd = sosfilt(sos, fwd);
  bwd.reverse();
  return bwd.slice(pad, pad + n);
}

/**
 * Zero-phase Butterworth bandpass (highpass cascade then lowpass cascade). Because filtfilt runs
 * each filter twice, the effective magnitude response is the square of an `order`-order filter,
 * and the -3 dB points sit slightly inside [lo, hi].
 */
export function bandpass(x: ArrayLike<number>, fs: number, lo: number, hi: number, order: 2 | 4 = 4): Float64Array {
  const pad = Math.round((3 / lo) * fs); // three periods of the lowest passband frequency
  const hp = filtfilt(butterworth('highpass', order, lo, fs), x, pad);
  return filtfilt(butterworth('lowpass', order, hi, fs), hp, pad);
}

export function lowpass(x: ArrayLike<number>, fs: number, fc: number, order: 2 | 4 = 4): Float64Array {
  return filtfilt(butterworth('lowpass', order, fc, fs), x, Math.round((3 / fc) * fs));
}

/** Least-squares linear trend removal. */
export function detrendLinear(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sx += i; sy += x[i]; sxx += i * i; sxy += i * x[i]; }
  const denom = n * sxx - sx * sx;
  const slope = denom ? (n * sxy - sx * sy) / denom : 0;
  const icpt = (sy - slope * sx) / (n || 1);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = x[i] - (icpt + slope * i);
  return out;
}

/** Centred moving average with window `win` samples (odd widths are exactly centred). */
export function movingAverage(x: ArrayLike<number>, win: number): Float64Array {
  const n = x.length;
  const w = Math.max(1, Math.round(win));
  const half = Math.floor(w / 2);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i - half + w);
    out[i] = (prefix[b] - prefix[a]) / (b - a);
  }
  return out;
}

/**
 * Streaming causal bandpass for the live display trace only. Never used for measurement.
 * Causal filtering delays the trace slightly, which is invisible on a scrolling display.
 */
export class StreamingBandpass {
  private sos: Biquad[];
  private z1: Float64Array;
  private z2: Float64Array;
  private primed = false;

  constructor(fs: number, lo: number, hi: number) {
    this.sos = [...butterworth('highpass', 2, lo, fs), ...butterworth('lowpass', 2, hi, fs)];
    this.z1 = new Float64Array(this.sos.length);
    this.z2 = new Float64Array(this.sos.length);
  }

  push(x: number): number {
    if (!this.primed) {
      let v = x;
      this.sos.forEach((s, k) => {
        const yss = v * dcGain(s);
        this.z2[k] = s.b2 * v - s.a2 * yss;
        this.z1[k] = s.b1 * v - s.a1 * yss + this.z2[k];
        v = yss;
      });
      this.primed = true;
    }
    let v = x;
    this.sos.forEach((s, k) => {
      const y = s.b0 * v + this.z1[k];
      this.z1[k] = s.b1 * v - s.a1 * y + this.z2[k];
      this.z2[k] = s.b2 * v - s.a2 * y;
      v = y;
    });
    return v;
  }
}
