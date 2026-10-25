# Spring Launch — Deliverable Review

**Project:** Acme spring launch
**Assets checked:** 12 · **Errors:** 14 · **Warnings:** 7 · **Info:** 2

---

## ⛔ Blocks delivery (errors — must fix before client review)

### acme-spring_banner_v1.jpg (Web banner)
- **Colour mode is CMYK; web needs RGB.** Colours will look muddy and shift in browsers.
  → Convert to RGB (Photoshop: Image > Mode > RGB Color) and re-export. [image.colorMode]
- **Colour profile is "Generic CMYK Profile"; expected sRGB.** Same root cause — colours will shift.
  → Convert to sRGB (Photoshop: Edit > Convert to Profile > sRGB IEC61966-2.1) and re-export. [image.colorProfile]

### acme-spring_ig-feed_v2.png (Instagram feed post)
- **Exported at 2× (2160×2700); spec is 1080×1350.** Right shape, wrong scale.
  → Re-export at 1× (the export scale is set to 2×). [image.dimensions]
- **Colour profile is Display P3; expected sRGB.** Colours will shift on non-Apple screens.
  → Convert to sRGB (Photoshop: Edit > Convert to Profile > sRGB IEC61966-2.1) and re-export. [image.colorProfile]

### acme-spring_ig-story_v1.mp4 (Instagram story video)
- **Frame rate 25 fps; needs 30 fps.**
  → Set the sequence/composition to 30 fps and re-render. [video.fps]
- **Duration 18 s; limit is 15 s.**
  → Trim to 15 s or less. [video.duration]
- **Loudness −10.8 LUFS; target −14 ±1 LUFS (3.2 LU too loud).**
  → Normalise the mix to −14 LUFS (Premiere: Export > Effects > Loudness Normalization) and re-render. [video.loudness]

### acme-spring_ig-story_v3.mp4 (Instagram story video)
- **Rendered landscape 1920×1080; needs portrait 1080×1920.** Rotating the clip would turn the picture on its side.
  → Re-render from a 1080×1920 sequence. [video.dimensions]
- **No audio track; story video needs sound.**
  → Re-render with the audio track enabled. [video.audio]

### acme-spring_logo_v1.png (Logo)
- **No alpha channel; logo needs a transparent background.**
  → Hide the background layer and export as PNG with transparency. [image.transparency]

### Figma — acme-spring_ig-feed_hero (Instagram feed post)
- **Body text uses Helvetica; brand fonts are Inter / Recoleta.**
  → Change to Inter or Recoleta, ideally by applying a library text style. [brand.font]
- **"Shop the drop" CTA: white on #FF6A2F = 2.85 : 1 contrast; needs ≥ 3 : 1 (large text).**
  → Change the text to #1B1B1F (6.01 : 1 on this background). [text.contrast]
- **Legal line: #B8B0A4 on #F4E9DA = 1.78 : 1 contrast; needs ≥ 4.5 : 1.**
  → Change the text to #1B1B1F (14.31 : 1 on this background). [text.contrast]

### Figma — acme-spring_banner (Web banner)
- **Frame is 1200 × 630; spec is 1200 × 628.**
  → Set the frame to 1200 × 628 in the design panel. [figma.frameSize]

---

## 🟡 Fix if quick (warnings)

### Acme Spring Banner FINAL.jpg (Web banner)
- **Filename doesn't follow the convention** (lowercase, no spaces, versioned).
  → Rename to `acme-spring_banner_v<N>.jpg`. [naming.pattern]
- **No colour profile embedded; viewers will guess.**
  → Re-export with sRGB embedded. [image.colorProfile]

### acme-spring_ig-story_v1.mp4 (Instagram story video)
- **1 s of black at the start; max 0.5 s allowed.**
  → Trim the black to 0.5 s or less. [video.blackEdges]

### acme-spring_logo_v1.png (Logo)
- **No colour profile embedded; viewers will guess.**
  → Re-export with sRGB embedded. [image.colorProfile]

### Figma — acme-spring_ig-feed_hero (Instagram feed post)
- **Badge background #FF6A2F is off-palette** (nearest brand swatch #FF5A1F, ΔE 8.1).
  → Swap to the #FF5A1F library swatch. [brand.color]
- **Legal text colour #B8B0A4 is off-palette** (nearest #F4E9DA, ΔE 20.7).
  → Replace with a palette colour; see the contrast finding above for the recommended #1B1B1F. [brand.color]
- **Legal text is 10 px; minimum is 12 px.**
  → Increase to at least 12 px. [text.size]

---

## 👀 Needs a human eye (info)

### Figma — acme-spring_ig-feed_hero (Instagram feed post)
- **1 text layer (Body) doesn't use a shared text style**, so it won't follow library updates.
  → Apply the matching library text style. [text.noStyle]

### Figma — acme-spring_banner (Web banner)
- **"Photo: the new trail runner" sits on an image** — the tool can't measure contrast here.
  → Please eyeball legibility of this caption against the photo. [text.contrastUnchecked]

---

## ✅ Passed (no findings — checked and ready)

| Asset | Deliverable |
|---|---|
| acme-spring_ig-feed_v3.jpg | Instagram feed post |
| acme-spring_ig-story_v2.mp4 | Instagram story video |
| acme-spring_logo_v2.png | Logo |
| Figma · acme-spring_logo | Logo |

---

## Verdict per asset

| Asset | Verdict |
|---|---|
| acme-spring_ig-feed_v3.jpg | ✅ Ready |
| acme-spring_ig-story_v2.mp4 | ✅ Ready |
| acme-spring_logo_v2.png | ✅ Ready |
| Figma · acme-spring_logo | ✅ Ready |
| acme-spring_banner_v1.jpg | ⛔ Needs fixes (CMYK → RGB + sRGB) |
| acme-spring_ig-feed_v2.png | ⛔ Needs fixes (2× scale + P3 → sRGB) |
| acme-spring_ig-story_v1.mp4 | ⛔ Needs fixes (fps, duration, loudness, black lead-in) |
| acme-spring_ig-story_v3.mp4 | ⛔ Needs fixes (landscape → portrait, missing audio) |
| acme-spring_logo_v1.png | ⛔ Needs fixes (no transparency) |
| Figma · acme-spring_ig-feed_hero | ⛔ Needs fixes (font, 2× contrast, off-palette colours, small text) |
| Figma · acme-spring_banner | ⛔ Needs fixes (frame 2 px off) + 👀 human look on caption |
| Acme Spring Banner FINAL.jpg | 🟡 Needs fixes (naming + colour profile) — likely superseded by v1; confirm with designer whether this file is still needed |

---

**One thing to flag for the team:** the ig-feed_v2 export was rendered at exactly 2× the spec. If the Figma export settings for that frame are still set to 2×, any future re-export will repeat the problem. Worth checking the export preset on the frame before re-exporting.

**Suggested priority before the client review:** fix the 14 errors first (all are re-export / re-render / Figma-edit tasks), then knock out the 7 warnings (mostly re-exports and a rename), and ask the designer to eyeball the banner caption over the photo.