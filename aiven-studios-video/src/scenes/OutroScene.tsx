import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, Sequence, useCurrentFrame } from "remotion";
import { Background } from "../components/Background";
import { BrandLogo } from "../components/BrandLogo";
import { WordReveal } from "../components/WordReveal";
import "../fonts";

export const HARD_CUT = 180;

// CTA (beats 0–2), slogan fully visible (beats 3–5), hard cut to black logo + silent hold (beats 6–7).
export const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Sequence durationInFrames={HARD_CUT} layout="absolute-fill">
        <Background />
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 64 }}>
          <WordReveal text="Laten we praten." delay={4} exitAt={80} fontSize={190} />
          <Interactive.Div
            name="CTA"
            style={{
              padding: "30px 64px",
              borderRadius: 100,
              background: "#FAFAFA",
              color: "#030303",
              fontFamily: "Manrope",
              fontWeight: 800,
              fontSize: 44,
              letterSpacing: "0.04em",
              opacity: interpolate(frame, [24, 40, 80, 92], [0, 1, 1, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              scale: interpolate(frame, [24, 54], [0.8, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.34, 1.56, 0.64, 1),
                output: "perceptual-scale",
              }),
            }}
          >
            AIVENSTUDIOS.COM
          </Interactive.Div>
        </AbsoluteFill>
        <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
          <WordReveal text="Shaping the inevitable." delay={96} stagger={8} fontSize={170} />
        </AbsoluteFill>
      </Sequence>

      <Sequence from={HARD_CUT} layout="absolute-fill">
        {/* End card: the wordmark centred and alone, on a silent hold */}
        <AbsoluteFill style={{ backgroundColor: "#000000", justifyContent: "center", alignItems: "center" }}>
          <BrandLogo mark="wordmark" width={1160} />
        </AbsoluteFill>
      </Sequence>
    </AbsoluteFill>
  );
};
