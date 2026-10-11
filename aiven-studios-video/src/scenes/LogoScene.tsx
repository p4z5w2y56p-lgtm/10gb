import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { BrandLogo } from "../components/BrandLogo";
import { ScrambleLabel } from "../components/ScrambleLabel";
import "../fonts";

export const LogoScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("audio/impact.wav")} from={0} volume={0.9} />
      <Audio src={staticFile("audio/click.wav")} from={150} volume={0.6} />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <Interactive.Div
          name="Monogram"
          style={{
            opacity: interpolate(frame, [0, 60], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            filter: `blur(${interpolate(frame, [0, 100], [28, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px)`,
            scale: interpolate(frame, [0, 100, 120, 150], [1.25, 1, 1, 0.62], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear, Easing.bezier(0.85, 0, 0.15, 1)],
              output: "perceptual-scale",
            }),
            translate: interpolate(frame, [120, 150], ["0px 0px", "0px -170px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.85, 0, 0.15, 1),
            }),
          }}
        >
          <BrandLogo file="as-monogram.png" width={430} height={366} />
        </Interactive.Div>

        <Interactive.Div
          name="Wordmark"
          style={{
            position: "absolute",
            top: 600,
            opacity: interpolate(frame, [128, 170], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
            filter: `blur(${interpolate(frame, [128, 190], [16, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px)`,
            translate: interpolate(frame, [128, 180], ["0px 40px", "0px 0px"], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            }),
          }}
        >
          <BrandLogo file="wordmark.png" width={1000} height={200} />
        </Interactive.Div>
      </AbsoluteFill>

      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 120,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <ScrambleLabel text="AI-INTEGRATIE / AUTOMATISERING / WEBSITES" delay={150} duration={36} fontSize={34} />
      </div>
    </AbsoluteFill>
  );
};
