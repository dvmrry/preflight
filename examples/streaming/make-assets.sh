#!/usr/bin/env bash
# Generates the streaming test set: every deliverable in projects/streaming-delivery.json, some clean, some with
# realistic mistakes (see EXPECTED.md). Synthetic on purpose: no licensing, and every defect is known.
# Needs ffmpeg and python3; on macOS also sips (for colour profiles).
set -euo pipefail
cd "$(dirname "$0")"; out=${OUT:-assets}; rm -rf "$out"; mkdir -p "$out"; cd "$out"
P=/System/Library/ColorSync/Profiles
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
img() { ff -f lavfi -i "testsrc2=s=$1" -frames:v 1 "$2"; }
srgb_jpeg() { python3 -c 'import sys; icc=open(sys.argv[1],"rb").read(); j=open(sys.argv[2],"rb").read()
seg=b"ICC_PROFILE\0\x01\x01"+icc; open(sys.argv[2],"wb").write(j[:2]+b"\xff\xe2"+(len(seg)+2).to_bytes(2,"big")+seg+j[2:])' "$P/sRGB Profile.icc" "$1"; }
vid() { # size dur fps out [audio-filter] [extra args...]
  local s=$1 d=$2 r=$3 out=$4 af=${5:-}; shift 5 || shift $#
  if [ -n "$af" ]; then ff -f lavfi -i "testsrc2=s=$s:r=$r:d=$d" -f lavfi -i "$af" -c:v libx264 -preset ultrafast -crf 35 -pix_fmt yuv420p -c:a aac -shortest "$@" "$out"
  else ff -f lavfi -i "testsrc2=s=$s:r=$r:d=$d" -c:v libx264 -preset ultrafast -crf 35 -pix_fmt yuv420p "$@" "$out"; fi
}
n=${PREFIX:-tunewell_fall}

# Podcast cover: clean / transparent PNG / too small
img 3000x3000 ${n}_podcast-cover_v1.jpg; srgb_jpeg ${n}_podcast-cover_v1.jpg
ff -f lavfi -i "testsrc2=s=3000x3000,format=rgba,colorchannelmixer=aa=0.9" -frames:v 1 ${n}_podcast-cover_v2.png
img 1200x1200 ${n}_podcast-cover_v3.jpg; srgb_jpeg ${n}_podcast-cover_v3.jpg
# YouTube thumbnail: clean / 4:3 / over 2 MB (noise doesn't compress)
img 1280x720 ${n}_yt-thumb_v1.jpg
img 1280x960 ${n}_yt-thumb_v2.jpg
ff -f lavfi -i "nullsrc=s=1600x900,geq=random(1)*255:random(2)*255:random(3)*255" -frames:v 1 ${n}_yt-thumb_v3.png
# App Store iPhone: clean 6.9" / alpha / 4 px off a valid size / exported at 2x
img 1290x2796 ${n}_appstore-iphone_v1.png
ff -f lavfi -i "testsrc2=s=1290x2796,format=rgba" -frames:v 1 ${n}_appstore-iphone_v2.png
img 1180x2560 ${n}_appstore-iphone_v3.png
img 2580x5592 ${n}_appstore-iphone_v4.png
# Google Play: feature graphic clean / 1024x512; screenshot clean / too tall for 2:1; icon
img 1024x500 ${n}_play-feature_v1.jpg
img 1024x512 ${n}_play-feature_v2.png
img 1080x1920 ${n}_play-screenshot_v1.jpg
img 1080x2400 ${n}_play-screenshot_v2.jpg
ff -f lavfi -i "color=c=0x7B2FF7@0.0:s=512x512,format=rgba,drawbox=x=64:y=64:w=384:h=384:color=0x7B2FF7@1:t=fill" -frames:v 1 ${n}_play-icon_v1.png
# Ad companion: clean / over 200 KB
img 640x640 ${n}_ad-companion_v1.jpg
ff -f lavfi -i "nullsrc=s=640x640,geq=random(1)*255:random(2)*255:random(3)*255" -frames:v 1 -q:v 1 ${n}_ad-companion_v2.jpg
# Spotify Canvas: clean 608x1080 6 s (9:16 within "720-1080px tall", read literally) / 1080x1920 (too tall) 12 s (too long)
vid 608x1080 6 24 ${n}_canvas_v1.mp4 ""
vid 1080x1920 12 24 ${n}_canvas_v2.mp4 ""
# App preview: clean 886x1920 20 s 30 fps stereo 48k / 10 s 60 fps mono
vid 886x1920 20 30 ${n}_app-preview_v1.mp4 "sine=f=440:d=20:sample_rate=48000" -ac 2 -ar 48000
vid 886x1920 10 60 ${n}_app-preview_v2.mp4 "sine=f=440:d=10:sample_rate=48000" -ac 1 -ar 48000
# Instagram story video: clean
vid 1080x1920 15 30 ${n}_ig-story_v1.mp4 "sine=f=330:d=15" -ac 2
# Spotify audio ads: clean WAV at -16 LUFS / MP3 48 kHz 128 kbps, far too loud
ff -f lavfi -i "anoisesrc=d=20:c=pink:a=0.5:r=44100:seed=1,lowpass=f=6000" -af "loudnorm=I=-16:TP=-3:LRA=7,aresample=44100" -ac 2 -ar 44100 ${n}_audio-ad_v1.wav
ff -f lavfi -i "anoisesrc=d=20:c=pink:a=0.9:r=48000:seed=2" -af "volume=14dB" -ac 2 -ar 48000 -b:a 128k ${n}_audio-ad_v2.mp3
