import { loadFont } from "@remotion/fonts";
import { staticFile } from "remotion";

// Fonts are bundled locally (public/fonts) so rendering never depends on the network.
const font = (family: string, file: string, weight = "400", style = "normal") =>
  loadFont({ family, url: staticFile(`fonts/${file}`), weight, style, display: "block" });

font("Anton", "Anton-normal-400.woff2");
font("Bebas Neue", "BebasNeue-normal-400.woff2");
font("Oswald", "Oswald-normal-700.woff2", "200 700");
font("Source Serif 4", "SourceSerif4-normal-400.woff2", "200 900");
font("Source Serif 4", "SourceSerif4-italic-400.woff2", "200 900", "italic");
font("Inter", "Inter-normal-700.woff2", "100 900");
font("JetBrains Mono", "JetBrainsMono-normal-400.woff2", "100 800");

export const ANTON = "Anton, sans-serif";
export const BEBAS = "'Bebas Neue', sans-serif";
export const OSWALD = "Oswald, sans-serif";
export const SERIF = "'Source Serif 4', serif";
export const SANS = "Inter, sans-serif";
export const MONO = "'JetBrains Mono', monospace";

// AIVEN STUDIOS brand type (stijlgids §3): Manrope for headlines/body, JetBrains Mono for labels and numbers.
font("Manrope", "Manrope-var.woff2", "200 800");
font("JetBrains Mono Var", "JetBrainsMono-var.woff2", "100 800");

export const MANROPE = "Manrope, sans-serif";
export const JBMONO = "'JetBrains Mono Var', 'JetBrains Mono', monospace";
