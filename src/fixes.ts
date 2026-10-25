import type { Finding } from "./types.ts";

// Known-good fixes, so an agent quotes these instead of improvising (weaker models invent plausible but wrong menu
// paths). Only rules with one unambiguous fix are here; checks pass a `fix` themselves when it depends on context
// (the right palette colour, the export scale), and rules that need a human eye get none.

const list = (x: unknown) => (Array.isArray(x) ? x.join(" or ") : String(x));

export function defaultFix(rule: string, f: Partial<Finding>): string | undefined {
  const e = f.expected;
  switch (rule) {
    case "naming.pattern": return "Rename the file to follow the naming convention.";
    case "file.unreadable": return "Re-copy or re-export the file; it couldn't be opened.";
    case "file.unrecognized": return "Export in the deliverable's required format.";
    case "image.format": return `Export as ${list(e)}.`;
    case "image.extension": return "Re-export in the intended format rather than renaming the file.";
    case "image.damaged": return "Re-export the file; it was cut short or corrupted (often an interrupted upload or sync).";
    case "image.dimensions": return `Set the artboard/frame to ${e} px and re-export.`;
    case "image.size": return "Re-export with more compression (e.g. JPEG quality ~80) or a smaller file format.";
    case "image.colorMode": return "Convert to RGB (Photoshop: Image > Mode > RGB Color) and re-export.";
    case "image.colorProfile":
      return f.actual === null
        ? "Re-export with the colour profile embedded and converted to sRGB."
        : "Convert to sRGB (Photoshop: Edit > Convert to Profile > sRGB IEC61966-2.1) and re-export.";
    case "image.transparency":
      return f.expected === "alpha" ? "Hide the background layer and export as PNG with transparency." : "Flatten onto the background colour before export.";
    case "video.format": return `Render to ${list(e)}.`;
    case "video.dimensions": return `Set the sequence/composition to ${e} and re-render.`;
    case "video.rotation": return "Re-render so the pixels are upright, without a rotation flag.";
    case "video.size": return "Re-render at a lower bitrate.";
    case "video.fps": return `Set the sequence/composition to ${e} fps and re-render.`;
    case "video.codec": return `Render with the ${list(e)} codec.`;
    case "video.duration": return String(e).startsWith("≤") ? `Trim to ${String(e).slice(2)} s or less.` : `Extend to at least ${String(e).slice(2)} s.`;
    case "video.audio": return f.expected === "audio" ? "Re-render with the audio track enabled." : "Render without an audio track.";
    case "video.loudness":
      return f.actual === "silent"
        ? "Check the mix and audio tracks are enabled, then re-render."
        : `Normalise the mix to ${String(e).split(" ")[0]} LUFS (Premiere: Export > Effects > Loudness Normalization) and re-render.`;
    case "video.truePeak": return `Put a true-peak limiter at ${String(e).slice(2)} dBTP on the master and re-render.`;
    case "video.blackEdges": return `Trim the black to ${String(e).slice(2)} s or less.`;
    case "figma.frameSize": return `Set the frame to ${e} in the design panel.`;
    case "figma.rotated": return "Set the frame's rotation to 0°.";
    case "brand.font": return `Change to ${list(e)}, ideally by applying a library text style.`;
    case "text.size": return `Increase to at least ${String(e).slice(2)}px.`;
    case "text.noStyle": return "Apply the matching library text style.";
  }
  return undefined;
}
