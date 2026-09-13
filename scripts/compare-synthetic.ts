/**
 * Compares features recovered by the full pipeline (camera frames → resample → filter → beats →
 * ensemble → contour) against the same extractor run on the noise-free model contour.
 * Run: npx tsx scripts/compare-synthetic.ts
 */
import { SYNTH_CASES, idealContour, synthesize } from '../src/sim/ppgSynth';
import { preprocess } from '../src/dsp/preprocess';
import { detectBeats } from '../src/dsp/peaks';
import { buildEnsemble, median } from '../src/dsp/ensemble';
import { contourFromEnsemble, extractMorphology, type Morphology } from '../src/features/morphology';

const row = (m: Morphology) => ({
  CT: m.crestTimeMs.toFixed(0), notch: m.notch.present ? 'yes' : 'no',
  RI: m.reflectionIndexPct?.toFixed(0) ?? '—', SI: m.stiffnessIndex?.toFixed(1) ?? '—',
  'b/a': m.apg?.ba.toFixed(2) ?? '—', 'd/a': m.apg?.da.toFixed(2) ?? '—', AGI: m.apg?.agi.toFixed(2) ?? '—',
});

const rows: Record<string, unknown>[] = [];
for (const c of SYNTH_CASES.filter((x) => !x.artifact)) {
  rows.push({ case: c.id, source: 'model', ...row(extractMorphology(idealContour(c.pulse, 60 / c.heartRate), 250, c.heightCm)) });
  for (const noise of [0, c.noise, c.noise * 2]) {
    const { frames } = synthesize({ ...c, noise }, { durationSec: 60 });
    const pre = preprocess(frames);
    const { beats } = detectBeats(pre.detect, pre.morph, pre.fs);
    const ibis = beats.slice(1).map((b, i) => (b.maxSlopePos - beats[i].maxSlopePos) / pre.fs);
    const ens = buildEnsemble(pre.morph, pre.fs, beats, median(ibis));
    const m = extractMorphology(contourFromEnsemble(ens).contour, ens.fs, c.heightCm);
    rows.push({ case: c.id, source: `pipeline σ=${noise}`, ...row(m), kept: `${ens.accepted.filter(Boolean).length}/${ens.accepted.length}` });
  }
}
console.table(rows);
