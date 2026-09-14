/**
 * Live feedback during capture: finger status, a display trace and a provisional heart rate.
 * Nothing here feeds the final analysis, which re-processes the full recording.
 */
import type { Frame } from '../types';
import { classifyFrame, type FrameStatus } from '../quality/frame';
import { StreamingBandpass } from '../dsp/filters';
import { preprocess } from '../dsp/preprocess';
import { detectBeats } from '../dsp/peaks';

export interface LiveState {
  status: FrameStatus;
  /** Seconds the current status has persisted */
  statusFor: number;
  frameRate: number;
  /** Latest display sample (inverted, normalised relative absorbance) */
  trace: number;
  heartRate: number | null;
  /** Recent beat times (s) for audio ticks and markers */
  lastBeatTime: number | null;
}

export class LiveMonitor {
  private frames: Frame[] = [];
  private filter: StreamingBandpass | null = null;
  private dc = 0;
  private statusSince = 0;
  private recentStatus: FrameStatus[] = [];
  private lastHrAt = 0;
  private lastBeatReported = -Infinity;
  state: LiveState = { status: 'uncovered', statusFor: 0, frameRate: 0, trace: 0, heartRate: null, lastBeatTime: null };

  push(f: Frame): LiveState {
    this.frames.push(f);
    // keep 12 s
    while (this.frames.length && f.t - this.frames[0].t > 12) this.frames.shift();
    const n = this.frames.length;
    const span = n > 1 ? f.t - this.frames[0].t : 0;
    const fps = span > 0 ? (n - 1) / span : 30;

    // Majority status over the last ~0.5 s, so single odd frames do not flicker the UI
    this.recentStatus.push(classifyFrame(f));
    if (this.recentStatus.length > Math.max(5, Math.round(fps / 2))) this.recentStatus.shift();
    const counts = new Map<FrameStatus, number>();
    for (const s of this.recentStatus) counts.set(s, (counts.get(s) ?? 0) + 1);
    const status = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (status !== this.state.status) this.statusSince = f.t;

    // Display trace: causal bandpass designed for the running frame rate
    // Display trace: log intensity (so camera gain changes are additive steps), a clamp on sudden
    // jumps so one glitch or exposure change does not throw the trace off screen, then a gentle
    // causal bandpass.
    if (!this.filter && n > 30) this.filter = new StreamingBandpass(fps, 0.6, Math.min(3.5, fps * 0.25));
    const lr = -Math.log(Math.max(1, f.r));
    if (this.dc === 0) this.dc = lr;
    const step = lr - this.dc;
    const limited = this.dc + Math.max(-0.02, Math.min(0.02, step));
    this.dc = limited;
    const trace = this.filter ? this.filter.push(limited) : 0;

    // Provisional heart rate once a second from the last 8 s of finger-present signal
    let heartRate = this.state.heartRate;
    let lastBeatTime = this.state.lastBeatTime;
    if (f.t - this.lastHrAt > 1 && span > 8 && status === 'ok') {
      this.lastHrAt = f.t;
      const recent = this.frames.filter((x) => f.t - x.t <= 8);
      try {
        const pre = preprocess(recent, 'red');
        const { beats } = detectBeats(pre.detect, pre.morph, pre.fs);
        // Provisional rate from beat intervals, shown only when the intervals agree with each other
        const ibis = beats.slice(1).map((b, i) => (b.maxSlopePos - beats[i].maxSlopePos) / pre.fs).filter((v) => v > 0.3 && v < 2);
        const sorted = [...ibis].sort((a, b) => a - b);
        const med = sorted[sorted.length >> 1];
        const consistent = ibis.length >= 4 && ibis.filter((v) => Math.abs(v - med) / med < 0.15).length >= 0.75 * ibis.length;
        heartRate = consistent ? 60 / med : null;
        const lb = beats[beats.length - 1];
        if (lb) {
          const bt = pre.t0 + lb.maxSlopePos / pre.fs;
          if (bt > this.lastBeatReported + 0.25) { this.lastBeatReported = bt; lastBeatTime = bt; }
        }
      } catch {
        heartRate = null;
      }
    }
    if (status !== 'ok') heartRate = null;

    this.state = { status, statusFor: f.t - this.statusSince, frameRate: fps, trace, heartRate, lastBeatTime };
    return this.state;
  }

  reset(): void {
    this.frames = [];
    this.filter = null;
    this.dc = 0;
    this.recentStatus = [];
    this.state = { status: 'uncovered', statusFor: 0, frameRate: 0, trace: 0, heartRate: null, lastBeatTime: null };
  }
}
