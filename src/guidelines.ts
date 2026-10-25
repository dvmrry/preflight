import type { Deliverable, Finding, Guidelines, Severity } from "./types.ts";
import { defaultFix } from "./fixes.ts";

// Parses and validates guidelines text (JSONC). A typo must fail loudly here, not silently skip a check.
export function parseGuidelines(text: string, label: string): Guidelines {
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonc(text));
  } catch (e) {
    throw new Error(`guidelines ${label}: ${(e as Error).message}`);
  }
  const problems = validateGuidelines(raw);
  if (problems.length) throw new Error(`guidelines ${label}:\n  ${problems.join("\n  ")}`);
  return raw as Guidelines;
}

// Guidelines may carry // and /* */ comments and trailing commas (JSONC, as in VS Code settings), so designers can
// note where a rule comes from. Strings are left untouched.
export function stripJsonc(src: string): string {
  // Pass 1: drop comments (outside strings). Pass 2: drop commas whose next token closes an object/array.
  const noComments = scan(src, (c, n, at, out) => {
    if (c === "/" && n === "/") { while (at.i < src.length && src[at.i] !== "\n") at.i++; return true; }
    if (c === "/" && n === "*") { at.i += 2; while (at.i < src.length && !(src[at.i] === "*" && src[at.i + 1] === "/")) at.i++; at.i += 2; return true; }
    return false;
  });
  return scan(noComments, (c, _n, at) => {
    if (c !== ",") return false;
    let k = at.i + 1;
    while (k < noComments.length && /\s/.test(noComments[k])) k++;
    if (noComments[k] === "}" || noComments[k] === "]") { at.i++; return true; }
    return false;
  });
}

// Copies src, letting `skip` consume text outside string literals.
function scan(src: string, skip: (c: string, n: string | undefined, at: { i: number }, out: string) => boolean): string {
  let out = "", inStr = false;
  const at = { i: 0 };
  while (at.i < src.length) {
    const c = src[at.i], n = src[at.i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n ?? ""; at.i += 2; continue; }
      if (c === '"') inStr = false;
      at.i++;
    } else if (c === '"') { inStr = true; out += c; at.i++; }
    else if (!skip(c, n, at, out)) { out += c; at.i++; }
  }
  return out;
}

const TOP = ["project", "naming", "brand", "deliverables", "severity", "$schema", "notes"];
const BRAND = ["palette", "paletteTolerance", "fonts", "minTextSize", "minContrast", "logos"];
const DELIVERABLE = ["name", "match", "source", "width", "height", "sizes", "anyOrientation", "minWidth", "maxWidth", "minHeight", "maxHeight", "aspect",
  "aspectTolerance", "maxLongToShort", "safeArea", "formats", "maxBytes", "colorProfile", "colorMode", "transparency", "video", "notes"];
const VIDEO = ["fps", "maxFps", "codec", "minDurationS", "maxDurationS", "audio", "audioCodec", "audioChannels", "audioSampleRates",
  "minAudioBitrateKbps", "loudness", "maxBlackAtEdgesS"];
const LOGO = ["name", "match", "minHeight", "minWidth", "clearSpace", "source", "notes"];
const SAFE = ["top", "bottom", "left", "right"];
const SEVERITIES = ["error", "warning", "info"];

// Every rule id a check can emit; severity overrides must name one of these (a typo would silently do nothing).
export const RULES = [
  "naming.pattern", "deliverable.unmatched", "file.unreadable", "file.unrecognized",
  "image.format", "image.extension", "image.damaged", "image.orientation", "image.dimensions", "image.size",
  "image.colorMode", "image.colorProfile", "image.transparency",
  "video.unreadable", "video.partial", "video.format", "video.dimensions", "video.rotation", "video.size", "video.fps", "video.codec",
  "video.duration", "video.audio", "video.audioFormat", "video.loudness", "video.loudnessUnmeasured", "video.truePeak", "video.blackEdges",
  "figma.frameSize", "figma.rotated", "figma.notChecked", "figma.safeArea", "brand.logoSize", "brand.logoClearSpace", "brand.color", "brand.font", "text.size", "text.contrast",
  "text.contrastUnchecked", "text.noStyle",
  "locale.missingLayer", "locale.untranslated",
  "assist.locale.wrongLanguage", "assist.locale.typo", "assist.locale.meaning", "assist.locale.missingInfo",
  "assist.visual.logoDistorted", "assist.visual.logoRecoloured", "assist.visual.logoEffect", "assist.visual.subjectCut", "assist.visual.textLegibility",
];

