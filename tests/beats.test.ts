import { describe, expect, it } from 'vitest';
import { SYNTH_CASES, synthesize } from '../src/sim/ppgSynth';
import { preprocess } from '../src/dsp/preprocess';
import { detectBeats } from '../src/dsp/peaks';

const byId = (id: string) => SYNTH_CASES.find((c) => c.id === id)!;

describe('beat detection on synthetic camera frames', () => {
  for (const id of ['a', 'b', 'c']) {
    it(`case ${id}: finds every beat once, no dicrotic double counts`, () => {
      const c = byId(id);
      const { frames, beatTimes } = synthesize(c, { durationSec: 60 });
      const pre = preprocess(frames);
      const { beats, spectralHr } = detectBeats(pre.detect, pre.morph, pre.fs);
      expect(Math.abs(spectralHr - c.heartRate)).toBeLessThan(3);

      // Compare tangent-foot times with the model's beat onsets, ignoring filter edge regions
      const truth = beatTimes.filter((tb) => tb > pre.t0 + 2 && tb < pre.t0 + pre.raw.length / pre.fs - 2);
      const found = beats.map((b) => pre.t0 + b.tangentFootPos / pre.fs);
      let matched = 0;
      const offsets: number[] = [];
      for (const tb of truth) {
        const near = found.filter((tf) => Math.abs(tf - tb) < 0.15);
        if (near.length === 1) { matched++; offsets.push(near[0] - tb); }
        expect(near.length).toBeLessThanOrEqual(1);
      }
      expect(matched / truth.length).toBeGreaterThan(0.97);
      // The tangent foot sits at a consistent offset from the Gaussian model's nominal onset;
      // what matters for IBIs is that the offset is stable beat to beat. With sensor noise the
      // jitter scales with noise / upstroke slope, so the stiff, low-perfusion case is worst.
      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
      expect(sd).toBeLessThan(0.03);
    });
  }

  it('timing fiducials are exact without sensor noise', () => {
    for (const id of ['a', 'c']) {
      const c = { ...byId(id), noise: 0 };
      const { frames, beatTimes } = synthesize(c, { durationSec: 40, frameJitterMs: 0, dropProbability: 0 });
      const pre = preprocess(frames);
      const { beats } = detectBeats(pre.detect, pre.morph, pre.fs);
      const offsets: number[] = [];
      for (const tb of beatTimes) {
        if (tb < pre.t0 + 2 || tb > pre.t0 + 36) continue;
        const b = beats.find((x) => Math.abs(pre.t0 + x.maxSlopePos / pre.fs - tb - 0.08) < 0.2);
        if (b) offsets.push(pre.t0 + b.maxSlopePos / pre.fs - tb);
      }
      const mean = offsets.reduce((a, b) => a + b, 0) / offsets.length;
      const sd = Math.sqrt(offsets.reduce((a, b) => a + (b - mean) ** 2, 0) / offsets.length);
      expect(sd).toBeLessThan(0.001);
    }
  });

  it('selects the red channel when it is not saturated', () => {
    const { frames } = synthesize(byId('a'), { durationSec: 30 });
    expect(preprocess(frames).channel).toBe('red');
  });
});
