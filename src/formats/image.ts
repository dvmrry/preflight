import { inflateSync } from "./inflate.ts";
import { bufferReader, type Reader } from "./reader.ts";
import { iccFacts } from "./icc.ts";
import { probeHeader, sniffHeader, type HeaderFormat } from "./headers.ts";

// Reads what a reviewer would check in an image export straight from the file bytes: no decoder, no dependencies.
// PNG and JPEG cover nearly all design exports; anything else comes back as format "unknown".
// Every read is bounds-checked: a damaged file is reported as truncated, never thrown.

export interface ImageFacts {
  format: "png" | "jpeg" | HeaderFormat | "unknown";
  width?: number; // as displayed (EXIF orientation applied)
  height?: number;
  orientation?: number; // EXIF orientation 1-8, when present and not 1
  colorMode?: "rgb" | "cmyk" | "gray" | "indexed";
  hasAlpha?: boolean;
  bitDepth?: number;
  iccProfile?: string; // the profile's own description, e.g. "sRGB IEC61966-2.1", "Display P3"
  iccColorSpace?: string; // from the ICC header: "RGB", "CMYK", "GRAY"
  srgbChunk?: boolean; // PNG sRGB chunk: declares sRGB without embedding a profile
  dpi?: number;
  truncated?: string; // why the file looks cut short or damaged
  transparentPixels?: number; // PNG with an alpha channel: how many pixels are not fully opaque (0 = channel unused)
}

const MAX_ICC = 4 << 20; // no real profile is bigger; caps a decompression bomb in iCCP

export function sniffImage(head: Buffer): ImageFacts["format"] | undefined {
  if (head.length >= 8 && head.readUInt32BE(0) === 0x89504e47 && head.readUInt32BE(4) === 0x0d0a1a0a) return "png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  return sniffHeader(head);
}

export { iccFacts } from "./icc.ts";
export type { Reader } from "./reader.ts";

export function probeImage(buf: Buffer): ImageFacts {
  return probeWith(bufferReader(buf));
}


export function probeWith(r: Reader): ImageFacts {
  const kind = sniffImage(r.read(0, 1024));
  if (kind === "png") return probePng(r);
  if (kind === "jpeg") return probeJpeg(r);
  if (kind && kind !== "unknown") return probeHeader(kind, r);
  return { format: "unknown" };
}

function probePng(r: Reader): ImageFacts {
  const f: ImageFacts = { format: "png" };
  let off = 8, sawIend = false, sawIdat = false, colorType = -1, interlaced = false, idatBytes = 0;
  const idat: Buffer[] = [];
  let countAlpha = false; // decided at IHDR: only then is pixel data worth reading
  while (off + 8 <= r.size) {
    const head = r.read(off, 8);
    const len = head.readUInt32BE(0);
    const type = head.toString("latin1", 4, 8);
    if (off + 12 + len > r.size) { f.truncated = `the ${type} chunk is cut off`; break; }
    const data = () => r.read(off + 8, len);
    if (type === "IHDR" && len >= 13) {
      const d = data();
      f.width = d.readUInt32BE(0);
      f.height = d.readUInt32BE(4);
      f.bitDepth = d[8];
      const ct = d[9];
      f.colorMode = ct === 0 || ct === 4 ? "gray" : ct === 3 ? "indexed" : "rgb";
      f.hasAlpha = ct === 4 || ct === 6;
      colorType = ct;
      interlaced = d[12] === 1;
      countAlpha = (ct === 6 || ct === 4) && !interlaced && (f.bitDepth === 8 || f.bitDepth === 16);
    } else if (type === "tRNS") {
      f.hasAlpha = true;
    } else if (type === "sRGB") {
      f.srgbChunk = true;
    } else if (type === "iCCP") {
      const d = data();
      const nul = d.indexOf(0);
      const name = d.toString("latin1", 0, Math.max(0, nul));
      try {
        Object.assign(f, iccFacts(inflateSync(d.subarray(nul + 2), { maxOutputLength: MAX_ICC })));
      } catch { /* unreadable profile body: fall back to the chunk's own name below */ }
      f.iccProfile ??= name || "(unnamed profile)";
    } else if (type === "pHYs" && len >= 9) {
      const d = data();
      if (d[8] === 1) f.dpi = Math.round(d.readUInt32BE(0) * 0.0254);
    } else if (type === "IDAT") {
      sawIdat = true;
      idatBytes += len;
      if (countAlpha && idatBytes <= MAX_DECODE) idat.push(data());
      else countAlpha = false; // too big to decode: leave it uncounted rather than slow
    } else if (type === "IEND") {
      sawIend = true;
      break;
    }
    off += 12 + len; // walk every chunk header (cheap) so a cut-off file is noticed
  }
  if (f.width === undefined) f.truncated ??= "no IHDR header";
  else if (!sawIend) f.truncated ??= sawIdat ? "image data ends early (no IEND)" : "no image data";
  // An alpha channel that every pixel leaves at 255 is a different finding from real transparency, so count.
  if (!f.truncated && countAlpha && colorType >= 0) {
    const n = countTransparent(idat, f.width!, f.height!, colorType === 6 ? 4 : 2, f.bitDepth! / 8);
    if (n !== undefined) f.transparentPixels = n;
  }
  return f;
}

