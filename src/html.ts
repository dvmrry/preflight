import type { AssetReport, Finding, Report } from "./types.ts";
import type { SketchLayer } from "./report.ts";
import { contrastRatio, deltaE, hexToRgb } from "./color.ts";
import { brandCss, type BrandProfile } from "./brand.ts";

// A self-contained HTML review page built from the report: the same grouping an agent would do (blocks delivery /
// fix if quick / needs a human eye), but deterministic, so the numbers on the page are the tool's own.
// The look is Preflight's neutral theme: a plain document (flat header, one summary strip, bordered cards). A brand
// profile (src/brand.ts) restyles it — colours, fonts, logo, mark — and may pick the "bold" style instead (curved
// hero header, floating stat cards, pill headings), without code changes.

// Preflight's neutral look. A brand profile (src/brand.ts) overrides any of these tokens; nothing brand-specific lives here.
const THEME = `
  --brand: #3B5BDB; --brand-strong: #2F4AC2; --brand-soft: #E8EDFF; --brand-ink: #1E2A5A;
  --ink: #111318; --ink-2: #5B6170; --paper: #FFFFFF; --base: #F4F5F8; --chip: #E9EBF0; --line: #CDD1DA;
  --head: #111318; --head-2: #1B1E25; --head-accent: #9DB2FF;
  --error: #D92D20; --warn: #DC6803; --info: #3B5BDB; --ok: #079455;
  /* intent colours as text on white need >= 3:1, so text uses darker shades of the same hues */
  --error-text: #B42318; --warn-text: #A15C07; --info-text: #2F4AC2; --ok-text: #067647;
  --r-s: 6px; --r-m: 8px; --r-l: 10px; --r-full: 256px;
  --elev: none;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif;
  --font-head: var(--font);
  --head-stretch: 100%; --head-case: none;`;
const THEME_DARK = `--ink:#F4F5F8;--ink-2:#A6ACB8;--paper:#232630;--base:#111318;--chip:#343846;--line:#4A4F5E;--brand-soft:#1E2A5A;--brand-strong:#9DB2FF;--head:#1B1E25;--ok-text:#3CCB7F;--warn-text:#F79009;--error-text:#F97066;--info-text:#9DB2FF`;

