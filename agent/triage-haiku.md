## Spring launch review: exports checked, Figma not checked

**Guidelines:** `acme-spring` (the only project on the server; the report labels it "Acme spring launch (dummy)"). I checked the 9 files in `spring-launch/exports`. I did not check the Figma file: `check_figma` takes a figma.com link or a `figma:FILEKEY`, and I was given a local JSON path. Send me the Figma link and I'll run it.

**Possible spec issue:** Two of the errors are colour profile. The Instagram feed PNG is Display P3 and the banner is CMYK. Both need sRGB, so the export preset may be the cause rather than each file. Worth checking the export settings once.

### Blocks delivery (10 errors)

- **acme-spring_ig-story_v1.mp4** (3 errors)
  - Frame rate is 25 fps; Instagram story needs 30. [video.fps]
  - Runs 18 s; the limit is 15 s. [video.duration]
  - Loudness is -10.8 LUFS, 3.2 LU too loud; target is -14 ±1. [video.loudness]
  - Fix: re-export at 30 fps, trim to 15 s, and normalise audio to -14 LUFS in Premiere.
- **acme-spring_ig-story_v3.mp4** (2 errors)
  - Landscape 1920×1080; needs portrait 1080×1920. [video.dimensions]
  - No audio track; Instagram story needs sound. [video.audio]
  - Fix: re-export portrait with an audio track. This may be a stray or draft file.
- **acme-spring_ig-feed_v2.png** (2 errors)
  - 2160×2700 (2× export); spec is 1080×1350. [image.dimensions]
  - Display P3 profile; needs sRGB. [image.colorProfile]
  - Fix: re-export at 1×, with File > Export using Convert to sRGB.
- **acme-spring_banner_v1.jpg** (2 errors)
  - CMYK colour mode; web banner needs RGB. [image.colorMode]
  - Generic CMYK profile; needs sRGB, or colours will shift. [image.colorProfile]
  - Fix: re-export as RGB with the sRGB profile.
- **acme-spring_logo_v1.png** (1 error)
  - No alpha channel; logo needs a transparent background. [image.transparency]
  - Fix: re-export with transparency. `acme-spring_logo_v2.png` already has it and passes.

### Fix if quick (4 warnings)

- **Acme Spring Banner FINAL.jpg** (2 warnings)
  - Name doesn't match the convention `acme-spring_<deliverable>_v<N>.<ext>`. [naming.pattern]
  - No colour profile embedded; expected sRGB. [image.colorProfile]
  - Fix: rename, and re-export with sRGB embedded. It may duplicate `banner_v1`, which is a different file; confirm which one is final.
- **acme-spring_ig-story_v1.mp4** (1 warning)
  - 1 s of black at the start; at most 0.5 s allowed. [video.blackEdges]
  - Fix: trim the first second.
- **acme-spring_logo_v1.png** (1 warning)
  - No colour profile embedded; expected sRGB. [image.colorProfile]
  - Fix: re-export with sRGB. This file has other errors too, so it may be superseded by v2.

### Needs a human eye

- The tool returned no info-level items. Nothing in the folder needed a judgement call.
- Please confirm whether `ig-story_v3` (landscape, no audio) and `logo_v1` are meant to go to the client or are superseded drafts. They fail the spec regardless.
- The guidelines don't cover visual content, so the banner, feed post and story still need a look for layout and copy.

### Verdicts

- acme-spring_ig-feed_v2.png: needs fixes
- acme-spring_ig-feed_v3.jpg: ready
- acme-spring_ig-story_v1.mp4: needs fixes
- acme-spring_ig-story_v2.mp4: ready
- acme-spring_ig-story_v3.mp4: needs fixes (or remove if it's a draft)
- acme-spring_banner_v1.jpg: needs fixes
- Acme Spring Banner FINAL.jpg: needs fixes (naming and profile; confirm it's the final banner)
- acme-spring_logo_v1.png: needs fixes (or remove if superseded)
- acme-spring_logo_v2.png: ready
