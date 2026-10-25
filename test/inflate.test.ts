import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync, inflateSync as nodeInflate, constants } from "node:zlib";
import { readFileSync } from "node:fs";
import { inflateSync } from "../src/formats/inflate.browser.ts";

test("browser inflate matches node:zlib on stored, fixed and dynamic blocks and real PNG data", () => {
  const rnd = (n: number, seed: number) => { const b = Buffer.alloc(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; };
  const inputs = [
    Buffer.alloc(0), Buffer.from("a"), Buffer.from("hello hello hello hello world ".repeat(200)),
    rnd(70000, 7), Buffer.alloc(100000, 0x2a),
    Buffer.concat([rnd(3000, 1), Buffer.from("abcabcabc".repeat(1000)), rnd(50, 2)]),
  ];
  for (const data of inputs) {
    for (const level of [0, 1, 6, 9]) {
      for (const strategy of [constants.Z_DEFAULT_STRATEGY, constants.Z_FIXED, constants.Z_HUFFMAN_ONLY]) {
        const z = deflateSync(data, { level, strategy });
        assert.ok(inflateSync(z).equals(nodeInflate(z)), `len ${data.length} level ${level} strategy ${strategy}`);
      }
    }
  }
  // Real image data: every IDAT stream of a fixture PNG.
  const png = readFileSync(new URL("../examples/spring-launch/exports/acme-spring_logo_v2.png", import.meta.url));
  const idat: Buffer[] = [];
  for (let off = 8; off < png.length;) { const len = png.readUInt32BE(off), type = png.toString("latin1", off + 4, off + 8); if (type === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len)); off += 12 + len; }
  const z = Buffer.concat(idat);
  assert.ok(inflateSync(z).equals(nodeInflate(z)));
});

test("browser inflate refuses bombs and garbage like node does", () => {
  const big = deflateSync(Buffer.alloc(1 << 20));
  assert.throws(() => inflateSync(big, { maxOutputLength: 1000 }), /maxOutputLength/);
  assert.throws(() => inflateSync(Buffer.from([0x78, 0x9c, 0xff, 0xff])));
  assert.throws(() => inflateSync(Buffer.from("not zlib")));
});
