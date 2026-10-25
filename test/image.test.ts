import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { iccFacts, probeImage } from "../src/formats/image.ts";
import { checkImage } from "../src/checks/image.ts";
import { findingMaker, globMatch, validateGuidelines } from "../src/guidelines.ts";
import type { Deliverable, Guidelines } from "../src/types.ts";

// --- builders for minimal, valid-enough files: only the bytes the probe reads ---

function icc(space: string, desc: string, encoding: "desc" | "mluc"): Buffer {
  let tag: Buffer;
  if (encoding === "desc") {
    const ascii = Buffer.from(desc + "\0", "latin1");
    tag = Buffer.concat([Buffer.from("desc\0\0\0\0", "latin1"), u32(ascii.length), ascii]);
  } else {
    const utf16 = Buffer.from(desc, "utf16le").swap16();
    const head = Buffer.concat([Buffer.from("mluc\0\0\0\0", "latin1"), u32(1), u32(12), Buffer.from("enUS", "latin1"), u32(utf16.length), u32(28)]);
    tag = Buffer.concat([head, utf16]);
  }
  const header = Buffer.alloc(128);
  header.write(space.padEnd(4), 16, "latin1");
  const table = Buffer.concat([u32(1), Buffer.from("desc", "latin1"), u32(128 + 4 + 12), u32(tag.length)]);
  return Buffer.concat([header, table, tag]);
}

function u32(n: number) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }
function u16(n: number) { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; }

function png(w: number, h: number, colorType: number, extra: Buffer[] = []): Buffer {
  const chunk = (type: string, data: Buffer) => Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(0)]);
  const ihdr = Buffer.concat([u32(w), u32(h), Buffer.from([8, colorType, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), ...extra, chunk("IEND", Buffer.alloc(0))]);
}
function pngChunk(type: string, data: Buffer) { return Buffer.concat([u32(data.length), Buffer.from(type, "latin1"), data, u32(0)]); }

function jpeg(w: number, h: number, comps: number, iccParts: Buffer[] = []): Buffer {
  const seg = (m: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, m]), u16(data.length + 2), data]);
  const app2 = iccParts.map((p, i) => seg(0xe2, Buffer.concat([Buffer.from("ICC_PROFILE\0", "latin1"), Buffer.from([i + 1, iccParts.length]), p])));
  const sof = seg(0xc0, Buffer.concat([Buffer.from([8]), u16(h), u16(w), Buffer.from([comps])]));
  return Buffer.concat([Buffer.from([0xff, 0xd8]), ...app2, sof, Buffer.from([0xff, 0xda])]);
}

// --- probe ---

test("png: size, alpha, embedded profile (v2 desc)", () => {
  const prof = icc("RGB", "Display P3", "desc");
  const iccp = pngChunk("iCCP", Buffer.concat([Buffer.from("P3\0\0", "latin1"), deflateSync(prof)]));
  const f = probeImage(png(2160, 2700, 6, [iccp]));
  assert.deepEqual([f.format, f.width, f.height, f.hasAlpha, f.colorMode, f.iccProfile, f.iccColorSpace], ["png", 2160, 2700, true, "rgb", "Display P3", "RGB"]);
});

test("png: tRNS means alpha; sRGB chunk without a profile", () => {
  const f = probeImage(png(10, 10, 3, [pngChunk("sRGB", Buffer.from([0])), pngChunk("tRNS", Buffer.from([0]))]));
  assert.equal(f.hasAlpha, true);
  assert.equal(f.colorMode, "indexed");
  assert.equal(f.srgbChunk, true);
  assert.equal(f.iccProfile, undefined);
});

test("jpeg: CMYK, profile split across two APP2 chunks (v4 mluc)", () => {
  const prof = icc("CMYK", "U.S. Web Coated (SWOP) v2", "mluc");
  const f = probeImage(jpeg(1200, 628, 4, [prof.subarray(0, 100), prof.subarray(100)]));
  assert.deepEqual([f.format, f.width, f.height, f.colorMode, f.iccProfile, f.iccColorSpace], ["jpeg", 1200, 628, "cmyk", "U.S. Web Coated (SWOP) v2", "CMYK"]);
});

test("unknown bytes are not guessed at", () => {
  assert.deepEqual(probeImage(Buffer.from("just some text, not an image")), { format: "unknown" });
});

test("iccFacts reads the colour space even with no desc tag", () => {
  const p = Buffer.alloc(132); p.write("GRAY", 16, "latin1");
  assert.deepEqual(iccFacts(p), { iccColorSpace: "GRAY" });
});

// --- checks ---

const g: Guidelines = { project: "t", severity: { "image.colorProfile": "info" } };
const feed: Deliverable = { name: "Feed", match: "*", width: 1080, height: 1350, formats: ["jpg"], colorProfile: ["sRGB"], colorMode: ["rgb"], maxBytes: 1000 };

