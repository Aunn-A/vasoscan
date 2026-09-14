/** Short audio cues for when the user cannot watch the screen: a tick per heartbeat, and state tones. */
let ctx: AudioContext | null = null;

/** Must be called from a user gesture (iOS only allows audio to start that way). */
export function unlockAudio(): void {
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { ctx = null; }
}

function tone(freq: number, dur: number, gain = 0.12, when = 0): void {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

export const cue = {
  beat: () => tone(880, 0.06, 0.09),
  count: () => tone(660, 0.12, 0.12),
  start: () => { tone(660, 0.12); tone(990, 0.18, 0.12, 0.14); },
  lost: () => { tone(440, 0.16); tone(330, 0.22, 0.12, 0.18); },
  done: () => { tone(660, 0.12); tone(880, 0.12, 0.12, 0.13); tone(1320, 0.24, 0.12, 0.26); },
};

export function vibrate(pattern: number | number[]): void {
  try { navigator.vibrate?.(pattern); } catch { /* not supported */ }
}
