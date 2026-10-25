import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeGuidelines, readComments } from "../src/assist/feedback.ts";
import { validateGuidelines } from "../src/guidelines.ts";

const EX = new URL("../examples/", import.meta.url).pathname;

test("feedback CSV: quoted fields with commas parse into comments", () => {
  const c = readComments(EX + "feedback/history.csv");
  assert.equal(c.length, 40);
  assert.equal(c[0].text, "logo feels tiny here, can we bump the store badges? they're unreadable on phones");
  assert.equal(c[0].campaign, "spring-mix");
});

test("merging a proposal: deliverables and logos by name, lists unioned, result still validates", () => {
  const base = { project: "p", brand: { palette: ["#000000"], logos: [{ name: "Badge", match: "B*", minHeight: 30 }] },
    deliverables: [{ name: "Story", match: "*_story_*", width: 1080 }] };
  const patch = { brand: { palette: ["#FFFFFF"], logos: [{ name: "Badge", match: "B*", minHeight: 40 }] },
    deliverables: [{ name: "Story", match: "*_story_*", colorMode: ["rgb"] }, { name: "Banner", match: "*banner*", width: 1200 }] };
  const m = mergeGuidelines(base, patch) as any;
  assert.deepEqual(m.brand.palette, ["#000000", "#FFFFFF"]);
  assert.equal(m.brand.logos.length, 1);
  assert.equal(m.brand.logos[0].minHeight, 40);
  assert.deepEqual(m.deliverables.map((d: any) => d.name), ["Story", "Banner"]);
  assert.equal(m.deliverables[0].width, 1080);
  assert.deepEqual(m.deliverables[0].colorMode, ["rgb"]);
  assert.deepEqual(validateGuidelines(m), []);
  assert.equal(JSON.stringify(mergeGuidelines(base, { brand: { palette: ["#000000"] } })), JSON.stringify(base)); // "already enforced"
});

test("localize, code part: missing layers and untranslated text are found without any model", async () => {
  const { loadFigma } = await import("../src/io.ts");
  const { localeGroups, structuralFindings } = await import("../src/assist/localize.ts");
  const { findingMaker } = await import("../src/guidelines.ts");
  const f = await loadFigma(EX + "localize/campaign-locales.figma.json");
  const [g] = localeGroups(f.frames);
  assert.deepEqual(g.frames.map((x) => x.locale), ["en", "de", "fr"]); // reference first
  const by = structuralFindings(g, (a) => findingMaker({ project: "t" }, a));
  const rules = (name: string) => (by.get(name) ?? []).map((x) => `${x.rule}:${x.location?.split(" / ").pop()}`).sort();
  assert.deepEqual(rules("tunewell_fall_ig-story_v1_de"), ["locale.untranslated:Kicker"]);
  assert.deepEqual(rules("tunewell_fall_ig-story_v1_fr"), ["locale.missingLayer:tunewell_fall_ig-story_v1_fr", "locale.untranslated:Headline"]);
});
