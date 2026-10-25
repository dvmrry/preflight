// Preflight in the browser: the same pure checker as the CLI and the Mac app, fed from dropped files. Nothing is
// uploaded — files are read with the File API, Figma JSON is parsed in the page, video size/length come from a media
// element (frame rate, codec, loudness and black frames need the app or CLI).
import { Buffer } from "node:buffer";
(globalThis as { Buffer?: unknown }).Buffer ??= Buffer; // the parsers use Node's Buffer API; Bun bundles a polyfill

import type { AssetReport, Guidelines, Report } from "../types.ts";
import { deliverableFor, parseGuidelines } from "../guidelines.ts";
import { parseBrand, type BrandProfile } from "../brand.ts";
import { buildReport, checkAsset, frameReports } from "../report.ts";
import { framesFromDoc } from "../formats/figma.ts";
import { probeImage } from "../formats/image.ts";
import type { DecodeNeeds, VideoFacts } from "../formats/media.ts";
import { renderHtml } from "../html.ts";

interface Named<T> { name: string; value: T }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const guidelinesSel = $<HTMLSelectElement>("guidelines"), brandSel = $<HTMLSelectElement>("brand");
const frame = $<HTMLIFrameElement>("report"), status = $<HTMLElement>("status"), empty = $<HTMLElement>("empty");

const guidelines: Named<Guidelines>[] = [];
const brands: Named<BrandProfile | undefined>[] = [{ name: "Neutral", value: undefined }];
let lastFiles: File[] = [];
let lastReport: { report: Report; html: string } | undefined;

// ---------- loading what the site ships (data/index.json lists it) ----------

async function boot() {
  const index = await (await fetch("data/index.json")).json() as { guidelines: string[]; brands: string[] };
  for (const f of index.guidelines) {
    const text = await (await fetch(`data/${f}`)).text();
    const g = parseGuidelines(text, f);
    guidelines.push({ name: g.project, value: g });
  }
  for (const f of index.brands) {
    const b = parseBrand(await (await fetch(`data/${f}`)).text(), f);
    brands.push({ name: b.name, value: b });
  }
  fillSelect(guidelinesSel, guidelines.map((g) => g.name), "Load your own guidelines…");
  fillSelect(brandSel, brands.map((b) => b.name), "Load a brand profile…");
  guidelinesSel.onchange = () => (guidelinesSel.value === "load" ? pickFile(".json,.jsonc", loadOwnGuidelines) : lastFiles.length && run(lastFiles, false));
  brandSel.onchange = () => (brandSel.value === "load" ? pickFile(".json,.jsonc", loadOwnBrand) : rerender());
}

function fillSelect(sel: HTMLSelectElement, names: string[], loadLabel: string) {
  sel.innerHTML = names.map((n, i) => `<option value="${i}">${escapeHtml(n)}</option>`).join("") + `<option value="load">${loadLabel}</option>`;
}

function pickFile(accept: string, then: (f: File) => void) {
  const input = Object.assign(document.createElement("input"), { type: "file", accept });
  input.onchange = () => input.files?.[0] && then(input.files[0]);
  input.click();
}

async function loadOwnGuidelines(f: File) {
  try {
    const g = parseGuidelines(await f.text(), f.name);
    guidelines.push({ name: `${g.project} (yours)`, value: g });
    fillSelect(guidelinesSel, guidelines.map((x) => x.name), "Load your own guidelines…");
    guidelinesSel.value = String(guidelines.length - 1);
    if (lastFiles.length) run(lastFiles, false);
  } catch (e) { showError((e as Error).message); }
}

// Brand files picked here can't reference sibling logo files; use a packed profile (`preflight brand pack`).
async function loadOwnBrand(f: File) {
  try {
    const b = parseBrand(await f.text(), f.name, (ref) => { throw new Error(`"${ref}": pack the profile first (preflight brand pack) so its images are embedded`); });
    brands.push({ name: b.name, value: b });
    fillSelect(brandSel, brands.map((x) => x.name), "Load a brand profile…");
    brandSel.value = String(brands.length - 1);
    rerender();
  } catch (e) { showError((e as Error).message); }
}

// ---------- files in: drop, pickers, demo ----------

async function filesFromDrop(e: DragEvent): Promise<File[]> {
  const entries = [...(e.dataTransfer?.items ?? [])].map((i) => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[];
  if (!entries.length) return [...(e.dataTransfer?.files ?? [])];
  const out: File[] = [];
  const walk = async (en: FileSystemEntry): Promise<void> => {
    if (en.isFile) out.push(await new Promise<File>((res, rej) => (en as FileSystemFileEntry).file(res, rej)));
    else if (en.isDirectory) {
      const reader = (en as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const b of batch) if (!b.name.startsWith(".")) await walk(b);
      }
    }
  };
  for (const en of entries) await walk(en);
  return out;
}

async function demoFiles(): Promise<File[]> {
  const list = await (await fetch("demo/index.json")).json() as string[];
  return Promise.all(list.map(async (n) => new File([await (await fetch(`demo/${n}`)).blob()], n)));
}

// ---------- checking ----------

const isFigma = (f: File) => /\.json$/i.test(f.name);

async function figmaDoc(f: File): Promise<any | undefined> {
  try { const d = JSON.parse(await f.text()); return d?.document?.children ? d : undefined; } catch { return undefined; }
}

