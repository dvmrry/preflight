**Spring launch review: `spring-launch/campaign.figma.json`**

I ran the check against the `acme-spring` guidelines, the only project on the server. The file is a saved Figma snapshot, so these results reflect that snapshot, not the live file. Three frames were checked.

**Blocks delivery (4 errors)**

- **Helvetica on the IG feed hero "Body" text.** The brand fonts are Inter and Recoleta. Measured: Helvetica. Fix: switch the layer to Inter, ideally via a shared text style. [brand.font]
- **"Shop the drop" CTA on the IG feed hero has 2.86:1 contrast.** Measured: 2.86:1 on #FF6A2F. Expected: at least 3:1 for large text. Fix: either darken the badge fill to the palette orange #FF5A1F and re-check, or change the CTA text colour to the dark #1B1B1F. The tool did not report the CTA's current text colour, so I can't say which option gives the better number. [text.contrast]
- **Legal line on the IG feed hero has 1.79:1 contrast.** The text is on #F4E9DA and needs 4.5:1. Fix: darken the legal text (for example to #1B1B1F) or move it onto a lighter background. [text.contrast]
- **Web banner is 1200×630, but the spec is 1200×628.** Fix: resize the frame to 1200×628 and check that the artwork still sits correctly. [figma.frameSize]

**Fix if quick (3 warnings)**

- **Badge background #FF6A2F on the IG feed hero is off-palette.** It is close to #FF5A1F (ΔE 8.1). Fix: swap to the Brand/Orange swatch. [brand.color]
- **Legal text colour #B8B0A4 on the IG feed hero is off-palette.** The nearest palette colour is #F4E9DA (ΔE 20.7), so this is not a near miss. Fix: pick a palette colour for the legal text, which also helps the contrast error above. [brand.color]
- **Legal text on the IG feed hero is 10px.** The minimum is 12px. Fix: raise it to 12px or more, which may mean shortening the copy or enlarging the text box. [text.size]

**Needs a human eye (2 info)**

- **Banner caption "Photo: the new trail runner" sits on an image.** The tool cannot measure contrast over a photo, so someone needs to look at legibility. [text.contrastUnchecked]
- **Body text on the IG feed hero doesn't use a shared text style.** It won't follow library updates. Fix: apply a text style when you fix the font. [text.noStyle]

**Verdicts**

- **IG feed hero** (`acme-spring_ig-feed_hero`): needs fixes.
- **Web banner** (`acme-spring_banner`): needs fixes. Also needs a human look at the caption.
- **Logo** (`acme-spring_logo`): ready.
