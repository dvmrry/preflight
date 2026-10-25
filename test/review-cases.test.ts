// Regression tests for the defects found by the adversarial reviews (Haiku and Sonnet, 2026-10-24).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkFigma, checkFile, expandPaths } from "../src/run.ts";
import { parseFigmaSource } from "../src/formats/figma.ts";
import { probeImage, iccFacts } from "../src/formats/image.ts";
import type { Guidelines } from "../src/types.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "ar-test-"));
const EX = new URL("../examples/spring-launch/exports/", import.meta.url).pathname;

// --- Figma ---------------------------------------------------------------------------------------------------

const c = (h: string, a = 1) => { const n = parseInt(h.slice(1), 16); return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a }; };
const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const solid = (h: string, extra = {}) => ({ type: "SOLID", color: c(h), ...extra });
const rect = (name: string, b: object, fills: object[], extra = {}) => ({ id: name, name, type: "RECTANGLE", absoluteBoundingBox: b, fills, ...extra });
const text = (name: string, chars: string, b: object, fill: object, style = { fontFamily: "Inter", fontSize: 16, fontWeight: 400 }, extra = {}) =>
  ({ id: name, name, type: "TEXT", characters: chars, absoluteBoundingBox: b, fills: [fill], style, styles: { text: "S" }, ...extra });
const frame = (name: string, kids: object[], extra = {}) =>
  ({ id: name, name, type: "FRAME", absoluteBoundingBox: box(0, 0, 400, 400), fills: [solid("#FFFFFF")], children: kids, ...extra });
const fileOf = (pageKids: object[]) => ({ name: "t", document: { children: [{ id: "0:1", name: "Page", type: "CANVAS", children: pageKids }] } });
const G: Guidelines = { project: "t", brand: { fonts: ["Inter"], minTextSize: 12, minContrast: 4.5 } };

async function figmaRules(pageKids: object[], g = G) {
  const dir = tmp(), p = join(dir, "f.figma.json");
  writeFileSync(p, JSON.stringify(fileOf(pageKids)));
  return (await checkFigma(g, p)).map((r) => [r.asset.split("/").pop(), r.findings.map((f) => f.rule).filter((x) => x !== "deliverable.unmatched").sort()]);
}

test("frames inside a Section are found; non-frame top-level layers are reported as not checked", async () => {
  const got = await figmaRules([
    { id: "s", name: "Sec", type: "SECTION", children: [frame("Post A", [text("T", "hi", box(10, 10, 100, 20), solid("#000000"), { fontFamily: "Comic Sans MS", fontSize: 8, fontWeight: 400 })])] },
    text("Loose note", "todo", box(900, 0, 50, 20), solid("#000000")),
  ]);
  assert.deepEqual(got, [["Post A", ["brand.font", "text.size"]], ["figma:f.figma.json", ["figma.notChecked"]]]);
});

test("a gradient or image under text is a human look, not a false contrast error", async () => {
  const got = await figmaRules([frame("F", [
    rect("grad", box(0, 0, 400, 100), [{ type: "GRADIENT_LINEAR", gradientStops: [] }]),
    text("on grad", "white on dark gradient", box(10, 10, 200, 20), solid("#FFFFFF")),
    rect("photo", box(0, 200, 400, 100), [solid("#FFFFFF"), { type: "IMAGE", imageRef: "x" }]), // image on top of a white fill
    text("on photo", "caption", box(10, 210, 200, 20), solid("#FFFFFF")),
  ])]);
  assert.deepEqual(got, [["F", ["text.contrastUnchecked", "text.contrastUnchecked"]]]);
});

test("text that only partly overlaps a shape, or sits on an ellipse, is not judged against the frame", async () => {
  const got = await figmaRules([frame("F", [
    rect("bar", box(0, 0, 100, 50), [solid("#000000")]),
    text("half", "black text half on a black bar", box(0, 10, 300, 20), solid("#111111")),
    { ...rect("dot", box(0, 200, 300, 100), [solid("#000000")]), type: "ELLIPSE" },
    text("on dot", "on an ellipse", box(10, 210, 200, 20), solid("#111111")),
  ])]);
  assert.deepEqual(got, [["F", ["text.contrastUnchecked", "text.contrastUnchecked"]]]);
});