const MAX_DECODE = 64 << 20; // ~16 MP of RGBA8: anything bigger is left uncounted rather than slow

// Inflates and unfilters the image rows, then counts pixels whose alpha isn't the maximum. Undefined if it can't.
function countTransparent(idat: Buffer[], w: number, h: number, channels: number, bytesPerSample: number): number | undefined {
  const bpp = channels * bytesPerSample, stride = w * bpp;
  if ((stride + 1) * h > MAX_DECODE) return undefined;
  let raw: Buffer;
  try { raw = inflateSync(Buffer.concat(idat), { maxOutputLength: (stride + 1) * h }); } catch { return undefined; }
  if (raw.length < (stride + 1) * h) return undefined;
  let prev = new Uint8Array(stride), cur = new Uint8Array(stride), count = 0;
  const alphaOff = (channels - 1) * bytesPerSample; // alpha is the last sample; for 16-bit, check both bytes
  for (let y = 0, i = 0; y < h; y++) {
    const filter = raw[i++];
    for (let x = 0; x < stride; x++, i++) {
      const a = x >= bpp ? cur[x - bpp] : 0, up = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = raw[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += up;
      else if (filter === 3) v += (a + up) >> 1;
      else if (filter === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v;
    }
    for (let x = alphaOff; x < stride; x += bpp) if (cur[x] !== 255 || (bytesPerSample === 2 && cur[x + 1] !== 255)) count++;
    [prev, cur] = [cur, prev];
  }
  return count;
}

function probeJpeg(r: Reader): ImageFacts {
  const f: ImageFacts = { format: "jpeg", hasAlpha: false };
  const icc: Buffer[] = [];
  let off = 2, sawSos = false;
  while (off + 4 <= r.size) {
    const h = r.read(off, 4);
    if (h[0] !== 0xff) { f.truncated = "marker structure is damaged"; break; }
    if (h[1] === 0xff) { off++; continue; } // fill bytes before a marker are legal
    const marker = h[1];
    if ((marker >= 0xd0 && marker <= 0xd8) || marker === 0x01) { off += 2; continue; }
    if (marker === 0xd9) break;
    const len = h.readUInt16BE(2);
    if (len < 2 || off + 2 + len > r.size) { f.truncated = "a header segment is cut off"; break; }
    if (marker === 0xda) { sawSos = true; break; } // start of scan: metadata is over
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    const wanted = isSof || marker === 0xe0 || marker === 0xe1 || marker === 0xe2; // other segments are skipped unread
    const seg = wanted ? r.read(off + 4, len - 2) : Buffer.alloc(0);
    if (isSof && seg.length >= 6) {
      f.bitDepth = seg[0];
      f.height = seg.readUInt16BE(1);
      f.width = seg.readUInt16BE(3);
      const comps = seg[5];
      f.colorMode = comps === 1 ? "gray" : comps === 4 ? "cmyk" : "rgb";
    } else if (marker === 0xe0 && seg.length >= 12 && seg.toString("latin1", 0, 5) === "JFIF\0") {
      const units = seg[7], x = seg.readUInt16BE(8);
      if (units === 1) f.dpi = x;
      else if (units === 2) f.dpi = Math.round(x * 2.54);
    } else if (marker === 0xe1 && seg.length > 14 && seg.toString("latin1", 0, 6) === "Exif\0\0") {
      const o = exifOrientation(seg.subarray(6));
      if (o && o !== 1) f.orientation = o;
    } else if (marker === 0xe2 && seg.length > 14 && seg.toString("latin1", 0, 12) === "ICC_PROFILE\0") {
      icc[seg[12] - 1] = seg.subarray(14); // chunks carry their sequence number; reassemble in order
    }
    off += 2 + len;
  }
  if (icc.length) {
    try { Object.assign(f, iccFacts(Buffer.concat(icc.filter(Boolean)))); } catch { /* damaged profile */ }
    f.iccProfile ??= "(unnamed profile)"; // a profile is embedded even if its name can't be read
  }
  if (f.width === undefined) f.truncated ??= "no frame header (SOF)";
  else if (!sawSos) f.truncated ??= "no image data";
  else if (!tailHasEoi(r)) f.truncated ??= "image data ends early (no end marker)";
  // Orientations 5-8 rotate by 90°: report the size the viewer sees.
  if (f.orientation && f.orientation >= 5 && f.width !== undefined) [f.width, f.height] = [f.height, f.width];
  return f;
}

function tailHasEoi(r: Reader): boolean {
  const tail = r.read(Math.max(0, r.size - 4096), 4096); // exporters may append padding or trailers
  return tail.lastIndexOf(Buffer.from([0xff, 0xd9])) !== -1;
}

// EXIF: a TIFF header, then IFD0; tag 0x0112 is orientation.
function exifOrientation(t: Buffer): number | undefined {
  if (t.length < 8) return undefined;
  const le = t.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
  const u32 = (o: number) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
  const ifd = u32(4);
  if (ifd + 2 > t.length) return undefined;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return undefined;
    if (u16(e) === 0x0112) return u16(e + 8);
  }
  return undefined;
}

