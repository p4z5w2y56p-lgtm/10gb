import React from "react";
import { AbsoluteFill, interpolate, random, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { b, BEAT, C } from "./brand";
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

// [component, name, start beat, length in beats] — every cut lands on a beat (168 BPM).
export const TIMELINE: [React.FC, string, number, number][] = [
  [HookA, "Hook: minder handwerk", 0, 4],
  [HookB, "Hook: meer groei", 4, 4],
  [LogoDrop, "Drop: logo", 8, 6],
  [AiStatement, "01 AI-integratie", 14, 4],
  [AiTerminal, "01 Terminal", 18, 6],
  [AutoStatement, "02 Automatisering", 24, 4],
  [AutoSteps, "02 Lees denk doe", 28, 6],
  [Proof, "02 Proof", 34, 4],
  [WebStatement, "03 Websites", 38, 4],
  [WebBuild, "03 Build", 42, 8],
  [WordSlim, "Slim", 50, 1],
  [WordSnel, "Snel", 51, 1],
  [WordOpMaat, "Op maat", 52, 2],
  [BlackHole, "Geen onnodige ruis", 54, 6],
  [Cta, "Laten we praten", 60, 6],
  [Slogan, "Shaping the inevitable", 66, 4],
  [EndCard, "End card", 70, 8],
];
export const TOTAL_BEATS = 78;

// [sound, beat, volume]
const SFX: [string, number, number][] = [
  ["whoosh", 4, 0.5], ["impact", 8, 0.9], ["whoosh", 14, 0.4],
  ["keys", 19, 0.5], ["keys", 20, 0.5], ["keys", 21, 0.5], ["keys", 22, 0.5], ["click", 23, 0.8],
  ["whoosh", 24, 0.4], ["click", 29, 0.7], ["click", 30, 0.7], ["click", 31, 0.9],
  ["click", 34, 0.6], ["click", 35, 0.6], ["click", 36, 0.6], ["whoosh", 38, 0.4],
  ["click", 43, 0.5], ["click", 44, 0.5], ["click", 45, 0.5], ["click", 47, 0.9], ["whoosh", 48, 0.4],
  ["impact", 50, 0.45], ["impact", 51, 0.45], ["impact", 52, 0.6], ["impact", 57, 0.9],
  ["whoosh", 60, 0.4], ["click", 64, 0.9], ["whoosh", 66, 0.4],
];

const FLASHES = [8, 50, 51, 52, 60];

/** Decaying noise shake on every kick, from the drop to the hard cut. */
const useKickShake = () => {
  const frame = useCurrentFrame();
  const beat = Math.floor(frame / BEAT);
  if (frame < b(8) || frame >= b(70) || (frame >= b(54) && frame < b(57))) {
    return "0px 0px";
  }
  const t = frame - b(beat);
  const amp = 7 * Math.exp(-t / 4);
  return `${(random(`kx${beat}`) - 0.5) * 2 * amp}px ${(random(`ky${beat}`) - 0.5) * 2 * amp}px`;
};

export const AivenVideo: React.FC = () => {
  const frame = useCurrentFrame();
  const shake = useKickShake();
  const flash = Math.max(
    0,
    ...FLASHES.map((at) => interpolate(frame, [b(at), b(at) + 5], [0.85, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * (frame >= b(at) ? 1 : 0)),
  );

  return (
    <AbsoluteFill style={{ backgroundColor: C.black }}>
      <Audio src={staticFile("audio/music.wav")} volume={0.6} />
      {SFX.map(([name, at, volume]) => (
        <Audio key={`${name}${at}`} src={staticFile(`audio/${name}.wav`)} from={b(at)} volume={volume * 0.7} />
      ))}
      <AbsoluteFill style={{ translate: shake, scale: "1.02" }}>
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
