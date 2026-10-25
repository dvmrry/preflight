import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDecodeLog } from "../src/formats/video.ts";
import { checkVideo } from "../src/checks/video.ts";
import { findingMaker } from "../src/guidelines.ts";
import type { Deliverable } from "../src/types.ts";

// Trimmed from real ffmpeg 9 output (blackdetect + ebur128=peak=true).
const LOG = `
[blackdetect @ 0x1] black_start:0 black_end:1 black_duration:1
[Parsed_ebur128_0 @ 0x2] t: 0.1  TARGET:-23 LUFS    M: -10.0 S:-120.7     I: -10.0 LUFS
[Parsed_ebur128_0 @ 0x2] Summary:

  Integrated loudness:
    I:         -10.8 LUFS
    Threshold: -20.8 LUFS

  True peak:
    Peak:       -0.2 dBFS
`;

test("decode log: black segments and the summary (not the running) loudness", () => {
  assert.deepEqual(parseDecodeLog(LOG, true, true), { black: [{ startS: 0, endS: 1 }], loudnessLufs: -10.8, truePeakDb: -0.2 });
});

test("decode log: silence and a missing summary are explicit, never just absent", () => {
  assert.deepEqual(parseDecodeLog("Summary:\n I:  -inf LUFS\n Peak: -inf dBFS", false, true), { audioSilent: true });
  assert.deepEqual(parseDecodeLog("no summary here", false, true), { loudnessUnmeasured: true });
});

test("decode log: a fade split into black segments is merged", () => {
  const log = "black_start:0 black_end:0.3 x\nblack_start:0.34 black_end:0.7 x\nblack_start:5 black_end:5.2 x";
  assert.deepEqual(parseDecodeLog(log, true, false).black, [{ startS: 0, endS: 0.7 }, { startS: 5, endS: 5.2 }]);
});

const story: Deliverable = {
  name: "Story", match: "*", width: 1080, height: 1920, formats: ["mp4"],
  video: { fps: 30, codec: ["h264"], maxDurationS: 15, audio: "required", loudness: { targetLufs: -14, tolerance: 1, maxTruePeakDb: -1 }, maxBlackAtEdgesS: 0.5 },
};
const make = findingMaker({ project: "t" }, "a.mp4");

test("every video rule fires on a bad export", () => {
  const out = checkVideo({ width: 1920, height: 1080, fps: 25, codec: "hevc", durationS: 18, audioCodec: "aac", loudnessLufs: -10.8, truePeakDb: -0.2, black: [{ startS: 0, endS: 1 }, { startS: 5, endS: 6 }] }, story, 1, "a.mov", make);
  assert.deepEqual(out.map((f) => f.rule), ["video.format", "video.dimensions", "video.fps", "video.codec", "video.duration", "video.loudness", "video.truePeak", "video.blackEdges"]);
  assert.match(out[1].message, /portrait and landscape are swapped/);
  assert.match(out[5].message, /3\.2 LU too loud/);
  assert.equal(out[7].location, "0-1 s"); // the mid-video black segment is not an edge
});

test("a compliant export passes; missing tools are one clear error", () => {
  assert.deepEqual(checkVideo({ width: 1080, height: 1920, fps: 30, codec: "h264", durationS: 12, audioCodec: "aac", loudnessLufs: -14.3, truePeakDb: -2, black: [] }, story, 1, "a.mp4", make), []);
  const err = checkVideo({ error: "ffprobe is not installed (needed for video checks)" }, story, 1, "a.mp4", make);
  assert.equal(err.length, 1);
  assert.equal(err[0].rule, "video.unreadable");
});

test("audio presence unknown (browser) is not reported as a missing track", () => {
  const out = checkVideo({ width: 1080, height: 1920, durationS: 12, audioUnknown: true }, story, 1, "a.mp4", make);
  assert.ok(!out.some((f) => f.rule === "video.audio"));
});
