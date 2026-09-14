/**
 * "From light to pulse": a cross-section of a fingertip resting on a phone. Flash light enters the
 * finger, scatters, and part of it returns to the camera. With each heartbeat the small vessels fill
 * with blood, which absorbs more light, so the camera sees a small dip in brightness. The trace below
 * is driven by the same pulse model, so the diagram and the trace move together.
 * Illustration only: the size of the change is exaggerated so it is visible.
 */
import { h, s, prefersReducedMotion } from '../dom';
import { pulseAt, SYNTH_CASES } from '../../sim/ppgSynth';

export function lightPathSection(): { el: HTMLElement; start(): () => void } {
  const c = SYNTH_CASES[0];
  const period = 60 / c.heartRate;
  const pulse = (t: number) => {
    const ph = ((t % period) + period) % period;
    return pulseAt(c.pulse, ph) + pulseAt(c.pulse, ph + period);
  };
  const peak = Math.max(...Array.from({ length: 200 }, (_, i) => pulse((i / 200) * period)));

  const svg = s('svg', { viewBox: '0 0 520 416', class: 'lp-diagram', role: 'img', 'aria-label': 'Cross-section of a fingertip on a phone camera. Light from the flash passes into the finger, some is absorbed by blood, and the rest returns to the camera lens. With each heartbeat the vessels swell and less light returns.' });
  const defs = s('defs', {},
    s('radialGradient', { id: 'lp-skin', cx: '50%', cy: '85%', r: '80%' },
      s('stop', { offset: '0%', 'stop-color': '#f0a58f' }),
      s('stop', { offset: '55%', 'stop-color': '#d97a66' }),
      s('stop', { offset: '100%', 'stop-color': '#8f3f38' })),
    s('radialGradient', { id: 'lp-flash', cx: '50%', cy: '50%', r: '50%' },
      s('stop', { offset: '0%', 'stop-color': '#fffdf2' }),
      s('stop', { offset: '60%', 'stop-color': '#ffe9a8', 'stop-opacity': '0.7' }),
      s('stop', { offset: '100%', 'stop-color': '#ffd37a', 'stop-opacity': '0' })),
    s('clipPath', { id: 'lp-clip' }, s('path', { d: 'M104,318 C104,146 186,70 260,70 C334,70 416,146 416,318 Z' })),
  );
  svg.append(defs);

  // Finger
  svg.append(s('path', { d: 'M104,318 C104,146 186,70 260,70 C334,70 416,146 416,318 Z', fill: 'url(#lp-skin)' }));
  svg.append(s('path', { d: 'M118,318 C118,156 194,86 260,86 C326,86 402,156 402,318', fill: 'none', stroke: 'rgba(255,230,220,0.35)', 'stroke-width': 1.5, 'stroke-dasharray': '2 5' }));

  // Capillary network: branching vessels clipped to the finger. Their width swells with each beat.
  svg.append(s('defs', {},
    s('filter', { id: 'lp-soft', x: '-20%', y: '-20%', width: '140%', height: '140%' }, s('feGaussianBlur', { stdDeviation: '1.2' })),
    s('filter', { id: 'lp-glow', x: '-50%', y: '-50%', width: '200%', height: '200%' },
      s('feGaussianBlur', { stdDeviation: '3', result: 'b' }),
      s('feMerge', {}, s('feMergeNode', { in: 'b' }), s('feMergeNode', { in: 'SourceGraphic' }))),
  ));
  const vessels = s('g', { 'clip-path': 'url(#lp-clip)', filter: 'url(#lp-soft)' });
  const vesselPaths: Array<[string, number]> = [
    ['M130,318 C150,270 170,250 200,236 C236,220 250,196 262,160 C272,130 300,112 330,120', 5.5],
    ['M390,318 C372,276 350,258 322,246 C290,232 276,210 262,160', 5],
    ['M200,236 C186,208 196,176 222,158 C240,146 248,128 246,104', 3],
    ['M322,246 C342,222 360,200 356,170 C352,146 336,132 330,120', 3],
    ['M170,258 C150,236 140,210 150,184', 2.4],
    ['M236,224 C250,244 276,252 300,238 C316,228 322,210 312,192', 2.4],
    ['M262,160 C236,178 214,196 212,222', 2],
    ['M350,262 C376,248 396,230 398,206', 2.2],
    ['M214,288 C236,270 262,272 286,288 C306,300 330,296 346,282', 2.6],
    ['M160,300 C176,286 196,284 214,288', 2],
    ['M286,288 C290,262 304,252 322,246', 1.8],
    ['M246,104 C262,98 280,100 292,110', 1.8],
  ];
  const vesselEls = vesselPaths.map(([d, w]) => {
    const el = s('path', { d, fill: 'none', stroke: '#8a1328', 'stroke-width': w, 'stroke-linecap': 'round', opacity: 0.9 });
    vessels.append(el);
    return { el, w };
  });
  svg.append(vessels);

  // Light paths (drawn faintly) and photons travelling along them
  const rayPaths = [
    'M198,322 C170,230 240,170 262,210 C282,246 318,250 322,326',
    'M198,322 C206,262 250,236 276,262 C298,286 316,300 322,326',
    'M198,322 C150,190 230,120 280,150 C340,186 346,260 322,326',
    'M198,322 C230,290 270,288 292,300 C306,308 312,314 322,326',
    'M198,322 C120,250 150,150 220,150 C260,150 240,230 300,250 C330,262 330,300 322,326',
  ];
  const rayEls = rayPaths.map((d) => {
    const el = s('path', { d, fill: 'none', stroke: '#ffe9bd', 'stroke-width': 1.2, opacity: 0.18 });
    svg.append(el);
    return el;
  });
  const photonLayer = s('g', { filter: 'url(#lp-glow)' });
  svg.append(photonLayer);
  const photons = Array.from({ length: 22 }, (_, i) => {
    const el = s('circle', { r: 2.6, fill: '#fff3cf', opacity: 0 });
    photonLayer.append(el);
    return { el, path: i % rayPaths.length, offset: (i * 0.137) % 1, speed: 0.33 + ((i * 37) % 10) / 40, fate: ((i * 53) % 100) / 100 };
  });

  // Phone
  svg.append(s('rect', { x: 60, y: 322, width: 400, height: 34, rx: 10, fill: '#1c2a33' }));
  svg.append(s('rect', { x: 60, y: 322, width: 400, height: 4, fill: '#34444e' }));
  const flashGlow = s('circle', { cx: 198, cy: 324, r: 30, fill: 'url(#lp-flash)' });
  svg.append(flashGlow);
  svg.append(s('circle', { cx: 198, cy: 332, r: 7, fill: '#fff7da' }));
  svg.append(s('circle', { cx: 322, cy: 336, r: 13, fill: '#0b151b', stroke: '#6d7e86', 'stroke-width': 3 }));
  svg.append(s('circle', { cx: 322, cy: 336, r: 5, fill: '#223845' }));

  // Labels
  const lab = (x: number, y: number, anchor: string, title: string, sub: string, lx: number, ly: number, tx: number, ty: number) => {
    svg.append(s('line', { x1: lx, y1: ly, x2: tx, y2: ty, stroke: 'rgba(231,238,235,0.5)', 'stroke-width': 1 }));
    svg.append(s('text', { x, y, 'text-anchor': anchor, class: 'lp-label' }, title));
    svg.append(s('text', { x, y: y + 16, 'text-anchor': anchor, class: 'lp-sub' }, sub));
  };
  lab(24, 392, 'start', 'Flash', 'light goes in', 190, 346, 60, 376);
  lab(496, 392, 'end', 'Camera', 'measures what returns', 330, 352, 460, 376);
  lab(496, 60, 'end', 'Blood vessels', 'swell with each beat', 356, 170, 440, 78);

  const readout = h('span', { class: 'num lp-readout-num' }, '0.0');
  const trace = h('canvas', { class: 'lp-trace', 'aria-hidden': 'true' });

  const el = h('section', { class: 'band scope-band', 'aria-labelledby': 'lp-title' },
    h('div', { class: 'wrap lp-grid' },
      h('div', { class: 'lp-copy' },
        h('p', { class: 'kicker on-dark' }, 'The principle'),
        h('h2', { id: 'lp-title', class: 'section-title' }, 'From light to pulse'),
        h('p', { class: 'section-lede' }, 'Your phone’s flash shines into your fingertip. Light scatters through the tissue, and some of it finds its way back to the camera.'),
        h('ol', { class: 'lp-steps' },
          h('li', {}, h('strong', {}, 'Each heartbeat pushes blood into the fingertip.'), ' The tiny vessels swell for a fraction of a second.'),
          h('li', {}, h('strong', {}, 'Blood absorbs light.'), ' With more blood in the way, slightly less light reaches the camera.'),
          h('li', {}, h('strong', {}, 'The camera turns that into a wave.'), ' Measured 30 times a second, the dips in brightness trace out your pulse. The real change is about 1% of the light; it is exaggerated here so you can see it.'),
        ),
      ),
      h('figure', { class: 'lp-figure' },
        svg,
        h('div', { class: 'lp-strip' },
          h('div', { class: 'lp-strip-head' },
            h('span', {}, 'Light reaching the camera'),
            h('span', { class: 'lp-readout' }, readout, ' % below baseline')),
          trace),
        h('figcaption', {}, 'Illustration driven by VasoScan’s pulse model at 64 beats per minute.'),
      ),
    ),
  );

  const start = () => {
    let raf = 0;
    let visible = true;
    const io = typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); if (visible) raf = requestAnimationFrame(frame); })
      : null;
    io?.observe(el);
    const hist: number[] = [];
    let last = 0;
    const frame = (now: number) => {
      const reduce = prefersReducedMotion();
      const t = reduce ? 0.18 : now / 1000;
      const p = pulse(t) / peak; // 0..1
      vesselEls.forEach(({ el: v, w }) => v.setAttribute('stroke-width', String(w * (1 + 0.7 * p))));
      rayEls.forEach((ray) => ray.setAttribute('opacity', String(0.1 + 0.14 * (1 - p))));
      const lengths = rayEls.map((ray) => (ray as SVGPathElement).getTotalLength());
      photons.forEach((ph) => {
        const u = reduce ? ph.offset : ((now / 1000) * ph.speed + ph.offset) % 1;
        const ray = rayEls[ph.path] as SVGPathElement;
        const pt = ray.getPointAtLength(u * lengths[ph.path]);
        // Photons whose fate falls below the current absorption are absorbed partway through
        const absorbed = ph.fate < 0.25 + 0.45 * p;
        const alive = absorbed ? Math.max(0, 1 - Math.max(0, u - 0.45) * 5) : 1;
        const fade = Math.min(1, u * 8) * Math.min(1, (1 - u) * 8);
        ph.el.setAttribute('cx', pt.x.toFixed(1));
        ph.el.setAttribute('cy', pt.y.toFixed(1));
        ph.el.setAttribute('opacity', (0.95 * alive * fade).toFixed(2));
      });
      flashGlow.setAttribute('r', String(30 + 2 * Math.sin(now / 300)));
      if (now - last > 90) { readout.textContent = (p * 1.2).toFixed(1); last = now; }

      // strip chart: brightness dips as blood volume rises
      if (!reduce) {
        hist.push(1 - p);
        if (hist.length > 360) hist.shift();
      } else if (!hist.length) {
        for (let i = 0; i < 360; i++) hist.push(1 - pulse(i / 90) / peak);
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = trace.clientWidth, hh = trace.clientHeight;
      if (w && hh) {
        if (trace.width !== Math.round(w * dpr)) { trace.width = Math.round(w * dpr); trace.height = Math.round(hh * dpr); }
        const g = trace.getContext('2d')!;
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, hh);
        g.strokeStyle = 'rgba(231,238,235,0.08)';
        for (let x = w; x > 0; x -= 24) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.stroke(); }
        g.lineWidth = 2.4; g.lineJoin = 'round';
        const grad = g.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, 'rgba(255,214,150,0)');
        grad.addColorStop(0.4, 'rgba(255,214,150,0.8)');
        grad.addColorStop(1, '#ffe7b8');
        g.strokeStyle = grad;
        g.beginPath();
        hist.forEach((v, i) => {
          const x = w - (hist.length - 1 - i) * (w / 360);
          const y = hh * 0.2 + (1 - v) * hh * 0.68;
          if (i) g.lineTo(x, y); else g.moveTo(x, y);
        });
        g.stroke();
      }
      if (visible && !reduce) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  };

  return { el, start };
}
