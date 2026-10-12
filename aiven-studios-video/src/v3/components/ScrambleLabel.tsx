import React from "react";
import { random, useCurrentFrame } from "remotion";

const GLYPHS = "0123456789/<>#*+=-";

/** Split-flap scramble for mono labels and numbers (0.25s), design-system `Scramble`. */
export const ScrambleLabel: React.FC<{
  text: string;
  delay: number;
  duration?: number;
  fontSize?: number;
  weight?: number;
  color: string;
}> = ({ text, delay, duration = 15, fontSize = 24, weight = 800, color }) => {
  const frame = useCurrentFrame();
  if (frame < delay) {
    return null;
  }
  const progress = (frame - delay) / duration;
  const shown = text
    .split("")
    .map((ch, i) =>
      ch === " " || i / text.length < progress
        ? ch
        : GLYPHS[Math.floor(random(`${text}${i}${Math.floor(frame / 2)}`) * GLYPHS.length)],
    )
    .join("");

  return (
    <div
      style={{
        fontFamily: "JetBrains Mono Var",
        fontWeight: weight,
        fontSize,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        whiteSpace: "pre",
        color,
      }}
    >
      {shown}
    </div>
  );
};
