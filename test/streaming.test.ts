// Golden test: the streaming test set (real platform specs, synthetic assets with known defects) must raise exactly
// these rules. Generates the assets on first run; skipped where ffmpeg or the macOS sRGB profile isn't available.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { loadGuidelines } from "../src/io.ts";
import { checkFigma, checkFile, expandPaths } from "../src/run.ts";

const EX = new URL("../examples/", import.meta.url).pathname;
const canGenerate = spawnSync("ffmpeg", ["-version"]).status === 0 && existsSync("/System/Library/ColorSync/Profiles/sRGB Profile.icc");

const EXPECTED: Record<string, string[]> = {
  "tunewell_fall_ad-companion_v1.jpg": [],
  "tunewell_fall_ad-companion_v2.jpg": ["image.size"],
  "tunewell_fall_app-preview_v1.mp4": [],
  "tunewell_fall_app-preview_v2.mp4": ["video.audioFormat", "video.duration", "video.fps"],
  "tunewell_fall_appstore-iphone_v1.png": [],
  "tunewell_fall_appstore-iphone_v2.png": ["image.transparency"],
  "tunewell_fall_appstore-iphone_v3.png": ["image.dimensions"],
  "tunewell_fall_appstore-iphone_v4.png": ["image.dimensions"],
  "tunewell_fall_audio-ad_v1.wav": [],
  "tunewell_fall_audio-ad_v2.mp3": ["video.audioFormat", "video.loudness", "video.truePeak"],
  "tunewell_fall_canvas_v1.mp4": [],
  "tunewell_fall_canvas_v2.mp4": ["video.dimensions", "video.duration"],
  "tunewell_fall_ig-story_v1.mp4": [],
  "tunewell_fall_play-feature_v1.jpg": [],
  "tunewell_fall_play-feature_v2.png": ["image.dimensions"],
  "tunewell_fall_play-icon_v1.png": [],
  "tunewell_fall_play-screenshot_v1.jpg": [],
  "tunewell_fall_play-screenshot_v2.jpg": ["image.dimensions"],
  "tunewell_fall_podcast-cover_v1.jpg": [],
  "tunewell_fall_podcast-cover_v2.png": ["image.colorProfile", "image.transparency"],
  "tunewell_fall_podcast-cover_v3.jpg": ["image.dimensions"],
  "tunewell_fall_yt-thumb_v1.jpg": [],
  "tunewell_fall_yt-thumb_v2.jpg": ["image.dimensions"],
  "tunewell_fall_yt-thumb_v3.png": ["image.size"],
};

test("streaming test set: exactly the planted defects", { skip: !canGenerate && !existsSync(EX + "streaming/assets") && "needs ffmpeg + macOS to generate" }, async () => {
  if (!existsSync(EX + "streaming/assets")) execFileSync(EX + "streaming/make-assets.sh");
  const g = loadGuidelines(EX + "projects/streaming-delivery.json");
  const got = Object.fromEntries(await Promise.all(expandPaths([EX + "streaming/assets"]).map(async (p) => {
    const r = await checkFile(g, p);
    return [p.split("/").pop(), r.findings.map((f) => f.rule).sort()];
  })));
  assert.deepEqual(got, EXPECTED);
});

test("streaming Figma campaign: safe area, logo size and clear space, brand rules", async () => {
  const g = loadGuidelines(EX + "projects/streaming-delivery.json");
  const got = (await checkFigma(g, EX + "streaming/campaign.figma.json")).map((r) => [r.asset.split("/").pop(), r.findings.map((f) => f.rule).sort()]);
  assert.deepEqual(got, [
    ["tunewell_fall_ig-story_v1", ["brand.logoSize", "figma.safeArea"]],
    ["tunewell_fall_appstore-iphone_v1", ["brand.color", "brand.font", "brand.logoClearSpace", "brand.logoSize", "text.noStyle", "text.size"]],
  ]);
});