// Shared by both styles: finding internals, sketches, swatches, banner, footer, layout breakpoints.
const BASE_CSS = `
*{box-sizing:border-box}
body{margin:0;background:var(--base);color:var(--ink);font:16px/1.45 var(--font);-webkit-font-smoothing:antialiased;overflow-wrap:anywhere}
header .title{flex:1;min-width:0;overflow-wrap:anywhere}
header .eyebrow{color:var(--head-accent);font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:12px}
header .sub{color:#A9A6AA}
.ic{flex:none;vertical-align:-2px}
main{padding:8px 48px 56px}
.asset ul{list-style:none;margin:0;padding:0}
.f{border-left:3px solid var(--info);padding:8px 0 8px 14px;margin:6px 0}
.f.error{border-color:var(--error)}.f.warning{border-color:var(--warn)}
.msg{font-weight:600}
.loc{color:var(--ink-2);font-size:13px;margin-top:2px}
.fix{margin-top:8px;background:var(--brand-soft);border-radius:var(--r-s);padding:8px 12px}
.fix b{color:var(--brand-strong);margin-right:6px}
.rule{color:var(--ink-2);font:11px ui-monospace,Menlo,monospace;margin-top:6px}
.stat span{display:flex;align-items:center;gap:6px;white-space:nowrap;color:var(--ink-2);font-size:14px}
.stat.error b{color:var(--error-text)}.stat.warning b{color:var(--warn-text)}.stat.info b{color:var(--info-text)}.stat.ok b{color:var(--ok-text)}
.stat.ok span .ic{color:var(--ok-text)}.stat.error span .ic{color:var(--error-text)}.stat.warning span .ic{color:var(--warn-text)}.stat.info span .ic{color:var(--info-text)}
.pill{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:700}
.checklist{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
.checklist li{background:var(--paper);border-radius:var(--r-m);padding:10px 14px;display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:2px 10px;font-weight:600}
.checklist li .tag{grid-column:2;justify-self:start}
.checklist li .ic{color:var(--ok-text)}
.asset.has-sketch{display:grid;grid-template-columns:minmax(150px,280px) minmax(0,1fr);gap:4px 24px;align-items:start}
.asset.has-sketch h3{grid-column:1/-1}
.sketch{margin:6px 0 0}
.sketch svg{display:block;width:100%;height:auto;max-height:520px;border-radius:var(--r-s);box-shadow:0 0 0 1px var(--line);background:#fff}
.sketch figcaption{color:var(--ink-2);font-size:12px;margin-top:6px}
.n{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:var(--r-full);background:#DF3C3C;color:#fff;font:800 12px/1 var(--font);margin-right:8px;padding:0 5px;vertical-align:1px}
.sws{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:8px}
.sw{display:inline-flex;align-items:center;gap:6px;font:12px ui-monospace,Menlo,monospace}
.sw i{width:28px;height:28px;border-radius:var(--r-s);box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
.sample{display:inline-grid;place-items:center;width:44px;height:32px;border-radius:var(--r-s);font:800 18px var(--font);box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
.cap{font-size:12px;color:var(--ink-2)}
.arrow{color:var(--ink-2)}
.banner{display:flex;gap:12px;align-items:flex-start;background:#FFF1E0;color:#5C3200;border-radius:var(--r-m);padding:14px 18px;margin:28px 0 0}
.banner .ic{color:var(--warn-text);margin-top:2px}
.ai{display:inline-block;background:var(--chip);color:var(--ink-2);border-radius:var(--r-full);padding:1px 8px;margin-right:8px;font:700 11px var(--font);text-transform:uppercase;letter-spacing:.04em;vertical-align:1px}
footer{color:var(--ink-2);font-size:12px;padding:0 48px 40px}
table{width:100%;table-layout:fixed}
td{padding:10px 14px;overflow-wrap:anywhere}
td:last-child{width:140px;text-align:right}
@media (max-width:760px){.asset.has-sketch{grid-template-columns:1fr}.sketch svg{max-width:260px}td:nth-child(2){display:none}td:last-child{width:118px}
  header,main,footer{padding-left:16px;padding-right:16px}}
@media (prefers-color-scheme:dark){:root{${THEME_DARK}}header{box-shadow:inset 0 -1px 0 var(--line)}.banner{background:#3A2410;color:#FFD9B0}.banner .ic{color:var(--warn)}}`;

// The default: a plain document. Flat header band, one bordered summary strip, plain headings, bordered cards.
const PLAIN_CSS = `
header{background:var(--head);color:#FDFCFE;padding:28px 48px;display:flex;gap:24px;align-items:center}
header h1{font:700 34px/1.1 var(--font-head);font-stretch:var(--head-stretch);text-transform:var(--head-case);margin:6px 0 6px;letter-spacing:-.01em}
header .logo{display:block;height:24px;width:auto;margin-bottom:14px}
header .mark{height:72px;width:auto;flex:none}
.stats{display:grid;grid-template-columns:repeat(5,1fr);margin:24px 48px 0;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden}
.stat{padding:14px 18px;border-left:1px solid var(--line)}
.stat:first-child{border-left:0}
.stat b{display:block;font:700 28px/1.1 var(--font-head);font-stretch:var(--head-stretch);margin-bottom:2px}
.group h2{display:flex;align-items:center;gap:10px;font:700 20px/1.3 var(--font-head);font-stretch:var(--head-stretch);margin:36px 0 2px}
.group.error h2 .ic{color:var(--error-text)}.group.warning h2 .ic{color:var(--warn-text)}.group.info h2 .ic{color:var(--info-text)}.group.ok h2 .ic{color:var(--ok-text)}
.group .count{color:var(--ink-2);font:500 16px var(--font)}
.blurb{color:var(--ink-2);margin:0 0 12px}
.asset{background:var(--paper);border:1px solid var(--line);border-radius:var(--r-l);padding:14px 20px;margin:0 0 10px}
.asset h3{margin:0 0 4px;font-size:15px;display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.tag{color:var(--ink-2);font-weight:400;font-size:13px}
.asset .tag::before{content:"· "}
.mx{display:flex;gap:4px 20px;flex-wrap:wrap;margin-top:4px;font:13px ui-monospace,Menlo,monospace}
.mx em{font:12px var(--font);color:var(--ink-2);margin-right:6px;font-style:normal}
.checklist li{border:1px solid var(--line)}
table{border-collapse:separate;border-spacing:0;background:var(--paper);border:1px solid var(--line);border-radius:var(--r-l);overflow:hidden}
tr+tr td{border-top:1px solid var(--line)}
td:first-child{font-weight:600}
.pill.error{color:var(--error-text)}.pill.warning{color:var(--warn-text)}.pill.info{color:var(--info-text)}.pill.ok{color:var(--ok-text)}
@media (max-width:900px){.stats{grid-template-columns:repeat(3,1fr)}.stat:nth-child(4){border-left:0}.stat:nth-child(n+4){border-top:1px solid var(--line)}}
@media (max-width:760px){header{padding:20px 16px}header .mark{display:none}.stats{margin:16px 16px 0;grid-template-columns:repeat(2,1fr)}
  .stat:nth-child(n){border-left:1px solid var(--line);border-top:1px solid var(--line)}.stat:nth-child(odd){border-left:0}.stat:nth-child(-n+2){border-top:0}}`;

