import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { b, C, Theme, themeMuted, themeText } from "../brand";
import { ScrambleLabel } from "./ScrambleLabel";

export type Line = {
  text: string;
  /** Beat (within the scene) on which the line hits. */
  at: number;
  muted?: boolean;
  /** Paint the closing full stop in the accent red (max once per scene). */
  accentDot?: boolean;
};

/**
 * Flush-left statement: eyebrow, one headline line per beat (rise 40px + 12px blur
 * in 0.12s), optional light lead underneath.
 */
export const Statement: React.FC<{
  theme: Theme;
  eyebrow?: string;
  lines: Line[];
  size: number;
  lead?: string;
  leadAt?: number;
  left?: number;
}> = ({ theme, eyebrow, lines, size, lead, leadAt = 2, left = 120 }) => {
  const frame = useCurrentFrame();
  const rise = (at: number) =>
    interpolate(frame, [b(at), b(at) + 8], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  return (
    <AbsoluteFill style={{ justifyContent: "center", paddingLeft: left }}>
      {eyebrow ? (
        <div style={{ marginBottom: 18 }}>
          <ScrambleLabel text={eyebrow} delay={0} color={themeMuted(theme)} />
        </div>
      ) : null}
      {lines.map((line) => {
        const p = rise(line.at);
        const hasDot = line.accentDot && line.text.endsWith(".");
        return (
          <div
            key={line.text}
            style={{
              fontFamily: "Manrope",
              fontWeight: 800,
              fontSize: size,
              lineHeight: 0.89,
              letterSpacing: "-0.055em",
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              color: line.muted ? themeMuted(theme) : themeText(theme),
              opacity: p,
              translate: `0px ${(1 - p) * 40}px`,
              filter: `blur(${(1 - p) * 12}px)`,
            }}
          >
            {hasDot ? line.text.slice(0, -1) : line.text}
            {hasDot ? <span style={{ color: C.accent }}>.</span> : null}
          </div>
        );
      })}
      {lead ? (
        <div
          style={{
            marginTop: 36,
            fontFamily: "Manrope",
            fontWeight: 300,
            fontSize: 46,
            lineHeight: 1.45,
            color: themeMuted(theme),
            opacity: rise(leadAt),
            translate: `0px ${(1 - rise(leadAt)) * 30}px`,
          }}
        >
          {lead}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};
