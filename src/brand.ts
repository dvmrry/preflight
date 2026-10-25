import { stripJsonc } from "./guidelines.ts";

// A brand profile restyles the report page, the way a guidelines file sets the rules: a small JSONC file next to its
// logo files. Without one the page uses Preflight's neutral look.
//
// {
//   "name": "Acme",
//   "logo": "logo-on-dark.svg",          // header logo (drawn on the dark header); file next to the profile, or a URL
//   "mark": "mark.svg",                  // large mark in the header, instead of the waveform bars
//   "fontCss": ["https://…/fonts.css"],  // stylesheets that provide the fonts named below
//   "fonts": { "body": "\"Acme Sans\", sans-serif", "head": "\"Acme Display\", sans-serif", "headStretch": "75%", "headCase": "uppercase" },
//   "colors": { "brand": "#FF5A1F", … },  // theme tokens (see THEME_TOKENS), light mode
//   "colorsDark": { … },                 // overrides for dark mode
//   "style": "bold"                      // optional: curved hero header, floating stats, pill headings (default "plain")
// }

export const THEME_TOKENS = ["brand", "brand-strong", "brand-soft", "brand-ink", "ink", "ink-2", "paper", "base", "chip", "line", "head",
  "head-2", "head-accent", "error", "warn", "info", "ok", "error-text", "warn-text", "info-text", "ok-text", "r-s", "r-m", "r-l", "elev"];

export interface BrandProfile {
  name: string;
  logo?: string;
  mark?: string;
  fontCss?: string[];
  fonts?: { body?: string; head?: string; headStretch?: string; headCase?: "none" | "uppercase" };
  colors?: Record<string, string>;
  colorsDark?: Record<string, string>;
  style?: "plain" | "bold";
}

const KEYS = ["name", "logo", "mark", "fontCss", "fonts", "colors", "colorsDark", "style", "notes", "$schema"];

export function validateBrand(b: any): string[] {
  const p: string[] = [];
  if (typeof b !== "object" || b === null || Array.isArray(b)) return ["must be a JSON object"];
  for (const k of Object.keys(b)) if (!KEYS.includes(k)) p.push(`unknown key "${k}" (allowed: ${KEYS.join(", ")})`);
  if (typeof b.name !== "string") p.push(`"name" must be a string`);
  if (b.style !== undefined && b.style !== "plain" && b.style !== "bold") p.push(`"style" must be "plain" or "bold"`);
  for (const k of ["logo", "mark"]) if (b[k] !== undefined && typeof b[k] !== "string") p.push(`"${k}" must be a file name or URL`);
  if (b.fontCss !== undefined && !(Array.isArray(b.fontCss) && b.fontCss.every((u: unknown) => typeof u === "string" && /^https:\/\//.test(u as string)))) p.push(`"fontCss" must be a list of https URLs`);
  for (const k of ["colors", "colorsDark"]) {
    for (const [t, v] of Object.entries(b[k] ?? {})) {
      if (!THEME_TOKENS.includes(t)) p.push(`${k}: unknown token "${t}" (tokens: ${THEME_TOKENS.join(", ")})`);
      if (typeof v !== "string" || /[;{}<>]/.test(v)) p.push(`${k}.${t}: must be a plain CSS value`);
    }
  }
  for (const [k, v] of Object.entries(b.fonts ?? {})) if (typeof v !== "string" || /[;{}<>]/.test(v)) p.push(`fonts.${k}: must be a plain CSS value`);
  return p;
}

// Parses a profile; `asset` turns a logo/mark file reference into something the page can load (a data: URI).
export function parseBrand(text: string, label: string, asset: (ref: string) => string = (r) => r): BrandProfile {
  const b = JSON.parse(stripJsonc(text));
  const problems = validateBrand(b);
  if (problems.length) throw new Error(`brand profile ${label}:\n  ${problems.join("\n  ")}`);
  const res = (ref?: string) => (!ref || /^(https?:|data:)/.test(ref) ? ref : asset(ref));
  return { ...b, logo: res(b.logo), mark: res(b.mark) };
}

// The CSS a profile adds after the default theme.
export function brandCss(b?: BrandProfile): string {
  if (!b) return "";
  const vars = (o?: Record<string, string>) => Object.entries(o ?? {}).map(([k, v]) => `--${k}:${v}`).join(";");
  const f = b.fonts ?? {};
  const font = [f.body && `--font:${f.body}`, f.head && `--font-head:${f.head}`, f.headStretch && `--head-stretch:${f.headStretch}`, f.headCase && `--head-case:${f.headCase}`].filter(Boolean).join(";");
  return `:root{${[vars(b.colors), font].filter(Boolean).join(";")}}` + (b.colorsDark ? `@media (prefers-color-scheme:dark){:root{${vars(b.colorsDark)}}}` : "");
}
