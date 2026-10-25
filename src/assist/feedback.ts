import { readFileSync } from "node:fs";
import { extname } from "node:path";
import type { Guidelines } from "../types.ts";
import { validateGuidelines } from "../guidelines.ts";
import { structured, type LlmConfig } from "./llm.ts";

// Mines past review comments for what reviewers keep flagging, and turns the measurable part into guideline rules the
// checker can enforce. The model groups and drafts; the code counts, merges, validates and labels. Nothing proposed is
// applied unless a person adopts the proposed guidelines file.

export interface Comment { id: number; text: string; asset?: string; campaign?: string; reviewer?: string; date?: string }

export interface Theme { title: string; summary: string; checkable: boolean; capability: string; comments: Comment[] }
export interface Proposal { theme: string; rationale: string; patch: unknown; status: "valid" | "invalid" | "already enforced" | "unparseable"; problems: string[] }
export interface FeedbackResult { comments: number; themes: Theme[]; proposals: Proposal[]; proposed: Guidelines; dropped: string[]; ungrouped: Comment[] }

// What the checker can measure, by guidelines key, so the model can tell checkable themes from judgement calls.
export const CAPABILITIES = `
naming.pattern — file/frame naming convention (regex)
deliverables[].width/height/sizes/minWidth/maxWidth/minHeight/maxHeight/aspect/maxLongToShort/anyOrientation — pixel size rules
deliverables[].formats, maxBytes — file type and size limit
deliverables[].colorProfile, colorMode, transparency — sRGB/P3, RGB/CMYK, alpha required/forbidden
deliverables[].safeArea {top,bottom,left,right} — Figma: text must stay out of these margins (px)
deliverables[].video {fps,maxFps,codec,minDurationS,maxDurationS,audio,audioCodec,audioChannels,audioSampleRates,minAudioBitrateKbps,loudness{targetLufs,tolerance,maxTruePeakDb},maxBlackAtEdgesS}
brand.palette (+paletteTolerance, CIEDE2000, default 1.0) — colours must be palette colours
brand.fonts — allowed font families (Figma)
brand.minTextSize — minimum text size px (Figma)
brand.minContrast — WCAG contrast of text against what is behind it (Figma)
brand.logos[] {name, match (layer-name glob), minHeight, minWidth, clearSpace} — logo/badge size and clear space (Figma)
NOT measurable by the checker: wording, tone, translation quality, spelling, which UI version is shown, photo crops, logo effects/distortion, design quality.`.trim();

export function readComments(path: string): Comment[] {
  const raw = readFileSync(path, "utf8");
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    const arr = JSON.parse(raw) as Record<string, unknown>[];
    return arr.map((o, i) => ({ id: i + 1, text: String(o.comment ?? o.text ?? o.message ?? ""), asset: o.asset as string, campaign: o.campaign as string, reviewer: o.reviewer as string, date: o.date as string })).filter((c) => c.text);
  }
  if (ext === ".csv") {
    const rows = parseCsv(raw);
    const head = rows.shift()!.map((h) => h.trim().toLowerCase());
    const col = (names: string[]) => head.findIndex((h) => names.includes(h));
    const [ci, ai, ki, ri, di] = [col(["comment", "feedback", "text", "note"]), col(["asset", "file"]), col(["campaign", "project"]), col(["reviewer", "author", "who"]), col(["date"])];
    if (ci < 0) throw new Error(`${path}: needs a "comment" column`);
    return rows.filter((r) => r[ci]?.trim()).map((r, i) => ({ id: i + 1, text: r[ci].trim(), asset: r[ai], campaign: r[ki], reviewer: r[ri], date: r[di] }));
  }
  return raw.split("\n").map((l) => l.replace(/^[-*•]\s*/, "").trim()).filter(Boolean).map((text, i) => ({ id: i + 1, text }));
}

// RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes.
function parseCsv(s: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

const THEMES_SCHEMA = {
  type: "object", additionalProperties: false, required: ["themes"],
  properties: { themes: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["title", "summary", "commentIds", "checkable", "capability"],
    properties: {
      title: { type: "string" }, summary: { type: "string" },
      commentIds: { type: "array", items: { type: "integer" } },
      checkable: { type: "boolean" },
      capability: { type: "string" },
    } } } },
};

const PROPOSALS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["proposals"],
  properties: { proposals: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["theme", "patchJson", "rationale"],
    properties: { theme: { type: "string" }, patchJson: { type: "string" }, rationale: { type: "string" } } } } },
};

export async function mineFeedback(cfg: LlmConfig, comments: Comment[], current: Guidelines): Promise<FeedbackResult> {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const listing = comments.map((c) => `#${c.id} [${[c.campaign, c.asset, c.reviewer].filter(Boolean).join(" · ")}] ${c.text}`).join("\n");

  const THEME_RULES = `You analyse design review feedback for a design team. Group the comments into themes: the same kind of issue,
even if worded differently. Judgement issues (translation, spelling, tone, crops, logo misuse, outdated UI) are themes too,
just as important as measurable ones. A theme may be a single comment if it states a clear rule. Every theme cites the exact
comment ids it is based on. Mark a theme checkable only if one of the checker capabilities below can measure it, and name
that capability; otherwise checkable=false and capability "none". Leave out only pure praise.

Checker capabilities:
${CAPABILITIES}`;
  const ask = (subset: Comment[]) => structured<{ themes: { title: string; summary: string; commentIds: number[]; checkable: boolean; capability: string }[] }>(cfg, {
    name: "themes", schema: THEMES_SCHEMA, system: THEME_RULES,
    user: `Comments:\n${subset.map((c) => `#${c.id} [${[c.campaign, c.asset, c.reviewer].filter(Boolean).join(" · ")}] ${c.text}`).join("\n")}`,
    maxTokens: 12000,
  });

  const dropped: string[] = [];
  const toThemes = (raw: Awaited<ReturnType<typeof ask>>["themes"]): Theme[] => raw.map((th) => {
    const cited = [...new Set(th.commentIds)].filter((id) => byId.has(id) || (dropped.push(`theme "${th.title}" cited unknown comment #${id}`), false));
    return { title: th.title, summary: th.summary, checkable: th.checkable, capability: th.capability, comments: cited.map((id) => byId.get(id)!) };
  }).filter((th) => th.comments.length > 0);

  // First pass over everything; then a second pass over whatever no theme cited, so nothing silently disappears.
  let themes = toThemes((await ask(comments)).themes);
  const covered = () => new Set(themes.flatMap((th) => th.comments.map((c) => c.id)));
  let left = comments.filter((c) => !covered().has(c.id));
  if (left.length) {
    themes = themes.concat(toThemes((await ask(left)).themes));
    left = comments.filter((c) => !covered().has(c.id));
  }
  themes.sort((a, b) => b.comments.length - a.comments.length);

  const checkable = themes.filter((th) => th.checkable);
  const proposals: Proposal[] = [];
  let proposed: Guidelines = structuredClone(current);
  if (checkable.length) {
    const p = await structured<{ proposals: { theme: string; patchJson: string; rationale: string }[] }>(cfg, {
      name: "proposals", schema: PROPOSALS_SCHEMA,
      system: `You turn recurring design-review themes into changes to a guidelines JSON file that a deterministic checker enforces.
For each theme give patchJson: a JSON object (as a string) holding ONLY the keys to add or change, in the same shape as the
guidelines file. Deliverables and logos are matched by "name": reuse an existing name to change it, or add a new one with
"name" and "match". Use only keys from the capabilities list. If the current guidelines already enforce the theme, return
the patch that would enforce it anyway (it will be detected as already enforced). Prefer values stated in the comments.

Capabilities:
${CAPABILITIES}`,
      user: `Current guidelines:\n${JSON.stringify(current, null, 1)}\n\nThemes:\n${checkable.map((th) => `- ${th.title} (${th.comments.length} comments, capability ${th.capability}): ${th.summary}\n  e.g. ${th.comments.slice(0, 3).map((c) => JSON.stringify(c.text)).join(" | ")}`).join("\n")}`,
      maxTokens: 12000,
    });
    for (const pr of p.proposals) {
      let patch: unknown;
      try { patch = JSON.parse(pr.patchJson); } catch { proposals.push({ theme: pr.theme, rationale: pr.rationale, patch: pr.patchJson, status: "unparseable", problems: ["patch is not JSON"] }); continue; }
      const merged = mergeGuidelines(proposed, patch);
      const problems = validateGuidelines(merged);
      const same = JSON.stringify(merged) === JSON.stringify(proposed);
      const status = problems.length ? "invalid" : same ? "already enforced" : "valid";
      if (status === "valid") proposed = merged as Guidelines;
      proposals.push({ theme: pr.theme, rationale: pr.rationale, patch, status, problems });
    }
  }
  return { comments: comments.length, themes, proposals, proposed, dropped, ungrouped: left };
}

