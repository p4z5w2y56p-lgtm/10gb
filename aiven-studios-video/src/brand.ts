// AIVEN STUDIOS tokens, from the Claude Design system "Aiven Studios" (tokens.json).
export const C = {
  paper: "#f7f7f9",
  black: "#050505",
  ink: "#030303",
  white: "#f7f7f9",
  mutedOnPaper: "#666666",
  mutedOnDark: "#8a8a8e",
  hairPaper: "#e2e2e5",
  hair: "#2a2a2c",
  cardWhite: "#ffffff",
  terminal: "#0b0b0c",
  panel: "#0d0d0e",
  unlit: "#3a3a3d",
  grid: "#2b2b2e",
  accent: "#d8291f",
};

export type Theme = "paper" | "black";

export const themeText = (t: Theme) => (t === "paper" ? C.ink : C.white);
export const themeMuted = (t: Theme) => (t === "paper" ? C.mutedOnPaper : C.mutedOnDark);

// Music clock: 168 BPM at 60fps -> one beat = 21.43 frames.
export const FPS = 60;
export const BPM = 168;
export const BEAT = (FPS * 60) / BPM;
/** Frame of beat n (rounded, so cuts land on the nearest frame). */
export const b = (n: number) => Math.round(n * BEAT);

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
