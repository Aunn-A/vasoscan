/**
 * Perfusion index: pulsatile (AC) over non-pulsatile (DC) light, as a percentage.
 *
 * On a pulse oximeter PI reflects peripheral perfusion (vasodilation raises it, vasoconstriction
 * and cold lower it) (Lima et al. 2002, Crit Care Med 30:1210). A phone camera applies automatic
 * exposure, gain and tone mapping before the app sees a pixel, and the torch is not a calibrated
 * light source, so this value is only comparable between captures on the same phone under similar
 * conditions. It is labelled as relative.
 */
import type { Beat } from '../dsp/peaks';

export function perfusionIndex(raw: Float64Array, beats: Beat[], fs: number, include?: (b: Beat) => boolean): number | null {
  const values: number[] = [];
  const win = Math.round(0.15 * fs);
  for (const b of beats) {
    if (include && !include(b)) continue;
    // Intensity is highest at the pulse foot (least blood) and lowest at the systolic peak
    let hi = -Infinity, lo = Infinity, dc = 0, count = 0;
    for (let i = Math.max(0, b.footIdx - win); i <= Math.min(raw.length - 1, b.footIdx + win); i++) hi = Math.max(hi, raw[i]);
    for (let i = Math.max(0, b.peakIdx - win); i <= Math.min(raw.length - 1, b.peakIdx + win); i++) lo = Math.min(lo, raw[i]);
    for (let i = b.footIdx; i <= b.peakIdx; i++) { dc += raw[i]; count++; }
    if (count && dc > 0 && hi > lo) values.push(((hi - lo) / (dc / count)) * 100);
  }
  if (!values.length) return null;
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}