// Deep merge for guidelines: objects merge, deliverables/logos merge by name, palette/fonts and other string lists union,
// scalars and other arrays replace.
export function mergeGuidelines(base: unknown, patch: unknown): unknown {
  if (Array.isArray(base) && Array.isArray(patch)) {
    const named = (a: unknown[]) => a.every((x) => x && typeof x === "object" && "name" in (x as object));
    if (named(base) && named(patch)) {
      const out = base.map((x) => structuredClone(x));
      for (const p of patch as { name: string }[]) {
        const i = out.findIndex((x) => (x as { name: string }).name === p.name);
        if (i >= 0) out[i] = mergeGuidelines(out[i], p); else out.push(structuredClone(p));
      }
      return out;
    }
    if (base.every((x) => typeof x === "string") && patch.every((x) => typeof x === "string")) return [...new Set([...base, ...patch])];
    return structuredClone(patch);
  }
  if (base && patch && typeof base === "object" && typeof patch === "object" && !Array.isArray(base) && !Array.isArray(patch)) {
    const out: Record<string, unknown> = structuredClone(base as Record<string, unknown>);
    for (const [k, v] of Object.entries(patch as Record<string, unknown>)) out[k] = k in out ? mergeGuidelines(out[k], v) : structuredClone(v);
    return out;
  }
  return structuredClone(patch);
}

export function feedbackMarkdown(r: FeedbackResult, project: string): string {
  const L: string[] = [];
  L.push(`# What reviewers keep flagging — ${project}`, "", `${r.comments} comments, ${r.themes.length} themes, ${r.comments - r.ungrouped.length} comments grouped. Themes and drafts are model-made; counts, coverage and rule checks are not.`, "");
  L.push("## Themes", "", "| # | theme | comments | the checker can enforce it? |", "|---|---|---|---|");
  r.themes.forEach((th, i) => L.push(`| ${i + 1} | ${th.title} | ${th.comments.length} | ${th.checkable ? `yes (${th.capability})` : "no — human checklist"} |`));
  L.push("", "## Proposed rules (adopt by reviewing the proposed guidelines file)", "");
  if (!r.proposals.length) L.push("None.");
  for (const p of r.proposals) {
    L.push(`- **${p.theme}** — ${p.status}${p.problems.length ? `: ${p.problems.join("; ")}` : ""}`, `  - ${p.rationale}`, `  - \`${JSON.stringify(p.patch)}\``);
  }
  const human = r.themes.filter((th) => !th.checkable);
  L.push("", "## Human checklist (the checker can't measure these)", "");
  for (const th of human) L.push(`- [ ] **${th.title}** — ${th.summary} _(${th.comments.length}× e.g. "${th.comments[0].text}")_`);
  if (r.ungrouped.length) L.push("", `## Not grouped (${r.ungrouped.length}) — read these yourself`, "", ...r.ungrouped.map((c) => `- #${c.id} ${c.text}`));
  if (r.dropped.length) L.push("", "## Dropped model claims", "", ...r.dropped.map((d) => `- ${d}`));
  return L.join("\n");
}
