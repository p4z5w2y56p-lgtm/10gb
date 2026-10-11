import React from "react";
import { random, useCurrentFrame } from "remotion";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/#";

/**
 * Kinetic scramble for small mono labels only (Stijlgids §6).
 * Characters resolve left to right starting at `delay`.
 */
export const ScrambleLabel: React.FC<{
  text: string;
  delay: number;
  duration?: number;
  fontSize?: number;
  color?: string;
}> = ({ text, delay, duration = 24, fontSize = 30, color = "#8A8A8A" }) => {
  const frame = useCurrentFrame();
  const progress = (frame - delay) / duration;

  if (frame < delay) {
    return null;
  }

  const shown = text
    .split("")
    .map((char, i) => {
      if (char === " " || i / text.length < progress) {
        return char;
      }
      return GLYPHS[Math.floor(random(`${text}${i}${Math.floor(frame / 2)}`) * GLYPHS.length)];
    })
    .join("");

  return (
    <div
      style={{
        fontFamily: "JetBrains Mono",
        fontWeight: 800,
        fontSize,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        color,
        whiteSpace: "pre",
      }}
    >
      {shown}
    </div>
  );
};
