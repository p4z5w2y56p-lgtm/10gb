// All timings are in seconds and converted to frames at render time, so the
// edit stays locked to the music at any frame rate.

export const FPS = 60;
export const WIDTH = 1920;
export const HEIGHT = 1080;

// Beat grid of the soundtrack: "Unknown" by Tanner Helland (CC BY 4.0), 129.59 BPM.
// The edit starts on bar 33 of the track (61.15 s); the drop b(0) is bar 36 (66.71 s),
// where the track's peak section kicks in. Kicks land on every beat.
export const BEAT = 60 / 129.59;
export const DROP = 12 * BEAT;
/** Time of beat j relative to the drop (negative = before it). */
export const b = (j: number) => DROP + j * BEAT;
/** Music stops dead on the cut to the logo, then a silent hold. */
export const DURATION = b(38) + 2;

export type Shot = { from: number; to: number };

export const SHOTS = {
  // Intro (quiet groove)
  feed: { from: 0, to: b(-8) },
  headline: { from: b(-8), to: b(-4) },
  eye: { from: b(-4), to: b(0) },
  // Drop (loud section, b(0) → b(26))
  scroll: { from: b(0), to: b(2) },
  skip: { from: b(2), to: b(4) },
  ignore: { from: b(4), to: b(6) },
  whip1: { from: b(6), to: b(7) },
  trio: { from: b(7), to: b(11.5) },
  whip2: { from: b(11.5), to: b(12) },
  cctv: { from: b(12), to: b(14) },
  strategy: { from: b(14), to: b(16) },
  execution: { from: b(16), to: b(18) },
  reach: { from: b(18), to: b(20) },
  stop: { from: b(20), to: b(22) },
  mark: { from: b(22), to: b(24) },
  article: { from: b(24), to: b(26) },
  // Breath + outro groove
  statement: { from: b(26), to: b(32) },
  logo: { from: b(32), to: DURATION },
} satisfies Record<string, Shot>;

// Cuts that get a white flash.
export const FLASHES = [b(0), b(12), b(20), b(22)];

/** Kick drums measured from the bed as [time, strength]; drives the global bass bump. */
const kick = (js: number[], w: number) => js.map((j) => [b(j), w] as [number, number]);
export const KICKS: [number, number][] = [
  ...kick([-12, -11, -8, -7, -4, -3], 0.35),
  ...kick([0, 1, 4, 5, 8, 9, 12, 13, 16, 20, 21, 24, 25], 1),
  ...kick([14, 15, 17], 0.5),
  ...kick([28, 29, 32, 33, 36, 37, 40, 41], 0.35),
];

/** Frame helpers shared by the composition and the content-aware whips. */
export const toFrame = (s: number, fps: number) => Math.round(s * fps);
export const shotFrames = (s: Shot, fps: number) => toFrame(s.to, fps) - toFrame(s.from, fps);
