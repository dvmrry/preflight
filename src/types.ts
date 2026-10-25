// The contract between the checks and whoever reads the report (a person, or an agent that ranks and explains).
// A check never judges taste: it measures a fact and compares it with a number or list from the guidelines.
// Every finding names the rule, the measured value and the expected one, so the reader never has to re-measure.

export type Severity = "error" | "warning" | "info";

export type AssetKind = "image" | "video" | "audio" | "figma-frame" | "unknown";

export interface Finding {
  rule: string; // stable id, e.g. "image.dimensions"; guidelines can override its severity
  severity: Severity;
  asset: string; // file path, or "figma:<fileKey>/<frame name>"
  location?: string; // inside the asset, e.g. "text 'Headline'" or "00:00:00-00:00:01.2"
  expected?: unknown;
  actual?: unknown;
  message: string; // one plain sentence a non-specialist understands
  fix?: string; // a known-good fix, when there is one unambiguous fix
  source?: "model"; // set when a language model made the finding (assist commands): advisory, never measured
}

export interface AssetReport {
  asset: string;
  kind: AssetKind;
  deliverable?: string; // which guideline deliverable it was checked against
  facts: Record<string, unknown>; // everything measured, pass or fail, so an agent can answer follow-up questions
  findings: Finding[];
}

export interface Report {
  tool: "preflight";
  version: string;
  project: string;
  assets: AssetReport[];
  summary: { assets: number; passed: number; withFindings: number; errors: number; warnings: number; infos: number };
}

// Guidelines: one JSON file per project. Everything is optional; a missing key means "don't check that".

export interface Guidelines {
  project: string;
  naming?: { pattern: string; description?: string }; // regex on the file (or frame) name
  brand?: {
    palette?: string[]; // hex colours, "#RRGGBB"
    paletteTolerance?: number; // CIEDE2000; 0 = exact. Default 1.0 (about one just-noticeable difference)
    fonts?: string[]; // allowed font families
    minTextSize?: number; // px
    minContrast?: number; // WCAG ratio, e.g. 4.5
    logos?: LogoRule[];
  };
  deliverables?: Deliverable[];
  severity?: Record<string, Severity>; // per-rule override, e.g. { "naming.pattern": "warning" }
}

export interface Deliverable {
  name: string;
  match: string; // glob on the file name (or Figma frame name), e.g. "*_ig-feed_*"
  source?: string; // where the spec comes from (URL), carried into the report for reviewers
  width?: number;
  height?: number;
  sizes?: [number, number][]; // any one of these exact sizes (e.g. the App Store's accepted screenshot sizes)
  anyOrientation?: boolean; // width/height and sizes also match turned 90° (portrait or landscape both accepted)
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  aspect?: string; // "9:16"
  aspectTolerance?: number; // relative, default 0.01
  maxLongToShort?: number; // long side ≤ this × short side (Google Play screenshots: 2)
  safeArea?: { top?: number; bottom?: number; left?: number; right?: number }; // Figma: margins text must stay out of, px
  formats?: string[]; // "png", "jpg", "mp4", "mov", ...
  maxBytes?: number;
  colorProfile?: string[]; // accepted ICC profile names (substring match, case-insensitive), e.g. ["sRGB"]
  colorMode?: ("rgb" | "cmyk" | "gray")[];
  transparency?: "required" | "forbidden";
  video?: VideoSpec;
}

// A logo or badge placed in Figma, found by layer name: minimum size and clear space (no other visible layer within
// the margin, measured as a fraction of the logo's height).
export interface LogoRule {
  name: string;
  match: string; // glob on the layer name, e.g. "Apple Music badge*"
  minHeight?: number;
  minWidth?: number;
  clearSpace?: number; // e.g. 0.1 = 1/10 of the logo height on every side
  source?: string;
}

export interface VideoSpec {
  fps?: number;
  maxFps?: number;
  audioCodec?: string[]; // ffprobe names: "aac", "mp3", "pcm_s16le", "vorbis"
  audioChannels?: number;
  audioSampleRates?: number[]; // Hz
  minAudioBitrateKbps?: number;
  codec?: string[]; // ffprobe codec names: "h264", "hevc", "prores"
  minDurationS?: number;
  maxDurationS?: number;
  audio?: "required" | "forbidden";
  loudness?: { targetLufs: number; tolerance?: number; maxTruePeakDb?: number };
  maxBlackAtEdgesS?: number; // black frames allowed at the head and tail
}
