# AIVEN STUDIOS — promo video

A 34-second, 1920×1080, 60fps motion piece for AIVEN STUDIOS, in Dutch, built with Remotion and styled to the
*AIVEN STUDIOS — Stijlgids voor AI*: monochrome, Manrope uppercase headlines, JetBrains Mono labels,
cuts on a 120 BPM clock (one beat = 30 frames).

| # | Scene | Beats | What happens |
|---|-------|-------|--------------|
| 00 | Hook | 8 | MINDER HANDWERK. → MEER GROEI. |
| — | Logo | 8 | Monogram blur-to-sharp, wordmark, services label |
| 01 | AI-integratie | 12 | Statement, then a live assistant terminal |
| 02 | Automatisering | 12 | Statement, then a lead → AI → CRM → mail pipeline, 24/7 |
| 03 | Websites | 12 | Statement, then a site building itself in a browser and phone |
| 04 | Waarom | 8 | Inverted X-ray chapter: SLIM. SNEL. OP MAAT. |
| — | Outro | 8 | LATEN WE PRATEN. → SHAPING THE INEVITABLE. → hard cut to logo, silent hold |

## Logo files

The video only uses the official logo files (from the AIVEN STUDIOS design-system artifact) and never redraws them:

```
public/brand/monogram-white.png   monogram-black.png   (1415 × 1118)
public/brand/wordmark-white.png   wordmark-black.png   (1948 × 295)
```

White files on the dark ground, black on paper. The end card is the wordmark alone on a silent hold.

## Commands

```console
npm i
npm run dev                                  # preview in Remotion Studio
npx remotion render AivenStudios out/aiven-studios.mp4
python3 scripts/generate_audio.py            # regenerate music bed + SFX in public/audio
```

Fonts are bundled in `public/fonts` (SIL OFL, via Fontsource), so rendering needs no network access.
