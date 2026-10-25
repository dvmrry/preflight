#!/usr/bin/env node
import { parseArgs } from "node:util";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { renderHtml } from "./html.ts";
import { loadBrand } from "./io.ts";
import { deliverableFor } from "./guidelines.ts";
import { loadGuidelines } from "./io.ts";
import { basename, join, resolve } from "node:path";
import { llmFromEnv, usageLine } from "./assist/llm.ts";
import { assetNames, checkSources } from "./core.ts";
import { feedbackMarkdown, mineFeedback, readComments } from "./assist/feedback.ts";
import { checkLocales } from "./assist/localize.ts";
import { checkVisual } from "./assist/visual.ts";
import { buildReport, expandPaths, sketchOf } from "./run.ts";
import type { AssetReport, Report } from "./types.ts";
import { loadFigma } from "./io.ts";

const USAGE = `usage: preflight check -g GUIDELINES.json [--json] SOURCE...
       preflight brand pack PROFILE.jsonc OUT.json   (self-contained brand profile: logo files embedded)
       preflight match -g A.json -g B.json ... SOURCE...   (which guidelines fit these files best; prints JSON)
       preflight assist feedback -g GUIDELINES.json [--out DIR] COMMENTS.csv|.json|.txt
         (model-assisted: recurring themes in past review comments, proposed rules, human checklist;
          needs PREFLIGHT_LLM_URL and PREFLIGHT_LLM_MODEL)
       preflight assist localize -g GUIDELINES.json [--html FILE] [--json] FIGMA...
         (localised frames named …_en/_fr/…: missing or untranslated text by code; wrong language, typos and
          meaning changes by the model, marked AI-suggested. Without the LLM env vars only the code checks run)
       preflight assist visual -g GUIDELINES.json [--reference LOGO.png] [--html FILE] IMAGE...
         (vision model: stretched/recoloured/effect logos, cut-off subjects, hard-to-read text; AI-suggested.
          PREFLIGHT_LLM_URL=claude-code uses Claude Code, e.g. MODEL=haiku EFFORT=low)

Checks assets against a project's guidelines and prints the findings. A SOURCE is an exported file, a folder of
them, a Figma link (needs FIGMA_TOKEN), figma:FILEKEY, or a saved Figma API response named *.figma.json.
  -g, --guidelines  the project's guidelines file (JSON)
  --json            print the full report as JSON (every measured fact; for tools)
  --compact         print a JSON report with findings only, passing assets listed by name (for pasting into a chat)
  --html FILE       also write a self-contained HTML review page (grouped, with verdicts) to FILE
  --brand FILE      brand profile (JSONC: colours, fonts, logo) that restyles the HTML page; default is neutral
Exit code: 0 no errors, 1 at least one error-severity finding, 2 bad usage or guidelines.`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { guidelines: { type: "string", short: "g", multiple: true }, json: { type: "boolean" }, compact: { type: "boolean" }, html: { type: "string" }, out: { type: "string" }, reference: { type: "string" }, brand: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  const [cmd, ...paths] = positionals;
  if (cmd === "brand" && paths[0] === "pack" && paths.length === 3) {
    try {
      writeFileSync(paths[2], JSON.stringify(loadBrand(paths[1]), null, 1) + "\n");
      return 0;
    } catch (e) { console.error((e as Error).message); return 2; }
  }
  if (cmd === "assist" && values.guidelines?.length) return assist(paths, values.guidelines[0], values);
  if (values.help || !["check", "match"].includes(cmd) || !values.guidelines?.length || paths.length === 0) {
    console.error(USAGE);
    return values.help ? 0 : 2;
  }
  if (cmd === "match") {
    try {
      const names = await assetNames(paths);
      const scores = values.guidelines.map((file) => {
        const g = loadGuidelines(file);
        return { guidelines: file, project: g.project, matched: names.filter((n) => deliverableFor(g, n)).length, of: names.length };
      }).sort((a, b) => b.matched - a.matched);
      console.log(JSON.stringify(scores, null, 2));
      return 0;
    } catch (e) {
      console.error((e as Error).message);
      return 2;
    }
  }
  let report: Report;
  try {
    const g = loadGuidelines(values.guidelines[0]);
    report = buildReport(g, await checkSources(g, paths));
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  writePage(report, values);
  console.log(values.compact ? JSON.stringify(compact(report), null, 1) : values.json ? JSON.stringify(report, null, 2) : formatText(report));
  return report.summary.errors > 0 ? 1 : 0;
}

// Findings only: what an agent needs to triage, small enough to upload for a big folder.
export function compact(r: Report) {
  return {
    tool: r.tool, version: r.version, project: r.project, summary: r.summary,
    passed: r.assets.filter((a) => a.findings.length === 0).map((a) => a.asset),
    findings: r.assets.flatMap((a) => a.findings.map(({ asset, ...f }) => ({ asset, deliverable: a.deliverable, ...f }))),
  };
}

async function assist(args: string[], guidelinesPath: string, values: { out?: string; html?: string; json?: boolean; reference?: string; brand?: string }): Promise<number> {
  const [what, ...inputs] = args;
  const out = values.out;
  try {
    const g = loadGuidelines(guidelinesPath);
    if (what === "localize" && inputs.length) {
      let cfg; try { cfg = llmFromEnv(); } catch { console.error("no model configured: running the code checks only"); }
      const assets = [], dropped: string[] = [];
      for (const src of inputs) {
        const file = await loadFigma(src);
        const r = await checkLocales(cfg, g, file.frames, file.key === "local" ? basename(src) : file.key, sketchOf);
        assets.push(...r.reports); dropped.push(...r.dropped);
      }
      const report = buildReport({ ...g, project: `${g.project} — localisation` }, assets);
      writePage(report, values);
      console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report));
      for (const d of dropped) console.error(`dropped model claim: ${d}`);
      if (cfg) console.error(usageLine());
      return 0;
    }
    if (what === "visual" && inputs.length) {
      const cfg = llmFromEnv();
      const imgs = expandPaths(inputs).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => resolve(f));
      const report = buildReport({ ...g, project: `${g.project} — visual check` }, await checkVisual(cfg, g, imgs, values.reference && resolve(values.reference)));
      writePage(report, values);
      console.log(values.json ? JSON.stringify(report, null, 2) : formatText(report));
      console.error(usageLine());
      return 0;
    }
    const cfg = llmFromEnv();
    if (what === "feedback" && inputs.length) {
      const comments = inputs.flatMap(readComments).map((c, i) => ({ ...c, id: i + 1 }));
      const r = await mineFeedback(cfg, comments, g);
      const md = feedbackMarkdown(r, g.project);
      if (out) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "feedback.md"), md);
        writeFileSync(join(out, "feedback.json"), JSON.stringify(r, null, 2));
        writeFileSync(join(out, "guidelines.proposed.json"), JSON.stringify(r.proposed, null, 2) + "\n");
      }
      console.log(md);
      console.error(usageLine());
      return 0;
    }
    console.error(USAGE);
    return 2;
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
}


