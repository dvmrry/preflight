import type { Deliverable } from "../types.ts";

// Size rules shared by images, videos and Figma frames. Platforms state sizes several ways: one exact size, a list
// of accepted sizes (App Store screenshots), bounds (YouTube: at least 640 wide), an aspect ratio (Canvas: 9:16), or
// a proportion limit (Google Play: long side at most 2× the short side). All that apply must hold.

export interface SizeProblem { expected: string; actual: string; why: string; scale?: number; swapped?: boolean }

export function sizeProblem(d: Deliverable, w: number | undefined, h: number | undefined): SizeProblem | undefined {
  if (w === undefined || h === undefined) return undefined;
  const actual = `${w}×${h}`;
  const fail = (expected: string, why: string, extra: Partial<SizeProblem> = {}) => ({ expected, actual, why, ...extra });
  const swapped = (a: number, b: number) => a === h && b === w && a !== b;
  const turnedOk = (a?: number, b?: number) => d.anyOrientation && (a === undefined || a === h) && (b === undefined || b === w);

  if (d.width !== undefined || d.height !== undefined) {
    if (((d.width !== undefined && w !== d.width) || (d.height !== undefined && h !== d.height)) && !turnedOk(d.width, d.height)) {
      const exp = `${d.width ?? "any"}×${d.height ?? "any"}`;
      return fail(exp, `must be ${exp}${d.anyOrientation ? " (either orientation)" : ""}`, { scale: scaleOf(w, h, d.width, d.height), swapped: d.width !== undefined && d.height !== undefined && swapped(d.width, d.height) });
    }
  }
  if (d.sizes?.length && !d.sizes.some(([a, b]) => (a === w && b === h) || turnedOk(a, b))) {
    const exp = d.sizes.map(([a, b]) => `${a}×${b}`).join(", ") + (d.anyOrientation ? " (portrait or landscape)" : "");
    const scaled = d.sizes.map(([a, b]) => scaleOf(w, h, a, b)).find((s) => s !== undefined);
    return fail(exp, `must be one of ${exp}`, { scale: scaled, swapped: d.sizes.some(([a, b]) => swapped(a, b)) });
  }
  const bounds: string[] = [];
  if (d.minWidth !== undefined && w < d.minWidth) bounds.push(`at least ${d.minWidth} wide`);
  if (d.maxWidth !== undefined && w > d.maxWidth) bounds.push(`at most ${d.maxWidth} wide`);
  if (d.minHeight !== undefined && h < d.minHeight) bounds.push(`at least ${d.minHeight} tall`);
  if (d.maxHeight !== undefined && h > d.maxHeight) bounds.push(`at most ${d.maxHeight} tall`);
  if (bounds.length) return fail(bounds.join(", "), `must be ${bounds.join(" and ")}`);
  if (d.aspect) {
    const [a, b] = d.aspect.split(":").map(Number);
    const tol = d.aspectTolerance ?? 0.01;
    if (Math.abs(w / h - a / b) / (a / b) > tol) {
      const turned = Math.abs(h / w - a / b) / (a / b) <= tol;
      return fail(d.aspect, `must be ${d.aspect}, not ${ratioLabel(w, h)}`, { swapped: turned });
    }
  }
  if (d.maxLongToShort !== undefined && Math.max(w, h) / Math.min(w, h) > d.maxLongToShort) {
    return fail(`long side ≤ ${d.maxLongToShort}× short side`, `can't have a long side more than ${d.maxLongToShort}× the short side`);
  }
  return undefined;
}

// Exactly k× the target (k ≠ 1): almost always an export-scale setting.
function scaleOf(w: number, h: number, tw?: number, th?: number): number | undefined {
  if (!tw || !th) return undefined;
  const s = w / tw;
  return s !== 1 && Math.abs(h - th * s) < 0.5 ? +s.toFixed(2) : undefined;
}

function ratioLabel(w: number, h: number) {
  const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
  const k = g(w, h);
  const r = `${w / k}:${h / k}`;
  return r.length <= 7 ? r : (w / h).toFixed(3) + ":1";
}
