import type { Deliverable, Finding, Guidelines, LogoRule } from "../types.ts";
import type { FigmaFrame } from "../formats/figma.ts";
import { globMatch, type findingMaker } from "../guidelines.ts";
import { sizeProblem } from "./size.ts";
import { contrastRatio, deltaE, hexToRgb, rgbToHex, type RGB } from "../color.ts";

type Make = ReturnType<typeof findingMaker>;

const SHOW = 3; // layers named per grouped finding; the count covers the rest

// Brand checks run on every frame; size checks only when the frame matches a deliverable.
export function checkFrame(fr: FigmaFrame, d: Deliverable | undefined, g: Guidelines, make: Make): Finding[] {
  const out: Finding[] = [];
  const b = g.brand ?? {};
  const sz = d ? sizeProblem(d, fr.width, fr.height) : undefined;
  if (d && sz) {
    out.push(make("figma.frameSize", "error", `Frame is ${sz.actual}, ${d.name} ${sz.why}.`, { expected: sz.expected, actual: sz.actual,
      ...(d.sizes?.length || d.width === undefined ? { fix: `Resize the frame to an accepted size (${sz.expected}).` } : {}) }));
  }
  if (d?.safeArea) out.push(...safeArea(fr, d, make));
  for (const logo of b.logos ?? []) out.push(...logoRule(fr, logo, make));
  if (fr.rotation) {
    out.push(make("figma.rotated", "warning", `The frame itself is rotated ${fr.rotation}° on the canvas, so its export won't be upright.`, { actual: fr.rotation }));
  }

  // Off-palette colours, grouped by colour so one stray swatch used 40 times is one finding, not 40.
  if (b.palette?.length) {
    const palette = b.palette.map(hexToRgb);
    const tol = b.paletteTolerance ?? 1.0;
    const off = new Map<string, { layers: string[]; nearest: string; dE: number }>();
    for (const el of fr.elements) {
      for (const f of el.fills) {
        const hex = rgbToHex(f.color);
        const dists = palette.map((p) => deltaE(f.color, p));
        const min = Math.min(...dists);
        if (min <= tol) continue;
        const e = off.get(hex) ?? { layers: [], nearest: b.palette[dists.indexOf(min)].toUpperCase(), dE: +min.toFixed(1) };
        e.layers.push(el.path);
        off.set(hex, e);
      }
    }
    for (const [hex, e] of off) {
      const close = e.dE < 5 ? ` — looks like an off-by-a-bit ${e.nearest}` : "";
      out.push(make("brand.color", "warning", `${hex} isn't in the palette (nearest ${e.nearest}, ΔE2000 ${e.dE})${close}; used on ${e.layers.length} layer(s).`,
        { location: layers(e.layers), expected: b.palette, actual: hex, fix: e.dE < 5 ? `Swap to the ${e.nearest} library swatch.` : "Replace with a palette colour (see the contrast findings if this is text)." }));
    }
  }

  // Text: every distinct style inside a layer (a bold word in another font counts) is checked on its own.
  const texts = fr.elements.filter((el) => el.text);
  const runs = texts.flatMap((el) => el.text!.runs.map((r) => ({ el, r })));
  if (b.fonts?.length) {
    const bad = new Map<string, string[]>();
    for (const { el, r } of runs) {
      if (b.fonts.some((f) => f.toLowerCase() === String(r.family).toLowerCase())) continue;
      const ls = bad.get(r.family) ?? [];
      if (!ls.includes(el.path)) ls.push(el.path);
      bad.set(r.family, ls);
    }
    for (const [fam, ls] of bad) out.push(make("brand.font", "error", `Font "${fam}" isn't a brand font (${b.fonts.join(", ")}); used on ${ls.length} text layer(s).`, { location: layers(ls), expected: b.fonts, actual: fam }));
  }
  for (const { el, r } of runs) {
    const t = el.text!;
    const quote = `"${r.sample}${r.sample.length >= 40 ? "…" : ""}"`;
    if (b.minTextSize && r.size < b.minTextSize) {
      out.push(make("text.size", "warning", `Text ${quote} is ${r.size}px, below the ${b.minTextSize}px minimum.`, { location: el.path, expected: `≥ ${b.minTextSize}`, actual: r.size }));
    }
    if (!b.minContrast) continue;
    if (typeof t.background === "object" && r.color) {
      const large = r.size >= 24 || (r.size >= 18.66 && (r.weight ?? 400) >= 700); // WCAG "large text"
      const need = large ? Math.min(3, b.minContrast) : b.minContrast;
      const raw = contrastRatio(r.color, t.background);
      if (raw < need) {
        const shown = Math.floor(raw * 100) / 100; // never display a failing 4.496 as "4.50"
        out.push(make("text.contrast", "error", `Text ${quote} (${rgbToHex(r.color)} as seen) has contrast ${shown}:1 on ${rgbToHex(t.background)}, needs ${need}:1${large ? " (large text)" : ""}.`,
          { location: el.path, expected: `≥ ${need}`, actual: { ratio: shown, text: rgbToHex(r.color), background: rgbToHex(t.background) },
            fix: contrastFix(r.color, t.background, need, b.palette) }));
      }
    } else {
      const on = t.background === "image" ? "an image" : t.background === "mixed" ? "more than one thing (a gradient, or a shape that only partly covers it)" : typeof t.background === "object" ? "a solid colour" : "no solid background";
      const why = r.fill !== "solid" ? `has a ${r.fill} fill` : !r.color ? "is see-through" : `sits on ${on}`;
      out.push(make("text.contrastUnchecked", "info", `Text ${quote} ${why}, so contrast needs a human look.`, { location: el.path }));
    }
  }
  const unstyled = texts.filter((el) => !el.text!.styleId).map((el) => el.path);
  if (unstyled.length) {
    out.push(make("text.noStyle", "info", `${unstyled.length} text layer(s) don't use a shared text style, so they won't follow library updates.`, { location: layers(unstyled) }));
  }
  return out;
}

