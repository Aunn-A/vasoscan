/**
 * Frame sampling: video → per-frame ROI statistics with a capture timestamp.
 *
 * requestVideoFrameCallback fires once per decoded camera frame and carries timing metadata. The
 * best available timestamp is used, in order: captureTime (when the sensor captured the frame),
 * mediaTime (stream presentation time), then the callback time. Timing accuracy matters: heart
 * rate variability is a few tens of milliseconds, the same order as frame-callback jitter.
 * Browsers without requestVideoFrameCallback fall back to requestAnimationFrame, with duplicate
 * frames detected and dropped.
 *
 * The region of interest is the central part of the image, downscaled to a small grid. The
 * browser's downscale averages many sensor pixels, which lowers noise before any processing.
 */
import type { Frame } from '../types';

export type Timebase = 'captureTime' | 'mediaTime' | 'callback' | 'animationFrame';

interface VideoFrameMeta {
  captureTime?: number;
  mediaTime?: number;
  presentedFrames?: number;
}

type RVFCVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
};

export class FrameSampler {
  timebase: Timebase = 'callback';
  frameCount = 0;
  private canvas: HTMLCanvasElement | OffscreenCanvas;
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  private running = false;
  private handle = 0;
  private lastMediaTime = -1;
  private lastCaptureTime = -1;
  private lastT = -Infinity;
  private lastSig = '';

  constructor(
    private video: HTMLVideoElement,
    private onFrame: (f: Frame) => void,
    private roiFraction = 0.5,
    private grid = 48,
  ) {
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(grid, grid) : Object.assign(document.createElement('canvas'), { width: grid, height: grid });
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true, alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('2D canvas unavailable');
    this.ctx = ctx;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const v = this.video as RVFCVideo;
    if (typeof v.requestVideoFrameCallback === 'function') {
      const loop = (now: number, meta: VideoFrameMeta) => {
        if (!this.running) return;
        this.sample(this.pickTime(now, meta));
        this.handle = v.requestVideoFrameCallback!(loop);
      };
      this.handle = v.requestVideoFrameCallback(loop);
    } else {
      this.timebase = 'animationFrame';
      const loop = (now: number) => {
        if (!this.running) return;
        this.sample(now / 1000, true);
        this.handle = requestAnimationFrame(loop);
      };
      this.handle = requestAnimationFrame(loop);
    }
  }

  stop(): void {
    this.running = false;
    const v = this.video as RVFCVideo;
    if (typeof v.cancelVideoFrameCallback === 'function') v.cancelVideoFrameCallback(this.handle);
    cancelAnimationFrame(this.handle);
  }

  /**
   * The timebase is chosen on the first frame and then kept: mixing clocks mid-recording would
   * create jumps. Returns NaN for a frame whose locked timestamp did not advance (a repeat).
   */
  private locked: Timebase | null = null;
  private pickTime(now: number, meta: VideoFrameMeta): number {
    if (!this.locked) {
      this.locked = typeof meta.captureTime === 'number' && meta.captureTime > 0 ? 'captureTime'
        : typeof meta.mediaTime === 'number' && meta.mediaTime > 0 ? 'mediaTime'
        : 'callback';
      this.timebase = this.locked;
    }
    if (this.locked === 'captureTime') {
      const ct = meta.captureTime ?? -1;
      if (ct <= this.lastCaptureTime) return NaN;
      this.lastCaptureTime = ct;
      return ct / 1000;
    }
    if (this.locked === 'mediaTime') {
      // mediaTime is on the stream's own clock: offset from performance.now, but uniform
      const mt = meta.mediaTime ?? -1;
      if (mt <= this.lastMediaTime) return NaN;
      this.lastMediaTime = mt;
      return mt;
    }
    return now / 1000;
  }

  private sample(t: number, dedupe = false): void {
    const v = this.video;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h || !(t > this.lastT)) return;
    const side = Math.min(w, h) * this.roiFraction;
    const g = this.grid;
    this.ctx.drawImage(v, (w - side) / 2, (h - side) / 2, side, side, 0, 0, g, g);
    const data = this.ctx.getImageData(0, 0, g, g).data;
    const n = g * g;
    let r = 0, gr = 0, b = 0, r2 = 0, rSat = 0, gSat = 0;
    for (let i = 0; i < data.length; i += 4) {
      const R = data[i], G = data[i + 1], B = data[i + 2];
      r += R; gr += G; b += B; r2 += R * R;
      if (R >= 250) rSat++;
      if (G >= 250) gSat++;
    }
    r /= n; gr /= n; b /= n;
    if (dedupe) {
      const sig = `${r.toFixed(3)},${gr.toFixed(3)},${b.toFixed(3)}`;
      if (sig === this.lastSig) return;
      this.lastSig = sig;
    }
    this.lastT = t;
    this.frameCount++;
    this.onFrame({ t, r, g: gr, b, rStd: Math.sqrt(Math.max(0, r2 / n - r * r)), rSat: rSat / n, gSat: gSat / n });
  }
}
