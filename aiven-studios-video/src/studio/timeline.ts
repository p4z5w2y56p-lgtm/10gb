import { b, DURATION, Shot } from "../timeline";

// AIVEN STUDIOS company ad (Dutch). Beat grid of the soundtrack in ../timeline.ts.
export const STUDIO_SHOTS = {
  // Intro: the system boots, the manifesto, the philosophy (dive into the full stop → black hole)
  terminal: { from: 0, to: b(-8) },
  manifesto: { from: b(-8), to: b(-4) },
  philosophy: { from: b(-4), to: b(0) },
  // Drop: what we build, climbing from intelligence to launch
  ai: { from: b(0), to: b(2) },
  data: { from: b(2), to: b(4) },
  saas: { from: b(4), to: b(6) },
  swipe: { from: b(6), to: b(7) },
  advantage: { from: b(7), to: b(11.5) },
  whip: { from: b(11.5), to: b(12) },
  process: { from: b(12), to: b(14) },
  overview: { from: b(14), to: b(16) },
  lock: { from: b(16), to: b(18) },
  marquee: { from: b(18), to: b(20) },
  launch: { from: b(20), to: b(22) },
  hero: { from: b(22), to: b(24) },
  horizon: { from: b(24), to: b(26) },
  // Break: the hero image returns with the slogan; then the call to action; hard cut to the logo
  slogan: { from: b(26), to: b(32) },
  cta: { from: b(32), to: b(38) },
  logo: { from: b(38), to: DURATION },
} satisfies Record<string, Shot>;

export const STUDIO_FLASHES = [b(0), b(12), b(20)];
/** The music stops dead on the cut to the logo (silent hold). */
export const MUSIC_STOP = b(38);

const kick = (js: number[], w: number) => js.map((j) => [b(j), w] as [number, number]);
export const STUDIO_KICKS: [number, number][] = [
  ...kick([-12, -11, -8, -7, -4, -3], 0.35),
  ...kick([0, 1, 4, 5, 8, 9, 12, 13, 16, 20, 21, 24, 25], 1),
  ...kick([14, 15, 17], 0.5),
  ...kick([28, 29, 32, 33, 36, 37], 0.35),
];
