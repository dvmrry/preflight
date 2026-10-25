import { over, type RGB } from "../color.ts";

// Reads a Figma file as the REST API returns it (GET /v1/files/:key): live with FIGMA_TOKEN, or from a saved JSON
// file. Finds the deliverable frames (top level of a page or inside sections), flattens each into the elements the
// checks look at, in paint order, and works out what each text run is drawn on top of, so contrast is measured
// against what a viewer actually sees. When that can't be known exactly (a photo, a gradient, a shape that only
// partly covers the text) the background is reported as such, never guessed.

export type Background = RGB | "image" | "mixed" | "unknown";

export interface FigmaFrame {
  id: string;
  name: string;
  page: string;
  width: number;
  height: number;
  rotation?: number; // degrees, when the frame itself is rotated on the canvas
  ids: Set<string>; // every node inside, for node-id links
  elements: FigmaElement[];
}

export interface FigmaElement {
  path: string; // "Frame / Group / Layer"
  name: string;
  type: string;
  box?: { x: number; y: number; width: number; height: number }; // relative to the frame's top-left
  paints: boolean; // draws something itself (a fill, stroke or text), as opposed to a bare group
  fillKind?: "image" | "gradient"; // top fill when it isn't a solid colour
  fills: { color: RGB; opacity: number }[]; // visible solid fills only (what the palette check reads)
  text?: { styleId?: string; characters: string; background: Background; runs: TextRun[] };
}

// One distinct style inside a text layer: the base style, or a character-range override.
export interface TextRun {
  family: string;
  size: number;
  weight?: number;
  color?: RGB; // as seen: fill opacity and layer opacity composited over the background; undefined if not solid
  fill: "solid" | "gradient" | "image" | "none";
  sample: string; // the run's first characters
}

export interface FigmaSource { key: string; nodeId?: string }

export function parseFigmaSource(source: string): FigmaSource | undefined {
  const k = source.match(/^figma:([A-Za-z0-9]+)$/);
  if (k) return { key: k[1] };
  let u: URL;
  try { u = new URL(source); } catch { return undefined; }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return undefined;
  // /design/KEY/Name, /file/KEY/Name, or a branch: /design/KEY/branch/BRANCHKEY/Name (the branch is its own file)
  const m = u.pathname.match(/^\/(?:file|design|proto)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!m) return undefined;
  const node = u.searchParams.get("node-id");
  return { key: m[2] ?? m[1], nodeId: node ? node.replace("-", ":") : undefined };
}

// Frames of a Figma REST document (GET /v1/files/:key). Pure: loading (file or API) lives in src/io.ts.
export function framesFromDoc(doc: any, nodeId?: string): { fileName: string; frames: FigmaFrame[]; skipped: string[] } {
  const frames: FigmaFrame[] = [];
  const skipped: string[] = []; // visible top-level things that aren't frames, so the report can say what wasn't checked
  const visit = (node: any, page: any, trail: string[]) => {
    if (node.visible === false) return;
    if (node.type === "SECTION" || node.type === "GROUP") {
      for (const c of node.children ?? []) visit(c, page, [...trail, node.name]);
    } else if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)) {
      frames.push(frameOf(node, page.name, page.id));
    } else {
      skipped.push(`${[page.name, ...trail, node.name].join(" / ")} (${node.type.toLowerCase()})`);
    }
  };
  for (const page of doc.document?.children ?? []) for (const node of page.children ?? []) visit(node, page, []);
  // A link to one node narrows the check to the frame(s) it is, contains, or sits in.
  const scoped = nodeId ? frames.filter((f) => f.ids.has(nodeId) || (f as any).pageId === nodeId) : frames;
  return { fileName: doc.name ?? "Figma file", frames: scoped, skipped };
}

function frameOf(node: any, page: string, pageId: string): FigmaFrame {
  // `size` is the frame's own width/height; absoluteBoundingBox grows when the frame is rotated.
  const box = node.absoluteBoundingBox ?? { width: 0, height: 0 };
  const w = node.size?.x ?? box.width, h = node.size?.y ?? box.height;
  const rotation = rotationOf(node);
  const ids = new Set<string>();
  const f: FigmaFrame & { pageId: string } = { id: node.id, name: node.name, page, pageId, width: Math.round(w), height: Math.round(h), ids, elements: flatten(node, ids) };
  if (rotation) f.rotation = rotation;
  return f;
}

function rotationOf(n: any): number | undefined {
  let deg: number | undefined = typeof n.rotation === "number" ? n.rotation : undefined;
  const t = n.relativeTransform;
  if (deg === undefined && Array.isArray(t) && t[0] && t[1]) deg = (Math.atan2(t[1][0], t[0][0]) * 180) / Math.PI;
  if (deg === undefined) return undefined;
  const r = Math.round(deg * 100) / 100;
  return Math.abs(r) < 0.01 ? undefined : r;
}

interface Painted { box: Box; bg: Background; covers: boolean } // covers: paints its whole bounding box
interface Box { x: number; y: number; width: number; height: number }

