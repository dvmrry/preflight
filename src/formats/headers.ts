import type { Reader } from "./reader.ts";
import { iccFacts } from "./icc.ts";
import type { ImageFacts } from "./image.ts";

// Size, colour mode, alpha and colour profile for the image formats beyond PNG/JPEG, read from their headers through the
// positional reader (a few KB per file). No pixel decoding: these give the facts a spec talks about, not pixels.

export type HeaderFormat = "webp" | "gif" | "bmp" | "tiff" | "psd" | "avif" | "heic" | "svg";

const BMP_DIB = [12, 40, 52, 56, 64, 108, 124];
const AVIF_BRANDS = ["avif", "avis"], HEIC_BRANDS = ["heic", "heix", "heim", "heis", "hevc", "hevx"];

export function sniffHeader(h: Buffer): HeaderFormat | undefined {
  const at = (o: number, n: number) => h.toString("latin1", o, o + n);
  if (h.length >= 12 && at(0, 4) === "RIFF" && at(8, 4) === "WEBP") return "webp";
  if (h.length >= 6 && (at(0, 6) === "GIF87a" || at(0, 6) === "GIF89a")) return "gif";
  if (h.length >= 26 && at(0, 2) === "BM" && BMP_DIB.includes(h.readUInt32LE(14))) return "bmp";
  if (h.length >= 8 && (at(0, 4) === "II*\0" || at(0, 4) === "MM\0*")) return "tiff";
  if (h.length >= 4 && at(0, 4) === "8BPS") return "psd";
  if (h.length >= 16 && at(4, 4) === "ftyp") {
    const n = Math.min(h.readUInt32BE(0), h.length);
    const brands = [at(8, 4), ...Array.from({ length: Math.max(0, (n - 16) / 4) }, (_, i) => at(16 + 4 * i, 4))];
    if (brands.some((b) => AVIF_BRANDS.includes(b))) return "avif";
    if (brands.some((b) => HEIC_BRANDS.includes(b))) return "heic";
    return undefined; // mp4/mov and friends are video
  }
  const text = h.toString("utf8", 0, Math.min(h.length, 1024)).replace(/^﻿/, "").trimStart();
  if (text.startsWith("<") && /<svg[\s>]/i.test(text)) return "svg";
  return undefined;
}

export function probeHeader(kind: HeaderFormat, r: Reader): ImageFacts {
  const f: ImageFacts = { format: kind };
  try {
    ({ webp, gif, bmp, tiff, psd, avif: isobmff, heic: isobmff, svg } as Record<HeaderFormat, (r: Reader, f: ImageFacts) => void>)[kind](r, f);
  } catch { /* a read past what's there: reported as truncated below */ }
  if (f.width === undefined && kind !== "svg") f.truncated ??= "header missing or cut off";
  return f;
}

function webp(r: Reader, f: ImageFacts) {
  f.colorMode = "rgb";
  f.hasAlpha = false;
  const end = Math.min(r.size, 8 + r.read(4, 4).readUInt32LE(0));
  for (let off = 12; off + 8 <= end;) {
    const h = r.read(off, 8), id = h.toString("latin1", 0, 4), len = h.readUInt32LE(4);
    const d = () => r.read(off + 8, len);
    if (id === "VP8 ") {
      const x = r.read(off + 8, 10);
      f.width = x.readUInt16LE(6) & 0x3fff; f.height = x.readUInt16LE(8) & 0x3fff;
    } else if (id === "VP8L") {
      const b = r.read(off + 9, 4).readUInt32LE(0);
      f.width ??= (b & 0x3fff) + 1; f.height ??= ((b >> 14) & 0x3fff) + 1;
      if ((b >> 28) & 1) f.hasAlpha = true;
    } else if (id === "VP8X") {
      const x = r.read(off + 8, 10);
      if (x[0] & 0x10) f.hasAlpha = true;
      f.width = 1 + x.readUIntLE(4, 3); f.height = 1 + x.readUIntLE(7, 3); // canvas size wins over frame sizes
    } else if (id === "ALPH") {
      f.hasAlpha = true;
    } else if (id === "ICCP") {
      Object.assign(f, iccFacts(d()));
    }
    if (off + 8 + len > r.size) { f.truncated = `the ${id.trim()} chunk is cut off`; break; }
    off += 8 + len + (len & 1);
  }
}

function gif(r: Reader, f: ImageFacts) {
  const h = r.read(0, 13);
  f.width = h.readUInt16LE(6); f.height = h.readUInt16LE(8);
  f.colorMode = "indexed";
  if (r.read(r.size - 1, 1)[0] !== 0x3b) f.truncated = "no GIF trailer";
}

function bmp(r: Reader, f: ImageFacts) {
  const h = r.read(0, 70), dib = h.readUInt32LE(14);
  if (dib === 12) { f.width = h.readUInt16LE(18); f.height = h.readUInt16LE(20); f.bitDepth = h.readUInt16LE(24); }
  else { f.width = h.readInt32LE(18); f.height = Math.abs(h.readInt32LE(22)); f.bitDepth = h.readUInt16LE(28); }
  f.colorMode = f.bitDepth <= 8 ? "indexed" : "rgb";
  f.hasAlpha = f.bitDepth === 32 && dib >= 56 && h.readUInt32LE(66) !== 0; // V3+ headers carry an alpha mask
}

