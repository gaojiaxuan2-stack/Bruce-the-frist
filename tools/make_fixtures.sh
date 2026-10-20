#!/usr/bin/env bash
# Builds fake-webcam videos (.y4m) of real hands for the headless hand-tracking tests.
# Needs curl + ffmpeg. Output: out/fixtures/*.y4m (git-ignored).
#   bash tools/make_fixtures.sh
#   node tools/smoke.mjs --input hand --video out/fixtures/point.y4m --wait 6000
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=out/fixtures/src
OUT=out/fixtures
mkdir -p "$SRC"
BASE=https://storage.googleapis.com/mediapipe-assets
for f in fist pointing_up victory thumb_up right_hands; do
  [ -s "$SRC/$f.jpg" ] || curl -sSfL -o "$SRC/$f.jpg" "$BASE/$f.jpg"
done

# right_hands.jpg holds two hands; the right half is one upright open palm.
ffmpeg -loglevel error -y -i "$SRC/right_hands.jpg" -vf "crop=iw/2:ih:iw/2:0" "$SRC/open.jpg"

BG=0xd9d6d0
still() { # name image seconds
  ffmpeg -loglevel error -y -loop 1 -i "$1" -t "$3" -r 15 \
    -vf "scale=-2:380,setsar=1,pad=640:480:(ow-iw)/2:(oh-ih)/2:color=$BG,format=yuv420p" "$OUT/$2.y4m"
}
still "$SRC/fist.jpg" fist 2
still "$SRC/pointing_up.jpg" point 2
still "$SRC/victory.jpg" victory 2
still "$SRC/thumb_up.jpg" thumbsup 2
still "$SRC/open.jpg" open 2

# Gesture sequence: open -> fist -> point -> victory (2 s each), loops forever in Chrome.
ffmpeg -loglevel error -y -i "$OUT/open.y4m" -i "$OUT/fist.y4m" -i "$OUT/point.y4m" -i "$OUT/victory.y4m" \
  -filter_complex "[0][1][2][3]concat=n=4:v=1:a=0,format=yuv420p" "$OUT/sequence.y4m"

# Swipe: an open palm held still on the right, then moved quickly to the left (a "swipe left").
ffmpeg -loglevel error -y -f lavfi -i "color=c=$BG:s=640x480:r=15:d=3" -loop 1 -i "$SRC/open.jpg" \
  -filter_complex "[1]scale=-2:300,setsar=1[h];[0][h]overlay=x='if(lt(t,1.6),400,400-(t-1.6)*1400)':y=90:shortest=1,format=yuv420p" \
  "$OUT/swipe.y4m"

ls -la "$OUT"/*.y4m
