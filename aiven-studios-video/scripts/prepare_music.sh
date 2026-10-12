#!/usr/bin/env bash
# Cut the soundtrack excerpt from "Unknown" by Tanner Helland (CC BY 4.0,
# https://github.com/tannerhelland/free-music). 129.59 BPM, first beat at 0.029 s:
# bars 30–44 (55.59 s – 81.52 s), loudness-normalised to -14 LUFS / -1.5 dBTP.
set -euo pipefail
SRC="${1:?usage: prepare_music.sh path/to/Unknown.mp3}"
ffmpeg -v error -y -ss 55.594 -t 25.931 -i "$SRC" \
  -af "afade=t=in:d=0.03,afade=t=out:st=25.90:d=0.03,loudnorm=I=-14:TP=-1.5:LRA=11" \
  -ar 48000 -ac 2 "$(dirname "$0")/../public/audio/music.wav"