// Opt-in for brand profiles ("style": "bold"): curved hero header with a large mark, stat cards overlapping it,
// headings in pills, filled verdict pills.
const BOLD_CSS = `
:root{--r-s:12px;--r-m:16px;--r-l:24px;--elev:0 1px 20px 0 #1f1f1f1f}
header{background:var(--head);color:#FDFCFE;padding:40px 48px 72px;border-radius:0 0 50% 50% / 0 0 56px 56px;clip-path:inset(0 round 0 0 50% 50% / 0 0 56px 56px);display:flex;gap:32px;align-items:flex-end;position:relative;overflow:hidden}
header h1{font:800 56px/.95 var(--font-head);font-stretch:var(--head-stretch);margin:8px 0 10px;letter-spacing:-.005em;text-transform:var(--head-case)}
header.has-mark .title{padding-right:270px}
header .logo{display:block;height:30px;width:auto;margin-bottom:18px}
header .mark{position:absolute;right:56px;bottom:-26px;height:230px;width:auto}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin:-44px 48px 8px;position:relative;z-index:1}
.stat{background:var(--paper);border-radius:var(--r-l);padding:18px 20px;box-shadow:var(--elev)}
.stat b{display:block;font:800 44px/1 var(--font-head);font-stretch:var(--head-stretch)}
main{padding-top:24px}
.group h2{display:inline-flex;align-items:center;gap:12px;font:800 24px/1.2 var(--font-head);font-stretch:var(--head-stretch);margin:36px 0 6px;background:var(--ink);color:var(--paper);border-radius:var(--r-full);padding:8px 18px 8px 10px}
.group h2 .ic{margin-left:4px}
.group.error h2 .ic{color:#FF8A8A}.group.warning h2 .ic{color:#FFB25C}.group.info h2 .ic{color:var(--head-accent)}.group.ok h2 .ic{color:#5FE08A}
.group .count{background:var(--paper);color:var(--ink);border-radius:var(--r-full);padding:2px 10px;font:700 14px var(--font)}
.blurb{color:var(--ink-2);margin:0 0 14px 26px}
.asset{background:var(--paper);border-radius:var(--r-l);padding:18px 22px;margin:0 0 14px;box-shadow:var(--elev)}
.asset h3{margin:0 0 8px;font-size:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.tag{background:var(--brand-soft);color:var(--brand-strong);border-radius:var(--r-full);padding:3px 10px;font:800 12px/1.2 var(--font-head);font-stretch:var(--head-stretch);text-transform:uppercase;letter-spacing:.02em}
.f{border-left-width:4px;padding:10px 0 10px 14px;margin:8px 0}
.mx{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.mx span{background:var(--chip);border-radius:var(--r-s);padding:4px 10px;font:12px ui-monospace,Menlo,monospace;max-width:100%}
.mx em{font:600 10px var(--font);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-2);margin-right:6px;font-style:normal}
.checklist li{font-weight:700}
table{border-collapse:separate;border-spacing:0 6px}
td{background:var(--paper)}
td:first-child{border-radius:var(--r-m) 0 0 var(--r-m);font-weight:700}td:last-child{border-radius:0 var(--r-m) var(--r-m) 0}
.pill{border-radius:var(--r-full);padding:3px 12px;color:#FFFFFF}
.pill.error{background:var(--error-text)}.pill.warning{background:var(--warn-text)}.pill.info{background:var(--info-text)}.pill.ok{background:var(--ok-text)}
@media (prefers-color-scheme:dark){.group h2{background:var(--chip);color:var(--ink)}.group .count{background:var(--ink);color:#0F0D13}.pill{color:#0F0D13}}
@media (max-width:900px){header .mark{display:none}header.has-mark .title{padding-right:0}.stats{grid-template-columns:repeat(3,1fr)}}
@media (max-width:760px){.stats{margin:-44px 16px 8px;grid-template-columns:repeat(2,1fr)}}`;

