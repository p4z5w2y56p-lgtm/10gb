import React from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { b, C } from "./brand";
import {
  AiStatement,
  AutoStatement,
  EndCard,
  HookA,
  HookB,
  Slogan,
  WebStatement,
  WordOpMaat,
  WordSlim,
  WordSnel,
} from "./scenes/StatementScenes";
import { AiTerminal, AutoSteps, LogoDrop, Proof } from "./scenes/ShowcaseScenes";
import { WebBuild } from "./scenes/WebBuild";
import { BlackHole, Cta } from "./scenes/FinaleScenes";

// [component, name, start beat, length in beats] — every cut lands on a beat of the track.
// Edit beat 0 = bar 30 of "Unknown" (55.6 s); the track's peak starts at beat 24 and
// falls away at beat 56, exactly where the hard cut to the end card lands.
export const TIMELINE: [React.FC, string, number, number][] = [
  [HookA, "Hook: minder handwerk", 0, 2],
  [HookB, "Hook: meer groei", 2, 2],
  [LogoDrop, "Drop: logo", 4, 4],
  [AiStatement, "01 AI-integratie", 8, 2],
  [AiTerminal, "01 Terminal", 10, 4],
  [AutoStatement, "02 Automatisering", 14, 2],
  [AutoSteps, "02 Lees denk doe", 16, 4],
  [Proof, "02 Proof", 20, 4],
  [WebStatement, "03 Websites", 24, 2],
  [WebBuild, "03 Build", 26, 8],
  [WordSlim, "Slim", 34, 1],
  [WordSnel, "Snel", 35, 1],
  [WordOpMaat, "Op maat", 36, 2],
  [BlackHole, "Geen onnodige ruis", 38, 6],
  [Cta, "Laten we praten", 44, 6],
  [Slogan, "Shaping the inevitable", 50, 6],
  [EndCard, "End card", 56, 6],
];
export const TOTAL_BEATS = 62;

// Sparse SFX that follow visible actions; the track carries the rhythm. [sound, beat, volume]
const SFX: [string, number, number][] = [
  ["impact", 4, 0.6],
  ["keys", 10.5, 0.35], ["keys", 11.5, 0.35], ["click", 12.5, 0.5],
  ["click", 17, 0.45], ["click", 18, 0.45], ["click", 19, 0.6],
  ["click", 31, 0.6],
  ["impact", 41, 0.6],
  ["click", 48, 0.6],
];

// Soft white flashes only on the two big lifts of the track.
const FLASHES = [4, 24];

export const AivenVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const flash = Math.max(
    0,
    ...FLASHES.map((at) => interpolate(frame, [b(at), b(at) + 5], [0.45, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * (frame >= b(at) ? 1 : 0)),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.black }}>
      <Audio src={staticFile("audio/music.wav")} volume={1} />
      {SFX.map(([name, at, volume]) => (
        <Audio key={`${name}${at}`} src={staticFile(`audio/${name}.wav`)} from={b(at)} volume={volume * 0.5} />
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
