/**
 * "Anatomy of a heartbeat": drag from more elastic to stiffer arteries and watch the pulse contour
 * change. The contour comes from VasoScan's pulse model (interpolated between demo cases A and C) and
 * every number shown is measured from it by the same feature-extraction code used on recordings.
 */
import { h } from '../dom';
import { idealContour, SYNTH_CASES, type PulseShape } from '../../sim/ppgSynth';
import { extractMorphology } from '../../features/morphology';
import { plateSvg } from '../charts/heartbeat';

const PERIOD = 0.92;

function shapeAt(k: number): PulseShape {
  const a = SYNTH_CASES[0].pulse, c = SYNTH_CASES[2].pulse;
  const mix = (x: number, y: number) => x + (y - x) * k;
  return { sysPeak: mix(a.sysPeak, c.sysPeak), sysK: mix(a.sysK, c.sysK), diaMu: mix(a.diaMu, c.diaMu), diaSigma: mix(a.diaSigma, c.diaSigma), diaAmp: mix(a.diaAmp, c.diaAmp) };
}

export function heartbeatMorphSection(): { el: HTMLElement; start(): () => void } {
  const chart = h('div', { class: 'chart morph-chart' });
  const input = h('input', { type: 'range', min: 0, max: 100, value: 20, step: 1, id: 'elasticity', 'aria-describedby': 'morph-state' });
  const state = h('p', { class: 'morph-state', id: 'morph-state', 'aria-live': 'polite' });
  const vPeak = h('span', { class: 'num' });
  const vDelay = h('span', { class: 'num' });
  const vNotch = h('span', { class: 'morph-word' });

  const el = h('section', { class: 'band', 'aria-labelledby': 'morph-title' },
    h('div', { class: 'wrap morph-grid' },
      h('div', { class: 'morph-copy' },
        h('p', { class: 'kicker' }, 'The idea behind the shape'),
        h('h2', { id: 'morph-title', class: 'section-title' }, 'Anatomy of a heartbeat'),
        h('p', { class: 'section-lede' }, 'Every heartbeat sends a pressure wave along your arteries. Part of it bounces back from further down the body and returns as a second, smaller wave.'),
        h('p', { class: 'section-lede' }, 'Elastic arteries carry that echo slowly, so it arrives late and stays separate. Stiffer arteries carry it faster, so it arrives sooner and merges into the main peak. Drag the slider to see it happen.'),
        h('dl', { class: 'morph-values' },
          h('div', {}, h('dt', {}, 'Time to main peak'), h('dd', {}, vPeak, h('span', { class: 'unit' }, 'ms'))),
          h('div', {}, h('dt', {}, 'Echo arrives after peak'), h('dd', {}, vDelay, h('span', { class: 'unit' }, 'ms'))),
          h('div', {}, h('dt', {}, 'Notch between waves'), h('dd', {}, vNotch)),
        ),
      ),
      h('figure', { class: 'evidence morph-figure' },
        chart,
        h('div', { class: 'morph-control' },
          h('label', { for: 'elasticity', class: 'visually-hidden' }, 'Artery stiffness in the illustration'),
          h('span', { 'aria-hidden': 'true' }, 'More elastic'),
          input,
          h('span', { 'aria-hidden': 'true' }, 'Stiffer'),
        ),
        state,
        h('figcaption', {}, h('strong', {}, 'Illustration from the pulse model. '), 'Values are measured from the drawn wave by the same code that analyses recordings. They show the principle, not what any particular person’s arteries look like.'),
      ),
    ),
  );

  const elastic = idealContour(shapeAt(0), PERIOD);
  const render = () => {
    const k = Number(input.value) / 100;
    const contour = idealContour(shapeAt(k), PERIOD);
    const m = extractMorphology(contour, 250);
    const w = Math.max(280, Math.floor(chart.clientWidth || 600));
    chart.replaceChildren(plateSvg(m, w, { tMaxMs: PERIOD * 1000, ghost: k > 0.04 ? { contour: elastic, label: 'most elastic' } : undefined, label: `Illustrated heartbeat at ${Math.round(k * 100)}% towards stiffer arteries.` }));
    vPeak.textContent = String(Math.round(m.crestTimeMs));
    vDelay.textContent = m.deltaTMs !== null ? String(Math.round(m.deltaTMs)) : '–';
    vNotch.textContent = m.notch.present ? 'Clear' : m.diastolic ? 'Faded' : 'Gone';
    state.textContent = m.notch.present
      ? 'The echo arrives late and stays separate, with a clear notch between the two waves.'
      : m.diastolic
        ? 'The echo arrives sooner and shows only as a shoulder on the way down.'
        : 'The echo has merged into the main peak and now forms its highest point, so the peak arrives later: one broad wave, no notch.';
  };

  const start = () => {
    input.addEventListener('input', render);
    let lastW = 0;
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (chart.clientWidth !== lastW) { lastW = chart.clientWidth; render(); } }) : null;
    ro?.observe(chart);
    render();
    return () => ro?.disconnect();
  };
  return { el, start };
}
