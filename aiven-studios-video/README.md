# AIVEN STUDIOS — promo edit

A 28-second, 1920×1080, 60fps edit for AIVEN STUDIOS, in Dutch, built with Remotion on the
**Aiven Studios** Claude Design system: Paper and Black grounds alternating on every cut,
flush-left Manrope headlines with a full stop, JetBrains Mono labels, one red accent per scene,
and every cut and hit locked to **168 BPM** (one beat = 0.357 s, `b(n)` in `src/brand.ts`).

| Beats | Scene | Ground |
|-------|-------|--------|
| 0–4 | MINDER HANDWERK. | Black |
| 4–8 | MEER GROEI. (red full stop) | Paper |
| 8–14 | Drop: monogram slam, reticle locks red, wordmark | Black |
| 14–18 | 01 / AI-INTEGRATIE — AI DIE MEEWERKT. | Paper |
| 18–24 | Assistant terminal, one line per beat, reticle locks on `[OK]` | Black |
| 24–28 | 02 / AUTOMATISERING — ALLES AUTOMATISCH. | Paper |
| 28–34 | LEES. DENK. DOE. step panels light per beat | Black |
| 34–38 | Proof cards: 24/7 · 1 · 0 | Paper |
| 38–42 | 03 / WEBSITES — SITES DIE VERKOPEN. | Black |
| 42–50 | A site builds itself per beat; CTA press in red; phone | Paper |
| 50–54 | SLIM. / SNEL. / OP MAAT. — one word per beat | Black/Paper/Black |
| 54–60 | GEEN ONNODIGE RUIS. — the full stop grows into the black hole | Black |
| 60–66 | LATEN WE PRATEN. + pill (pressed red) + AIVENSTUDIOS.COM | Paper |
| 66–70 | SHAPING THE INEVITABLE. | Black |
| 70–78 | Wordmark alone, silent hold | Black |

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
python3 scripts/generate_audio.py             # regenerate the 168 BPM bed + SFX
```

The music bed is synthesised as a placeholder; swap in a licensed track at 168 BPM for release.
