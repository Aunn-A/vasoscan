import { h, icon, s, prefersReducedMotion } from '../dom';
import type { Ctx } from '../main';
import { state } from '../state';
import { openCamera, CameraError, type CameraSession } from '../../capture/camera';
import { FrameSampler } from '../../capture/sampler';
import { LiveMonitor } from '../../capture/live';
import type { Frame } from '../../types';
import type { FrameStatus } from '../../quality/frame';
import { cue, vibrate } from '../audio';
import { SYNTH_CASES, synthesize } from '../../sim/ppgSynth';

const SETTLE_SEC = 5;
const RECORD_SEC = 60;
const COUNTDOWN_SEC = 3;
const GIVE_UP_LOST_SEC = 10;

type Phase = 'starting' | 'waiting' | 'countdown' | 'settling' | 'recording' | 'error';

export function renderCapture(main: HTMLElement, ctx: Ctx): () => void {
  main.classList.add('scope');
  const video = h('video', { class: 'capture-video', muted: true, playsinline: true, 'aria-hidden': 'true' });

  const R = 46;
  const C = 2 * Math.PI * R;
  const ring = s('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'var(--scope-ink)', 'stroke-width': 3.2, 'stroke-linecap': 'round', 'stroke-dasharray': C, 'stroke-dashoffset': C, transform: 'rotate(-90 50 50)', class: 'ring-progress' });
  const ringSvg = s('svg', { viewBox: '0 0 100 100', class: 'ring', 'aria-hidden': 'true' },
    s('circle', { cx: 50, cy: 50, r: R, fill: 'none', stroke: 'rgba(231,238,235,0.16)', 'stroke-width': 3.2 }), ring);
  const glow = h('div', { class: 'aperture-glow live' });
  const centre = h('div', { class: 'aperture-centre' });
  const bigNum = h('span', { class: 'aperture-num num' }, '');
  const bigUnit = h('span', { class: 'aperture-unit' }, '');
  centre.append(bigNum, bigUnit);
  const aperture = h('div', { class: 'capture-aperture' }, glow, ringSvg, centre);

  const title = h('h1', { class: 'capture-title', 'aria-live': 'assertive' }, 'Starting the camera');
  const guide = h('p', { class: 'capture-guide', 'aria-live': 'polite' }, '');
  const trace = h('canvas', { class: 'capture-trace', 'aria-hidden': 'true' });
  const hrValue = h('span', { class: 'num' }, '–');
  const signalValue = h('span', {}, '–');
  const soundBtn = h('button', { class: 'btn secondary sound', type: 'button', 'aria-pressed': String(state.sound) }, icon(state.sound ? 'sound' : 'mute'), state.sound ? 'Sound on' : 'Sound off');
  soundBtn.addEventListener('click', () => {
    state.sound = !state.sound;
    soundBtn.setAttribute('aria-pressed', String(state.sound));
    soundBtn.replaceChildren(icon(state.sound ? 'sound' : 'mute'), state.sound ? 'Sound on' : 'Sound off');
  });
  const actionRow = h('div', { class: 'capture-actions' });
  const simCamera = new URLSearchParams(location.search).has('simcamera');
  const modeLabel = h('span', { class: 'capture-mode' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), simCamera ? 'Test mode: simulated camera' : 'Camera');
  let simTimer = 0;

  main.append(
    h('div', { class: 'capture' },
      h('div', { class: 'capture-top' },
        modeLabel,
        h('button', { class: 'btn secondary cancel', type: 'button', onclick: () => cancel() }, icon('close'), 'Cancel'),
      ),
      video,
      aperture,
      h('div', { class: 'capture-status' }, title, guide),
      h('div', { class: 'capture-strip' }, trace, h('span', { class: 'strip-label' }, 'Live pulse signal')),
      h('dl', { class: 'capture-readouts' },
        h('div', {}, h('dt', {}, 'Heart rate (provisional)'), h('dd', {}, hrValue, h('span', { class: 'unit' }, ' beats/min'))),
        h('div', {}, h('dt', {}, 'Finger on lens'), h('dd', {}, signalValue)),
      ),
      h('div', { class: 'capture-footer' }, soundBtn, actionRow),
    ),
  );

  let session: CameraSession | null = null;
  let sampler: FrameSampler | null = null;
  const live = new LiveMonitor();
  let phase: Phase = 'starting';
  let phaseStart = 0;
  let okSince: number | null = null;
  let lostSince: number | null = null;
  let recorded: Frame[] = [];
  let lastFrame: Frame | null = null;
  let lastCount = -1;
  let wakeLock: { release(): Promise<void> } | null = null;
  let raf = 0;
  let disposed = false;
  const buf: Array<{ t: number; v: number }> = [];
  // causal beat detector for audio ticks
  let lastBeatT = -Infinity;
  let armed = true;

  const setPhase = (p: Phase, t: number) => { phase = p; phaseStart = t; lastCount = -1; };

  function startSimulatedCamera() {
    // Test mode: replay simulated phone-camera frames in real time through the real capture flow
    const src = synthesize({ ...SYNTH_CASES[0], seed: Date.now() % 1000 }, { durationSec: 95, camera: 'phone' }).frames;
    const t0 = performance.now() / 1000;
    let k = 0;
    phase = 'waiting';
    simTimer = window.setInterval(() => {
      const now = performance.now() / 1000 - t0;
      while (k < src.length && src[k].t <= now) { onFrame({ ...src[k], t: src[k].t + t0 }); k++; }
    }, 16);
    raf = requestAnimationFrame(loop);
  }

  async function start() {
    if (simCamera) { startSimulatedCamera(); return; }
    try {
      session = await openCamera(video);
    } catch (e) {
      const err = e instanceof CameraError ? e : new CameraError('unknown', 'The camera could not be started.', 'Reload the page and try again.');
      showError(err.problem, err.fix);
      return;
    }
    if (disposed) { session.stop(); return; }
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } };
      wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch { wakeLock = null; }
    sampler = new FrameSampler(video, onFrame);
    sampler.start();
    phase = 'waiting';
    render();
    raf = requestAnimationFrame(loop);
  }

  function onFrame(f: Frame) {
    lastFrame = f;
    const st = live.push(f);
    buf.push({ t: f.t, v: st.trace });
    while (buf.length && f.t - buf[0].t > 6) buf.shift();
    detectBeat(f.t, st.status);

    const ok = st.status === 'ok';
    if (phase === 'waiting') {
      if (ok) { okSince ??= f.t; if (f.t - okSince > 1) { setPhase('countdown', f.t); } }
      else okSince = null;
    } else if (phase === 'countdown') {
      if (!ok) { okSince = null; setPhase('waiting', f.t); if (state.sound) cue.lost(); }
      else if (f.t - phaseStart >= COUNTDOWN_SEC) { recorded = []; setPhase('settling', f.t); if (state.sound) cue.start(); vibrate(60); }
    } else if (phase === 'settling' || phase === 'recording') {
      recorded.push(f);
      if (!ok) {
        if (lostSince === null) { lostSince = f.t; if (state.sound) cue.lost(); vibrate([80, 60, 80]); }
        if (f.t - lostSince > GIVE_UP_LOST_SEC) return finish();
      } else lostSince = null;
      if (phase === 'settling' && f.t - phaseStart >= SETTLE_SEC) setPhase('recording', f.t);
      if (phase === 'recording' && f.t - phaseStart >= RECORD_SEC) return finish();
    }
  }

  function detectBeat(t: number, status: FrameStatus) {
    if (status !== 'ok' || buf.length < 30) return;
    let max = 0;
    for (const p of buf) if (t - p.t < 2.5) max = Math.max(max, p.v);
    const v = buf[buf.length - 1].v;
    if (armed && max > 0 && v > 0.55 * max && t - lastBeatT > 0.33) {
      lastBeatT = t;
      armed = false;
      if (state.sound && (phase === 'settling' || phase === 'recording' || phase === 'waiting' || phase === 'countdown')) cue.beat();
      glow.classList.remove('beat');
      void glow.offsetWidth;
      glow.classList.add('beat');
    }
    if (v < 0.1 * max) armed = true;
  }

  function loop() {
    if (disposed) return;
    render();
    drawTrace();
    raf = requestAnimationFrame(loop);
  }

  function render() {
    const f = lastFrame;
    const st = live.state;
    if (f) {
      // The aperture glows with the colour the camera actually sees through the fingertip
      const k = 255 / Math.max(60, f.r, f.g, f.b);
      glow.style.setProperty('--glow', `rgb(${Math.round(f.r * k)}, ${Math.round(f.g * k)}, ${Math.round(f.b * k)})`);
      glow.style.setProperty('--glow-strength', String(Math.min(1, f.r / 120)));
    }
    const t = f?.t ?? 0;
    const elapsed = t - phaseStart;
    let progress = 0;
    let num = '';
    let unit = '';
    let heading = '';
    let guidance = '';

    const statusText: Record<FrameStatus, [string, string]> = {
      ok: ['Hold still', 'Keep your fingertip resting lightly on the camera and flash.'],
      uncovered: ['Cover the camera and flash', 'Rest the pad of your fingertip over both, lightly and completely.'],
      dark: ['Not enough light', session?.torch === 'on' ? 'Make sure your fingertip covers the flash as well as the camera.' : 'This browser could not turn on the flashlight. Face a bright lamp or window so light shines through your fingertip.'],
      overexposed: ['Too much light', 'Cover the flash completely with the fleshy pad of your finger.'],
    };

    switch (phase) {
      case 'starting':
        heading = 'Starting the camera';
        guidance = 'Allow camera access if your browser asks.';
        break;
      case 'waiting': {
        const [h1, g1] = statusText[st.status];
        heading = st.status === 'ok' ? 'Finger detected' : h1;
        guidance = st.status === 'ok' ? 'Hold still. Recording starts in a moment.' : g1;
        break;
      }
      case 'countdown': {
        const left = Math.max(1, Math.ceil(COUNTDOWN_SEC - elapsed));
        num = String(left);
        unit = 'starting';
        heading = 'Hold still';
        guidance = 'Recording starts when the count reaches zero.';
        if (left !== lastCount) { lastCount = left; if (state.sound) cue.count(); }
        progress = 0;
        break;
      }
      case 'settling':
      case 'recording': {
        const total = SETTLE_SEC + RECORD_SEC;
        const done = phase === 'settling' ? elapsed : SETTLE_SEC + elapsed;
        progress = Math.min(1, done / total);
        num = String(Math.max(0, Math.ceil(total - done)));
        unit = 'seconds left';
        if (st.status !== 'ok') {
          [heading, guidance] = statusText[st.status];
          if (lostSince !== null && t - lostSince > 3) guidance += ` The recording stops in ${Math.max(0, Math.ceil(GIVE_UP_LOST_SEC - (t - lostSince)))} s if the signal does not return.`;
        } else {
          heading = phase === 'settling' ? 'Adjusting to your finger' : 'Hold still';
          guidance = phase === 'settling' ? 'The camera is settling. Keep your finger relaxed and still.' : 'Recording your pulse. You can listen for the clicks instead of watching.';
        }
        break;
      }
      case 'error':
        return;
    }
    ring.setAttribute('stroke-dashoffset', String(C * (1 - progress)));
    aperture.classList.toggle('is-recording', phase === 'settling' || phase === 'recording');
    if (bigNum.textContent !== num) bigNum.textContent = num;
    if (bigUnit.textContent !== unit) bigUnit.textContent = unit;
    if (title.textContent !== heading) title.textContent = heading;
    if (guide.textContent !== guidance) guide.textContent = guidance;
    const hr = st.heartRate ? String(Math.round(st.heartRate)) : '–';
    if (hrValue.textContent !== hr) hrValue.textContent = hr;
    const sig = { ok: 'Yes', uncovered: 'Not covering', dark: 'Too dark', overexposed: 'Too bright' }[st.status];
    if (signalValue.textContent !== sig) signalValue.textContent = sig;
  }

  function drawTrace() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = trace.clientWidth, hh = trace.clientHeight;
    if (!w || !hh) return;
    if (trace.width !== Math.round(w * dpr) || trace.height !== Math.round(hh * dpr)) { trace.width = Math.round(w * dpr); trace.height = Math.round(hh * dpr); }
    const g = trace.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hh);
    // strip-chart grid: 0.2 s minor, 1 s major
    const span = 6;
    const tNow = buf.length ? buf[buf.length - 1].t : 0;
    const X = (t: number) => w - ((tNow - t) / span) * w;
    for (let k = Math.floor(tNow - span); k <= tNow; k += 0.2) {
      const x = X(k);
      const major = Math.abs(k - Math.round(k)) < 1e-6;
      g.strokeStyle = major ? 'rgba(231,238,235,0.14)' : 'rgba(231,238,235,0.05)';
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke();
    }
    if (buf.length < 3) return;
    const vals = buf.map((p) => p.v).sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.03)], hi = vals[Math.floor(vals.length * 0.97)];
    const range = hi - lo || 1;
    const Y = (v: number) => hh * 0.88 - ((v - lo) / range) * hh * 0.76;
    g.lineWidth = 2.6;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255,107,125,0)');
    grad.addColorStop(0.25, 'rgba(255,107,125,0.7)');
    grad.addColorStop(1, 'rgba(255,150,160,1)');
    g.strokeStyle = grad;
    g.beginPath();
    buf.forEach((p, i) => { const x = X(p.t), y = Y(p.v); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    const last = buf[buf.length - 1];
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(X(last.t) - 2, Y(last.v), 4.5, 0, Math.PI * 2); g.fill();
    void prefersReducedMotion;
  }

  function showError(problem: string, fix: string) {
    phase = 'error';
    main.querySelector('.capture')?.classList.add('has-error');
    modeLabel.replaceChildren('Camera unavailable');
    title.textContent = problem;
    guide.textContent = fix;
    aperture.classList.add('is-error');
    actionRow.replaceChildren(
      h('button', { class: 'btn', onclick: () => ctx.go('capture') }, icon('retry'), 'Try again'),
      h('button', { class: 'btn secondary', onclick: () => ctx.go('demo') }, 'View a demo recording'),
    );
  }

  async function stopHardware() {
    clearInterval(simTimer);
    sampler?.stop();
    if (session) {
      try { await session.setTorch(false); } catch { /* ignore */ }
      session.stop();
    }
    try { await wakeLock?.release(); } catch { /* ignore */ }
    session = null;
  }

  function finish() {
    const s0 = session;
    phase = 'error'; // stops further frame handling in the UI
    sampler?.stop();
    clearInterval(simTimer);
    if (state.sound) cue.done();
    vibrate([60, 40, 60]);
    state.frames = recorded;
    state.demoCaseId = null;
    state.captureSimulated = simCamera;
    state.meta = {
      userAgent: navigator.userAgent,
      timebase: sampler?.timebase ?? 'unknown',
      torch: simCamera ? 'simulated' : s0?.torch ?? 'unknown',
      startedAt: new Date().toISOString(),
      subject: state.subject,
    };
    void stopHardware();
    ctx.go('processing');
  }

  function cancel() {
    void stopHardware();
    ctx.go('setup');
  }

  void start();
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    void stopHardware();
  };
}
