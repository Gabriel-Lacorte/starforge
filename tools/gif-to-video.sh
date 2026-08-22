#!/usr/bin/env bash
#
# usage: tools/gif-to-video.sh input.gif output.mp4 [scale] [loops]
#
set -euo pipefail

IN=${1:?usage: gif-to-video.sh input.gif output.mp4 [scale] [loops]}
OUT=${2:?usage: gif-to-video.sh input.gif output.mp4 [scale] [loops]}
SCALE=${3:-10}
LOOPS=${4:-8}

BG=0x161616

ffmpeg -v error -stream_loop "$((LOOPS - 1))" -i "$IN" \
    -filter_complex "[0:v]scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor[up];\
color=c=${BG}:s=$(ffprobe -v error -select_streams v -show_entries stream=width -of csv=p=0 "$IN" | head -1 | awk -v s="$SCALE" '{print $1*s}')x$(ffprobe -v error -select_streams v -show_entries stream=height -of csv=p=0 "$IN" | head -1 | awk -v s="$SCALE" '{print $1*s}')[bg];\
[bg][up]overlay=shortest=1,format=yuv420p" \
    -c:v libx264 -profile:v high -crf 16 -movflags +faststart -r 30 \
    "$OUT" -y

ffprobe -v error -show_entries format=duration,size:stream=width,height,codec_name,pix_fmt \
    -of default=nw=1 "$OUT"