// TIFF: walk IFD0 for size, photometric interpretation, extra (alpha) samples and the embedded ICC profile (tag 34675).
function tiff(r: Reader, f: ImageFacts) {
  const le = r.read(0, 2).toString("latin1") === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const ifd = u32(r.read(4, 4), 0);
  const n = u16(r.read(ifd, 2), 0);
  const entries = r.read(ifd + 2, n * 12);
  if (entries.length < n * 12) { f.truncated = "the image directory is cut off"; }
  let photometric = -1, samples = 1;
  for (let i = 0; i + 12 <= entries.length; i += 12) {
    const e = entries.subarray(i, i + 12);
    const tag = u16(e, 0), type = u16(e, 2), count = u32(e, 4);
    const val = type === 3 ? u16(e, 8) : u32(e, 8);
    if (tag === 256) f.width = val;
    else if (tag === 257) f.height = val;
    else if (tag === 258) f.bitDepth = count > 2 ? u16(r.read(u32(e, 8), 2), 0) : u16(e, 8); // per-sample bits: first
    else if (tag === 262) photometric = val;
    else if (tag === 277) samples = val;
    else if (tag === 338) f.hasAlpha = true;
    else if (tag === 34675) Object.assign(f, iccFacts(r.read(u32(e, 8), count)));
  }
  f.colorMode = photometric === 5 ? "cmyk" : photometric === 0 || photometric === 1 ? "gray" : photometric === 3 ? "indexed" : "rgb";
  f.hasAlpha ??= photometric === 2 && samples > 3;
}

// PSD/PSB: fixed header, then the image-resources section, where resource 1039 is the ICC profile.
function psd(r: Reader, f: ImageFacts) {
  const h = r.read(0, 30);
  const channels = h.readUInt16BE(12), mode = h.readUInt16BE(24);
  f.height = h.readUInt32BE(14); f.width = h.readUInt32BE(18); f.bitDepth = h.readUInt16BE(22);
  f.colorMode = mode === 4 ? "cmyk" : mode === 1 || mode === 8 ? "gray" : mode === 2 ? "indexed" : "rgb";
  const base = mode === 4 ? 4 : mode === 3 || mode === 9 ? 3 : 1;
  f.hasAlpha = channels > base; // extra channels: transparency or alpha/spot channels
  const resStart = 30 + h.readUInt32BE(26);
  const resEnd = resStart + 4 + r.read(resStart, 4).readUInt32BE(0);
  for (let off = resStart + 4; off + 12 <= resEnd;) {
    const head = r.read(off, 7);
    if (head.toString("latin1", 0, 4) !== "8BIM") break;
    const id = head.readUInt16BE(4), nameLen = head[6];
    const nameSize = (1 + nameLen) + ((1 + nameLen) & 1);
    const size = r.read(off + 6 + nameSize, 4).readUInt32BE(0);
    const data = off + 6 + nameSize + 4;
    if (id === 1039) Object.assign(f, iccFacts(r.read(data, size)));
    off = data + size + (size & 1);
  }
}

// AVIF/HEIC (ISO base media): meta → iprp → ipco holds ispe (size), colr (ICC or nclx colour primaries) and auxC
// (an alpha plane). The largest ispe is the image; smaller ones are thumbnails or grid tiles.
function isobmff(r: Reader, f: ImageFacts) {
  f.colorMode = "rgb";
  f.hasAlpha = false;
  const NCLX: Record<number, string> = { 1: "sRGB / BT.709 (nclx)", 9: "BT.2020 (nclx)", 11: "DCI-P3 (nclx)", 12: "Display P3 (nclx)" };
  let best = 0;
  const walk = (start: number, end: number, depth: number) => {
    for (let off = start; off + 8 <= end && depth < 6;) {
      const h = r.read(off, 16);
      let size = h.readUInt32BE(0), hdr = 8;
      const type = h.toString("latin1", 4, 8);
      if (size === 1) { size = Number(h.readBigUInt64BE(8)); hdr = 16; } else if (size === 0) size = end - off;
      if (size < hdr) break;
      const body = off + hdr;
      if (type === "meta") walk(body + 4, off + size, depth + 1); // full box: skip version/flags
      else if (type === "iprp" || type === "ipco") walk(body, off + size, depth + 1);
      else if (type === "ispe") {
        const d = r.read(body + 4, 8), w = d.readUInt32BE(0), hh = d.readUInt32BE(4);
        if (w * hh > best) { best = w * hh; f.width = w; f.height = hh; }
      } else if (type === "colr") {
        const kind = r.read(body, 4).toString("latin1");
        if (kind === "prof" || kind === "rICC") Object.assign(f, iccFacts(r.read(body + 4, size - hdr - 4)));
        else if (kind === "nclx" && !f.iccProfile) { const p = r.read(body + 4, 2).readUInt16BE(0); if (p !== 2) f.iccProfile = NCLX[p] ?? `colour primaries ${p} (nclx)`; } // 2 = unspecified
      } else if (type === "auxC") {
        if (/alpha/i.test(r.read(body + 4, size - hdr - 4).toString("latin1"))) f.hasAlpha = true;
      }
      off += size;
    }
  };
  walk(0, r.size, 0);
}

// SVG: width/height in px (or unitless), else the viewBox. Vector, so "size" is the declared canvas.
function svg(r: Reader, f: ImageFacts) {
  const text = r.read(0, 65536).toString("utf8");
  const tag = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const attr = (n: string) => tag.match(new RegExp(`\\s${n}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, "i"))?.[1];
  const vb = tag.match(/\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  const w = attr("width") ?? vb?.[1], h = attr("height") ?? vb?.[2];
  if (w && h) { f.width = Math.round(+w); f.height = Math.round(+h); }
  f.colorMode = "rgb";
  if (!tag) f.truncated = "no <svg> element";
}
