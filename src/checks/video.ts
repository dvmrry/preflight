import type { Deliverable, Finding } from "../types.ts";
import type { VideoFacts } from "../formats/media.ts";
import type { findingMaker } from "../guidelines.ts";
import { sizeProblem } from "./size.ts";
import { kb } from "./image.ts";

type Make = ReturnType<typeof findingMaker>;

const EDGE = 0.05; // a black segment within 50 ms of the start or end counts as "at the edge"

export function checkVideo(f: VideoFacts, d: Deliverable, bytes: number, path: string, make: Make): Finding[] {
  if (f.error) return [make("video.unreadable", "error", `Couldn't analyse the video: ${f.error}.`)];
  const out: Finding[] = [];
  const v = d.video ?? {};
  const ext = (path.match(/\.([^./\\]+)$/)?.[1] ?? "").toLowerCase();
  if (d.formats && !d.formats.map((x) => x.toLowerCase()).includes(ext)) {
    out.push(make("video.format", "error", `${d.name} must be ${d.formats.join(" or ")}, this is .${ext}.`, { expected: d.formats, actual: ext }));
  }
  const sz = f.width !== undefined ? sizeProblem(d, f.width, f.height) : undefined;
  if (sz) {
    const turned = sz.swapped ? " (portrait and landscape are swapped)" : "";
    const flag = f.rotation !== undefined ? ` The file is stored rotated ${f.rotation}° and this is how it displays.` : "";
    out.push(make("video.dimensions", "error", `${d.name} ${sz.why}; this is ${sz.actual}${turned}.${flag}`,
      { expected: sz.expected, actual: sz.actual, ...(sz.swapped && { fix: `Re-render from a sequence of the right orientation (${sz.expected}); rotating the clip would turn the picture on its side.` }) }));
  }
  if (d.maxBytes && bytes > d.maxBytes) {
    out.push(make("video.size", "error", `File is ${kb(bytes)}, over the ${kb(d.maxBytes)} limit.`, { expected: `≤ ${d.maxBytes}`, actual: bytes }));
  }
  if (v.fps && f.fps && Math.abs(f.fps - v.fps) > 0.01) {
    out.push(make("video.fps", "error", `Frame rate is ${f.fps} fps, ${d.name} needs ${v.fps}.`, { expected: v.fps, actual: f.fps }));
  }
  if (v.maxFps && f.fps && f.fps > v.maxFps + 0.01) {
    out.push(make("video.fps", "error", `Frame rate is ${f.fps} fps, ${d.name} allows at most ${v.maxFps}.`, { expected: v.maxFps, actual: f.fps }));
  }
  if (v.codec && f.codec && !v.codec.includes(f.codec)) {
    out.push(make("video.codec", "error", `Video codec is ${f.codec}, ${d.name} needs ${v.codec.join(" or ")}.`, { expected: v.codec, actual: f.codec }));
  }
  if (f.durationS !== undefined) {
    const dur = +f.durationS.toFixed(2);
    if (v.maxDurationS && dur > v.maxDurationS) out.push(make("video.duration", "error", `Runs ${dur} s, the limit for ${d.name} is ${v.maxDurationS} s.`, { expected: `≤ ${v.maxDurationS}`, actual: dur }));
    if (v.minDurationS && dur < v.minDurationS) out.push(make("video.duration", "error", `Runs ${dur} s, ${d.name} needs at least ${v.minDurationS} s.`, { expected: `≥ ${v.minDurationS}`, actual: dur }));
  }
  if (f.rotation !== undefined && !out.some((x) => x.rule === "video.dimensions")) {
    out.push(make("video.rotation", "warning", `The file is stored rotated ${f.rotation}° with a display flag; some platforms ignore it and show it sideways. Re-export without rotation metadata.`, { actual: f.rotation }));
  }
  if (v.audio === "required" && !f.audioCodec && !f.audioUnknown) out.push(make("video.audio", "error", `No audio track; ${d.name} needs sound.`, { expected: "audio", actual: "none" }));
  if (v.audio === "forbidden" && f.audioCodec) out.push(make("video.audio", "warning", `Has an audio track; ${d.name} should be silent.`, { expected: "none", actual: f.audioCodec }));
  if (f.audioCodec) {
    const bad: string[] = [];
    if (v.audioCodec && !v.audioCodec.includes(f.audioCodec)) bad.push(`codec ${f.audioCodec} (needs ${v.audioCodec.join(" or ")})`);
    if (v.audioChannels && f.audioChannels !== v.audioChannels) bad.push(`${f.audioChannels} channel(s) (needs ${v.audioChannels})`);
    if (v.audioSampleRates && f.audioSampleRate && !v.audioSampleRates.includes(f.audioSampleRate)) bad.push(`${f.audioSampleRate / 1000} kHz (needs ${v.audioSampleRates.map((r) => r / 1000).join(" or ")} kHz)`);
    if (v.minAudioBitrateKbps && f.audioBitrateKbps && f.audioBitrateKbps < v.minAudioBitrateKbps) bad.push(`${f.audioBitrateKbps} kbps (needs ≥ ${v.minAudioBitrateKbps})`);
    if (bad.length) out.push(make("video.audioFormat", "error", `Audio is ${bad.join(", ")}.`, { actual: bad, fix: "Re-export the audio with the required codec, channels, sample rate and bitrate." }));
  }
  if (v.loudness && f.audioCodec) {
    const { targetLufs, tolerance = 1, maxTruePeakDb } = v.loudness;
    const l = f.loudnessLufs;
    if (f.audioSilent) {
      out.push(make("video.loudness", "error", `The audio track is silent; target ${targetLufs} ±${tolerance} LUFS.`, { expected: `${targetLufs} ±${tolerance} LUFS`, actual: "silent" }));
    } else if (f.loudnessUnmeasured) {
      out.push(make("video.loudnessUnmeasured", "warning", `Couldn't measure loudness on this audio track, so it needs a listen.`));
    } else if (l !== undefined && Math.abs(l - targetLufs) > tolerance) {
      const dir = l > targetLufs ? `${(l - targetLufs).toFixed(1)} LU too loud` : `${(targetLufs - l).toFixed(1)} LU too quiet`;
      out.push(make("video.loudness", "error", `Loudness is ${l} LUFS (${dir}); target ${targetLufs} ±${tolerance}.`, { expected: `${targetLufs} ±${tolerance} LUFS`, actual: l }));
    }
    if (maxTruePeakDb !== undefined && f.truePeakDb !== undefined && f.truePeakDb > maxTruePeakDb) {
      out.push(make("video.truePeak", "warning", `True peak reaches ${f.truePeakDb} dBTP, above the ${maxTruePeakDb} dBTP ceiling (risk of clipping after upload).`, { expected: `≤ ${maxTruePeakDb}`, actual: f.truePeakDb }));
    }
  }
  if (v.maxBlackAtEdgesS !== undefined && f.black && f.durationS) {
    for (const b of f.black) {
      const len = +(b.endS - b.startS).toFixed(2);
      const where = b.startS <= EDGE ? "start" : b.endS >= f.durationS - EDGE ? "end" : undefined;
      if (where && len > v.maxBlackAtEdgesS) {
        out.push(make("video.blackEdges", "warning", `${len} s of black at the ${where}; at most ${v.maxBlackAtEdgesS} s allowed.`, { location: `${b.startS}-${b.endS} s`, expected: `≤ ${v.maxBlackAtEdgesS}`, actual: len }));
      }
    }
  }
  return out;
}
