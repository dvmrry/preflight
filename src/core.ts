import { availableParallelism } from "node:os";
import { basename } from "node:path";
import type { AssetReport, Guidelines } from "./types.ts";
import { checkFigma, checkFile, expandPaths, isFigmaSource } from "./run.ts";
import { parseFigmaSource } from "./formats/figma.ts";
import { loadFigma } from "./io.ts";

// The one way in for every front end (CLI, MCP server, app, assist commands): turn what the user gave into sources,
// check them, keep the order they were given in.

export type Source = { kind: "figma"; ref: string } | { kind: "file"; path: string };

// Figma links pass through; folders are walked (Figma JSON found inside counts as Figma); everything else is a file.
export function walkSources(paths: string[]): Source[] {
  const out: Source[] = [];
  for (const p of paths) {
    for (const f of parseFigmaSource(p) ? [p] : expandPaths([p])) out.push(isFigmaSource(f) ? { kind: "figma", ref: f } : { kind: "file", path: f });
  }
  return out;
}

// Files are checked concurrently (video decoding is the slow part and runs in ffmpeg processes); results keep the
// input order so reports are stable.
export async function checkSources(g: Guidelines, paths: string[] | Source[], opts: { concurrency?: number } = {}): Promise<AssetReport[]> {
  const sources = typeof paths[0] === "string" || paths.length === 0 ? walkSources(paths as string[]) : (paths as Source[]);
  const results: AssetReport[][] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const i = next++;
      const s = sources[i];
      results[i] = s.kind === "figma" ? await checkFigma(g, s.ref) : [await checkFile(g, s.path)];
    }
  };
  const n = Math.max(1, Math.min(opts.concurrency ?? Math.max(2, Math.floor(availableParallelism() / 2)), sources.length));
  await Promise.all(Array.from({ length: n }, worker));
  return results.flat();
}

// What deliverables are matched on: file names, and the frame names inside Figma sources.
export async function assetNames(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const s of walkSources(paths)) {
    if (s.kind === "file") out.push(basename(s.path));
    else try { out.push(...(await loadFigma(s.ref)).frames.map((fr) => fr.name)); } catch { /* unreadable: no names */ }
  }
  return out;
}
