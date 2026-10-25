#!/usr/bin/env bash
# Regenerates the dummy exports, each with the mistake its name in EXPECTED.md says (macOS: needs ffmpeg and sips).
set -euo pipefail
cd "$(dirname "$0")"; rm -rf exports; mkdir exports; cd exports
P=/System/Library/ColorSync/Profiles
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
emb() { sips -e "$P/$1" "$2" >/dev/null; }
# sips won't embed sRGB into a JPEG (ImageIO treats it as the default), so write the APP2 ICC segment directly.
emb_jpeg() { python3 -c 'import sys; icc=open(sys.argv[1],"rb").read(); j=open(sys.argv[2],"rb").read()
seg=b"ICC_PROFILE\0\x01\x01"+icc; open(sys.argv[2],"wb").write(j[:2]+b"\xff\xe2"+(len(seg)+2).to_bytes(2,"big")+seg+j[2:])' "$P/$1" "$2"; }
ff -f lavfi -i "testsrc2=s=1080x1350" -frames:v 1 acme-spring_ig-feed_v3.jpg;  emb_jpeg "sRGB Profile.icc" acme-spring_ig-feed_v3.jpg
ff -f lavfi -i "testsrc2=s=2160x2700" -frames:v 1 acme-spring_ig-feed_v2.png;  emb "Display P3.icc" acme-spring_ig-feed_v2.png
ff -f lavfi -i "smptebars=s=1200x628" -frames:v 1 acme-spring_banner_v1.jpg
sips -m "$P/Generic CMYK Profile.icc" acme-spring_banner_v1.jpg >/dev/null
ff -f lavfi -i "smptebars=s=1200x628" -frames:v 1 "Acme Spring Banner FINAL.jpg"
ff -f lavfi -i "color=c=0xFF5A1F:s=512x512" -frames:v 1 acme-spring_logo_v1.png
ff -f lavfi -i "color=c=0xFF5A1F@0.0:s=512x512,format=rgba,drawbox=x=128:y=128:w=256:h=256:color=0xFF5A1F@1:t=fill" -frames:v 1 acme-spring_logo_v2.png
emb "sRGB Profile.icc" acme-spring_logo_v2.png
# Videos: 12 s 1080x1920 30 fps h264 with a -14 LUFS-ish tone (pass); 25 fps, too long, too loud, 1 s black head (fail);
# landscape with no audio (fail).
tone="sine=f=440:d=12,volume=7.8dB"
ff -f lavfi -i "testsrc2=s=1080x1920:r=30:d=12" -f lavfi -i "$tone" -c:v libx264 -crf 35 -pix_fmt yuv420p -c:a aac -shortest acme-spring_ig-story_v2.mp4
ff -f lavfi -i "color=c=black:s=1080x1920:r=25:d=1" -f lavfi -i "testsrc2=s=1080x1920:r=25:d=17" -f lavfi -i "sine=f=440:d=18,volume=11dB" \
   -filter_complex "[0:v][1:v]concat=n=2:v=1[v]" -map "[v]" -map 2:a -c:v libx264 -crf 35 -pix_fmt yuv420p -c:a aac acme-spring_ig-story_v1.mp4
ff -f lavfi -i "testsrc2=s=1920x1080:r=30:d=10" -c:v libx264 -crf 35 -pix_fmt yuv420p acme-spring_ig-story_v3.mp4
