import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { pushCut } from "@remotion/transitions/push-cut";
import { slide } from "@remotion/transitions/slide";
import { HookScene } from "./scenes/HookScene";
import { LogoScene } from "./scenes/LogoScene";
import { AiScene } from "./scenes/AiScene";
import { AutomationScene } from "./scenes/AutomationScene";
import { WebsiteScene } from "./scenes/WebsiteScene";
import { ValuesScene } from "./scenes/ValuesScene";
import { OutroScene } from "./scenes/OutroScene";

// 60fps on a 120 BPM clock: one beat = 30 frames.
// Every scene except the last is (beats × 30) + 10 frames, so each
// 10-frame transition starts exactly on a beat. Total: 68 beats = 2040 frames.
export const AivenVideo: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#040404" }}>
      <Audio src={staticFile("audio/music.wav")} volume={0.75} />
      <TransitionSeries>
        <TransitionSeries.Sequence name="Hook" durationInFrames={250}>
          <HookScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={pushCut({ flashColor: "#FAFAFA", flashOpacity: 0.5 })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Logo" durationInFrames={250}>
          <LogoScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="AI-integratie" durationInFrames={370}>
          <AiScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Automatisering" durationInFrames={370}>
          <AutomationScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Websites" durationInFrames={370}>
          <WebsiteScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={pushCut({ flashColor: "#FFFFFF", flashOpacity: 0.8 })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Waarom" durationInFrames={250}>
          <ValuesScene />
        </TransitionSeries.Sequence>
        <TransitionSeries.Transition
          presentation={pushCut({ flashColor: "#030303", flashOpacity: 0.6 })}
          timing={linearTiming({ durationInFrames: 10 })}
        />
        <TransitionSeries.Sequence name="Outro" durationInFrames={240}>
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
