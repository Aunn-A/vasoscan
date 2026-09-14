import { SYNTH_CASES, synthesize } from '../src/sim/ppgSynth';
import { analyse } from '../src/pipeline';
for (const id of ['a','b','c']) for (const seed of [1,2,3]) {
  const c = {...SYNTH_CASES.find(x=>x.id===id)!, seed};
  const r = analyse(synthesize(c, {durationSec:65, camera:'phone'}).frames, {heightCm:c.heightCm}, {kind:'simulated',caseId:id}, {bootstrapIterations:50});
  const q = r.quality!;
  console.log(id, seed, q.pass ? 'PASS' : 'FAIL', `clean ${(q.metrics.cleanFraction*100).toFixed(0)}% longest ${q.metrics.longestCleanSec.toFixed(0)}s frames`, JSON.stringify(Object.fromEntries(Object.entries(q.metrics.frameStatusFraction).map(([k,v])=>[k,+v.toFixed(2)]))), q.issues.map(i=>i.severity+': '+i.problem.slice(0,90)).join(' | '), r.hrv ? `HR ${r.hrv.heartRateBpm.toFixed(0)}/${c.heartRate}` : '');
}
