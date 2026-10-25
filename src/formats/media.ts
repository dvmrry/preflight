// Video/audio facts and container sniffing: pure, shared by the Node prober (formats/video.ts, ffprobe/ffmpeg) and
// the browser (src/web, media elements).

export interface VideoFacts {
  container?: string;
  durationS?: number;
  width?: number; // as displayed (rotation metadata applied)
  height?: number;
  rotation?: number; // display rotation in degrees, when the file carries one
  fps?: number;
  codec?: string;
  pixFmt?: string;
  audioCodec?: string;
  audioSampleRate?: number;
  audioChannels?: number;
  audioBitrateKbps?: number;
  loudnessLufs?: number; // integrated, EBU R128
  truePeakDb?: number; // dBTP
  black?: { startS: number; endS: number }[]; // segments of black picture ≥ 0.04 s
  audioSilent?: boolean; // integrated loudness is -inf (JSON can't carry -Infinity, so loudnessLufs is dropped)
  loudnessUnmeasured?: boolean; // there is audio but ffmpeg produced no loudness summary
  measured?: { black: boolean; loudness: boolean }; // which decode passes ran (only those a rule needs)
  partial?: string; // set when the platform could only read some facts (the browser: size and length)
  audioUnknown?: boolean; // the platform can't tell whether there is an audio track
  error?: string; // ffprobe/ffmpeg missing or the file unreadable
}

// What a deliverable's rules need from decoding: black frames at the edges, loudness. Without either, ffprobe alone
// (container and stream facts) is enough and nothing is decoded.
export interface DecodeNeeds { blackEdgesS?: number; loudness?: boolean }

export function sniffAudio(head: Buffer): string | undefined {
  if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (head.length >= 3 && head.toString("latin1", 0, 3) === "ID3") return "mp3";
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "mp3";
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "OggS") return "ogg";
  if (head.length >= 4 && head.toString("latin1", 0, 4) === "fLaC") return "flac";
  return undefined;
}

// Container magic numbers, so a video is recognised by content even without its extension.

export function sniffVideo(head: Buffer): string | undefined {
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp") return "mp4/mov";
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return "webm/mkv";
  if (head.length >= 12 && head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 11) === "AVI") return "avi";
  if (head.length >= 4 && head.readUInt32BE(0) === 0x060e2b34) return "mxf";
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "moov") return "mov";
  return undefined;
}
