import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// AIVEN STUDIOS type system (Stijlgids §3), bundled locally (SIL OFL, from Fontsource)
// so renders don't depend on Google Fonts being reachable.
// Manrope 800 headlines / 300 body, JetBrains Mono for labels and numbers.
const FILES = [
  { family: "Manrope", weight: "300", file: "manrope-latin-300-normal.woff2" },
  { family: "Manrope", weight: "500", file: "manrope-latin-500-normal.woff2" },
  { family: "Manrope", weight: "800", file: "manrope-latin-800-normal.woff2" },
  { family: "JetBrains Mono", weight: "500", file: "jetbrains-mono-latin-500-normal.woff2" },
  { family: "JetBrains Mono", weight: "800", file: "jetbrains-mono-latin-800-normal.woff2" },
];

for (const font of FILES) {
  loadFont({
    family: font.family,
    url: staticFile(`fonts/${font.file}`),
    weight: font.weight,
    format: "woff2",
  });
}
