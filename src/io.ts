import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import type { Guidelines } from "./types.ts";
import { parseGuidelines } from "./guidelines.ts";
import { parseBrand, type BrandProfile } from "./brand.ts";
import { probeWith, type ImageFacts } from "./formats/image.ts";
import type { Reader } from "./formats/reader.ts";
import { framesFromDoc, parseFigmaSource, type FigmaFrame } from "./formats/figma.ts";

// Everything that touches the file system or the network on Node. The modules it calls are pure, so the browser build
// can use them with its own file handling (src/web).

export function loadGuidelines(path: string): Guidelines {
  return parseGuidelines(readFileSync(path, "utf8"), path);
}

// Logo/mark files next to the profile become data: URIs, so the page stays one self-contained file.
export function loadBrand(path: string): BrandProfile {
  return parseBrand(readFileSync(path, "utf8"), path, (ref) => {
    const file = resolve(dirname(path), ref);
    const type = { ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" }[extname(file).toLowerCase()] ?? "image/jpeg";
    return `data:${type};base64,${readFileSync(file).toString("base64")}`;
  });
}

// Opens a file and hands the parser a positional reader over it; the parser decides how much to read.
export function withFile<T>(path: string, fn: (r: Reader) => T): T {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    return fn({ size, read(o, l) {
      const n = Math.max(0, Math.min(l, size - o));
      const b = Buffer.allocUnsafe(n);
      return b.subarray(0, n ? readSync(fd, b, 0, n, o) : 0);
    } });
  } finally {
    closeSync(fd);
  }
}

export function probeImageFile(path: string): ImageFacts {
  return withFile(path, probeWith);
}

// A saved Figma API response, or a live file via the API (FIGMA_TOKEN).
export async function loadFigma(source: string, token = process.env.FIGMA_TOKEN): Promise<{ fileName: string; key: string; nodeId?: string; frames: FigmaFrame[]; skipped: string[] }> {
  if (existsSync(source)) return { ...framesFromDoc(JSON.parse(readFileSync(source, "utf8"))), key: "local" };
  const src = parseFigmaSource(source);
  if (!src) throw new Error(`"${source}" is neither a file nor a Figma link (figma.com/design/KEY/... or figma:KEY)`);
  if (!token) throw new Error("FIGMA_TOKEN is not set (a personal access token with file read access)");
  const r = await fetch(`https://api.figma.com/v1/files/${src.key}`, { headers: { "X-Figma-Token": token }, signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Figma API ${r.status} for file ${src.key}: ${(await r.text()).slice(0, 200)}`);
  return { ...framesFromDoc(await r.json(), src.nodeId), key: src.key, nodeId: src.nodeId };
}
