# AIVEN STUDIOS — promo edit

A 28.7-second, 1920×1080, 60fps edit for AIVEN STUDIOS, in Dutch, built with Remotion on the
**Aiven Studios** Claude Design system: Paper and Black grounds alternating on every cut,
flush-left Manrope headlines with a full stop, JetBrains Mono labels, one red accent per scene,
and every cut locked to the beat of the soundtrack (**129.59 BPM**, one beat = 0.463 s, `b(n)` in `src/brand.ts`).

| Beats | Scene | Ground |
|-------|-------|--------|
| 0–2 | MINDER HANDWERK. | Black |
| 2–4 | MEER GROEI. (red full stop) | Paper |
| 4–8 | Drop: monogram, reticle locks red, wordmark | Black |
| 8–10 | 01 / AI-INTEGRATIE — AI DIE MEEWERKT. | Paper |
| 10–14 | Assistant terminal, a line every half beat, reticle locks on `[OK]` | Black |
| 14–16 | 02 / AUTOMATISERING — ALLES AUTOMATISCH. | Paper |
| 16–20 | LEES. DENK. DOE. step panels light per beat | Black |
| 20–24 | Proof cards: 24/7 · 1 · 0 | Paper |
| 24–26 | 03 / WEBSITES — SITES DIE VERKOPEN. (track peak starts) | Black |
| 26–34 | A site builds itself; CTA press in red; phone | Paper |
| 34–38 | SLIM. / SNEL. / OP MAAT. — one word per beat | Black/Paper/Black |
| 38–44 | GEEN ONNODIGE RUIS. — the full stop grows into the black hole | Black |
| 44–50 | LATEN WE PRATEN. + pill (pressed red) + AIVENSTUDIOS.COM | Paper |
| 50–56 | SHAPING THE INEVITABLE. | Black |
| 56–62 | Wordmark alone, silent hold (the track falls away here) | Black |

Each scene is also its own composition under `AivenStudios-Scenes` in the Studio.

## Brand assets

From the Aiven Studios design-system artifact, used as supplied (never recoloured or redrawn):
`public/brand/{monogram,wordmark}-{white,black}.png` and `public/brand/blackhole.jpg`.
Fonts are bundled in `public/fonts` (SIL OFL), so rendering needs no network access.

## Commands

```console
npm i
npm run dev                                   # preview in Remotion Studio
npx remotion render AivenStudios out/aiven-studios.mp4
python3 scripts/generate_audio.py             # regenerate the SFX
scripts/prepare_music.sh path/to/Unknown.mp3  # re-cut the soundtrack excerpt
```

## Music

"Unknown" by Tanner Helland ([free-music](https://github.com/tannerhelland/free-music)), CC BY 4.0 —
free to publish commercially with credit. Put this in the post description:

> Music: "Unknown" by Tanner Helland (tannerhelland.com), licensed under CC BY 4.0.

Details in `public/audio/CREDITS.md`.
