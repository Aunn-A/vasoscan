/** Runs every synthetic demo case through the full pipeline and prints a summary. */
import { SYNTH_CASES, synthesize } from '../src/sim/ppgSynth';
import { analyse } from '../src/pipeline';

for (const c of SYNTH_CASES) {
  const { frames } = synthesize(c, { durationSec: 65 });
  const t0 = performance.now();
  const r = analyse(frames, { heightCm: c.heightCm, ageYears: c.ageYears }, { kind: 'simulated', caseId: c.id });
  const ms = performance.now() - t0;
  const q = r.quality!;
  console.log(`\n${c.label} (${c.id})  ${ms.toFixed(0)} ms  channel=${r.pre?.channel} fps=${q.metrics.frameRate.toFixed(1)} SQI=${q.score} pass=${q.pass}`);
  console.log(`  clean ${(q.metrics.cleanFraction * 100).toFixed(0)}%  longest ${q.metrics.longestCleanSec.toFixed(1)} s  beats accepted ${q.metrics.acceptedBeats}  conc ${q.metrics.spectralConcentration.toFixed(2)}`);
  for (const i of q.issues) console.log(`  [${i.severity}] ${i.problem}  → ${i.fix}`);
  if (r.hrv) console.log(`  HR ${r.hrv.heartRateBpm.toFixed(1)} (true ${c.heartRate})  SDNN ${r.hrv.sdnnMs?.toFixed(0)}  RMSSD ${r.hrv.rmssdMs?.toFixed(0)}  valid ${r.hrv.validIntervals}/${r.hrv.totalIntervals}  PI ${r.perfusionIndexPct?.toFixed(2)}%`);
  if (r.score && r.morphology) {
    const u = r.score.uncertainty;
    const f = (iv: { lo: number; hi: number } | null, d = 0) => (iv ? `[${iv.lo.toFixed(d)}, ${iv.hi.toFixed(d)}]` : '—');
    const m = r.morphology;
    console.log(`  CT ${m.crestTimeMs.toFixed(0)} ${f(u.features.crestTimeMs)}  SI ${m.stiffnessIndex?.toFixed(1) ?? '—'} ${f(u.features.stiffnessIndex, 1)}  RI ${m.reflectionIndexPct?.toFixed(0) ?? '—'} ${f(u.features.reflectionIndexPct)}  AGI ${m.apg?.agi.toFixed(2)} ${f(u.features.agi, 2)}  notch ${m.notch.present} (${(u.notchPresentFraction * 100).toFixed(0)}%)`);
    console.log(`  SCORE ${r.score.score.toFixed(0)} band=${r.score.band} 90% [${u.score.lo.toFixed(0)}, ${u.score.hi.toFixed(0)}] coverage ${r.score.coverage.toFixed(2)}`);
  }
}
