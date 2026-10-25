import { basename } from "node:path";
import type { AssetReport, Finding, Guidelines } from "../types.ts";
import { deliverableFor, findingMaker } from "../guidelines.ts";
import { structured, type LlmConfig } from "./llm.ts";

// Judgement checks a vision model can make and code can't: logo misuse, the subject cut off by a crop, text that's
// hard to read over a photo. One call per image, with the official logo as a reference picture when given. Findings
// are advisory (source "model"): high confidence → warning, otherwise a note for a human look.

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["issues"],
  properties: { issues: { type: "array", items: { type: "object", additionalProperties: false,
    required: ["kind", "detail", "confidence"],
    properties: {
      kind: { type: "string", enum: ["logo-distorted", "logo-recoloured", "logo-effect", "subject-cut-off", "text-hard-to-read"] },
      detail: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
    } } } },
};

const RULE: Record<string, { rule: string; fix: string }> = {
  "logo-distorted": { rule: "assist.visual.logoDistorted", fix: "Scale the logo proportionally (hold Shift), never stretch it." },
  "logo-recoloured": { rule: "assist.visual.logoRecoloured", fix: "Use the official logo file in its approved colours." },
  "logo-effect": { rule: "assist.visual.logoEffect", fix: "Remove effects (shadow, glow, outline) from the logo." },
  "subject-cut-off": { rule: "assist.visual.subjectCut", fix: "Re-crop so the main subject is fully inside the frame." },
  "text-hard-to-read": { rule: "assist.visual.textLegibility", fix: "Move the text to a calmer area, add a scrim, or increase size/contrast." },
};

export async function checkVisual(cfg: LlmConfig, g: Guidelines, images: string[], referenceLogo?: string): Promise<AssetReport[]> {
  const reports: AssetReport[] = [];
  for (const img of images) {
    const make = findingMaker(g, img);
    const r = await structured<{ issues: { kind: string; detail: string; confidence: string }[] }>(cfg, {
      name: "visual_issues", schema: SCHEMA, maxTokens: 2000,
      images: referenceLogo ? [img, referenceLogo] : [img],
      system: `You check one marketing image for problems a design reviewer would reject. Report only clear problems of these kinds:
- logo-distorted: the brand logo is stretched or squashed (its proportions differ from the reference logo)
- logo-recoloured: the logo's colours differ from the reference logo
- logo-effect: the logo has an added shadow, glow, outline or other effect
- subject-cut-off: the main subject (person, product, phone) is cut by the image edge in a way that looks unintentional
- text-hard-to-read: text overlaid on the image is hard to read against what is behind it
If the image has none of these, return an empty list. Don't comment on taste or layout. Describe what you see in plain
words; do not state pixel sizes, ratios, hex values or other measurements (you can't measure them reliably; the checker
measures what can be measured).`,
      user: `Image to check: ${basename(img)}.${referenceLogo ? ` Reference (correct) logo: ${basename(referenceLogo)}.` : ""}`,
    });
    const findings: Finding[] = r.issues.filter((i) => RULE[i.kind]).map((i) => ({
      ...make(RULE[i.kind].rule, i.confidence === "high" ? "warning" : "info", i.detail, { actual: i.confidence, fix: RULE[i.kind].fix }), source: "model" as const,
    }));
    reports.push({ asset: img, kind: "image", deliverable: deliverableFor(g, basename(img))?.name, facts: {}, findings });
  }
  return reports;
}
