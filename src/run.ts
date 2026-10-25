import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { AssetReport, Guidelines } from "./types.ts";
import { probeVideo } from "./formats/video.ts";
import { parseFigmaSource } from "./formats/figma.ts";
import { loadFigma, probeImageFile } from "./io.ts";
import { buildReport, checkAsset, checkName, frameReports, sketchOf, VERSION } from "./report.ts";
export { buildReport, checkName, frameReports, sketchOf, VERSION };



// Expands directories (recursively, skipping dotfiles) so a whole export folder can be checked at once. Follows
// symlinks but never visits the same real directory twice; anything unreadable is kept and reported by checkFile.
export function expandPaths(paths: string[], seen = new Set<string>()): string[] {
  const out: string[] = [];
  for (const p of paths) {
    let isDir = false;
    try { isDir = statSync(p).isDirectory(); } catch { /* dangling link or no permission: checkFile reports it */ }
    if (!isDir) { out.push(p); continue; }
    const real = realpathSync(p);
    if (seen.has(real)) continue;
    seen.add(real);
    const kids = readdirSync(p).filter((n) => !n.startsWith(".")).sort().map((n) => join(p, n));
    out.push(...expandPaths(kids, seen));
  }
  return out;
}

export async function checkFile(g: Guidelines, path: string): Promise<AssetReport> {
  let bytes = 0, head = Buffer.alloc(0);
  try {
    bytes = statSync(path).size;
    head = readHead(path, 1024);
  } catch { /* unreadable: checkAsset reports it when probing */ }
  return checkAsset(g, {
    asset: path, name: basename(path), bytes, head,
    image: () => { if (!bytes && !head.length) statSync(path); return probeImageFile(path); },
    video: (needs) => probeVideo(path, needs),
  });
}

function readHead(path: string, n: number): Buffer {
  const fd = openSync(path, "r");
  try {
    const b = Buffer.alloc(n);
    return b.subarray(0, readSync(fd, b, 0, n, 0));
  } finally {
    closeSync(fd);
  }
}

// A Figma link, figma:KEY, or a saved API response (*.figma.json). One report per deliverable frame.
export function isFigmaSource(s: string): boolean {
  return /^figma:/.test(s) || parseFigmaSource(s) !== undefined || s.endsWith(".figma.json");
}

export async function checkFigma(g: Guidelines, source: string): Promise<AssetReport[]> {
  const file = await loadFigma(source);
  return frameReports(g, file, file.key === "local" ? basename(source) : file.key);
}



