# AIVEN STUDIOS — promo (Dutch)

A 25-second, 60fps company ad in the AIVEN STUDIOS brand system, in Dutch, in two formats:

- `AivenStudios` — 1920×1080 (YouTube, LinkedIn, website)
- `AivenStudiosVertical` — 1080×1920 (TikTok, Reels, Shorts); every scene lays itself out vertically via `useStage()`

Built on the scenes of the original AIVEN STUDIOS ad (`p4z5w2y56p-lgtm/porrie`, branch
`claude/aiven-studios-ad`, package `aiven-ad`), re-written for the three services and cut to a licensed track.

## Story (beats of the soundtrack, drop = b(0))

| Beats | Shot |
|-------|------|
| −12…−8 | 00 / INITIALIZE — terminal boot, `[SCAN] 3 kerndiensten online` |
| −8…−4 | 01 / HET MANIFEST — WE WACHTEN NIET AF. → WE BOUWEN DE TOEKOMST. |
| −4…0 | 02 / DE FILOSOFIE — GEEN ONNODIGE RUIS. STRAK ONTWERP. EXTREME UITVOERING — the full stop becomes the black hole |
| 0…2 | 001 / AI-INTEGRATIE. — wireframe neural sphere |
| 2…4 | 002 / AUTOMATISERING. — handwerk (glyph noise) pulled into a locked matrix |
| 4…6 | 003 / WEBSITES. — isometric tower, “gebouwd om te groeien” |
| 7…11.5 | ONEERLIJK / DIGITAAL / VOORDEEL. — one word per beat, X-ray cut |
| 12…14 | DENK. BOUW. GROEI. — step panels |
| 14…16 | Overzicht — 24/7 · 1 · 0 |
| 16…18 | PRECISIE. — wireframe terrain, target lock |
| 18…20 | Stack marquee — AI-INTEGRATIE ✦ AUTOMATISERING ✦ WEBSITES |
| 20…26 | LAUNCH / SEQUENCE. → AIVEN STUDIOS → horizon dive |
| 26…32 | SHAPING THE INEVITABLE. over the black hole |
| 32…38 | 06 / VOLGENDE STAP — KOM PRATEN. + START pill + AIVENSTUDIOS.COM |
| 38… | Hard cut to the logo, silent hold |

Brand-system phrases (INITIALIZE, ALL SYSTEMS NOMINAL, LAUNCH SEQUENCE, SHAPING THE INEVITABLE.) stay in English;
all other copy is Dutch. Copy lives as plain text in `src/studio/*.tsx`.

Outlined type (X-ray cut, marquee) is drawn as a 5px stroke under a fill in the ground colour
(`paint-order: stroke fill`), so overlapping glyph contours never show inside letters like the A.

## Commands

```console
npm i
npm run dev                                                    # Remotion Studio
npx remotion render AivenStudios out/aiven-studios-16x9.mp4 --crf=16 --audio-bitrate=320k
npx remotion render AivenStudiosVertical out/aiven-studios-9x16.mp4 --crf=16 --audio-bitrate=320k
# upload master: BT.709 yuv420p, -14 LUFS / -1.5 dBTP, faststart
ffmpeg -i out/aiven-studios-16x9.mp4 -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -colorspace bt709 \
  -color_primaries bt709 -color_trc bt709 -af loudnorm=I=-14:TP=-1.5:LRA=11 -c:a aac -b:a 320k \
  -movflags +faststart out/AIVEN-STUDIOS-16x9-upload.mp4
scripts/prepare_music.sh path/to/Unknown.mp3                   # re-cut the soundtrack excerpt
```

The beat grid (`src/timeline.ts`) is the only place tied to the track: `BEAT`, `DROP` and `DURATION`.

## Music

"Unknown" by Tanner Helland ([free-music](https://github.com/tannerhelland/free-music)), CC BY 4.0 —
free to publish commercially with credit. Put this in the post description:

> Music: "Unknown" by Tanner Helland (tannerhelland.com), licensed under CC BY 4.0.

Details in `public/audio/CREDITS.md`. Fonts in `public/fonts` are bundled locally, so rendering needs no network.
