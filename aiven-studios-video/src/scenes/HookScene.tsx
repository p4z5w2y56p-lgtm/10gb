import React from "react";
import { AbsoluteFill, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { ScrambleLabel } from "../components/ScrambleLabel";
import { WordReveal } from "../components/WordReveal";
import "../fonts";

// 60fps, 120 BPM: one beat = 30 frames. Chapter = 8 beats.
export const HookScene: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("audio/whoosh.wav")} from={4} volume={0.5} />
      <Audio src={staticFile("audio/whoosh.wav")} from={120} volume={0.5} />

      <div style={{ position: "absolute", left: 120, top: 108 }}>
        <ScrambleLabel text="AIVEN // INITIALIZE" delay={0} />
      </div>

      <Interactive.Div
        name="Camera"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          scale: interpolate(frame, [0, 250], [1, 1.05], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            output: "perceptual-scale",
          }),
        }}
      >
        <div style={{ position: "absolute" }}>
          <WordReveal text="Minder handwerk." delay={6} exitAt={100} fontSize={168} />
        </div>
        <div style={{ position: "absolute", display: "flex", gap: "0.24em", fontSize: 200 }}>
          <WordReveal text="Meer" delay={124} fontSize={200} />
          <WordReveal text="groei." delay={132} fontSize={200} outline />
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
