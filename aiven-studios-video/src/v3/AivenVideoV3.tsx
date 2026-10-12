import React from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { b, C } from "./brand";
import { EndCard, Manifest } from "./scenes/StatementScenes";
import { AutoSteps, LogoDrop, Proof } from "./scenes/ShowcaseScenes";
import { AiSphere, AutoChaos, Boot, WebIso } from "./scenes/ServiceScenes";
import { Cta, Launch, Marquee, Precision, SloganHole } from "./scenes/FinaleScenes";

// [component, name, start beat, length in beats] — every cut lands on a beat of the track.
// Beat 0 = bar 30 of "Unknown" (55.6 s); the peak starts at beat 24 and the track falls
// away at beat 56, exactly where the hard cut to the end card lands.
export const TIMELINE: [React.FC, string, number, number][] = [
  [Boot, "00 Boot", 0, 4],
  [Manifest, "01 Manifest", 4, 4],
  [LogoDrop, "Drop: logo", 8, 4],
  [AiSphere, "001 AI-integratie", 12, 4],
  [AutoChaos, "002 Automatisering", 16, 4],
  [WebIso, "003 Websites", 20, 4],
  [AutoSteps, "Lees denk doe", 24, 4],
  [Proof, "Proof", 28, 4],
  [Marquee, "Stack", 32, 2],
  [Precision, "Precisie", 34, 4],
  [Launch, "Lanceer", 38, 4],
  [SloganHole, "Shaping the inevitable", 42, 6],
  [Cta, "Laten we praten", 48, 8],
  [EndCard, "End card", 56, 6],
];
export const TOTAL_BEATS = 62;

// Sparse SFX that follow visible actions; the track carries the rhythm. [sound, beat, volume]
const SFX: [string, number, number][] = [
  ["keys", 0.3, 0.35], ["keys", 1.2, 0.35], ["keys", 2, 0.35], ["click", 3.4, 0.5],
  ["impact", 8, 0.6],
  ["click", 19, 0.5],
  ["click", 25, 0.45], ["click", 26, 0.45], ["click", 27, 0.6],
  ["click", 30, 0.45],
  ["click", 36.8, 0.5], ["whoosh", 38, 0.45],
  ["impact", 42, 0.6],
  ["click", 53, 0.6],
];

// Soft white flashes only on the two big lifts of the track.
const FLASHES = [8, 24];

export const AivenVideoV3: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = Math.max(
    0,
    ...FLASHES.map(
      (at) => interpolate(frame, [b(at), b(at) + 5], [0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * (frame >= b(at) ? 1 : 0),
    ),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.black }}>
      <Audio src={staticFile("audio/v3/music.wav")} volume={1} />
      {SFX.map(([name, at, volume]) => (
        <Audio key={`${name}${at}`} src={staticFile(`audio/v3/${name}.wav`)} from={b(at)} volume={volume * 0.5} />
      ))}
      <AbsoluteFill>
        {TIMELINE.map(([Scene, name, start, beats]) => (
          <Sequence key={name} name={name} from={b(start)} durationInFrames={b(start + beats) - b(start)}>
            <Scene />
          </Sequence>
        ))}
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.paper, opacity: flash, pointerEvents: "none" }} />
    </AbsoluteFill>
  );
};
