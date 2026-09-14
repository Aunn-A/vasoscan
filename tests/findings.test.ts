import { describe, expect, it } from 'vitest';
import { SYNTH_CASES, synthesize } from '../src/sim/ppgSynth';
import { analyse } from '../src/pipeline';
import { allFindings, summarise } from '../src/app/findings';

const run = (id: string, subject = true) => {
  const c = SYNTH_CASES.find((x) => x.id === id)!;
  return analyse(synthesize(c, { durationSec: 65 }).frames, subject ? { heightCm: c.heightCm, ageYears: c.ageYears } : {}, { kind: 'simulated', caseId: id }, { bootstrapIterations: 60 });
};

// Words that would claim diagnostic ability this app does not have
const FORBIDDEN = /\b(diagnos(is|e|ed)\b(?! or)|you have|healthy|unhealthy|disease|stenosis|blockage|atrial fibrillation|afib|arrhythmia detected|normal range|abnormal|at risk|risk of|refer(ral)?\b|urgent|probability)/i;

describe('findings language', () => {
  const cases = ['a', 'b', 'c', 'motion', 'no-finger'].map((id) => [id, run(id)] as const);

  it('never uses diagnostic or risk wording', () => {
    for (const [id, r] of cases) {
      const text = [summarise(r).verdict, summarise(r).sentence, ...allFindings(r).flatMap((f) => [f.title, f.status.label, f.takeaway, f.explanation, f.context, ...f.metrics.map((m) => `${m.label} ${m.value} ${m.note ?? ''}`)])].join(' \n');
      const hit = text.match(FORBIDDEN);
      expect(hit, `${id}: "${hit?.[0]}" in: ${text.slice(Math.max(0, (hit?.index ?? 0) - 80), (hit?.index ?? 0) + 80)}`).toBeNull();
    }
  });

  it('produces only a quality finding for a failed recording', () => {
    const r = cases.find(([id]) => id === 'motion')![1];
    const f = allFindings(r);
    expect(f.map((x) => x.id)).toEqual(['quality']);
    expect(f[0].status.label).toBe('Not usable');
    expect(summarise(r).usable).toBe(false);
  });

  it('marks the composite indicator as experimental', () => {
    const r = cases.find(([id]) => id === 'a')![1];
    const s = allFindings(r).find((x) => x.id === 'stiffness')!;
    expect(s.experimental).toBe(true);
    expect(s.context).toMatch(/not learned from patient data/);
  });

  it('quotes numbers that match the analysis', () => {
    const r = cases.find(([id]) => id === 'a')![1];
    const rate = allFindings(r).find((x) => x.id === 'rate')!;
    expect(rate.takeaway).toContain(`${Math.round(r.hrv!.heartRateBpm)} beats per minute`);
  });

  it('explains a missing stiffness index when height is not given', () => {
    const r = run('a', false);
    const shape = allFindings(r).find((x) => x.id === 'shape')!;
    expect(shape.metrics.find((m) => m.label === 'Stiffness index')!.note).toBe('needs your height');
  });
});
