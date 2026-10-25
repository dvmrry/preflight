import type { AssetReport, Finding, Guidelines } from "../types.ts";
import type { FigmaFrame } from "../formats/figma.ts";
import { findingMaker } from "../guidelines.ts";
import { structured, type LlmConfig } from "./llm.ts";

// Localised variants of a frame (…_en, …_fr, …_de) side by side. Code finds what's structurally wrong (a layer one
// locale lacks, text left identical to the reference); the model reads the words (wrong language, typos, meaning that
// changed). Model findings are marked source "model" and never block.

const LOCALE = /[_-]([a-z]{2}(?:-[a-z]{2})?)$/i;

export interface LocaleGroup { base: string; frames: { locale: string; frame: FigmaFrame; texts: Map<string, { path: string; text: string }> }[] }

export function localeGroups(frames: FigmaFrame[], reference = "en"): LocaleGroup[] {
  const groups = new Map<string, LocaleGroup>();
  for (const fr of frames) {
    const m = fr.name.match(LOCALE);
    if (!m) continue;
    const base = fr.name.slice(0, m.index);
    const texts = new Map<string, { path: string; text: string }>();
    for (const e of fr.elements) if (e.text && e.text.characters.trim()) texts.set(e.name, { path: e.path, text: e.text.characters });
    const g = groups.get(base) ?? { base, frames: [] };
    g.frames.push({ locale: m[1].toLowerCase(), frame: fr, texts });
    groups.set(base, g);
  }
  // Reference locale first, so it's what the others are compared with.
  for (const g of groups.values()) g.frames.sort((a, b) => (a.locale === reference ? -1 : b.locale === reference ? 1 : a.locale.localeCompare(b.locale)));
  return [...groups.values()].filter((g) => g.frames.length > 1);
}

// Deterministic: layers the reference has and a locale lacks; text identical to the reference (left untranslated).
export function structuralFindings(g: LocaleGroup, make: (asset: string) => ReturnType<typeof findingMaker>): Map<string, Finding[]> {
  const out = new Map<string, Finding[]>();
  const [ref, ...rest] = g.frames;
  for (const f of rest) {
    const list: Finding[] = [];
    const mk = make(f.frame.name);
    for (const [layer, r] of ref.texts) {
      const t = f.texts.get(layer);
      if (!t) {
        list.push(mk("locale.missingLayer", "error", `The ${ref.locale.toUpperCase()} version has a "${layer}" text ("${r.text.slice(0, 50)}") that the ${f.locale.toUpperCase()} version doesn't.`,
          { location: `${f.frame.name}`, expected: r.text, actual: null, fix: `Add the ${layer} text, translated for ${f.locale.toUpperCase()}.` }));
      } else if (t.text.trim() === r.text.trim() && /[a-z]{3}/i.test(t.text)) {
        list.push(mk("locale.untranslated", "warning", `"${t.text.slice(0, 50)}" is identical to the ${ref.locale.toUpperCase()} text: probably not translated.`,
          { location: t.path, expected: `${f.locale.toUpperCase()} copy`, actual: t.text }));
      }
    }
    out.set(f.frame.name, list);
  }
  return out;
}

const ISSUES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["issues"],
  properties: { issues: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["locale", "layer", "kind", "detail", "suggestion"],
    properties: {
      locale: { type: "string" }, layer: { type: "string" },
      kind: { type: "string", enum: ["wrong-language", "typo", "meaning-change", "missing-information"] },
      detail: { type: "string" }, suggestion: { type: "string" },
    } } } },
};

const RULE: Record<string, string> = { "wrong-language": "assist.locale.wrongLanguage", typo: "assist.locale.typo", "meaning-change": "assist.locale.meaning", "missing-information": "assist.locale.missingInfo" };

export async function modelFindings(cfg: LlmConfig, g: LocaleGroup, make: (asset: string) => ReturnType<typeof findingMaker>, dropped: string[]): Promise<Map<string, Finding[]>> {
  const [ref] = g.frames;
  const listing = g.frames.map((f) => `## ${f.locale}${f === ref ? " (reference)" : ""}\n` + [...f.texts].map(([layer, t]) => `- ${layer}: ${JSON.stringify(t.text)}`).join("\n")).join("\n\n");
  const r = await structured<{ issues: { locale: string; layer: string; kind: string; detail: string; suggestion: string }[] }>(cfg, {
    name: "locale_issues", schema: ISSUES_SCHEMA, maxTokens: 6000,
    system: `You review the text of one marketing design in several languages. The reference version is "${ref.locale}". For each
other locale, report only real problems: text in the wrong language, spelling mistakes, a meaning that differs from the
reference (numbers, dates, prices, conditions, names), or information the reference has that is missing. Brand and product
names (Tunewell, Mix) stay as they are. Do not report style preferences or acceptable translation choices. Quote the exact
layer name. If a locale has no problems, report nothing for it.`,
    user: listing,
  });
  const out = new Map<string, Finding[]>();
  for (const is of r.issues) {
    const f = g.frames.find((x) => x.locale === is.locale.toLowerCase());
    const t = f?.texts.get(is.layer);
    if (!f || f === ref) { dropped.push(`${g.base}: issue for unknown or reference locale "${is.locale}"`); continue; }
    if (!t && is.kind !== "missing-information") { dropped.push(`${g.base}_${is.locale}: issue on unknown layer "${is.layer}"`); continue; }
    const list = out.get(f.frame.name) ?? [];
    list.push({ ...make(f.frame.name)(RULE[is.kind] ?? "assist.locale.meaning", is.kind === "typo" || is.kind === "wrong-language" ? "warning" : "info",
      `${is.detail}`, { location: t?.path ?? f.frame.name, actual: t?.text, fix: is.suggestion }), source: "model" });
    out.set(f.frame.name, list);
  }
  return out;
}

export async function checkLocales(cfg: LlmConfig | undefined, g: Guidelines, frames: FigmaFrame[], label: string, sketch: (fr: FigmaFrame) => unknown): Promise<{ reports: AssetReport[]; dropped: string[] }> {
  const dropped: string[] = [];
  const make = (frameName: string) => findingMaker(g, `figma:${label}/${frameName}`);
  const reports: AssetReport[] = [];
  for (const grp of localeGroups(frames)) {
    const det = structuralFindings(grp, make);
    const mod = cfg ? await modelFindings(cfg, grp, make, dropped) : new Map<string, Finding[]>();
    for (const f of grp.frames) {
      const fs = [...(det.get(f.frame.name) ?? []), ...dedupe(mod.get(f.frame.name) ?? [], det.get(f.frame.name) ?? [])];
      reports.push({ asset: `figma:${label}/${f.frame.page}/${f.frame.name}`, kind: "figma-frame", deliverable: `Locale ${f.locale.toUpperCase()}`,
        facts: { locale: f.locale, reference: grp.frames[0].locale, texts: f.texts.size, sketch: sketch(f.frame) }, findings: fs });
    }
  }
  return { reports, dropped };
}

// Model findings that repeat what the code already found add nothing; keep the deterministic ones.
function dedupe(model: Finding[], det: Finding[]): Finding[] {
  const untranslated = new Set(det.filter((d) => d.rule === "locale.untranslated").map((d) => d.location));
  const missing = det.filter((d) => d.rule === "locale.missingLayer").map((d) => String(d.expected));
  return model.filter((m) =>
    !(m.rule === "assist.locale.wrongLanguage" && untranslated.has(m.location)) &&
    !(m.rule === "assist.locale.missingInfo" && missing.some((t) => m.message.includes(t.slice(0, 20)) || m.location === det[0]?.location)));
}
