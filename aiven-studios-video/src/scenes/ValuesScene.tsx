import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { ScrambleLabel } from "../components/ScrambleLabel";
import "../fonts";

// Inverted "X-ray" chapter: paper ground, one word per two beats, each clears before the next.
export const ValuesScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Background inverted />
      <Audio src={staticFile("audio/impact.wav")} from={0} volume={0.6} />
      <Audio src={staticFile("audio/impact.wav")} from={60} volume={0.6} />
      <Audio src={staticFile("audio/impact.wav")} from={120} volume={0.8} />

      <div style={{ position: "absolute", left: 120, top: 108 }}>
        <ScrambleLabel text="04 / WAAROM AIVEN" delay={0} color="#666666" />
      </div>

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Manrope",
          fontWeight: 800,
          fontSize: 280,
          letterSpacing: "-0.05em",
          color: "#030303",
        }}
      >
        <Interactive.Div
          name="Slim"
          style={{
            position: "absolute",
            opacity: interpolate(frame, [0, 6, 48, 56], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(frame, [0, 24], [1.18, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            filter: `blur(${interpolate(frame, [0, 20], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          }}
        >
          SLIM.
        </Interactive.Div>
        <Interactive.Div
          name="Snel"
          style={{
            position: "absolute",
            opacity: interpolate(frame, [60, 66, 108, 116], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(frame, [60, 84], [1.18, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
              output: "perceptual-scale",
            }),
            filter: `blur(${interpolate(frame, [60, 80], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          }}
        >
          SNEL.
        </Interactive.Div>
        <Interactive.Div
          name="Op maat"
          style={{
            position: "absolute",
            color: "transparent",
            WebkitTextStroke: "3px #030303",
            opacity: interpolate(frame, [120, 126], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            scale: interpolate(frame, [120, 144, 250], [1.18, 1, 0.96], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: [Easing.bezier(0.16, 1, 0.3, 1), Easing.linear],
              output: "perceptual-scale",
            }),
            filter: `blur(${interpolate(frame, [120, 140], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
          }}
        >
          OP MAAT.
        </Interactive.Div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
