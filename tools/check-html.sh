#!/bin/sh
# Layout check for the HTML report at phone-to-desktop widths (macOS, system WebKit). Exit 1 on any problem.
set -eu
cd "$(dirname "$0")/.."
t=$(mktemp -d)
node src/cli.ts check -g examples/projects/acme-spring.json --html "$t/a.html" examples/spring-launch/exports examples/spring-launch/campaign.figma.json >/dev/null || true
[ -d examples/streaming/assets ] || examples/streaming/make-assets.sh
node src/cli.ts check -g examples/projects/streaming-delivery.json --html "$t/b.html" examples/streaming >/dev/null || true
bad=0
for f in "$t/a.html" "$t/b.html"; do for mode in light dark; do for w in 320 390 800 1280 1680; do
  r=$(swift tools/layout-check.swift "$f" "$w" "$mode" 2>/dev/null)
  [ "$r" = clean ] || { echo "$(basename "$f") @ $w $mode:"; echo "$r" | head -4 | sed 's/^/    /'; bad=1; }
done; done; done
rm -rf "$t"; [ $bad = 0 ] && echo "layout and contrast clean at 320-1680 px, light and dark"; exit $bad
