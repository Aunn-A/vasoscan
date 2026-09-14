import { h, icon, prefersReducedMotion } from '../dom';
import type { Ctx } from '../main';
import { state } from '../state';
import { analyse } from '../../pipeline';
import { SYNTH_CASES, synthesize } from '../../sim/ppgSynth';

/**
 * Analysis itself takes a few tens of milliseconds. The steps are revealed one at a time with the
 * real counts from this recording, so the user sees what was done rather than a spinner.
 */
export function renderProcessing(main: HTMLElement, ctx: Ctx): () => void {
  const simulated = state.demoCaseId !== null || state.captureSimulated;
  if (state.demoCaseId !== null) {
    const c = SYNTH_CASES.find((x) => x.id === state.demoCaseId)!;
    state.frames = synthesize(c, { durationSec: 65 }).frames;
    state.meta = null;
  }
  const r = analyse(state.frames, state.subject, simulated ? { kind: 'simulated', caseId: state.demoCaseId ?? 'simulated-camera' } : { kind: 'measured', device: navigator.userAgent });
  state.result = r;

  const q = r.quality;
  const steps: Array<[string, string]> = [
    ['Checking the recording', r.error ?? `${state.frames.length.toLocaleString()} camera frames at ${q?.metrics.frameRate.toFixed(0)} frames per second`],
    ['Correcting camera adjustments', r.pre ? `${r.pre.exposureSteps.length} brightness changes corrected` : 'Skipped'],
    ['Finding heartbeats', `${r.beats.length} heartbeats found`],
    ['Checking signal quality', q ? (q.pass ? `${Math.round(q.metrics.cleanFraction * 100)}% of the recording is steady` : 'The recording did not pass') : 'Skipped'],
    ['Measuring the pulse shape', r.morphology ? `${q?.metrics.acceptedBeats} beats averaged` : 'Not measured'],
  ];
  const list = h('ol', { class: 'proc-steps' });
  main.append(
    h('section', { class: 'page processing' },
      h('div', { class: 'wrap narrow' },
        h('p', { class: 'kicker' }, simulated ? 'Simulated recording' : 'Live recording'),
        h('h1', { class: 'page-title', 'aria-live': 'polite' }, simulated ? 'Analysing the simulated recording' : 'Analysing your pulse'),
        list,
        h('p', { class: 'fine' }, 'All analysis runs on this phone.'),
      ),
    ),
  );

  const timers: number[] = [];
  const reduce = prefersReducedMotion();
  const gap = reduce ? 0 : 420;
  steps.forEach(([title, detail], i) => {
    timers.push(window.setTimeout(() => {
      list.append(h('li', { class: 'proc-step' }, icon('check'), h('span', {}, h('strong', {}, title), h('span', {}, detail))));
    }, gap * i));
  });
  timers.push(window.setTimeout(() => ctx.go('results'), gap * steps.length + (reduce ? 0 : 450)));
  return () => timers.forEach(clearTimeout);
}