test("2x export gets the scale hint; overrides change severity; extension mismatch caught", () => {
  const out = checkImage({ format: "png", width: 2160, height: 2700, colorMode: "rgb", iccProfile: "Display P3" }, feed, 5000, "jpg", findingMaker(g, "a.jpg"));
  const by = Object.fromEntries(out.map((f) => [f.rule, f]));
  assert.match(by["image.dimensions"].message, /exported at 2×/);
  assert.equal(by["image.colorProfile"].severity, "info");
  assert.equal(by["image.extension"].severity, "error");
  assert.equal(by["image.format"].severity, "error");
  assert.equal(by["image.size"].actual, 5000);
});

test("a compliant file has no findings", () => {
  const out = checkImage({ format: "jpeg", width: 1080, height: 1350, colorMode: "rgb", iccProfile: "sRGB IEC61966-2.1" }, feed, 900, "jpg", findingMaker(g, "a.jpg"));
  assert.deepEqual(out, []);
});

// --- guidelines ---

test("guideline typos fail loudly", () => {
  const p = validateGuidelines({ project: "x", deliverables: [{ name: "a", match: "*", widht: 10 }], brand: { palette: ["red"] }, severity: { r: "fatal" } });
  assert.equal(p.length, 4); // the unknown rule "r" and its bad level are two problems
  assert.match(p.join("\n"), /unknown key "widht"/);
});

test("globs are anchored and case-insensitive", () => {
  assert.ok(globMatch("*_ig-feed_*", "ACME_IG-FEED_v2.png"));
  assert.ok(!globMatch("*_logo_*", "logo_v1.png"));
});

test("guidelines: wrong types, unknown rule names and hang-prone patterns are refused", () => {
  const p = validateGuidelines({ project: "x", naming: { pattern: "^(a+)+$" }, brand: null,
    deliverables: [{ name: "a", match: "*", width: "1080", formats: "png" }], severity: { "naming.patern": "info" } });
  assert.deepEqual(p.map((x) => x.split(" ")[0]), ["naming.pattern", "brand", "deliverables[0]", "deliverables[0]", "severity:"]);
});

test("glob matching stays fast with many stars", () => {
  const t = performance.now();
  assert.ok(!globMatch("*a*a*a*a*a*a*a*a*a*a*b", "a".repeat(200)));
  assert.ok(performance.now() - t < 50);
  assert.ok(globMatch("acme_*_v?.png", "ACME_ig_V2.PNG"));
});

test("every rule id the checks emit is listed in RULES (so severity overrides can name it)", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { RULES } = await import("../src/guidelines.ts");
  const src = new URL("../src/", import.meta.url).pathname;
  const files = ["run.ts", ...readdirSync(src + "checks").map((f) => "checks/" + f)];
  const emitted = new Set(files.flatMap((f) => [...readFileSync(src + f, "utf8").matchAll(/make\("([a-zA-Z.]+)"/g)].map((m) => m[1])));
  assert.deepEqual([...emitted].filter((r) => !RULES.includes(r)), []);
});

test("png alpha: an opaque alpha channel is told apart from real transparency (all five row filters)", async () => {
  const { deflateSync } = await import("node:zlib");
  const rgbaPng = (alphas: number[][]) => {
    const h = alphas.length, w = alphas[0].length;
    // Encode with filter type y%5 by computing the filtered bytes from the raw ones.
    const raw = alphas.map((r) => Buffer.from(r.flatMap((a) => [10, 20, 30, a])));
    const filtered = raw.map((cur, y) => {
      const prev = y ? raw[y - 1] : Buffer.alloc(cur.length), f = y % 5, out = Buffer.alloc(cur.length);
      for (let x = 0; x < cur.length; x++) {
        const a = x >= 4 ? cur[x - 4] : 0, up = prev[x], c = x >= 4 ? prev[x - 4] : 0;
        const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : (() => { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? up : c; })();
        out[x] = (cur[x] - pr) & 255;
      }
      return Buffer.concat([Buffer.from([f]), out]);
    });
    return png(w, h, 6, [pngChunk("IDAT", deflateSync(Buffer.concat(filtered)))]);
  };
  assert.equal(probeImage(rgbaPng(Array.from({ length: 5 }, () => [255, 255, 255]))).transparentPixels, 0);
  assert.equal(probeImage(rgbaPng([[255, 0, 255], [255, 255, 255], [128, 255, 255], [255, 255, 255], [255, 255, 1]])).transparentPixels, 3);
});

test("guidelines may have comments and trailing commas; strings are never touched", async () => {
  const { stripJsonc } = await import("../src/guidelines.ts");
  const src = `{
    // where this comes from
    "project": "p // not a comment, /* nor this */", /* block
    comment */
    "naming": { "pattern": "^a, }b$", },
    "list": [1, 2, ],
  }`;
  assert.deepEqual(JSON.parse(stripJsonc(src)), { project: "p // not a comment, /* nor this */", naming: { pattern: "^a, }b$" }, list: [1, 2] });
  assert.deepEqual(JSON.parse(stripJsonc('{"a": "say \\"hi\\", }", }')), { a: 'say "hi", }' }); // escaped quote inside a string
});