const GROUPS: { sev: Finding["severity"]; title: string; blurb: string }[] = [
  { sev: "error", title: "Blocks delivery", blurb: "Fails the spec. Fix before this goes out." },
  { sev: "warning", title: "Fix if quick", blurb: "Off-brand or risky, but not a hard fail." },
  { sev: "info", title: "Needs a human eye", blurb: "The checker couldn't decide these; someone should look." },
];

// Thin single-weight line icons on a 16px grid in currentColor
// (drawn for this report, not copied). The check has a slight curve, like theirs.
const ICON: Record<string, string> = {
  ok: '<path d="M2.5 8.6c1.4 1.1 2.6 2.4 3.6 3.9C8.1 8.6 10.6 5.4 13.6 3.2"/>',
  error: '<path d="M4 4l8 8M12 4l-8 8"/>',
  warning: '<path d="M8 2.2l6.2 11.1H1.8z"/><path d="M8 6.4v3.4M8 11.6v.4"/>',
  info: '<path d="M1.5 8s2.4-4.3 6.5-4.3S14.5 8 14.5 8s-2.4 4.3-6.5 4.3S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/>',
  assets: '<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>',
};
const icon = (k: string, size = 16) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const short = (asset: string) => asset.replace(/^figma:[^/]+\/[^/]+\//, "Figma · ").split("/").pop()!;
const val = (v: unknown) => (v === undefined ? "" : v === null ? "none" : typeof v === "object" && v !== null ? JSON.stringify(v).replace(/[{}"]/g, "").replace(/,/g, ", ") : String(v));

// Layers a finding points at: its location list, plus the logo for clear-space findings.
function targets(f: Finding): string[] {
  const out = (f.location ?? "").split("; ").filter((x) => x && !/^\+\d+ more$/.test(x));
  const logo = (f.actual as { logo?: string } | undefined)?.logo;
  if (logo) out.push(logo);
  return out;
}

let sketchSeq = 0;

// A simplified drawing of a Figma frame from its layer boxes, with the layers the findings point at outlined and
// numbered, safe-area bands shaded and logo clear space drawn. Vector, so it stays small and sharp.
function sketch(sk: { w: number; h: number; layers: SketchLayer[] }, numbered: { n: number; f: Finding }[]): string {
  const id = `sk${++sketchSeq}`, k = Math.max(sk.w, sk.h) / 320;
  const byPath = new Map(sk.layers.map((l) => [l.p, l]));
  const shape = (l: SketchLayer) => {
    if (l.text !== undefined) {
      const fs = Math.max(l.size ?? 16, 1);
      return `<clipPath id="${id}c${l.x}_${l.y}"><rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}"/></clipPath>` +
        `<text x="${l.x}" y="${l.y + fs * 0.9}" font-size="${fs}" font-family="var(--font)" font-weight="700" fill="${l.color ?? "#000"}"${l.alpha !== undefined ? ` fill-opacity="${l.alpha}"` : ""} clip-path="url(#${id}c${l.x}_${l.y})">${esc(l.text)}</text>`;
    }
    const fill = l.kind === "image" ? `url(#${id}img)` : l.kind === "gradient" ? `url(#${id}grad)` : l.fill ?? "none";
    const op = l.alpha !== undefined ? ` fill-opacity="${l.alpha}"` : "";
    return l.t === "ELLIPSE"
      ? `<ellipse cx="${l.x + l.w / 2}" cy="${l.y + l.h / 2}" rx="${l.w / 2}" ry="${l.h / 2}" fill="${fill}"${op}/>`
      : `<rect x="${l.x}" y="${l.y}" width="${l.w}" height="${l.h}" fill="${fill}"${op}/>`;
  };
  const overlays: string[] = [];
  // Number badges: one per finding per layer; when two would collide (same small layer, neighbouring layers),
  // the later one slides right until it's clear.
  const placed: [number, number][] = [];
  const badge = (x: number, y: number, n: number) => {
    const r = 11 * k;
    while (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 2.1 * r)) x += 2.3 * r;
    placed.push([x, y]);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#DF3C3C" stroke="#fff" stroke-width="${1.5 * k}"/><text x="${x}" y="${y + 4.5 * k}" text-anchor="middle" font-size="${13 * k}" font-weight="800" font-family="var(--font)" fill="#fff">${n}</text>`;
  };
  const outlined = new Set<string>();
  const badges: [number, number, number][] = [];
  for (const { n, f } of numbered) {
    if (f.rule === "figma.safeArea" && f.expected && typeof f.expected === "object") {
      const m = { top: 0, bottom: 0, left: 0, right: 0, ...(f.expected as Record<string, number>) };
      const band = (x: number, y: number, w: number, h: number) => w > 0 && h > 0 ? `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#DF3C3C" fill-opacity=".18"/>` : "";
      overlays.push(band(0, 0, sk.w, m.top) + band(0, sk.h - m.bottom, sk.w, m.bottom) + band(0, m.top, m.left, sk.h - m.top - m.bottom) + band(sk.w - m.right, m.top, m.right, sk.h - m.top - m.bottom),
        `<rect x="${m.left}" y="${m.top}" width="${sk.w - m.left - m.right}" height="${sk.h - m.top - m.bottom}" fill="none" stroke="#DF3C3C" stroke-width="${1.2 * k}" stroke-dasharray="${5 * k} ${4 * k}"/>`);
    }
    const cs = f.actual as { logo?: string; clearSpacePx?: number } | undefined;
    const logo = cs?.logo && byPath.get(cs.logo);
    if (logo && cs?.clearSpacePx) {
      const p = cs.clearSpacePx;
      overlays.push(`<rect x="${logo.x - p}" y="${logo.y - p}" width="${logo.w + 2 * p}" height="${logo.h + 2 * p}" fill="none" stroke="#EC7F11" stroke-width="${1.2 * k}" stroke-dasharray="${4 * k} ${3 * k}"/>`);
    }
    for (const t of targets(f)) {
      const l = byPath.get(t);
      if (!l || l.t === "FRAME" && l.x === 0 && l.y === 0 && l.w === sk.w) continue;
      const pad = 3 * k;
      if (!outlined.has(t)) {
        outlined.add(t);
        overlays.push(`<rect x="${l.x - pad}" y="${l.y - pad}" width="${l.w + 2 * pad}" height="${l.h + 2 * pad}" rx="${4 * k}" fill="none" stroke="#DF3C3C" stroke-width="${2.2 * k}"/>`);
      }
      badges.push([l.x - pad, l.y - pad, n]);
    }
  }
  for (const [x, y, n] of badges) overlays.push(badge(x, y, n));
  return `<figure class="sketch"><svg viewBox="0 0 ${sk.w} ${sk.h}" role="img" aria-label="Simplified drawing of the frame with the flagged layers outlined">
    <defs><pattern id="${id}img" width="${24 * k}" height="${24 * k}" patternUnits="userSpaceOnUse"><rect width="${24 * k}" height="${24 * k}" fill="#8E8A94"/><path d="M0 ${24 * k}L${24 * k} 0" stroke="#B9B5BF" stroke-width="${6 * k}"/></pattern>
    <linearGradient id="${id}grad" x2="1" y2="1"><stop offset="0" stop-color="#6F6D71"/><stop offset="1" stop-color="#C2C0C4"/></linearGradient></defs>
    ${sk.layers.map(shape).join("")}${overlays.join("")}</svg>
    <figcaption>Simplified drawing from the Figma layers${sk.layers.some((l) => l.kind === "image") ? "; hatched areas are images" : ""}.</figcaption></figure>`;
}

// Colour and contrast findings get swatches: what it is next to what it should be.
function swatches(f: Finding): string {
  const chip = (hex: string, label: string) => `<span class="sw"><i style="background:${esc(hex)}"></i>${esc(label)}</span>`;
  if (f.rule === "brand.color" && typeof f.actual === "string" && Array.isArray(f.expected)) {
    const pal = (f.expected as string[]).filter((h) => /^#[0-9a-f]{6}$/i.test(h));
    const near = pal.sort((a, b) => deltaE(hexToRgb(f.actual as string), hexToRgb(a)) - deltaE(hexToRgb(f.actual as string), hexToRgb(b)))[0];
    return `<div class="sws">${chip(f.actual, `${f.actual} used`)}<span class="arrow">→</span>${near ? chip(near, `${near.toUpperCase()} brand`) : ""}</div>`;
  }
  const c = f.actual as { text?: string; background?: string } | undefined;
  if (f.rule === "text.contrast" && c?.text && c.background) {
    const fix = f.fix?.match(/#[0-9A-Fa-f]{6}/)?.[0];
    const sample = (fg: string, label: string) => `<span class="sample" data-specimen style="color:${esc(fg)};background:${esc(c.background)}">Aa</span><span class="cap">${esc(label)} · ${(Math.floor(contrastRatio(hexToRgb(fg), hexToRgb(c.background!)) * 100) / 100)}:1</span>`;
    return `<div class="sws">${sample(c.text, "now")}${fix ? `<span class="arrow">→</span>${sample(fix, "fix")}` : ""}</div>`;
  }
  return "";
}

function finding(f: Finding, n?: number): string {
  const measured = f.actual !== undefined || f.expected !== undefined
    ? `<div class="mx"><span><em>measured</em>${esc(val(f.actual) || "—")}</span><span><em>expected</em>${esc(val(f.expected) || "—")}</span></div>` : "";
  return `<li class="f ${f.severity}">
    <div class="msg">${n ? `<span class="n">${n}</span>` : ""}${f.source === "model" ? `<span class="ai" title="Suggested by a language model, not measured">AI-suggested</span>` : ""}${esc(f.message)}</div>
    ${f.location ? `<div class="loc">${esc(f.location)}</div>` : ""}
    ${measured}
    ${swatches(f)}
    ${f.fix ? `<div class="fix"><b>Fix</b> ${esc(f.fix)}</div>` : ""}
    <div class="rule">${esc(f.rule)}</div>
  </li>`;
}

function verdict(a: AssetReport): { label: string; cls: string } {
  if (a.findings.some((f) => f.severity === "error")) return { label: "Needs fixes", cls: "error" };
  if (a.findings.some((f) => f.severity === "warning")) return { label: "Fix if quick", cls: "warning" };
  if (a.findings.length) return { label: "Human look", cls: "info" };
  return { label: "Ready", cls: "ok" };
}

export interface HtmlOptions {
  title?: string;
  generatedAt?: string;
  brand?: BrandProfile; // restyles the page (loadBrand resolves its logo files to data: URIs)
}

// Most files matching no deliverable almost always means the wrong guidelines were picked: say so first.
function mismatch(r: Report): string {
  const files = r.assets.filter((a) => a.kind !== "unknown" || a.findings.some((f) => f.rule === "deliverable.unmatched"));
  const un = files.filter((a) => a.findings.some((f) => f.rule === "deliverable.unmatched")).length;
  if (files.length < 2 || un / files.length < 0.5) return "";
  return `<div class="banner">${icon("warning", 18)}<div><b>${un} of ${files.length} files don't match any deliverable in “${esc(r.project)}”.</b>
    Were these checked against the right guidelines? Unmatched files only get the naming check.</div></div>`;
}

export function renderHtml(r: Report, opts: HtmlOptions = {}): string {
  const s = r.summary, style = opts.brand?.style ?? "plain";
  const sections = GROUPS.map((g) => {
    const byAsset = r.assets.map((a) => ({ a, fs: a.findings.filter((f) => f.severity === g.sev) })).filter((x) => x.fs.length);
    if (!byAsset.length) return "";
    return `<section class="group ${g.sev}">
      <h2>${icon(g.sev, 20)}${g.title}<span class="count">${byAsset.reduce((n, x) => n + x.fs.length, 0)}</span></h2>
      <p class="blurb">${g.blurb}</p>
      ${byAsset.map(({ a, fs }) => {
        const sk = a.kind === "figma-frame" ? (a.facts as { sketch?: { w: number; h: number; layers: SketchLayer[] } }).sketch : undefined;
        let n = 0;
        const numbered = fs.map((f) => ({ f, n: sk && (targets(f).length || f.rule === "figma.safeArea") ? ++n : 0 }));
        return `<article class="asset${sk ? " has-sketch" : ""}">
        <h3>${esc(short(a.asset))}${a.deliverable ? `<span class="tag">${esc(a.deliverable)}</span>` : ""}</h3>
        ${sk ? sketch(sk, numbered.filter((x) => x.n)) : ""}
        <ul>${numbered.map(({ f, n }) => finding(f, n || undefined)).join("")}</ul>
      </article>`;
      }).join("")}
    </section>`;
  }).join("");
  const ready = r.assets.filter((a) => a.findings.length === 0);
  const readyList = ready.length ? `<section class="group ok"><h2>${icon("ok", 20)}Ready<span class="count">${ready.length}</span></h2>
      <p class="blurb">Passed every measured rule.</p>
      <ul class="checklist">${ready.map((a) => `<li>${icon("ok")}<span>${esc(short(a.asset))}</span>${a.deliverable ? `<span class="tag">${esc(a.deliverable)}</span>` : ""}</li>`).join("")}</ul></section>` : "";
  const verdicts = r.assets.map((a) => { const v = verdict(a); return `<tr><td>${esc(short(a.asset))}</td><td>${esc(a.deliverable ?? "—")}</td><td><span class="pill ${v.cls}">${icon(v.cls, 12)}${v.label}</span></td></tr>`; }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? `Preflight · ${r.project}`)}</title>
${(opts.brand?.fontCss ?? []).map((u) => `<link rel="stylesheet" href="${esc(u)}">`).join("")}
<style>
:root{${THEME}}
${BASE_CSS}
${style === "bold" ? BOLD_CSS : PLAIN_CSS}
${brandCss(opts.brand)}
</style></head><body>
<header${opts.brand?.mark ? ' class="has-mark"' : ""}>
  <div class="title">
    ${opts.brand?.logo ? `<img class="logo" src="${esc(opts.brand.logo)}" alt="${esc(opts.brand.name)}">` : ""}
    <div class="eyebrow">Preflight report</div>
    <h1>${esc(r.project)}</h1>
    <div class="sub">${s.assets} assets checked${opts.generatedAt ? ` · ${esc(opts.generatedAt)}` : ""}</div>
  </div>
  ${opts.brand?.mark ? `<img class="mark" src="${esc(opts.brand.mark)}" alt="" aria-hidden="true">` : ""}
</header>
<div class="stats">
  <div class="stat ok"><b>${s.passed}</b><span>${icon("ok", 14)}ready</span></div>
  <div class="stat error"><b>${s.errors}</b><span>${icon("error", 14)}blocking</span></div>
  <div class="stat warning"><b>${s.warnings}</b><span>${icon("warning", 14)}fix if quick</span></div>
  <div class="stat info"><b>${s.infos}</b><span>${icon("info", 14)}human look</span></div>
  <div class="stat"><b>${s.withFindings}</b><span>${icon("assets", 14)}flagged</span></div>
</div>
<main>
${mismatch(r)}
${sections || `<p>No findings: everything checked is ready.</p>`}
${readyList}
<section class="group"><h2>${icon("assets", 20)}Verdicts</h2><table>${verdicts}</table></section>
</main>
<footer>Generated by preflight ${esc(r.version)}. Every number on this page is measured by the checker; findings marked AI-suggested come from a language model and are advice, not measurements.</footer>
</body></html>`;
}
