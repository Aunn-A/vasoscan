import { h, icon, prefersReducedMotion } from '../dom';
import type { Ctx } from '../main';
import { pulseAt, SYNTH_CASES } from '../../sim/ppgSynth';

export function renderHome(main: HTMLElement, ctx: Ctx): () => void {
  const aperture = h('div', { class: 'hero-aperture', 'aria-hidden': 'true' });
  const canvas = h('canvas', { class: 'hero-trace' });
  aperture.append(h('div', { class: 'aperture-glow' }), canvas);

  main.append(
    h('section', { class: 'hero' },
      h('div', { class: 'wrap hero-grid' },
        h('div', { class: 'hero-copy' },
          h('h1', { class: 'hero-title' }, 'Your pulse wave, read through your fingertip.'),
          h('p', { class: 'lede' }, 'VasoScan uses your phone’s camera and flashlight to record one minute of light passing through your finger. It checks that the recording is usable, measures your heart rate and the shape of your pulse wave, and explains what each result means.'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => ctx.go('setup') }, icon('camera'), 'Start a recording'),
            h('button', { class: 'btn secondary', onclick: () => ctx.go('demo') }, 'View a demo recording'),
          ),
          h('p', { class: 'hero-note' }, icon('info'), 'Research prototype. VasoScan is not a medical device and does not diagnose any condition.'),
        ),
        aperture,
      ),
    ),

    h('section', { class: 'band', id: 'how', 'aria-labelledby': 'how-title' },
      h('div', { class: 'wrap' },
        h('h2', { id: 'how-title', class: 'section-title' }, 'How a reading works'),
        h('ol', { class: 'steps' },
          step('Prepare', 'Enter your height and age, sit down, and rest your hand on a table.'),
          step('Record for one minute', 'Rest your fingertip lightly over the camera and flash. The phone clicks with each heartbeat so you don’t need to watch the screen.'),
          step('Read your findings', 'VasoScan shows whether the recording was usable, then what it measured, in plain language, with the evidence behind every number.'),
        ),
      ),
    ),

    h('section', { class: 'band', 'aria-labelledby': 'measures-title' },
      h('div', { class: 'wrap two-col' },
        h('div', {},
          h('h2', { id: 'measures-title', class: 'section-title' }, 'What it measures'),
          h('p', { class: 'section-lede' }, 'When blood surges into your fingertip with each heartbeat, it absorbs a little more light. The camera sees that change as a wave. Its timing and shape carry information about your heart and arteries.'),
        ),
        h('dl', { class: 'measure-list' },
          measure('Recording quality', 'Whether the finger stayed on the lens, how much of the minute was steady, and whether the beats were consistent enough to measure.'),
          measure('Heart rate and beat timing', 'Your average heart rate and how the time between beats changed through the minute.'),
          measure('Pulse wave shape', 'When the main peak arrives, and whether a second wave reflected from further down the body stays separate from it.'),
          measure('Pulse stiffness indicator', 'An experimental score combining those shape features. It has not been validated against clinical measurements.', true),
        ),
      ),
    ),

    h('section', { class: 'band limits', id: 'limits', 'aria-labelledby': 'limits-title' },
      h('div', { class: 'wrap two-col' },
        h('div', {},
          h('h2', { id: 'limits-title', class: 'section-title' }, 'What it cannot tell you'),
          h('p', { class: 'section-lede' }, 'A fingertip camera recording is a limited signal. VasoScan is designed to be clear about what it does not know.'),
        ),
        h('ul', { class: 'limit-list' },
          h('li', {}, 'It does not diagnose any disease and cannot tell you whether your arteries are healthy.'),
          h('li', {}, 'It cannot detect narrowed or blocked arteries, measure blood pressure, or assess heart rhythm problems.'),
          h('li', {}, 'Its stiffness indicator uses hand-set weights and has not been tested against clinical measurements.'),
          h('li', {}, 'Results vary between phones and with finger pressure, temperature and movement.'),
          h('li', {}, 'If you have symptoms such as chest pain, breathlessness, fainting or palpitations, contact a health professional. Do not wait for or rely on this app.'),
        ),
      ),
    ),

    h('footer', { class: 'site-footer' },
      h('div', { class: 'wrap' },
        h('p', {}, 'Processing happens entirely on your phone. No video is recorded or uploaded; only brightness values are analysed.'),
        h('p', { class: 'links' },
          h('a', { href: 'https://github.com/Aunn-A/vasoscan' }, 'Source code and methods'),
          h('a', { href: 'debug.html' }, 'Signal bench for engineers'),
        ),
      ),
    ),
  );

  return animateHero(canvas);
}

function step(title: string, body: string): HTMLLIElement {
  return h('li', {}, h('h3', {}, title), h('p', {}, body));
}

function measure(title: string, body: string, experimental = false): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(
    h('dt', {}, title, experimental ? h('span', { class: 'tag-exp' }, 'Experimental') : null),
    h('dd', {}, body),
  );
  return f;
}

/** A simulated pulse trace sweeping across the aperture. Illustrative only, drawn from the pulse model. */
function animateHero(canvas: HTMLCanvasElement): () => void {
  const c = SYNTH_CASES[0];
  const period = 60 / c.heartRate;
  let raf = 0;
  const draw = (now: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) { raf = requestAnimationFrame(draw); return; }
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const span = 3.2;
    const tEnd = prefersReducedMotion() ? 2.4 : now / 1000;
    const val = (t: number) => {
      const ph = ((t % period) + period) % period;
      return pulseAt(c.pulse, ph) + pulseAt(c.pulse, ph + period);
    };
    g.lineWidth = 3;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const steps = Math.round(w);
    g.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = tEnd - span + (i / steps) * span;
      const y = hgt * 0.72 - val(t) * hgt * 0.42;
      if (i) g.lineTo((i / steps) * w, y); else g.moveTo(0, y);
    }
    const grad = g.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'rgba(255,240,236,0)');
    grad.addColorStop(0.35, 'rgba(255,240,236,0.75)');
    grad.addColorStop(1, 'rgba(255,248,246,1)');
    g.strokeStyle = grad;
    g.stroke();
    const yHead = hgt * 0.72 - val(tEnd) * hgt * 0.42;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(w - 2, yHead, 5, 0, Math.PI * 2);
    g.fill();
    if (!prefersReducedMotion()) raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => cancelAnimationFrame(raf);
}
