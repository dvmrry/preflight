import { test } from "node:test";
import assert from "node:assert/strict";
import { contrastRatio, deltaE, hexToRgb, rgbToHex, type RGB } from "../src/color.ts";
import { loadFigma } from "../src/io.ts";
import { checkFigma } from "../src/run.ts";
import { loadGuidelines } from "../src/io.ts";

const EX = new URL("../examples/spring-launch/", import.meta.url).pathname;

test("colour maths matches WCAG and Lab reference points", () => {
  assert.equal(+contrastRatio(hexToRgb("#000000"), hexToRgb("#FFFFFF")).toFixed(1), 21);
  assert.equal(+contrastRatio(hexToRgb("#777777"), hexToRgb("#FFFFFF")).toFixed(2), 4.48); // the classic just-fails grey
  assert.equal(deltaE(hexToRgb("#FF5A1F"), hexToRgb("#FF5A1F")), 0);
  assert.ok(deltaE(hexToRgb("#000000"), hexToRgb("#FFFFFF")) > 99);
});

test("text background: a sibling shape under the text counts, an image is flagged, hidden pages are skipped", async () => {
  const f = await loadFigma(EX + "campaign.figma.json");
  assert.deepEqual(f.frames.map((fr) => fr.name), ["acme-spring_ig-feed_hero", "acme-spring_banner", "acme-spring_logo"]);
  const text = (frame: number, layer: string) => f.frames[frame].elements.find((e) => e.path.endsWith(layer))!.text!;
  const hex = (c: unknown) => rgbToHex(c as RGB);
  assert.equal(hex(text(0, "CTA").background), "#FF6A2F"); // drawn on the badge, not the cream frame
  assert.equal(hex(text(0, "Legal").background), "#F4E9DA");
  assert.equal(text(1, "Caption").background, "image");
});

test("the dummy campaign raises exactly the planted problems", async () => {
  const g = loadGuidelines(new URL("../examples/projects/acme-spring.json", import.meta.url).pathname);
  const reports = await checkFigma(g, EX + "campaign.figma.json");
  const got = reports.map((r) => [r.asset.split("/").pop(), r.findings.map((f) => f.rule).sort()]);
  assert.deepEqual(got, [
    ["acme-spring_ig-feed_hero", ["brand.color", "brand.color", "brand.font", "text.contrast", "text.contrast", "text.noStyle", "text.size"]],
    ["acme-spring_banner", ["figma.frameSize", "text.contrastUnchecked"]],
    ["acme-spring_logo", []],
  ]);
});

test("CIEDE2000 matches Sharma et al. 2005 test pairs", async () => {
  const { deltaE2000 } = await import("../src/color.ts");
  const pairs: [number[], number[], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[90.8027, -2.0831, 1.441], [91.1528, -1.6435, 0.0447], 1.4441],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [a, b, want] of pairs) assert.equal(+deltaE2000(a, b).toFixed(4), want, `${a} vs ${b}`);
});
