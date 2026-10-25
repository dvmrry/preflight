import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { probeImage } from "../src/formats/image.ts";
import { probeImageFile } from "../src/io.ts";

const F = new URL("./fixtures/formats/", import.meta.url).pathname;
const facts = (name: string) => { const r = probeImageFile(F + name); return [r.format, r.width, r.height, r.hasAlpha, r.iccProfile ?? null, r.colorMode, r.truncated ?? null]; };

test("header formats: size, alpha, colour mode and embedded profile (cross-checked with macOS sips)", () => {
  assert.deepEqual(facts("lossy.webp"), ["webp", 64, 40, false, null, "rgb", null]);
  assert.deepEqual(facts("alpha-lossless.webp"), ["webp", 64, 40, true, null, "rgb", null]);
  assert.deepEqual(facts("anim.gif"), ["gif", 64, 40, undefined, null, "indexed", null]);
  assert.deepEqual(facts("plain.bmp"), ["bmp", 64, 40, false, null, "rgb", null]);
  assert.deepEqual(facts("p3.tiff"), ["tiff", 64, 40, false, "Display P3", "rgb", null]);
  assert.deepEqual(facts("p3.psd"), ["psd", 64, 40, false, "Display P3", "rgb", null]);
  assert.deepEqual(facts("p3.heic"), ["heic", 64, 40, false, "Display P3", "rgb", null]);
  assert.deepEqual(facts("still.avif"), ["avif", 64, 40, false, null, "rgb", null]); // nclx primaries "unspecified"
  assert.deepEqual(facts("sized.svg"), ["svg", 1080, 1350, undefined, null, "rgb", null]); // width/height win over viewBox
  assert.deepEqual(facts("viewbox.svg"), ["svg", 512, 512, undefined, null, "rgb", null]);
});

test("header formats: cut-off files are reported, never thrown", () => {
  for (const name of ["lossy.webp", "p3.tiff", "p3.psd", "p3.heic", "anim.gif"]) {
    const b = readFileSync(F + name);
    const r = probeImage(b.subarray(0, 20));
    assert.ok(r.truncated, `${name} cut to 20 bytes should be truncated, got ${JSON.stringify(r)}`);
  }
});
