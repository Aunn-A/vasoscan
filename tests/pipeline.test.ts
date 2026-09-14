import { describe, expect, it } from 'vitest';
import { SYNTH_CASES, synthesize } from '../src/sim/ppgSynth';
import { analyse } from '../src/pipeline';

const run = (id: string) => {
  const c = SYNTH_CASES.find((x) => x.id === id)!;
  const syn = synthesize(c, { durationSec: 65 });
  return { c, syn, r: analyse(syn.frames, { heightCm: c.heightCm, ageYears: c.ageYears }, { kind: 'simulated', caseId: id }, { bootstrapIterations: 100 }) };
};

describe('full pipeline on synthetic recordings', () => {
  const results = Object.fromEntries(['a', 'b', 'c', 'motion', 'no-finger'].map((id) => [id, run(id)]));

  it('passes quality gating for clean recordings', () => {
    for (const id of ['a', 'b', 'c']) expect(results[id].r.quality?.pass, id).toBe(true);
  });

  it('recovers heart rate within 1 bpm', () => {
    for (const id of ['a', 'b', 'c']) {
      const { c, r } = results[id];
      expect(Math.abs(r.hrv!.heartRateBpm - c.heartRate), id).toBeLessThan(1);
    }
  });

  it('recovers RMSSD within 30%, or flags it as indistinguishable from timing noise', () => {
    for (const id of ['a', 'b', 'c']) {
      const { syn, r } = results[id];
      const t = syn.beatTimes.filter((x) => x > 6 && x < 64);
      const ibi = t.slice(1).map((x, i) => (x - t[i]) * 1000);
      const d = ibi.slice(1).map((x, i) => x - ibi[i]);
      const truth = Math.sqrt(d.reduce((a, v) => a + v * v, 0) / d.length);
      const err = Math.abs(r.hrv!.rmssdMs! - truth) / truth;
      expect(err < 0.3 || !r.hrv!.rmssdAboveNoise, `${id}: RMSSD ${r.hrv!.rmssdMs} vs ${truth}, floor ${r.hrv!.rmssdNoiseFloorMs}`).toBe(true);
    }
  });

  it('flags RMSSD as noise-limited when true variability is very low', () => {
    // Case C: true RMSSD ≈ 15 ms, below what this synthetic noise level can resolve
    expect(results.c.r.hrv!.rmssdAboveNoise).toBe(false);
    expect(results.a.r.hrv!.rmssdAboveNoise).toBe(true);
  });

  it('orders the demo cases by contour stiffness', () => {
    const s = (id: string) => results[id].r.score!.score;
    expect(s('a')).toBeLessThan(s('b'));
    expect(s('b')).toBeLessThan(s('c'));
  });

  it('reports an uncertainty band that contains the point estimate', () => {
    for (const id of ['a', 'b', 'c']) {
      const sc = results[id].r.score!;
      expect(sc.uncertainty.score.lo).toBeLessThanOrEqual(sc.score + 1e-9);
      expect(sc.uncertainty.score.hi).toBeGreaterThanOrEqual(sc.score - 1e-9);
    }
  });

  it('refuses to score a recording with movement, and says where', () => {
    const { r } = results.motion;
    expect(r.quality!.pass).toBe(false);
    expect(r.score).toBeNull();
    const fail = r.quality!.issues.find((i) => i.severity === 'fail')!;
    expect(fail.code).toBe('motion');
    // Injected movement at 9–13 s and 46–50 s, finger lift at 29–30.5 s (capture time)
    const covers = (t: number) => fail.intervals!.some((iv) => iv.start <= t && iv.end >= t);
    expect(covers(11)).toBe(true);
    expect(covers(29.8)).toBe(true);
    expect(covers(48)).toBe(true);
  });

  it('refuses to score when no finger covers the lens', () => {
    const { r } = results['no-finger'];
    expect(r.quality!.pass).toBe(false);
    expect(r.quality!.issues[0].code).toBe('no-finger');
    expect(r.score).toBeNull();
  });

  it('keeps provenance on the result', () => {
    expect(results.a.r.provenance).toEqual({ kind: 'simulated', caseId: 'a' });
  });
});

describe('realistic phone camera behaviour', () => {
  // Auto-exposure steps, white balance, uneven flash light, breathing, odd frames
  for (const id of ['a', 'b', 'c']) {
    it(`case ${id}: passes the quality gate and recovers heart rate`, () => {
      for (const seed of [101, 202]) {
        const c = { ...SYNTH_CASES.find((x) => x.id === id)!, seed };
        const r = analyse(synthesize(c, { durationSec: 65, camera: 'phone' }).frames, { heightCm: c.heightCm }, { kind: 'simulated', caseId: id }, { bootstrapIterations: 50 });
        expect(r.quality!.pass, `${id}/${seed}: ${r.quality!.issues.map((i) => i.problem).join(' ')}`).toBe(true);
        expect(Math.abs(r.hrv!.heartRateBpm - c.heartRate)).toBeLessThan(1.5);
        expect(r.pre!.exposureSteps.length).toBeGreaterThan(0);
      }
    });
  }

  it('still refuses a recording with no pulse (finger pressed too hard)', () => {
    const c = { ...SYNTH_CASES.find((x) => x.id === 'a')!, perfusion: 0.0003, seed: 7 };
    const r = analyse(synthesize(c, { durationSec: 65, camera: 'phone' }).frames, {}, { kind: 'simulated', caseId: 'a' }, { bootstrapIterations: 50 });
    expect(r.quality!.pass).toBe(false);
    expect(r.score).toBeNull();
  });

  it('still refuses an uncovered lens', () => {
    const c = { ...SYNTH_CASES.find((x) => x.id === 'no-finger')! };
    const r = analyse(synthesize(c, { durationSec: 65, camera: 'phone' }).frames, {}, { kind: 'simulated', caseId: 'no-finger' });
    expect(r.quality!.pass).toBe(false);
  });

  it('removes isolated exposure steps and single-frame glitches without losing signal', () => {
    const c = { ...SYNTH_CASES.find((x) => x.id === 'b')!, seed: 303 };
    const r = analyse(synthesize(c, { durationSec: 65, camera: 'phone' }).frames, {}, { kind: 'simulated', caseId: 'b' }, { bootstrapIterations: 50 });
    expect(r.quality!.metrics.cleanFraction).toBeGreaterThan(0.85);
  });
});

describe('safety invariant: a passing recording never carries a wrong heart rate', () => {
  it('holds across cases, camera models, seeds and a single movement episode', () => {
    const failures: string[] = [];
    for (const id of ['a', 'b', 'c', 'motion']) {
      for (const camera of ['ideal', 'phone'] as const) {
        for (const seed of [1, 2, 3, 4]) {
          const c = { ...SYNTH_CASES.find((x) => x.id === id)!, seed };
          const r = analyse(synthesize(c, { durationSec: 65, camera }).frames, { heightCm: c.heightCm }, { kind: 'simulated', caseId: id }, { bootstrapIterations: 50 });
          if (r.quality?.pass && Math.abs(r.hrv!.heartRateBpm - c.heartRate) > 3) {
            failures.push(`${id}/${camera}/${seed}: ${r.hrv!.heartRateBpm.toFixed(1)} vs ${c.heartRate}`);
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
