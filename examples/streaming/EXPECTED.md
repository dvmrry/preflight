# Streaming test set: what each file is

Guidelines: `examples/projects/streaming-delivery.json` (real platform specs, dummy "Tunewell" brand). Regenerate the
files with `./make-assets.sh` (ffmpeg + macOS). Pinned by `test/streaming.test.ts`.

| file | planted problem | rule(s) |
|---|---|---|
| podcast-cover_v1.jpg | none (3000×3000, sRGB) | — |
| podcast-cover_v2.png | transparent PNG, no profile | image.transparency, image.colorProfile |
| podcast-cover_v3.jpg | 1200×1200, under Apple's 1400 minimum | image.dimensions |
| yt-thumb_v1.jpg | none (1280×720) | — |
| yt-thumb_v2.jpg | 4:3 instead of 16:9 | image.dimensions |
| yt-thumb_v3.png | 4 MB, over YouTube's 2 MB | image.size |
| appstore-iphone_v1.png | none (1290×2796, 6.9") | — |
| appstore-iphone_v2.png | alpha channel (App Store rejects) | image.transparency |
| appstore-iphone_v3.png | 1180×2560, not an accepted size | image.dimensions |
| appstore-iphone_v4.png | exported at 2× | image.dimensions (scale hint + fix) |
| play-feature_v1.jpg | none (1024×500) | — |
| play-feature_v2.png | 1024×512 | image.dimensions |
| play-screenshot_v1.jpg | none (1080×1920) | — |
| play-screenshot_v2.jpg | 1080×2400: long side > 2× short | image.dimensions |
| play-icon_v1.png | none (512×512, alpha allowed) | — |
| ad-companion_v1.jpg | none (640×640) | — |
| ad-companion_v2.jpg | 435 KB, over 200 KB | image.size |
| canvas_v1.mp4 | none (608×1080, 6 s) | — |
| canvas_v2.mp4 | 1080×1920 (over "1080px tall"), 12 s | video.dimensions, video.duration |
| app-preview_v1.mp4 | none (886×1920, 20 s, 30 fps, stereo AAC 48 kHz) | — |
| app-preview_v2.mp4 | 10 s, 60 fps, mono | video.duration, video.fps, video.audioFormat |
| ig-story_v1.mp4 | none | — |
| audio-ad_v1.wav | none (44.1 kHz, about -16 LUFS) | — |
| audio-ad_v2.mp3 | 48 kHz, 128 kbps, crushed to about -2 LUFS, true peak over 0 | video.audioFormat, video.loudness, video.truePeak |

`campaign.figma.json` (frames inside a Section):
- ig-story frame: kicker in the top 270 px and CTA in the bottom 670 px (figma.safeArea); Apple Music badge 24 px tall, minimum 30 (brand.logoSize).
- App Store frame: Spotify logo 60 px wide, minimum 70 (brand.logoSize); legal line 5 px from it, inside its clear space (brand.logoClearSpace); Helvetica (brand.font); off-palette grey, 20 px, no text style.
