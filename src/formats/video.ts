import { spawn } from "node:child_process";
import type { DecodeNeeds, VideoFacts } from "./media.ts";
export type { DecodeNeeds, VideoFacts } from "./media.ts";
export { sniffAudio, sniffVideo } from "./media.ts";

// Video facts come from ffprobe (streams) and one ffmpeg decode pass (loudness and black frames). Both are the
// industry's reference tools, so a number here matches what an editor would see if they measured it themselves.


const TIMEOUT_MS = Number(process.env.PREFLIGHT_FFMPEG_TIMEOUT_S ?? 600) * 1000;



export async function probeVideo(path: string, needs: DecodeNeeds = {}): Promise<VideoFacts> {
  let probe: any;
  try {
    const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", path], 60_000, "stdout");
    probe = JSON.parse(r);
  } catch (e) {
    return { error: (e as Error).message.replace("{tool}", "ffprobe") };
  }
  const f: VideoFacts = {};
  const v = probe.streams?.find((s: any) => s.codec_type === "video");
  const a = probe.streams?.find((s: any) => s.codec_type === "audio");
  f.container = probe.format?.format_name;
  f.durationS = num(probe.format?.duration);
  if (v) {
    f.width = v.width;
    f.height = v.height;
    // Phones and some exporters store a portrait video as landscape pixels plus a rotation flag.
    const rot = v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation ?? v.tags?.rotate;
    if (rot !== undefined && Number(rot) % 360 !== 0) {
      f.rotation = Number(rot);
      if (Math.abs(Number(rot)) % 180 === 90) [f.width, f.height] = [v.height, v.width];
    }
    f.codec = v.codec_name;
    f.pixFmt = v.pix_fmt;
    f.fps = rate(v.avg_frame_rate) ?? rate(v.r_frame_rate);
  }
  if (a) {
    f.audioCodec = a.codec_name;
    f.audioSampleRate = num(a.sample_rate);
    f.audioChannels = a.channels;
    const br = num(a.bit_rate) ?? (v ? undefined : num(probe.format?.bit_rate)); // lossless/VBR streams may only report it on the container
    if (br) f.audioBitrateKbps = Math.round(br / 1000);
  }
  const black = !!v && needs.blackEdgesS !== undefined, loud = !!a && !!needs.loudness;
  f.measured = { black, loudness: loud };
  try {
    // Loudness needs the whole soundtrack, but never the picture (-vn).
    if (loud) Object.assign(f, parseDecodeLog(await decode(path, ["-vn", "-af", "ebur128=peak=true"]), false, true));
    // Black frames only matter at the edges: decode a window at each end instead of the whole video.
    if (black) {
      const win = needs.blackEdgesS! + 1.5, dur = f.durationS ?? 0;
      if (dur > 3 * win) {
        const head = parseDecodeLog(await decode(path, ["-an", "-t", String(win), "-vf", BLACK]), true, false).black ?? [];
        const tailStart = dur - win;
        const tail = (parseDecodeLog(await decode(path, ["-an", "-vf", BLACK], ["-ss", String(tailStart)]), true, false).black ?? [])
          .map((b) => ({ startS: +(b.startS + tailStart).toFixed(3), endS: +(b.endS + tailStart).toFixed(3) }));
        f.black = [...head, ...tail];
      } else {
        f.black = parseDecodeLog(await decode(path, ["-an", "-vf", BLACK]), true, false).black;
      }
    }
  } catch (e) {
    f.error = (e as Error).message.replace("{tool}", "ffmpeg");
  }
  return f;
}

const BLACK = "blackdetect=d=0.04:pix_th=0.10";

// ffmpeg writes its analysis to stderr, even on success.
function decode(path: string, args: string[], before: string[] = []): Promise<string> {
  return run("ffmpeg", ["-hide_banner", "-nostats", ...before, "-i", path, ...args, "-f", "null", "-"], TIMEOUT_MS, "stderr");
}

function run(cmd: string, args: string[], timeoutMs: number, want: "stdout" | "stderr"): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [], err: Buffer[] = [];
    p.stdout.on("data", (d) => out.push(d)); p.stderr.on("data", (d) => err.push(d));
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`analysis took longer than ${timeoutMs / 1000} s and was stopped (PREFLIGHT_FFMPEG_TIMEOUT_S raises it)`)); }, timeoutMs);
    p.on("error", (e: NodeJS.ErrnoException) => { clearTimeout(timer); reject(new Error(e.code === "ENOENT" ? `${cmd} is not installed (needed for video checks)` : `${cmd} failed: ${e.message}`)); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const so = Buffer.concat(out).toString("utf8"), se = Buffer.concat(err).toString("utf8");
      if (code === 0) resolve(want === "stdout" ? so : se);
      else reject(new Error(`${cmd} failed: ${se.trim().split("\n").slice(-2).join(" ")}`));
    });
  });
}

export function parseDecodeLog(log: string, hasVideo: boolean, hasAudio: boolean): Partial<VideoFacts> {
  const out: Partial<VideoFacts> = {};
  if (hasVideo) {
    // Merge segments split by a frame or two of near-black (a fade), so the total at an edge is what's judged.
    const segs = [...log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => ({ startS: +m[1], endS: +m[2] }));
    out.black = [];
    for (const s of segs) {
      const last = out.black[out.black.length - 1];
      if (last && s.startS - last.endS <= 0.1) last.endS = s.endS;
      else out.black.push({ ...s });
    }
  }
  if (hasAudio) {
    // The summary block at the end: "Integrated loudness:\n    I:         -14.2 LUFS" and "True peak:\n    Peak:  -1.3 dBFS"
    const summary = log.slice(log.lastIndexOf("Summary:"));
    const i = summary.match(/I:\s+(-?[\d.]+|-inf) LUFS/);
    const p = summary.match(/Peak:\s+(-?[\d.]+|-inf) dBFS/);
    if (!i) out.loudnessUnmeasured = true;
    else if (i[1] === "-inf") out.audioSilent = true;
    else out.loudnessLufs = +i[1];
    if (p && p[1] !== "-inf") out.truePeakDb = +p[1];
  }
  return out;
}

function rate(r?: string): number | undefined {
  if (!r || r === "0/0") return undefined;
  const [n, d] = r.split("/").map(Number);
  return d ? +(n / d).toFixed(3) : n;
}
function num(x: unknown) { const n = Number(x); return Number.isFinite(n) ? n : undefined; }
