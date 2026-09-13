import type { Frame, Provenance } from '../types';
import { openCamera, CameraError, type CameraSession } from '../capture/camera';
import { FrameSampler } from '../capture/sampler';
import { LiveMonitor } from '../capture/live';
import { analyse, type AnalysisResult } from '../pipeline';
import { SYNTH_CASES, synthesize } from '../sim/ppgSynth';
import { plot } from './plot';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Recording {
  version: 1;
  meta: { userAgent: string; timebase: string; torch: string; settings: unknown; startedAt: string; subject: { heightCm?: number; ageYears?: number } };
  frames: Frame[];
}

let session: CameraSession | null = null;
let sampler: FrameSampler | null = null;
const live = new LiveMonitor();
let recording: Frame[] = [];
let recordingStart: number | null = null;
let lastRecording: Recording | null = null;
const traceBuf: number[] = [];
let okSince: number | null = null;

const subject = () => ({
  heightCm: Number(($('height') as HTMLInputElement).value) || undefined,
  ageYears: Number(($('age') as HTMLInputElement).value) || undefined,
});
const duration = () => Number(($('duration') as HTMLSelectElement).value);
const msg = (text: string) => { $('captureMsg').textContent = text; };

// ---------- live capture ----------

$('startCam').addEventListener('click', async () => {
  msg('Starting camera…');
  try {
    session = await openCamera($('video') as HTMLVideoElement);
  } catch (e) {
    msg(e instanceof CameraError ? `${e.problem} ${e.fix}` : String(e));
    return;
  }
  live.reset();
  recording = [];
  recordingStart = null;
  okSince = null;
  traceBuf.length = 0;
  sampler = new FrameSampler(session.video, onFrame);
  sampler.start();
  ($('startCam') as HTMLButtonElement).disabled = true;
  ($('recordNow') as HTMLButtonElement).disabled = false;
  ($('stopCam') as HTMLButtonElement).disabled = false;
  msg(session.torch === 'on'
    ? 'Torch on. Cover the camera and flash with your fingertip.'
    : `Torch ${session.torch}. Turn on the flashlight from Control Center, then cover the camera and flash with your fingertip.`);
});

$('recordNow').addEventListener('click', () => beginRecording());
$('stopCam').addEventListener('click', () => stopCamera(true));

function beginRecording() {
  if (recordingStart !== null) return;
  recording = [];
  recordingStart = performance.now();
  msg('Recording. Hold still.');
}

function onFrame(f: Frame) {
  const st = live.push(f);
  traceBuf.push(st.trace);
  if (traceBuf.length > 8 * 30) traceBuf.shift();

  if (recordingStart === null) {
    if (st.status === 'ok') {
      okSince ??= f.t;
      if (f.t - okSince > 1.5) beginRecording();
    } else {
      okSince = null;
    }
  } else {
    recording.push(f);
    const elapsed = recording.length > 1 ? f.t - recording[0].t : 0;
    $('progress').style.width = `${Math.min(100, (elapsed / duration()) * 100)}%`;
    if (st.status !== 'ok') msg(`Recording: finger status "${st.status}". Put your finger back over the camera and flash.`);
    else msg(`Recording ${elapsed.toFixed(0)} / ${duration()} s. Hold still.`);
    if (elapsed >= duration()) stopCamera(true);
  }
}

let rafPending = false;
function drawLive() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    const st = live.state;
    const rows: Array<[string, string]> = [
      ['Finger', st.status],
      ['Frame rate', `${st.frameRate.toFixed(1)} fps`],
      ['Timebase', sampler?.timebase ?? '—'],
      ['Torch', session?.torch ?? '—'],
      ['Live HR', st.heartRate ? `${st.heartRate.toFixed(0)} bpm` : '—'],
      ['Frames', String(sampler?.frameCount ?? 0)],
      ['Resolution', session ? `${session.video.videoWidth}×${session.video.videoHeight}` : '—'],
    ];
    $('liveStats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const lo = Math.min(...traceBuf), hi = Math.max(...traceBuf);
    plot($('liveTrace') as HTMLCanvasElement, { series: [{ y: traceBuf, color: '#1d3b4f', width: 2 }], yRange: [lo, hi] });
    if (session) drawLive();
  });
}
setInterval(() => { if (session) drawLive(); }, 100);

