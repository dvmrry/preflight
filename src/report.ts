import type { AssetReport, Finding, Guidelines, Report } from "./types.ts";
import type { FigmaFrame } from "./formats/figma.ts";
import { deliverableFor, findingMaker } from "./guidelines.ts";
import { checkFrame } from "./checks/figma.ts";
import { checkImage } from "./checks/image.ts";
import { checkVideo } from "./checks/video.ts";
import { sniffImage, type ImageFacts } from "./formats/image.ts";
import { sniffAudio, sniffVideo, type DecodeNeeds, type VideoFacts } from "./formats/media.ts";
import { rgbToHex } from "./color.ts";

// Report building shared by every front end (CLI, app, Dust, browser). Pure: no file system, no network.

export const VERSION = "0.2.0";

// Figma frames → one report each, plus a note for what wasn't checked, so "no findings" never hides "nothing looked at".
export function frameReports(g: Guidelines, file: { fileName: string; nodeId?: string; frames: FigmaFrame[]; skipped: string[] }, label: string): AssetReport[] {
  const reports: AssetReport[] = file.frames.map((fr) => {
    const asset = `figma:${label}/${fr.page}/${fr.name}`;
    const make = findingMaker(g, asset);
    const d = deliverableFor(g, fr.name);
    const findings = checkFrame(fr, d, g, make);
    if (!d) findings.unshift(make("deliverable.unmatched", "info", `No deliverable matches frame "${fr.name}", so only brand rules were checked.`));
    const runs = fr.elements.flatMap((e) => e.text?.runs ?? []);
    const facts = { file: file.fileName, page: fr.page, width: fr.width, height: fr.height, rotation: fr.rotation, layers: fr.elements.length,
      fonts: [...new Set(runs.map((r) => r.family))], textLayers: fr.elements.filter((e) => e.text).length, sketch: sketchOf(fr) };
    return { asset, kind: "figma-frame" as const, deliverable: d?.name, facts, findings };
  });
  const make = findingMaker(g, `figma:${label}`);
  const notes: Finding[] = [];
  if (file.nodeId && reports.length === 0) notes.push(make("figma.notChecked", "error", `The link points at node ${file.nodeId}, which isn't inside any frame, so nothing was checked.`));
  if (!file.nodeId && file.skipped.length) {
    notes.push(make("figma.notChecked", "info", `${file.skipped.length} top-level layer(s) aren't frames and weren't checked.`, { location: file.skipped.slice(0, 3).join("; ") + (file.skipped.length > 3 ? `; +${file.skipped.length - 3} more` : "") }));
  }
  if (notes.length) reports.push({ asset: `figma:${label}`, kind: "unknown", facts: { file: file.fileName, frames: reports.length }, findings: notes });
  return reports;
}

// What the HTML page needs to draw a frame and point at layers: boxes, top fill, text. Capped so a huge frame
// can't bloat the report.
export interface SketchLayer { p: string; t: string; x: number; y: number; w: number; h: number; fill?: string; alpha?: number; kind?: string; text?: string; size?: number; color?: string }
export function sketchOf(fr: FigmaFrame): { w: number; h: number; layers: SketchLayer[] } {
  const r = (n: number) => Math.round(n * 10) / 10;
  const layers = fr.elements.filter((e) => e.box && (e.paints || e.text)).slice(0, 600).map((e) => {
    const top = e.fills[e.fills.length - 1];
    const l: SketchLayer = { p: e.path, t: e.type, x: r(e.box!.x), y: r(e.box!.y), w: r(e.box!.width), h: r(e.box!.height) };
    if (e.text) {
      const run = e.text.runs[0];
      l.text = e.text.characters.slice(0, 120); l.size = run?.size;
      if (top) l.color = rgbToHex(top.color);
      if (top && top.opacity < 1) l.alpha = +top.opacity.toFixed(2);
    } else if (top) { l.fill = rgbToHex(top.color); if (top.opacity < 1) l.alpha = +top.opacity.toFixed(2); }
    if (e.fillKind) l.kind = e.fillKind;
    return l;
  });
  return { w: fr.width, h: fr.height, layers };
}

