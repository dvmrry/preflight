#!/bin/sh
# Builds dist/Preflight.app: the SwiftUI window, the checker compiled to a standalone binary (no Node needed), the
# example guidelines and brand profiles (packed, logos embedded), and the icon. Ad-hoc signed, for running on this Mac.
# Private brand kits (examples/brands/<name>/brand.jsonc not in the public repo) are packed in when present.
set -eu
cd "$(dirname "$0")/../.."
app="dist/Preflight.app"; rm -rf "$app" "dist/Asset Review.app"; mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
res="$app/Contents/Resources"
bun build src/cli.ts --compile --outfile "$res/preflight" >/dev/null
swiftc -O -parse-as-library tools/mac-app/Preflight.swift -o "$app/Contents/MacOS/Preflight"
for f in examples/projects/*.json examples/projects/*.jsonc; do [ -e "$f" ] || continue; cp "$f" "$res/guidelines-$(basename "$f")"; done
for p in examples/brands/*/brand.jsonc; do
  name=$(basename "$(dirname "$p")")
  [ -x "examples/brands/$name/prepare.sh" ] && "examples/brands/$name/prepare.sh" # fetches logo files a kit can't ship
  node src/cli.ts brand pack "$p" "$res/brand-$name.json"
done
t=$(mktemp -d); swift tools/mac-app/icon.swift "$t/Preflight.iconset" 2>/dev/null && iconutil -c icns "$t/Preflight.iconset" -o "$res/Preflight.icns"
cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Preflight</string>
  <key>CFBundleDisplayName</key><string>Preflight</string>
  <key>CFBundleIdentifier</key><string>local.preflight</string>
  <key>CFBundleExecutable</key><string>Preflight</string>
  <key>CFBundleIconFile</key><string>Preflight</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.2</string>
  <key>LSMinimumSystemVersion</key><string>26.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CFBundleDocumentTypes</key><array>
    <dict><key>CFBundleTypeName</key><string>Exports folder</string><key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string><key>LSItemContentTypes</key><array><string>public.folder</string></array></dict>
    <dict><key>CFBundleTypeName</key><string>Design export</string><key>CFBundleTypeRole</key><string>Viewer</string>
      <key>LSHandlerRank</key><string>Alternate</string>
      <key>LSItemContentTypes</key><array><string>public.image</string><string>public.movie</string><string>public.audio</string><string>public.json</string></array></dict>
  </array>
</dict></plist>
PLIST
codesign -s - --force --deep "$app" 2>/dev/null
echo "$app"