const RECT_LIKE = ["RECTANGLE", "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"];

function flatten(frame: any, ids: Set<string>): FigmaElement[] {
  const origin = frame.absoluteBoundingBox ?? { x: 0, y: 0 };
  const out: FigmaElement[] = [];
  const painted: Painted[] = []; // everything drawn so far, bottom to top
  const walk = (n: any, path: string[], inherited: number) => {
    if (n.visible === false) return;
    if (n.id) ids.add(n.id);
    const opacity = inherited * (n.opacity ?? 1);
    const fills = (n.fills ?? []).filter((f: any) => f.visible !== false);
    const solid = fills.filter((f: any) => f.type === "SOLID").map((f: any) => ({ color: f.color, opacity: opacity * (f.opacity ?? 1) * (f.color?.a ?? 1) }));
    const box: Box | undefined = n.absoluteBoundingBox;
    const strokes = (n.strokes ?? []).filter((f: any) => f.visible !== false);
    const el: FigmaElement = { path: [...path, n.name].join(" / "), name: n.name, type: n.type, fills: solid,
      paints: n.type === "TEXT" || fills.length > 0 || strokes.length > 0 || ["VECTOR", "BOOLEAN_OPERATION", "INSTANCE"].includes(n.type) };
    if (box) el.box = { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height };
    const topFill = fills[fills.length - 1];
    if (topFill && topFill.type !== "SOLID") el.fillKind = topFill.type === "IMAGE" || topFill.type === "VIDEO" ? "image" : "gradient";
    if (n.type === "TEXT" && n.style) {
      const background = box ? backgroundAt(painted, box) : "unknown";
      el.text = { styleId: n.styles?.text, characters: n.characters ?? "", background, runs: textRuns(n, opacity, background) };
    } else if (box && fills.length) {
      // Composite the node's fills bottom to top over whatever is already under it.
      let bg: Background = backgroundAt(painted, box);
      for (const f of fills) {
        if (f.type === "SOLID") {
          const a = opacity * (f.opacity ?? 1) * (f.color?.a ?? 1);
          bg = a >= 0.999 ? f.color : typeof bg === "object" ? over(f.color, a, bg) : bg;
        } else if (f.type === "IMAGE" || f.type === "VIDEO") {
          bg = "image";
        } else {
          bg = "mixed"; // gradients and anything else that isn't one colour
        }
      }
      const covers = RECT_LIKE.includes(n.type) && !rotationOf(n);
      painted.push({ box, bg: stripAlpha(bg), covers });
    }
    out.push(el);
    for (const c of n.children ?? []) walk(c, [...path, n.name], opacity);
  };
  walk(frame, [], 1);
  return out;
}

// The topmost painted layer that touches the text decides: if it fully covers the text box (and is a plain
// rectangle), that is the background; if it only partly covers it, the text sits on more than one thing.
function backgroundAt(painted: Painted[], b: Box): Background {
  for (let i = painted.length - 1; i >= 0; i--) {
    const p = painted[i].box;
    const touches = p.x < b.x + b.width && p.x + p.width > b.x && p.y < b.y + b.height && p.y + p.height > b.y;
    if (!touches) continue;
    const contains = p.x <= b.x && p.y <= b.y && p.x + p.width >= b.x + b.width && p.y + p.height >= b.y + b.height;
    return painted[i].covers && contains ? painted[i].bg : "mixed";
  }
  return "unknown";
}

function textRuns(n: any, opacity: number, bg: Background): TextRun[] {
  const chars: string = n.characters ?? "";
  const base = n.style;
  const table = n.styleOverrideTable ?? {};
  const overrides: number[] = n.characterStyleOverrides ?? [];
  // Which style ids are actually used, and where each first appears. The override list may be shorter than the
  // text; characters past its end (and zeros in it) use the base style.
  const first = new Map<number, number>();
  for (let i = 0; i < Math.max(chars.length, 1); i++) {
    const id = overrides[i] ?? 0;
    if (!first.has(id)) first.set(id, i);
  }
  const runs: TextRun[] = [];
  for (const [id, at] of first) {
    const st = id === 0 ? base : { ...base, ...table[id] };
    const fills = ((id !== 0 && table[id]?.fills) || n.fills || []).filter((f: any) => f.visible !== false);
    const top = fills[fills.length - 1];
    const run: TextRun = {
      family: st.fontFamily, size: st.fontSize, weight: st.fontWeight,
      fill: !top ? "none" : top.type === "SOLID" ? "solid" : top.type === "IMAGE" ? "image" : "gradient",
      sample: chars.slice(at, at + 40),
    };
    if (top?.type === "SOLID") {
      const a = opacity * (top.opacity ?? 1) * (top.color?.a ?? 1);
      run.color = a >= 0.999 ? stripAlpha(top.color) as RGB : typeof bg === "object" ? over(top.color, a, bg) : undefined;
    }
    runs.push(run);
  }
  return runs;
}

function stripAlpha(c: Background): Background {
  return typeof c === "object" ? { r: c.r, g: c.g, b: c.b } : c;
}
