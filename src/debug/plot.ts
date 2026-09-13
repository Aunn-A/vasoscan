/** Minimal canvas plotting for the signal bench. */

export interface Series {
  y: ArrayLike<number>;
  x?: ArrayLike<number>;
  color: string;
  width?: number;
  alpha?: number;
}

export interface PlotOptions {
  series: Series[];
  xRange?: [number, number];
  yRange?: [number, number];
  shade?: Array<{ start: number; end: number; color: string }>;
  markers?: Array<{ x: number; y?: number; label?: string; color: string; shape?: 'line' | 'dot' }>;
  zeroLine?: boolean;
}

export function setupCanvas(c: HTMLCanvasElement): { ctx: CanvasRenderingContext2D; w: number; h: number } {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

export function plot(c: HTMLCanvasElement, o: PlotOptions): void {
  const { ctx, w, h } = setupCanvas(c);
  ctx.clearRect(0, 0, w, h);
  const pad = 6;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of o.series) {
    for (let i = 0; i < s.y.length; i++) {
      const xv = s.x ? s.x[i] : i;
      const yv = s.y[i];
      if (!Number.isFinite(yv)) continue;
      x0 = Math.min(x0, xv); x1 = Math.max(x1, xv);
      y0 = Math.min(y0, yv); y1 = Math.max(y1, yv);
    }
  }
  if (o.xRange) [x0, x1] = o.xRange;
  if (o.yRange) [y0, y1] = o.yRange;
  if (!(x1 > x0)) x1 = x0 + 1;
  if (!(y1 > y0)) { y1 = y0 + 1; }
  const X = (v: number) => pad + ((v - x0) / (x1 - x0)) * (w - 2 * pad);
  const Y = (v: number) => h - pad - ((v - y0) / (y1 - y0)) * (h - 2 * pad);

  for (const s of o.shade ?? []) {
    ctx.fillStyle = s.color;
    ctx.fillRect(X(s.start), 0, X(s.end) - X(s.start), h);
  }
  if (o.zeroLine && y0 < 0 && y1 > 0) {
    ctx.strokeStyle = '#c9d1cc'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
  }
  for (const s of o.series) {
    ctx.strokeStyle = s.color;
    ctx.globalAlpha = s.alpha ?? 1;
    ctx.lineWidth = s.width ?? 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < s.y.length; i++) {
      const yv = s.y[i];
      if (!Number.isFinite(yv)) { started = false; continue; }
      const px = X(s.x ? s.x[i] : i), py = Y(yv);
      if (started) ctx.lineTo(px, py); else { ctx.moveTo(px, py); started = true; }
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '11px system-ui';
  for (const m of o.markers ?? []) {
    ctx.strokeStyle = ctx.fillStyle = m.color;
    if (m.shape === 'dot' && m.y !== undefined) {
      ctx.beginPath(); ctx.arc(X(m.x), Y(m.y), 3, 0, Math.PI * 2); ctx.fill();
      if (m.label) ctx.fillText(m.label, X(m.x) + 4, Y(m.y) - 4);
    } else {
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X(m.x), 0); ctx.lineTo(X(m.x), h); ctx.stroke();
      if (m.label) ctx.fillText(m.label, X(m.x) + 3, 12);
    }
  }
}
