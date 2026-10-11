import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { ScrambleLabel } from "./ScrambleLabel";
import { WordReveal } from "./WordReveal";

/**
 * Service chapter opener (60fps, 1 beat = 30 frames):
 * beat 0 the numbered eyebrow scrambles in and stays as the chapter label,
 * beat 1 the statement reveals, then it clears at beat 3.5 so the demo
 * can enter on beat 4.
 */
export const ServiceHeader: React.FC<{
  label: string;
  headline: string;
  body: string;
}> = ({ label, headline, body }) => {
  const frame = useCurrentFrame();

  const bodyOpacity = interpolate(frame, [52, 80, 100, 112], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 120, top: 108 }}>
        <ScrambleLabel text={label} delay={2} />
      </div>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          flexDirection: "column",
          gap: 44,
          padding: "0 160px",
        }}
      >
        <WordReveal text={headline} delay={30} exitAt={100} fontSize={156} />
        <div
          style={{
            fontFamily: "Manrope",
            fontWeight: 300,
            fontSize: 60,
            lineHeight: 1.4,
            color: "#8A8A8A",
            textAlign: "center",
            maxWidth: 1400,
            opacity: bodyOpacity,
            translate: `0px ${(1 - Math.min(1, bodyOpacity * 2)) * 40}px`,
          }}
        >
          {body}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