// Same idea as `preflight match`: the guidelines whose deliverables recognise the most file/frame names.
async function autoPick(files: File[]) {
  const names: string[] = [];
  for (const f of files) {
    const doc = isFigma(f) ? await figmaDoc(f) : undefined;
    if (doc) names.push(...framesFromDoc(doc).frames.map((fr) => fr.name)); else names.push(f.name);
  }
  let best = -1, bestCount = 0;
  guidelines.forEach((g, i) => {
    const c = names.filter((n) => deliverableFor(g.value, n)).length;
    if (c > bestCount) { best = i; bestCount = c; }
  });
  if (best >= 0) guidelinesSel.value = String(best);
}

function videoFacts(f: File, _needs: DecodeNeeds): Promise<VideoFacts> {
  const partial = "In the browser only size and length are read. Frame rate, codec, audio, loudness and black frames are measured by the Preflight app or CLI.";
  return new Promise((resolve) => {
    const audio = f.type.startsWith("audio/") || /\.(wav|mp3|ogg|flac|m4a|aac|aiff?)$/i.test(f.name);
    const el = document.createElement(audio ? "audio" : "video");
    const url = URL.createObjectURL(f);
    const done = (facts: VideoFacts) => { URL.revokeObjectURL(url); clearTimeout(timer); resolve({ ...facts, partial }); };
    const timer = setTimeout(() => done({ audioUnknown: true }), 8000);
    el.preload = "metadata";
    // Audio: Safari may list tracks (audioTracks); a positive is trusted, anything else stays unknown.
    const tracks = (el as HTMLMediaElement & { audioTracks?: { length: number } }).audioTracks;
    el.onloadedmetadata = () => done(audio ? { durationS: el.duration, audioCodec: "audio" } : {
      width: (el as HTMLVideoElement).videoWidth || undefined, height: (el as HTMLVideoElement).videoHeight || undefined, durationS: el.duration,
      ...(tracks?.length ? { audioCodec: "audio" } : { audioUnknown: true }), // an empty list at metadata time isn't proof of silence
    });
    el.onerror = () => done({ audioUnknown: true }); // a codec this browser can't play (e.g. ProRes): nothing measured here
    el.src = url;
  });
}

async function run(files: File[], pick = true) {
  if (!files.length) return;
  lastFiles = files;
  empty.hidden = true;
  setStatus(`Checking ${files.length} file${files.length === 1 ? "" : "s"}…`);
  if (pick) await autoPick(files);
  const g = guidelines[Number(guidelinesSel.value)]?.value ?? guidelines[0].value;
  const assets: AssetReport[] = [];
  for (const [i, f] of files.entries()) {
    setStatus(`Checking ${i + 1} of ${files.length}: ${f.name}`);
    const doc = isFigma(f) ? await figmaDoc(f) : undefined;
    if (doc) { assets.push(...frameReports(g, framesFromDoc(doc), f.name)); continue; }
    const head = Buffer.from(await f.slice(0, 1024).arrayBuffer());
    assets.push(await checkAsset(g, {
      asset: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, name: f.name, bytes: f.size, head,
      image: async () => probeImage(Buffer.from(await f.arrayBuffer())),
      video: (needs) => videoFacts(f, needs),
    }));
  }
  const report = buildReport(g, assets);
  lastReport = { report, html: "" };
  (globalThis as { __preflight?: Report }).__preflight = report; // for automated checks of the page
  rerender();
  const s = report.summary;
  setStatus(`${s.assets} checked · ${s.errors} blocking · ${s.warnings} to fix · ${s.passed} ready — against “${g.project}”`);
}

function rerender() {
  if (!lastReport) return;
  const brand = brands[Number(brandSel.value)]?.value;
  lastReport.html = renderHtml(lastReport.report, { brand, generatedAt: new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC" });
  frame.srcdoc = lastReport.html;
  frame.hidden = false;
  document.body.classList.add("has-report");
}

// ---------- chrome ----------

function setStatus(t: string) { status.textContent = t; }
function showError(t: string) { setStatus(`⚠︎ ${t}`); }
function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!); }

function download(name: string, type: string, text: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$("choose").onclick = () => { const i = Object.assign(document.createElement("input"), { type: "file", multiple: true }); i.onchange = () => run([...(i.files ?? [])]); i.click(); };
$("chooseFolder").onclick = () => { const i = Object.assign(document.createElement("input"), { type: "file" }); i.setAttribute("webkitdirectory", ""); i.onchange = () => run([...(i.files ?? [])].filter((f) => !f.name.startsWith("."))); i.click(); };
$("demo").onclick = async () => run(await demoFiles());
$("saveHtml").onclick = () => lastReport && download("preflight-report.html", "text/html", lastReport.html);
$("saveJson").onclick = () => lastReport && download("preflight-report.json", "application/json", JSON.stringify(lastReport.report, null, 2));
document.addEventListener("dragover", (e) => { e.preventDefault(); document.body.classList.add("dragging"); });
document.addEventListener("dragleave", (e) => { if (!e.relatedTarget) document.body.classList.remove("dragging"); });
document.addEventListener("drop", async (e) => { e.preventDefault(); document.body.classList.remove("dragging"); run(await filesFromDrop(e)); });

boot().catch((e) => showError(`Couldn't load the bundled guidelines: ${(e as Error).message}`));