async function stopCamera(analyseAfter: boolean) {
  sampler?.stop();
  if (session) {
    await session.setTorch(false);
    session.stop();
  }
  const s = session;
  session = null;
  ($('startCam') as HTMLButtonElement).disabled = false;
  ($('recordNow') as HTMLButtonElement).disabled = true;
  ($('stopCam') as HTMLButtonElement).disabled = true;
  if (analyseAfter && recording.length > 60 && s) {
    lastRecording = {
      version: 1,
      meta: {
        userAgent: navigator.userAgent,
        timebase: sampler?.timebase ?? 'unknown',
        torch: s.torch,
        settings: s.settings,
        startedAt: new Date().toISOString(),
        subject: subject(),
      },
      frames: recording,
    };
    ($('download') as HTMLButtonElement).disabled = false;
    msg('Analysing…');
    show(analyse(recording, subject(), { kind: 'measured', device: navigator.userAgent }), recording);
    msg('Done. Scroll down for the analysis.');
  } else if (analyseAfter) {
    msg('Stopped before enough frames were recorded.');
  }
  recordingStart = null;
}

// ---------- demo cases and files ----------

const demoSelect = $('demoCase') as HTMLSelectElement;
demoSelect.innerHTML = SYNTH_CASES.map((c) => `<option value="${c.id}">${c.label}: ${c.summary}</option>`).join('');

$('runDemo').addEventListener('click', () => {
  const c = SYNTH_CASES.find((x) => x.id === demoSelect.value)!;
  const { frames } = synthesize(c, { durationSec: duration() });
  const prov: Provenance = { kind: 'simulated', caseId: c.id };
  show(analyse(frames, { heightCm: c.heightCm, ageYears: c.ageYears }, prov), frames);
});