test("faint text fails contrast: fill opacity, colour alpha and a parent's opacity all count", async () => {
  const got = await figmaRules([frame("F", [
    text("fill op", "a", box(10, 10, 100, 20), solid("#000000", { opacity: 0.2 })),
    { id: "g", name: "faded", type: "GROUP", absoluteBoundingBox: box(0, 100, 400, 50), opacity: 0.2,
      children: [text("in group", "b", box(10, 110, 100, 20), solid("#000000"))] },
    text("alpha", "c", box(10, 200, 100, 20), { type: "SOLID", color: c("#000000", 0.2) }),
    text("solid", "d", box(10, 300, 100, 20), solid("#000000")), // passes
  ])]);
  assert.deepEqual(got, [["F", ["text.contrast", "text.contrast", "text.contrast"]]]);
});

test("each style inside a text layer is checked: an overridden word in another font, size and colour", async () => {
  const t = text("mixed", "Hello world", box(10, 10, 300, 20), solid("#000000"), { fontFamily: "Inter", fontSize: 16, fontWeight: 400 },
    { characterStyleOverrides: [0, 0, 0, 0, 0, 0, 7, 7, 7, 7, 7], styleOverrideTable: { 7: { fontFamily: "Comic Sans MS", fontSize: 6, fills: [solid("#EEEEEE")] } } });
  const got = await figmaRules([frame("F", [t])]);
  assert.deepEqual(got, [["F", ["brand.font", "text.contrast", "text.size"]]]);
});

test("rotated frame: size from the frame itself, plus a warning", async () => {
  const g: Guidelines = { project: "t", deliverables: [{ name: "Post", match: "F", width: 400, height: 400 }] };
  const got = await figmaRules([frame("F", [], { size: { x: 400, y: 400 }, absoluteBoundingBox: box(0, 0, 566, 566), rotation: 45 })], g);
  assert.deepEqual(got, [["F", ["figma.rotated"]]]);
});

test("Figma links: branches are their own file; node-id narrows the check", () => {
  assert.deepEqual(parseFigmaSource("https://www.figma.com/design/MAIN123/branch/BR456/Name?node-id=12-34"), { key: "BR456", nodeId: "12:34" });
  assert.deepEqual(parseFigmaSource("https://www.figma.com/design/ABC/Name"), { key: "ABC", nodeId: undefined });
  assert.equal(parseFigmaSource("https://evil.example/figma.com/design/ABC"), undefined);
  assert.equal(parseFigmaSource("/tmp/figma.com/design/x.json"), undefined);
});

// --- files -----------------------------------------------------------------------------------------------------

const G2: Guidelines = { project: "t", deliverables: [{ name: "Feed", match: "*feed*", width: 1080, height: 1350 }] };

test("a damaged file is a finding, and the rest of the folder is still checked", async () => {
  const dir = tmp();
  const png = readFileSync(EX + "acme-spring_logo_v2.png");
  writeFileSync(join(dir, "feed_a.png"), png.subarray(0, 20)); // cut inside IHDR
  writeFileSync(join(dir, "feed_b.png"), png.subarray(0, Math.floor(png.length / 2))); // cut inside the pixels
  const jpg = readFileSync(EX + "acme-spring_ig-feed_v3.jpg");
  writeFileSync(join(dir, "feed_c.jpg"), jpg.subarray(0, 600));
  symlinkSync(join(dir, "missing.png"), join(dir, "feed_d.png")); // dangling
  const rules = await Promise.all(expandPaths([dir]).map(async (p) => (await checkFile(G2, p)).findings.map((f) => f.rule).filter((r) => r !== "image.dimensions")));
  assert.deepEqual(rules, [["image.damaged"], ["image.damaged"], ["image.damaged"], ["file.unreadable"]]);
});

test("an extensionless export is identified by content and checked", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "feed_v1"), readFileSync(EX + "acme-spring_logo_v2.png"));
  const r = await checkFile(G2, join(dir, "feed_v1"));
  assert.equal(r.kind, "image");
  assert.deepEqual(r.findings.map((f) => f.rule).sort(), ["image.dimensions", "image.extension"]);
  writeFileSync(join(dir, "feed_v2.bin"), "not an image");
  assert.deepEqual((await checkFile(G2, join(dir, "feed_v2.bin"))).findings.map((f) => f.rule), ["file.unrecognized"]);
});

