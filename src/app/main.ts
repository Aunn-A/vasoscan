import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/public-sans';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/views.css';

import { h, icon } from './dom';
import { state, loadSubject, type View } from './state';
import { renderHome } from './views/home';
import { renderSetup, renderDemoPicker } from './views/setup';
import { renderCapture } from './views/capture';
import { renderProcessing } from './views/processing';
import { renderResults } from './views/results';

export interface Ctx {
  go(view: View): void;
}

const root = document.getElementById('app')!;
let cleanup: (() => void) | void;

function topbar(): HTMLElement {
  return h('header', { class: 'topbar' },
    h('div', { class: 'wrap' },
      h('a', { class: 'wordmark', href: '#', onclick: (e: Event) => { e.preventDefault(); ctx.go('home'); } }, logo(), 'VasoScan'),
      h('nav', { 'aria-label': 'Site' },
        h('a', { href: '#how', class: 'hide-sm', onclick: (e: Event) => { e.preventDefault(); goAnchor('how'); } }, 'How it works'),
        h('a', { href: '#limits', class: 'hide-sm', onclick: (e: Event) => { e.preventDefault(); goAnchor('limits'); } }, 'Limits'),
        h('span', { class: 'proto-tag' }, 'Research prototype'),
      ),
    ),
  );
}

function goAnchor(id: string) {
  if (state.view !== 'home') ctx.go('home');
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }));
}

function logo(): SVGSVGElement {
  const svg = icon('dot');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.innerHTML = '<circle cx="16" cy="16" r="14" fill="var(--ink)"/><circle cx="16" cy="16" r="9.5" fill="var(--signal)"/><path d="M4.5 17h6l2.2-6 3.6 11 2.6-7.5 1.6 2.5h7" stroke="var(--surface)" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  return svg;
}

export const ctx: Ctx = {
  go(view) {
    if (typeof cleanup === 'function') cleanup();
    cleanup = undefined;
    state.view = view;
    const scope = view === 'capture';
    document.body.classList.toggle('in-scope', scope);
    const main = h('main', { id: 'main', tabindex: '-1' });
    root.replaceChildren(...(scope ? [] : [topbar()]), main);
    switch (view) {
      case 'home': cleanup = renderHome(main, ctx); break;
      case 'setup': cleanup = renderSetup(main, ctx); break;
      case 'demo': cleanup = renderDemoPicker(main, ctx); break;
      case 'capture': cleanup = renderCapture(main, ctx); break;
      case 'processing': cleanup = renderProcessing(main, ctx); break;
      case 'results': cleanup = renderResults(main, ctx); break;
    }
    window.scrollTo(0, 0);
    const heading = main.querySelector<HTMLElement>('h1');
    if (heading && view !== 'home') { heading.setAttribute('tabindex', '-1'); heading.focus({ preventScroll: true }); }
  },
};

loadSubject();
ctx.go('home');