$('download').addEventListener('click', () => {
  if (!lastRecording) return;
  const blob = new Blob([JSON.stringify(lastRecording)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `vasoscan-recording-${lastRecording.meta.startedAt.replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});

$('load').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const rec = JSON.parse(await file.text()) as Recording;
  lastRecording = rec;
  show(analyse(rec.frames, rec.meta.subject ?? subject(), { kind: 'measured', device: rec.meta.userAgent }), rec.frames);
});

// ---------- results ----------

function show(r: AnalysisResult, frames: Frame[]) {
  $('results').hidden = false;
  $('provenance').textContent = r.provenance.kind === 'simulated'
    ? `SIMULATED recording (demo case ${r.provenance.caseId}): not a measurement`
    : 'MEASURED recording from this device camera';
  $('provenance').style.color = r.provenance.kind === 'simulated' ? '#5b4b8a' : '#1d3b4f';

  const q = r.quality;
  $('quality').innerHTML = r.error
    ? `<div class="issue fail"><strong>${r.error}</strong></div>`
    : `<p>Quality ${q!.score}/100: <strong>${q!.pass ? 'passed' : 'failed, no score produced'}</strong>. Channel ${r.pre?.channel}, ${q!.metrics.frameRate.toFixed(1)} fps, ${Math.round(q!.metrics.cleanFraction * 100)}% clean, longest clean stretch ${q!.metrics.longestCleanSec.toFixed(0)} s, ${q!.metrics.acceptedBeats} beats accepted.</p>` +
      q!.issues.map((i) => `<div class="issue ${i.severity}"><strong>${i.problem}</strong>${i.fix}</div>`).join('');
  if (!r.pre) return;

  const pre = r.pre;
  const tAxis = Float64Array.from({ length: pre.detect.length }, (_, i) => i / pre.fs + r.analysisOffsetSec);
  plot($('plotSignal') as HTMLCanvasElement, {
    series: [{ x: tAxis, y: pre.detect, color: '#1d3b4f', width: 1.2 }],
    shade: (q?.artifacts ?? []).map((iv) => ({ ...iv, color: 'rgba(179,38,30,0.15)' })),
    markers: r.beats.map((b, i) => ({ x: b.maxSlopePos / pre.fs + r.analysisOffsetSec, y: pre.detect[Math.round(b.maxSlopePos)], color: r.beatClean[i] ? '#d9480f' : '#9aa6ae', shape: 'dot' as const })),
    zeroLine: true,
  });
  const t0 = frames[0].t;
  plot($('plotRaw') as HTMLCanvasElement, {
    series: [{ x: frames.map((f) => f.t - t0), y: frames.map((f) => (pre.channel === 'red' ? f.r : f.g)), color: pre.channel === 'red' ? '#b3261e' : '#2e7d32', width: 1 }],
  });

  if (r.ensemble) {
    const ens = r.ensemble;
    plot($('plotEnsemble') as HTMLCanvasElement, {
      series: [
        ...ens.beats.map((b, i) => ({ y: b, color: ens.accepted[i] ? '#6b7f8c' : '#e0a0a0', width: 1, alpha: 0.25 })),
        { y: ens.template, color: '#1d3b4f', width: 2.5 },
      ],
      markers: [{ x: ens.alignIdx, color: '#d9480f', label: 'max slope' }],
      zeroLine: true,
    });
  }
  const m = r.morphology;
  if (m) {
    const d2max = Math.max(...m.d2.map(Math.abs));
    const d2n = m.d2.map((v) => v / d2max * 0.5 - 0.7);
    const mk: NonNullable<Parameters<typeof plot>[1]['markers']> = [
      { x: m.systolicIdx, y: 1, color: '#1d3b4f', label: 'sys', shape: 'dot' },
      { x: m.tangentFoot, y: 0, color: '#1d3b4f', label: 'foot', shape: 'dot' },
    ];
    if (m.diastolic) mk.push({ x: m.diastolic.idx, y: m.contour[m.diastolic.idx], color: '#1d3b4f', label: m.diastolic.method === 'peak' ? 'dia' : 'infl', shape: 'dot' });
    if (m.notch.present) mk.push({ x: m.notch.idx, y: m.contour[m.notch.idx], color: '#1d3b4f', label: 'notch', shape: 'dot' });
    if (m.apg) for (const k of ['a', 'b', 'c', 'd', 'e'] as const) mk.push({ x: m.apg[k].idx, y: d2n[m.apg[k].idx], color: '#d9480f', label: k, shape: 'dot' });
    plot($('plotApg') as HTMLCanvasElement, { series: [{ y: m.contour, color: '#1d3b4f', width: 2 }, { y: d2n, color: '#d9480f', width: 1.5 }], markers: mk, yRange: [-1.25, 1.1] });
  }
  if (r.hrv) {
    const iv = r.hrv.intervals;
    plot($('plotIbi') as HTMLCanvasElement, {
      series: [{ x: iv.map((v) => v.tSec + r.analysisOffsetSec), y: iv.map((v) => (v.valid ? v.ms : NaN)), color: '#1d3b4f', width: 1.5 }],
      markers: iv.filter((v) => !v.valid).map((v) => ({ x: v.tSec + r.analysisOffsetSec, color: 'rgba(179,38,30,0.5)' })),
    });
  }

  const f = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? '—' : v.toFixed(d));
  const iv = (x: { lo: number; hi: number } | null | undefined, d = 1) => (x ? ` [${x.lo.toFixed(d)}, ${x.hi.toFixed(d)}]` : '');
  const u = r.score?.uncertainty;
  $('numbers').textContent = [
    `Heart rate        ${f(r.hrv?.heartRateBpm)} bpm`,
    `SDNN (ultra-short) ${f(r.hrv?.sdnnMs, 0)} ms`,
    `RMSSD             ${f(r.hrv?.rmssdMs, 0)} ms  (noise floor ≈ ${f(r.hrv?.rmssdNoiseFloorMs, 0)} ms, ${r.hrv?.rmssdAboveNoise ? 'above noise' : 'NOT separable from noise'})`,
    `Intervals valid   ${r.hrv?.validIntervals}/${r.hrv?.totalIntervals}`,
    `Perfusion (rel.)  ${f(r.perfusionIndexPct, 2)} %`,
    `Morph band        0.4–${f(pre.morphHigh, 1)} Hz`,
    m ? `Crest time        ${f(m.crestTimeMs, 0)} ms${iv(u?.features.crestTimeMs, 0)}  (${f(m.crestTimeRatio * 100, 1)}% of beat)` : '',
    m ? `Notch             ${m.notch.present ? `present, depth ${f(m.notch.depth, 3)}` : 'absent'}  (found in ${f((u?.notchPresentFraction ?? 0) * 100, 0)}% of resamples)` : '',
    m ? `Diastolic point   ${m.diastolic?.method ?? 'not measurable (reflected wave merged into systole)'}` : '',
    m ? `Reflection index  ${f(m.reflectionIndexPct, 0)} %${iv(u?.features.reflectionIndexPct, 0)}` : '',
    m ? `ΔT (sys→dia)      ${f(m.deltaTMs, 0)} ms` : '',
    m ? `Stiffness index   ${f(m.stiffnessIndex)} m/s${iv(u?.features.stiffnessIndex)}` : '',
    m?.apg ? `APG b/a ${f(m.apg.ba, 2)}${iv(u?.features.ba, 2)}  c/a ${f(m.apg.ca, 2)}  d/a ${f(m.apg.da, 2)}${iv(u?.features.da, 2)}  e/a ${f(m.apg.ea, 2)}  c/d ${m.apg.cdResolved ? 'resolved' : 'merged (estimated)'}` : '',
    m?.apg ? `Aging index       ${f(m.apg.agi, 2)}${iv(u?.features.agi, 2)}` : '',
    r.score ? `\nComposite score   ${f(r.score.score, 0)} (${r.score.band}), measurement band${iv(u?.score, 0)}; ${r.score.modelVersion}; inputs available ${f(r.score.coverage * 100, 0)}%` : '',
    r.score ? r.score.contributions.map((c) => `  ${c.label.padEnd(22)} value ${f(c.value, 3)}  z ${f(c.z, 2)}  share ${f(c.share * 100, 0)}%`).join('\n') : '',
  ].filter(Boolean).join('\n');
  $('results').scrollIntoView({ behavior: 'smooth' });
}