type PageFlags = { html?: string; brand?: string };

// The HTML page, written the same way by every command that makes a report.
function writePage(report: Report, v: PageFlags) {
  if (!v.html) return;
  writeFileSync(v.html, renderHtml(report, {
    generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC",
    brand: v.brand ? loadBrand(v.brand) : undefined,
  }));
}


export function formatText(r: Report): string {
  const lines: string[] = [];
  const mark = { error: "✗", warning: "!", info: "·" } as const;
  for (const a of r.assets) {
    const head = `${a.asset}${a.deliverable ? `  [${a.deliverable}]` : ""}`;
    if (a.findings.length === 0) { lines.push(`✓ ${head}`); continue; }
    lines.push(`  ${head}`);
    for (const f of a.findings) lines.push(`    ${mark[f.severity]} ${f.rule}${f.source === "model" ? " [AI]" : ""}: ${f.message}${f.location ? ` (${f.location})` : ""}`);
  }
  const s = r.summary;
  lines.push("", `${r.project}: ${s.assets} assets, ${s.errors} errors, ${s.warnings} warnings, ${s.infos} notes`);
  return lines.join("\n");
}

if (import.meta.main ?? /(cli\.ts|preflight\.m?js)$/.test(process.argv[1] ?? "")) process.exitCode = await main(process.argv.slice(2));
