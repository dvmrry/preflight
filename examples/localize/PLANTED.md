# Planted localisation problems (campaign-locales.figma.json)
| frame | problem | expected finding |
|---|---|---|
| _fr | headline left in English ("Your fall Mix is ready") | deterministic: untranslated (same as EN); model: wrong language |
| _fr | legal line missing | deterministic: missing layer "Legal" |
| _de | kicker left in English ("NEW THIS FALL") | deterministic: untranslated; model: wrong language |
| _de | CTA typo "anhörem" (anhören) | model: typo |
| _de | legal line says 30 October, EN says 31 October | model: meaning change |
