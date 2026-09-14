import { h, icon, prefersReducedMotion } from '../dom';
import type { Ctx } from '../main';
import { pulseAt, SYNTH_CASES } from '../../sim/ppgSynth';
import { lightPathSection } from '../home/lightPath';
import { heartbeatMorphSection } from '../home/heartbeatMorph';
import { pipelineSection } from '../home/pipelineDemo';

export function renderHome(main: HTMLElement, ctx: Ctx): () => void {
  const glow = h('div', { class: 'aperture-glow' });
  const canvas = h('canvas', { class: 'hero-trace' });
  const bpm = h('span', { class: 'num' }, String(SYNTH_CASES[0].heartRate));
  const aperture = h('div', { class: 'hero-instrument', 'aria-hidden': 'true' },
    h('div', { class: 'hero-aperture' }, glow, canvas),
    h('span', { class: 'callout c1' }, h('b', {}, 'Light through the fingertip'), 'the colour the camera sees'),
    h('span', { class: 'callout c2' }, h('b', {}, 'Pulse wave'), 'brightness, 30 times a second'),
    h('span', { class: 'callout c3' }, h('b', {}, bpm, ' beats/min'), 'illustration'),
  );

  const light = lightPathSection();
  const morph = heartbeatMorphSection();
  const pipe = pipelineSection();

  main.append(
    h('section', { class: 'hero' },
      h('div', { class: 'wrap hero-grid' },
        h('div', { class: 'hero-copy' },
          h('p', { class: 'hero-eyebrow' }, h('span', { class: 'live-dot', 'aria-hidden': 'true' }), 'Pulse wave analysis in the browser'),
          h('h1', { class: 'hero-title' }, 'Your pulse wave, read through your fingertip.'),
          h('p', { class: 'lede' }, 'VasoScan uses your phone’s camera and flashlight to record one minute of light passing through your finger. It checks that the recording is usable, measures your heart rate and the shape of your pulse wave, and explains what each result means.'),
          h('div', { class: 'actions' },
            h('button', { class: 'btn', onclick: () => ctx.go('setup') }, icon('camera'), 'Start a recording'),
            h('button', { class: 'btn secondary', onclick: () => ctx.go('demo') }, 'View a demo recording'),
          ),
          h('ul', { class: 'hero-facts' },
            h('li', {}, h('span', { class: 'num' }, '60'), ' second reading'),
            h('li', {}, h('span', { class: 'num' }, '0'), ' bytes uploaded'),
            h('li', {}, 'Any phone with a camera and flash'),
          ),
          h('p', { class: 'hero-note' }, icon('info'), 'Research prototype. VasoScan is not a medical device and does not diagnose any condition.'),
        ),
        aperture,
      ),
    ),

    light.el,

    h('section', { class: 'band', id: 'how', 'aria-labelledby': 'how-title' },
      h('div', { class: 'wrap' },
        h('p', { class: 'kicker' }, 'Using it'),
        h('h2', { id: 'how-title', class: 'section-title' }, 'How a reading works'),
        h('ol', { class: 'steps' },
          step('Prepare', 'Enter your height and age, sit down, and rest your hand on a table.'),
          step('Record for one minute', 'Rest your fingertip lightly over the camera and flash. The phone clicks with each heartbeat so you don’t need to watch the screen.'),
          step('Read your findings', 'VasoScan shows whether the recording was usable, then what it measured, in plain language, with the evidence behind every number.'),
        ),
      ),
    ),

    morph.el,
    pipe.el,

    h('section', { class: 'band', 'aria-labelledby': 'measures-title' },
      h('div', { class: 'wrap two-col' },
        h('div', {},
          h('p', { class: 'kicker' }, 'Results'),
          h('h2', { id: 'measures-title', class: 'section-title' }, 'What a reading gives you'),
          h('p', { class: 'section-lede' }, 'Four findings, each with a plain-language takeaway, the reason it matters, and the chart it came from.'),
        ),
        h('dl', { class: 'measure-list' },
          measure('Recording quality', 'Whether the finger stayed on the lens, how much of the minute was steady, and whether the beats were consistent enough to measure.'),
          measure('Heart rate and beat timing', 'Your average heart rate and how the time between beats changed through the minute.'),
          measure('Pulse wave shape', 'When the main peak arrives, and whether the reflected wave stays separate from it.'),
          measure('Pulse stiffness indicator', 'An experimental score combining those shape features. It has not been validated against clinical measurements.', true),
        ),
      ),
    ),

    compareSection(),
    specSection(),

    h('section', { class: 'band limits', id: 'limits', 'aria-labelledby': 'limits-title' },
      h('div', { class: 'wrap two-col' },
        h('div', {},
          h('p', { class: 'kicker' }, 'Honest limits'),
          h('h2', { id: 'limits-title', class: 'section-title' }, 'What it cannot tell you'),
          h('p', { class: 'section-lede' }, 'A fingertip camera recording is a limited signal. VasoScan is designed to be clear about what it does not know.'),
        ),
        h('ul', { class: 'limit-list' },
          h('li', {}, 'It does not diagnose any disease and cannot tell you whether your arteries are healthy.'),
          h('li', {}, 'It cannot detect narrowed or blocked arteries. A fingertip pulse reflects the whole arterial system, so a narrowing in one vessel cannot be picked out of it.'),
          h('li', {}, 'It cannot measure blood oxygen, blood pressure or heart rhythm problems.'),
          h('li', {}, 'Its stiffness indicator uses hand-set weights and has not been tested against clinical measurements.'),
          h('li', {}, 'Results vary between phones and with finger pressure, temperature and movement.'),
          h('li', {}, 'If you have symptoms such as chest pain, breathlessness, fainting or palpitations, contact a health professional. Do not wait for or rely on this app.'),
        ),
      ),
    ),

    h('section', { class: 'cta-band', 'aria-labelledby': 'cta-title' },
      h('div', { class: 'wrap cta-inner' },
        h('h2', { id: 'cta-title' }, 'Take a one-minute reading.'),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => ctx.go('setup') }, icon('camera'), 'Start a recording'),
          h('button', { class: 'btn secondary', onclick: () => ctx.go('demo') }, 'View a demo recording'),
        ),
      ),
    ),

    h('footer', { class: 'site-footer' },
      h('div', { class: 'wrap footer-grid' },
        h('div', {},
          h('p', { class: 'footer-mark' }, 'VasoScan'),
          h('p', {}, 'Processing happens entirely on your phone. No video is recorded or uploaded; only brightness values are analysed.'),
        ),
        h('ul', { class: 'links' },
          h('li', {}, h('a', { href: 'https://github.com/Aunn-A/vasoscan' }, 'Source code and methods')),
          h('li', {}, h('a', { href: 'debug.html' }, 'Signal bench for engineers')),
          h('li', {}, h('a', { href: '#limits', onclick: (e: Event) => { e.preventDefault(); document.getElementById('limits')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Limits')),
        ),
      ),
    ),
  );

  const stops = [animateHero(canvas, glow, bpm), light.start(), morph.start(), pipe.start()];
  return () => stops.forEach((f) => f());
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

type Mark = 'yes' | 'no' | 'part';
function cell(mark: Mark, text: string): HTMLTableCellElement {
  const name = mark === 'yes' ? 'check' : mark === 'no' ? 'cross' : 'partial';
  const label = mark === 'yes' ? 'Yes' : mark === 'no' ? 'No' : 'Partly';
  return h('td', { class: `mark ${mark}` }, h('span', { class: 'mark-line' }, icon(name), h('b', {}, label)), text ? h('span', { class: 'mark-note' }, text) : null);
}

function compareSection(): HTMLElement {
  const rows: Array<[string, [Mark, string], [Mark, string], [Mark, string]]> = [
    ['Heart rate', ['yes', ''], ['yes', ''], ['yes', '']],
    ['Pulse wave shape analysis', ['yes', 'peak timing, notch, reflected wave'], ['part', 'some show the wave; shape is not analysed'], ['no', 'measures flow speed instead']],
    ['Blood oxygen level', ['no', 'needs an infrared light source'], ['yes', 'red and infrared light'], ['no', '']],
    ['Blood flow speed', ['no', ''], ['no', ''], ['yes', 'from the Doppler shift of sound']],
    ['Narrowed arteries', ['no', 'not detectable from a fingertip'], ['no', ''], ['yes', 'at the vessel being scanned']],
  ];
  return h('section', { class: 'band', 'aria-labelledby': 'cmp-title' },
    h('div', { class: 'wrap' },
      h('p', { class: 'kicker' }, 'In context'),
      h('h2', { id: 'cmp-title', class: 'section-title' }, 'How it compares'),
      h('p', { class: 'section-lede' }, 'VasoScan uses the same light-based sensing as a pulse oximeter, but analyses a different part of the signal. Neither can do what an ultrasound scan does.'),
      h('div', { class: 'table-scroll compare-wrap' },
        h('table', { class: 'compare' },
          h('thead', {}, h('tr', {},
            h('td', {}),
            h('th', { scope: 'col', class: 'col-us' }, h('span', { class: 'col-name' }, 'VasoScan'), h('span', { class: 'col-sub' }, 'phone camera and flash')),
            h('th', { scope: 'col' }, h('span', { class: 'col-name' }, 'Pulse oximeter'), h('span', { class: 'col-sub' }, 'clip-on finger sensor')),
            h('th', { scope: 'col' }, h('span', { class: 'col-name' }, 'Doppler ultrasound'), h('span', { class: 'col-sub' }, 'clinic scanner and trained operator')),
          )),
          h('tbody', {}, ...rows.map(([name, a, b, c]) => h('tr', {},
            h('th', { scope: 'row' }, name), cell(...a), cell(...b), cell(...c)))),
        ),
      ),
    ),
  );
}

function specSection(): HTMLElement {
  const spec: Array<[string, string, string]> = [
    ['Recording', '60 s', 'analysed, after 5 s for the camera to settle'],
    ['Camera sampling', '≈30 frames/s', 'every frame timestamped, resampled to 60 Hz'],
    ['Heart rate range', '40–180', 'beats per minute'],
    ['Pulse detection band', '0.5–4 Hz', 'zero-phase Butterworth filter'],
    ['Shape analysis band', '0.4–12 Hz', 'keeps the notch and reflected wave'],
    ['Minimum steady signal', '30 s', 'otherwise no result is produced'],
    ['Uncertainty', '200 resamples', 'of the recorded beats, behind each likely range'],
    ['Where it runs', 'On the phone', 'no server, no account, no upload'],
  ];
  return h('section', { class: 'band spec-band', 'aria-labelledby': 'spec-title' },
    h('div', { class: 'wrap' },
      h('div', { class: 'spec-head' },
        h('div', {},
          h('p', { class: 'kicker' }, 'Specification'),
          h('h2', { id: 'spec-title', class: 'section-title' }, 'Instrument data'),
        ),
        h('p', { class: 'spec-code' }, 'VasoScan research prototype, analysis model heuristic-0.1'),
      ),
      h('dl', { class: 'spec' }, ...spec.map(([k, v, note]) => h('div', {},
        h('dt', {}, k), h('dd', {}, h('span', { class: 'spec-value num' }, v), h('span', { class: 'spec-note' }, note))))),
    ),
  );
}

/** A simulated pulse trace sweeping across the aperture; the glow swells with each beat. */
function animateHero(canvas: HTMLCanvasElement, glow: HTMLElement, _bpm: HTMLElement): () => void {
  const c = SYNTH_CASES[0];
  const period = 60 / c.heartRate;
  const val = (t: number) => {
    const ph = ((t % period) + period) % period;
    return pulseAt(c.pulse, ph) + pulseAt(c.pulse, ph + period);
  };
  let raf = 0;
  let visible = true;
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); if (visible) raf = requestAnimationFrame(draw); }) : null;
  io?.observe(canvas);
  function draw(now: number) {
    const reduce = prefersReducedMotion();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (w && hgt) {
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
      const g = canvas.getContext('2d')!;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, hgt);
      const span = 3.2;
      const tEnd = reduce ? 2.4 : now / 1000;
      g.lineWidth = 3; g.lineJoin = 'round'; g.lineCap = 'round';
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
      const head = val(tEnd);
      g.fillStyle = '#fff';
      g.beginPath(); g.arc(w - 2, hgt * 0.72 - head * hgt * 0.42, 5, 0, Math.PI * 2); g.fill();
      if (!reduce) {
        glow.style.transform = `scale(${1 + 0.035 * Math.min(1, head)})`;
        glow.style.filter = `brightness(${1 + 0.12 * Math.min(1, head)})`;
      }
    }
    if (!reduce && visible) raf = requestAnimationFrame(draw);
  }
  raf = requestAnimationFrame(draw);
  return () => { cancelAnimationFrame(raf); io?.disconnect(); };
}
