import type { Frame, Subject } from '../types';
import type { AnalysisResult } from '../pipeline';

export type View = 'home' | 'setup' | 'demo' | 'capture' | 'processing' | 'results';

export interface RecordingMeta {
  userAgent: string;
  timebase: string;
  torch: string;
  startedAt: string;
  subject: Subject;
}

export interface AppState {
  view: View;
  subject: Subject;
  frames: Frame[];
  meta: RecordingMeta | null;
  result: AnalysisResult | null;
  demoCaseId: string | null;
  /** True when the capture screen ran on a simulated camera feed (?simcamera test mode) */
  captureSimulated: boolean;
  sound: boolean;
}

export const state: AppState = {
  view: 'home',
  subject: {},
  frames: [],
  meta: null,
  result: null,
  demoCaseId: null,
  captureSimulated: false,
  sound: true,
};

const SUBJECT_KEY = 'vasoscan.subject';
export function loadSubject(): void {
  try {
    const raw = localStorage.getItem(SUBJECT_KEY);
    if (raw) state.subject = JSON.parse(raw) as Subject;
  } catch { /* storage unavailable */ }
}
export function saveSubject(): void {
  try { localStorage.setItem(SUBJECT_KEY, JSON.stringify(state.subject)); } catch { /* storage unavailable */ }
}