test("symlink loops don't hang the folder walk", () => {
  const dir = tmp();
  mkdirSync(join(dir, "a"));
  writeFileSync(join(dir, "a", "x.png"), "x");
  symlinkSync("..", join(dir, "a", "up"));
  assert.deepEqual(expandPaths([dir]).map((p) => p.slice(dir.length)), ["/a/x.png"]);
});

test("JPEG: EXIF orientation gives displayed size; fill bytes before markers are fine", () => {
  const exif = Buffer.from("457869660000" + "4d4d002a00000008" + "0001" + "011200030000000100060000" + "00000000", "hex"); // big-endian, orientation 6
  const seg = (m: number, d: Buffer) => Buffer.concat([Buffer.from([0xff, m, (d.length + 2) >> 8, (d.length + 2) & 255]), d]);
  const sof = seg(0xc0, Buffer.from([8, 0x04, 0x38, 0x07, 0x80, 3])); // h=1080, w=1920
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), seg(0xe1, exif), Buffer.from([0xff, 0xff]), sof, seg(0xda, Buffer.from([0])), Buffer.from([0, 0, 0xff, 0xd9])]);
  const f = probeImage(jpg);
  assert.deepEqual([f.width, f.height, f.orientation, f.truncated], [1080, 1920, 6, undefined]);
});

test("ICC: an absurd tag count doesn't spin; a profile with no name still counts as embedded", () => {
  const p = Buffer.alloc(200); p.write("RGB ", 16, "latin1"); p.writeUInt32BE(0xffffffff, 128);
  const t = performance.now();
  assert.deepEqual(iccFacts(p), { iccColorSpace: "RGB" });
  assert.ok(performance.now() - t < 20);
});

test("fixes: deterministic, and the contrast fix is a palette colour that actually passes on that background", async () => {
  const g: Guidelines = { project: "t", brand: { palette: ["#F4E9DA", "#1B1B1F", "#FF5A1F"], minContrast: 4.5 } };
  const dir = tmp(), p = join(dir, "f.figma.json");
  writeFileSync(p, JSON.stringify(fileOf([{ ...frame("F", [text("legal", "small print", box(10, 10, 100, 20), solid("#B8B0A4"))]), fills: [solid("#F4E9DA")] }])));
  const f = (await checkFigma(g, p))[0].findings.find((x) => x.rule === "text.contrast")!;
  assert.match(f.fix!, /^Change the text to #1B1B1F \(/); // never the background colour itself
  const none = await checkFigma({ ...g, brand: { palette: ["#F4E9DA"], minContrast: 4.5 } }, p);
  assert.match(none[0].findings.find((x) => x.rule === "text.contrast")!.fix!, /No palette colour passes/);
});

test("anyOrientation: a landscape App Store screenshot matches a portrait size; other sizes still fail", async () => {
  const { sizeProblem } = await import("../src/checks/size.ts");
  const d = { name: "iPad", match: "*", sizes: [[2048, 2732]] as [number, number][], anyOrientation: true };
  assert.equal(sizeProblem(d, 2732, 2048), undefined);
  assert.equal(sizeProblem({ ...d, anyOrientation: false }, 2732, 2048)?.swapped, true);
  assert.match(sizeProblem(d, 2000, 2700)!.why, /portrait or landscape/);
});

test("video: no rule needing a decode means no decode; black-frame windows find the same edge as a full decode", async () => {
  const { probeVideo } = await import("../src/formats/video.ts");
  const v = new URL("../examples/spring-launch/exports/acme-spring_ig-story_v1.mp4", import.meta.url).pathname; // 1 s black head, 18 s
  const none = await probeVideo(v);
  assert.deepEqual([none.measured, none.black, none.loudnessLufs], [{ black: false, loudness: false }, undefined, undefined]);
  const both = await probeVideo(v, { blackEdgesS: 0.5, loudness: true });
  assert.deepEqual(both.black, [{ startS: 0, endS: 1 }]);
  assert.equal(both.loudnessLufs, -10.8);
});
