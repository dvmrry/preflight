// zlib inflate (RFC 1950/1951) in plain TypeScript for the browser build, where node:zlib doesn't exist. A canonical-
// Huffman decoder in the style of zlib's "puff": stored, fixed and dynamic blocks; no checksum verification. Matches
// node:zlib byte for byte (test/inflate.test.ts). Same signature as node's inflateSync for what we use.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huff { count: Uint16Array; symbol: Uint16Array }

function build(lengths: ArrayLike<number>, n: number): Huff {
  const count = new Uint16Array(16), symbol = new Uint16Array(n), offs = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  count[0] = 0;
  for (let len = 1; len < 15; len++) offs[len + 1] = offs[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offs[lengths[i]]++] = i;
  return { count, symbol };
}

const FIXED = (() => {
  const l = new Uint8Array(288);
  l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288);
  return { lit: build(l, 288), dist: build(new Uint8Array(30).fill(5), 30) };
})();

export function inflateSync(input: Uint8Array, opts: { maxOutputLength?: number } = {}): Buffer {
  const max = opts.maxOutputLength ?? Infinity;
  if (input.length < 2 || (input[0] & 0x0f) !== 8) throw new Error("not a zlib deflate stream");
  let pos = 2, bitbuf = 0, bitcnt = 0;
  let out = new Uint8Array(Math.min(Math.max(1024, input.length * 4), Number.isFinite(max) ? max : Infinity)), n = 0;
  const need = (k: number) => {
    if (n + k > max) throw new Error("inflated data exceeds maxOutputLength");
    if (n + k > out.length) { const grown = new Uint8Array(Math.min(Math.max(out.length * 2, n + k), Number.isFinite(max) ? max : Infinity)); grown.set(out.subarray(0, n)); out = grown; }
  };
  const bits = (k: number) => {
    while (bitcnt < k) {
      if (pos >= input.length) throw new Error("unexpected end of deflate data");
      bitbuf |= input[pos++] << bitcnt; bitcnt += 8;
    }
    const v = bitbuf & ((1 << k) - 1);
    bitbuf >>>= k; bitcnt -= k;
    return v;
  };
  const decode = (h: Huff) => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first += c; first <<= 1; code <<= 1;
    }
    throw new Error("invalid Huffman code");
  };
  const codes = (lit: Huff, dist: Huff) => {
    for (;;) {
      let sym = decode(lit);
      if (sym < 256) { need(1); out[n++] = sym; continue; }
      if (sym === 256) return;
      sym -= 257;
      if (sym >= 29) throw new Error("invalid length symbol");
      const len = LEN_BASE[sym] + bits(LEN_EXTRA[sym]);
      const ds = decode(dist);
      if (ds >= 30) throw new Error("invalid distance symbol");
      const d = DIST_BASE[ds] + bits(DIST_EXTRA[ds]);
      if (d > n) throw new Error("distance too far back");
      need(len);
      for (let i = 0; i < len; i++, n++) out[n] = out[n - d];
    }
  };
  let last = 0;
  do {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0; // stored: byte-aligned length, its complement, raw bytes
      if (pos + 4 > input.length) throw new Error("unexpected end of deflate data");
      const len = input[pos] | (input[pos + 1] << 8);
      pos += 4;
      if (pos + len > input.length) throw new Error("unexpected end of deflate data");
      need(len); out.set(input.subarray(pos, pos + len), n); n += len; pos += len;
    } else if (type === 1) {
      codes(FIXED.lit, FIXED.dist);
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CL_ORDER[i]] = bits(3);
      for (let i = ncode; i < 19; i++) lengths[CL_ORDER[i]] = 0;
      const cl = build(lengths, 19);
      for (let i = 0; i < nlen + ndist;) {
        const sym = decode(cl);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let rep = 0, val = 0;
        if (sym === 16) { if (i === 0) throw new Error("repeat with no previous length"); val = lengths[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) throw new Error("too many lengths");
        while (rep--) lengths[i++] = val;
      }
      codes(build(lengths.subarray(0, nlen), nlen), build(lengths.subarray(nlen, nlen + ndist), ndist));
    } else throw new Error("invalid block type");
  } while (!last);
  return Buffer.from(out.buffer, out.byteOffset, n);
}