// Suggests a palette colour that passes on this background, the one closest to the current text colour (so the
// design changes least). Deterministic, so the agent never has to guess a colour.
function contrastFix(text: RGB, bg: RGB, need: number, palette?: string[]): string {
  const ok = (palette ?? []).map((h) => ({ h: h.toUpperCase(), c: hexToRgb(h) }))
    .filter((p) => contrastRatio(p.c, bg) >= need)
    .sort((a, b) => deltaE(a.c, text) - deltaE(b.c, text));
  if (ok.length) return `Change the text to ${ok[0].h} (${(Math.floor(contrastRatio(ok[0].c, bg) * 100) / 100)}:1 on this background).`;
  return "No palette colour passes on this background: change the background, or add a darker/lighter text colour to the palette.";
}

// Text inside the margins a platform covers with its own UI (captions, buttons, profile row).
function safeArea(fr: FigmaFrame, d: Deliverable, make: Make): Finding[] {
  const m = { top: 0, bottom: 0, left: 0, right: 0, ...d.safeArea };
  const inner = { x0: m.left, y0: m.top, x1: fr.width - m.right, y1: fr.height - m.bottom };
  const hits = fr.elements.filter((e) => e.text && e.box).filter((e) => {
    const b = e.box!;
    return b.x < inner.x0 || b.y < inner.y0 || b.x + b.width > inner.x1 || b.y + b.height > inner.y1;
  });
  if (!hits.length) return [];
  const margins = Object.entries(d.safeArea!).map(([k, v]) => `${k} ${v}px`).join(", ");
  return [make("figma.safeArea", "warning", `${hits.length} text layer(s) sit in the area ${d.name} covers with platform UI (${margins}).`,
    { location: layers(hits.map((e) => e.path)), expected: d.safeArea, fix: `Move the text inside the safe area (${margins} from the edges).` })];
}

// Logo/badge rules: found by layer name, then minimum height and clear space (nothing else drawn within the margin).
function logoRule(fr: FigmaFrame, rule: LogoRule, make: Make): Finding[] {
  const out: Finding[] = [];
  const logos = fr.elements.filter((e) => e.box && globMatch(rule.match, e.name));
  for (const lg of logos) {
    const b = lg.box!;
    if (rule.minHeight && b.height < rule.minHeight) {
      out.push(make("brand.logoSize", "error", `${rule.name} is ${+b.height.toFixed(1)}px tall, minimum ${rule.minHeight}px.`,
        { location: lg.path, expected: `≥ ${rule.minHeight}`, actual: +b.height.toFixed(1), fix: `Scale the ${rule.name} up to at least ${rule.minHeight}px tall (keep proportions).` }));
    }
    if (rule.minWidth && b.width < rule.minWidth) {
      out.push(make("brand.logoSize", "error", `${rule.name} is ${+b.width.toFixed(1)}px wide, minimum ${rule.minWidth}px.`,
        { location: lg.path, expected: `≥ ${rule.minWidth} wide`, actual: +b.width.toFixed(1), fix: `Scale the ${rule.name} up to at least ${rule.minWidth}px wide (keep proportions).` }));
    }
    if (rule.clearSpace) {
      const pad = b.height * rule.clearSpace;
      const zone = { x0: b.x - pad, y0: b.y - pad, x1: b.x + b.width + pad, y1: b.y + b.height + pad };
      const intruders = fr.elements.filter((e) => {
        if (e === lg || !e.box || !e.paints || e.path.startsWith(lg.path + " / ") || lg.path.startsWith(e.path + " / ")) return false;
        const o = e.box;
        const overlaps = o.x < zone.x1 && o.x + o.width > zone.x0 && o.y < zone.y1 && o.y + o.height > zone.y0;
        const isBackdrop = o.x <= zone.x0 && o.y <= zone.y0 && o.x + o.width >= zone.x1 && o.y + o.height >= zone.y1; // what the logo sits on
        return overlaps && !isBackdrop;
      });
      if (intruders.length) {
        out.push(make("brand.logoClearSpace", "warning", `${intruders.length} layer(s) intrude on the ${rule.name}'s clear space (${rule.clearSpace} × its height = ${+pad.toFixed(1)}px on every side).`,
          { location: layers(intruders.map((e) => e.path)), expected: `${+pad.toFixed(1)}px clear`, actual: { logo: lg.path, clearSpacePx: +pad.toFixed(1) }, fix: `Move them at least ${+pad.toFixed(1)}px away from the ${rule.name}.` }));
      }
    }
  }
  return out;
}

function layers(ls: string[]) {
  return ls.slice(0, SHOW).join("; ") + (ls.length > SHOW ? `; +${ls.length - SHOW} more` : "");
}
