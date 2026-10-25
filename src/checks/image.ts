import type { Deliverable, Finding } from "../types.ts";
import type { ImageFacts } from "../formats/image.ts";
import type { findingMaker } from "../guidelines.ts";
import { sizeProblem } from "./size.ts";

type Make = ReturnType<typeof findingMaker>;

const FORMAT_NAMES: Record<string, string[]> = {
  png: ["png"], jpeg: ["jpg", "jpeg"], webp: ["webp"], gif: ["gif"], bmp: ["bmp"], tiff: ["tif", "tiff"],
  psd: ["psd", "psb"], avif: ["avif"], heic: ["heic", "heif"], svg: ["svg"],
};

// Compares an image's measured facts with its deliverable spec. One finding per broken rule; silence means it passed.
export function checkImage(f: ImageFacts, d: Deliverable, bytes: number, ext: string, make: Make): Finding[] {
  const out: Finding[] = [];
  if (f.format === "unknown") {
    out.push(make("image.format", "warning", `Not an image format this tool reads, so nothing inside it was checked.`, { actual: ext }));
    return out;
  }
  if (f.truncated) {
    out.push(make("image.damaged", "error", `The file looks damaged or cut short (${f.truncated}); re-export it.`, { actual: f.truncated }));
  }
  if (!ext) {
    out.push(make("image.extension", "warning", `The file is a ${f.format.toUpperCase()} but has no file extension.`, { expected: FORMAT_NAMES[f.format], actual: "" }));
  } else if (!FORMAT_NAMES[f.format].includes(ext)) {
    out.push(make("image.extension", "error", `The file is a ${f.format.toUpperCase()} but is named .${ext}.`, { expected: FORMAT_NAMES[f.format], actual: ext }));
  }
  if (f.orientation) {
    out.push(make("image.orientation", "info", `The file carries an EXIF rotation (orientation ${f.orientation}); sizes here are as displayed, but some platforms ignore the flag.`, { actual: f.orientation }));
  }
  if (d.formats && !d.formats.some((x) => FORMAT_NAMES[f.format].includes(x.toLowerCase()))) {
    out.push(make("image.format", "error", `${d.name} must be ${d.formats.join(" or ")}, this is ${f.format}.`, { expected: d.formats, actual: f.format }));
  }
  const sz = sizeProblem(d, f.width, f.height);
  if (sz) {
    const hint = sz.scale ? ` (right shape, exported at ${sz.scale}×)` : sz.swapped ? " (portrait and landscape are swapped)" : "";
    out.push(make("image.dimensions", "error", `${d.name} ${sz.why}; this is ${sz.actual} px${hint}.`,
      { expected: sz.expected, actual: sz.actual, ...(sz.scale && { fix: `Re-export at 1× (the export scale is set to ${sz.scale}×).` }) }));
  }
  if (d.maxBytes && bytes > d.maxBytes) {
    out.push(make("image.size", "error", `File is ${kb(bytes)}, over the ${kb(d.maxBytes)} limit for ${d.name}.`, { expected: `≤ ${d.maxBytes}`, actual: bytes }));
  }
  if (d.colorMode && f.colorMode && !d.colorMode.includes(f.colorMode === "indexed" ? "rgb" : f.colorMode)) {
    out.push(make("image.colorMode", "error", `Colour mode is ${f.colorMode.toUpperCase()}, ${d.name} needs ${d.colorMode.join(" or ").toUpperCase()}.`, { expected: d.colorMode, actual: f.colorMode }));
  }
  if (d.colorProfile) {
    const name = f.iccProfile ?? (f.srgbChunk ? "sRGB" : undefined);
    if (!name) {
      out.push(make("image.colorProfile", "warning", `No colour profile embedded; viewers will guess (expected ${d.colorProfile.join(" or ")}).`, { expected: d.colorProfile, actual: null }));
    } else if (!d.colorProfile.some((p) => name.toLowerCase().includes(p.toLowerCase()))) {
      out.push(make("image.colorProfile", "error", `Colour profile is "${name}", expected ${d.colorProfile.join(" or ")}; colours will shift.`, { expected: d.colorProfile, actual: name }));
    }
  }
  const see = f.transparentPixels; // undefined when not counted (JPEG, tRNS, interlaced, very large)
  if (d.transparency === "required") {
    if (!f.hasAlpha) {
      out.push(make("image.transparency", "error", `${d.name} needs a transparent background, this file has no alpha channel.`, { expected: "alpha", actual: "none" }));
    } else if (see === 0) {
      out.push(make("image.transparency", "error", `${d.name} needs a transparent background; the file has an alpha channel but every pixel is opaque.`, { expected: "alpha", actual: "opaque alpha",
        fix: "Hide the background layer before exporting; the current export fills it in." }));
    }
  } else if (d.transparency === "forbidden" && f.hasAlpha) {
    if (see === 0) {
      out.push(make("image.transparency", "warning", `File has an alpha channel, though every pixel is opaque; ${d.name} should have no alpha channel at all (some stores reject the channel itself).`,
        { expected: "no alpha", actual: "opaque alpha", fix: "Re-export without an alpha channel (PNG-24, or JPEG)." }));
    } else {
      const n = see !== undefined ? ` (${see.toLocaleString("en")} see-through pixels)` : "";
      out.push(make("image.transparency", "error", `File has transparent areas${n}; ${d.name} must be flat.`, { expected: "no alpha", actual: see ?? "alpha",
        fix: "Flatten onto the background colour and re-export without alpha." }));
    }
  }
  return out;
}

// Limits are written either in binary (2097152 = 2 MB) or decimal (200000 = 200 KB) units; show each the way it was meant.
export function kb(n: number) {
  const base = n % 1000 === 0 && n % 1024 !== 0 ? 1000 : 1024;
  return n >= base * base ? `${+(n / base / base).toFixed(1)} MB` : `${Math.round(n / base)} KB`;
}
