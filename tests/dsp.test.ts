import { describe, expect, it } from 'vitest';
import { dominantFrequency, fft, powerSpectrum } from '../src/dsp/fft';
import { bandpass, detrendLinear } from '../src/dsp/filters';
import { interpAt, resampleUniform } from '../src/dsp/resample';
import { sgFirstDerivative, sgSecondDerivative } from '../src/dsp/derivative';
import { mulberry32, gaussian } from '../src/sim/random';

const sine = (n: number, fs: number, f: number, phase = 0) =>
  Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f * (i / fs) + phase));

describe('fft', () => {
  it('matches a naive DFT', () => {
    const n = 16;
    const x = Float64Array.from({ length: n }, (_, i) => Math.cos(i * 0.7) + 0.3 * Math.sin(i * 2.1));
    const re = Float64Array.from(x), im = new Float64Array(n);
    fft(re, im);
    for (let k = 0; k < n; k++) {
      let r = 0, m = 0;
      for (let i = 0; i < n; i++) { r += x[i] * Math.cos((-2 * Math.PI * k * i) / n); m += x[i] * Math.sin((-2 * Math.PI * k * i) / n); }
      expect(re[k]).toBeCloseTo(r, 9);
      expect(im[k]).toBeCloseTo(m, 9);
    }
  });

  it('finds a 1.2 Hz tone in 30 s of 60 Hz data to within 0.01 Hz', () => {
    const spec = powerSpectrum(sine(1800, 60, 1.2), 60, 16384);
    expect(dominantFrequency(spec, 0.5, 4).freq).toBeCloseTo(1.2, 2);
  });
});

describe('resampling', () => {
  it('reconstructs a smooth signal sampled with jittered timestamps', () => {
    const rand = mulberry32(1);
    const t: number[] = [];
    let tt = 0;
    while (tt < 10) { tt += 1 / 30 + 0.003 * gaussian(rand); if (rand() > 0.02) t.push(tt); }
    const f = (s: number) => Math.sin(2 * Math.PI * 1.1 * s) + 0.4 * Math.sin(2 * Math.PI * 3.3 * s + 1);
    const u = resampleUniform(t, t.map(f), 60);
    let maxErr = 0;
    for (let i = 0; i < u.x.length; i++) maxErr = Math.max(maxErr, Math.abs(u.x[i] - f(u.t0 + i / 60)));
    expect(maxErr).toBeLessThan(0.03);
  });

  it('interpolates at fractional indices', () => {
    const x = sine(600, 60, 1);
    expect(interpAt(x, 100.5)).toBeCloseTo(Math.sin(2 * Math.PI * (100.5 / 60)), 3);
  });
});

describe('filters', () => {
  const fs = 60;
  it('passes the cardiac band and rejects drift and high-frequency noise', () => {
    const n = 3600;
    const inBand = sine(n, fs, 1.2);
    const drift = sine(n, fs, 0.05);
    const hf = sine(n, fs, 15);
    const y = bandpass(inBand.map((v, i) => v + 3 * drift[i] + hf[i]), fs, 0.5, 4);
    let err = 0;
    for (let i = 600; i < n - 600; i++) err = Math.max(err, Math.abs(y[i] - inBand[i]));
    expect(err).toBeLessThan(0.08);
  });

  it('is zero-phase: a filtered pulse keeps its peak time', () => {
    const n = 1200;
    const x = Float64Array.from({ length: n }, (_, i) => Math.exp(-0.5 * ((i / fs - 10) / 0.08) ** 2));
    const y = bandpass(x, fs, 0.5, 8);
    let best = 0;
    for (let i = 0; i < n; i++) if (y[i] > y[best]) best = i;
    expect(Math.abs(best / fs - 10)).toBeLessThanOrEqual(1 / fs);
  });

  it('removes a linear trend', () => {
    const y = detrendLinear(Float64Array.from({ length: 100 }, (_, i) => 3 + 0.5 * i));
    expect(Math.max(...y.map(Math.abs))).toBeLessThan(1e-9);
  });
});

describe('Savitzky–Golay derivatives', () => {
  it('differentiate a sine accurately', () => {
    const fs = 250, f = 2;
    const x = sine(1000, fs, f);
    const d1 = sgFirstDerivative(x, fs, 5);
    const d2 = sgSecondDerivative(x, fs, 5);
    const w = 2 * Math.PI * f;
    for (let i = 100; i < 900; i += 37) {
      // Small amplitude bias is inherent to smoothing: <1% for d1, <3% for d2 at this window
      expect(Math.abs(d1[i] / w - Math.cos(w * (i / fs)))).toBeLessThan(0.01);
      expect(Math.abs(d2[i] / (w * w) + Math.sin(w * (i / fs)))).toBeLessThan(0.03);
    }
  });
});
