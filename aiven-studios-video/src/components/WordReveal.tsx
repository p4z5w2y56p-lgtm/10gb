import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

/**
 * Staggered mask reveal (Stijlgids §6): each word slides up from
 * translateY(110%) inside its own mask, brutalSnap easing.
 * Optional `exitAt` clears the words before the next line enters.
 */
export const WordReveal: React.FC<{
  text: string;
  delay: number;
  stagger?: number;
  duration?: number;
  exitAt?: number;
  fontSize: number;
  color?: string;
  outline?: boolean;
  align?: "center" | "flex-start";
}> = ({
  text,
  delay,
  stagger = 6,
  duration = 40,
  exitAt,
  fontSize,
  color = "#FAFAFA",
  outline = false,
  align = "center",
}) => {
  const frame = useCurrentFrame();
  const words = text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align,
        columnGap: "0.24em",
        fontFamily: "Manrope",
        fontWeight: 800,
        fontSize,
        letterSpacing: "-0.045em",
        lineHeight: 0.92,
        textTransform: "uppercase",
      }}
    >
      {words.map((word, i) => {
        const start = delay + i * stagger;
        const enter = interpolate(frame, [start, start + duration], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        });
        const exit =
          exitAt === undefined
            ? 0
            : interpolate(frame, [exitAt + i * 3, exitAt + i * 3 + 18], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.85, 0, 0.15, 1),
              });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              overflow: "hidden",
              padding: "0.06em 0.03em 0.1em",
              margin: "-0.06em -0.03em -0.1em",
            }}
          >
            <span
              style={{
                display: "inline-block",
                translate: `0px ${(1 - enter) * 110 - exit * 110}%`,
                filter: `blur(${(1 - enter) * 10}px)`,
                color: outline ? "transparent" : color,
                WebkitTextStroke: outline ? `2px ${color}` : undefined,
              }}
            >
              {word}
            </span>
          </span>
        );
      })}
    </div>
  );
};