export function checkName(g: Guidelines, name: string, make: ReturnType<typeof findingMaker>): Finding[] {
  if (!g.naming || new RegExp(g.naming.pattern).test(name)) return [];
  const why = g.naming.description ? ` (${g.naming.description})` : "";
  return [make("naming.pattern", "warning", `"${name}" doesn't follow the naming convention${why}.`, { expected: g.naming.pattern, actual: name, ...(g.naming.description && { fix: `Rename to the pattern ${g.naming.description}.` }) })];
}

export function buildReport(g: Guidelines, assets: AssetReport[]): Report {
  const all = assets.flatMap((a) => a.findings);
  const count = (s: string) => all.filter((f) => f.severity === s).length;
  return {
    tool: "preflight",
    version: VERSION,
    project: g.project,
    assets,
    summary: { assets: assets.length, passed: assets.filter((a) => a.findings.length === 0).length, withFindings: assets.filter((a) => a.findings.length > 0).length,
      errors: count("error"), warnings: count("warning"), infos: count("info") },
  };
}

const IMAGE_EXT = ["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "psd", "psb", "bmp", "avif", "heic", "heif", "svg"];
const VIDEO_EXT = ["mp4", "mov", "m4v", "mxf", "webm", "mkv", "avi"];
const AUDIO_EXT = ["wav", "mp3", "ogg", "flac", "m4a", "aac", "aif", "aiff"];

// One file as the checker sees it: its name, size, first bytes, and how to measure it on this platform (Node reads by
// position and runs ffprobe; the browser reads the File and asks a media element).
export interface FileSource {
  asset: string; // what the report calls it (a path, or a file name)
  name: string;
  bytes: number;
  head: Buffer; // first 1 KB: enough for every magic number, an ftyp brand list and an SVG's opening tag
  image: () => ImageFacts | Promise<ImageFacts>;
  video: (needs: DecodeNeeds) => Promise<VideoFacts>;
}

// One file's report. Never throws: a file that can't be read or parsed becomes an error finding, so one bad export
// can't take down the report for the rest of the folder.
export async function checkAsset(g: Guidelines, src: FileSource): Promise<AssetReport> {
  const make = findingMaker(g, src.asset);
  const d = deliverableFor(g, src.name);
  try {
    const ext = (src.name.match(/\.([^.]+)$/)?.[1] ?? "").toLowerCase();
    const findings: Finding[] = [...checkName(g, src.name, make)];
    if (!d) findings.push(make("deliverable.unmatched", "info", `No deliverable in the guidelines matches "${src.name}", so only the name was checked.`));
    const head = src.head;
    // Content decides the kind; the extension is only a fallback, so extensionless download links still get checked.
    if (sniffImage(head) || (IMAGE_EXT.includes(ext) && !sniffVideo(head))) {
      const facts = await src.image();
      if (d) findings.push(...checkImage(facts, d, src.bytes, ext, make));
      return { asset: src.asset, kind: "image", deliverable: d?.name, facts: { ...facts, bytes: src.bytes }, findings };
    }
    // Audio-only files go through the same prober; picture checks simply have nothing to measure.
    const audioOnly = sniffAudio(head) || (AUDIO_EXT.includes(ext) && !sniffVideo(head));
    if (audioOnly || sniffVideo(head) || VIDEO_EXT.includes(ext)) {
      // Decode only for the rules this deliverable has: none means container facts alone.
      const facts = await src.video({ blackEdgesS: d?.video?.maxBlackAtEdgesS, loudness: !!d?.video?.loudness });
      const kind = audioOnly || (facts.width === undefined && facts.audioCodec) ? "audio" as const : "video" as const;
      if (d) findings.push(...checkVideo(facts, d, src.bytes, src.name, make));
      if (facts.partial) findings.push(make("video.partial", "info", facts.partial));
      return { asset: src.asset, kind, deliverable: d?.name, facts: { ...facts, bytes: src.bytes }, findings };
    }
    if (d) findings.push(make("file.unrecognized", "warning", `Couldn't tell what kind of file this is, so none of the ${d.name} checks ran.`, { actual: ext || "(no extension)" }));
    return { asset: src.asset, kind: "unknown", deliverable: d?.name, facts: { bytes: src.bytes }, findings };
  } catch (e) {
    const why = (e as { code?: string }).code ?? (e as Error).message;
    return { asset: src.asset, kind: "unknown", deliverable: d?.name, facts: {},
      findings: [make("file.unreadable", "error", `Couldn't read this file (${why}).`, { actual: why })] };
  }
}