// Shape checks, by type rather than presence alone: a string "1080" or a "png" where a list belongs fails here
// instead of silently never matching later.
const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const isObj = (x: unknown) => typeof x === "object" && x !== null && !Array.isArray(x);
const isStrList = (x: unknown) => Array.isArray(x) && x.every((v) => typeof v === "string");

// Patterns with a quantified group that itself repeats ("(a+)+", "(\\w*)*") can take exponential time on a
// short name. Guidelines can arrive from an agent, so refuse them rather than risk a hung check.
export function unsafePattern(re: string): string | undefined {
  if (re.length > 300) return "is longer than 300 characters";
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)[+*{?]/.test(re)) return "repeats a group that already repeats (e.g. (a+)+), which can hang";
  return undefined;
}

export function validateGuidelines(g: any): string[] {
  const p: string[] = [];
  const unknownKeys = (o: any, allowed: string[], where: string) => {
    for (const k of Object.keys(o ?? {})) if (!allowed.includes(k)) p.push(`${where}: unknown key "${k}" (allowed: ${allowed.join(", ")})`);
  };
  const want = (ok: boolean, what: string) => { if (!ok) p.push(what); };
  if (!isObj(g)) return ["must be a JSON object"];
  unknownKeys(g, TOP, "top level");
  want(typeof g.project === "string", `"project" must be a string`);
  if (g.naming !== undefined) {
    if (!isObj(g.naming) || typeof g.naming.pattern !== "string") p.push(`naming must be { "pattern": "<regular expression>" }`);
    else {
      try { new RegExp(g.naming.pattern); } catch (e) { p.push(`naming.pattern: ${(e as Error).message}`); }
      const why = unsafePattern(g.naming.pattern);
      if (why) p.push(`naming.pattern ${why}`);
    }
  }
  if (g.brand !== undefined) {
    if (!isObj(g.brand)) p.push(`brand must be an object`);
    else {
      const b = g.brand;
      unknownKeys(b, BRAND, "brand");
      if (b.palette !== undefined) {
        if (!isStrList(b.palette)) p.push(`brand.palette must be a list of "#RRGGBB" strings`);
        else for (const c of b.palette) if (!/^#[0-9a-fA-F]{6}$/.test(c)) p.push(`brand.palette: "${c}" is not #RRGGBB`);
      }
      if (b.fonts !== undefined) want(isStrList(b.fonts), `brand.fonts must be a list of font family names`);
      for (const k of ["paletteTolerance", "minTextSize", "minContrast"]) if (b[k] !== undefined) want(isNum(b[k]), `brand.${k} must be a number`);
      if (b.logos !== undefined && !Array.isArray(b.logos)) p.push(`brand.logos must be a list`);
      else (b.logos ?? []).forEach((l: any, i: number) => {
        const w = `brand.logos[${i}]`;
        if (!isObj(l)) { p.push(`${w} must be an object`); return; }
        unknownKeys(l, LOGO, w);
        want(typeof l.name === "string" && typeof l.match === "string", `${w} needs "name" and "match" strings`);
        for (const k of ["minHeight", "minWidth", "clearSpace"]) if (l[k] !== undefined) want(isNum(l[k]), `${w}.${k} must be a number`);
      });
    }
  }
  if (g.deliverables !== undefined && !Array.isArray(g.deliverables)) p.push(`deliverables must be a list`);
  else (g.deliverables ?? []).forEach((d: any, i: number) => {
    const w = `deliverables[${i}]${d?.name ? ` (${d.name})` : ""}`;
    if (!isObj(d)) { p.push(`${w} must be an object`); return; }
    unknownKeys(d, DELIVERABLE, w);
    want(typeof d.name === "string", `${w}: "name" must be a string`);
    want(typeof d.match === "string", `${w}: "match" must be a glob string`);
    for (const k of ["width", "height", "maxBytes", "minWidth", "maxWidth", "minHeight", "maxHeight", "aspectTolerance", "maxLongToShort"]) if (d[k] !== undefined) want(isNum(d[k]), `${w}: "${k}" must be a number`);
    if (d.sizes !== undefined) want(Array.isArray(d.sizes) && d.sizes.every((x: any) => Array.isArray(x) && x.length === 2 && x.every(isNum)), `${w}: "sizes" must be a list of [width, height] pairs`);
    if (d.aspect !== undefined) want(typeof d.aspect === "string" && /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(d.aspect), `${w}: "aspect" must look like "9:16"`);
    if (d.safeArea !== undefined) {
      if (!isObj(d.safeArea)) p.push(`${w}: "safeArea" must be an object`);
      else { unknownKeys(d.safeArea, SAFE, `${w}.safeArea`); for (const k of SAFE) if (d.safeArea[k] !== undefined) want(isNum(d.safeArea[k]), `${w}.safeArea.${k} must be a number`); }
    }
    for (const k of ["formats", "colorProfile", "colorMode"]) if (d[k] !== undefined) want(isStrList(d[k]), `${w}: "${k}" must be a list of strings`);
    if (d.transparency !== undefined) want(["required", "forbidden"].includes(d.transparency), `${w}: "transparency" must be "required" or "forbidden"`);
    if (d.video !== undefined) {
      if (!isObj(d.video)) { p.push(`${w}.video must be an object`); return; }
      const v = d.video;
      unknownKeys(v, VIDEO, `${w}.video`);
      for (const k of ["fps", "maxFps", "minDurationS", "maxDurationS", "maxBlackAtEdgesS", "audioChannels", "minAudioBitrateKbps"]) if (v[k] !== undefined) want(isNum(v[k]), `${w}.video.${k} must be a number`);
      for (const k of ["codec", "audioCodec"]) if (v[k] !== undefined) want(isStrList(v[k]), `${w}.video.${k} must be a list of strings`);
      if (v.audioSampleRates !== undefined) want(Array.isArray(v.audioSampleRates) && v.audioSampleRates.every(isNum), `${w}.video.audioSampleRates must be a list of numbers`);
      if (v.audio !== undefined) want(["required", "forbidden"].includes(v.audio), `${w}.video.audio must be "required" or "forbidden"`);
      if (v.loudness !== undefined) want(isObj(v.loudness) && isNum(v.loudness.targetLufs), `${w}.video.loudness needs a numeric "targetLufs"`);
    }
  });
  if (g.severity !== undefined && !isObj(g.severity)) p.push(`severity must be an object of rule → level`);
  else for (const [rule, lvl] of Object.entries(g.severity ?? {})) {
    if (!RULES.includes(rule)) p.push(`severity: unknown rule "${rule}"`);
    if (!SEVERITIES.includes(lvl as string)) p.push(`severity.${rule}: "${lvl}" is not one of ${SEVERITIES.join("/")}`);
  }
  return p;
}

// "*_ig-feed_*" style globs on a bare name: * = any run of characters, ? = one character. Case-insensitive.
// A two-pointer matcher, not a regex: linear-ish however many stars the glob has.
export function globMatch(glob: string, name: string): boolean {
  const gl = glob.toLowerCase(), nm = name.toLowerCase();
  let gi = 0, ni = 0, star = -1, mark = 0;
  while (ni < nm.length) {
    if (gi < gl.length && (gl[gi] === "?" || gl[gi] === nm[ni])) { gi++; ni++; }
    else if (gi < gl.length && gl[gi] === "*") { star = gi++; mark = ni; }
    else if (star !== -1) { gi = star + 1; ni = ++mark; }
    else return false;
  }
  while (gl[gi] === "*") gi++;
  return gi === gl.length;
}

export function deliverableFor(g: Guidelines, name: string): Deliverable | undefined {
  return g.deliverables?.find((d) => globMatch(d.match, name));
}

// Builds findings with the project's severity overrides applied, so checks only state their default.
export function findingMaker(g: Guidelines, asset: string) {
  return (rule: string, defaultSeverity: Severity, message: string, extra: Partial<Finding> = {}): Finding => {
    const f: Finding = { rule, severity: g.severity?.[rule] ?? defaultSeverity, asset, message, ...extra };
    const fix = extra.fix ?? defaultFix(rule, extra);
    if (fix) f.fix = fix;
    return f;
  };
}
