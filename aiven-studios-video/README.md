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

The video only uses the official logo files and never redraws them. Put them here:

```
public/brand/as-monogram.png
public/brand/wordmark.png
```

(From Drive: AIVEN STUDIOS / Aiven Studios Matthijs / Aiven assests / Logos.) The black art is
inverted to white on the dark ground automatically. Until the files exist, a dashed empty slot holds their place.

## Commands

```console
npm i
npm run dev                                  # preview in Remotion Studio
npx remotion render AivenStudios out/aiven-studios.mp4
python3 scripts/generate_audio.py            # regenerate music bed + SFX in public/audio
```

Fonts are bundled in `public/fonts` (SIL OFL, via Fontsource), so rendering needs no network access.
