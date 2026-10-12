import React from "react";
import { AbsoluteFill, Freeze, Sequence, staticFile, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { Flashes, Grain, Preload, useTime } from "../fx";
import { ContentWhip } from "../scenes/DropA";
import { Shot, shotFrames, toFrame } from "../timeline";
import { AutonomousAI, DataEngineering, SaasArchitecture } from "./Capabilities";
import { Manifesto, Philosophy, TerminalBoot } from "./Intro";
import { CallToAction, LogoEnd, Slogan } from "./Outro";
import { Overview, ProcessRelay } from "./Process";
import { Advantage } from "./Statement";
import { Hero, Horizon, Launch, Lock, Marquee } from "./Systems";
import { MUSIC_STOP, STUDIO_FLASHES, STUDIO_KICKS, STUDIO_SHOTS as S } from "./timeline";

/** Whole-frame bump on every kick; nothing moves after the music stops. */
const BassBump: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const t = useTime();
  const { fps } = useVideoConfig();
  let e = 0;
  for (const [k, w] of STUDIO_KICKS) {
    const dt = t - toFrame(k, fps) / fps;
    if (dt >= 0 && dt < 0.7 && t < MUSIC_STOP) e += w * Math.exp(-dt / 0.11);
  }
  return <AbsoluteFill style={{ transform: `scale(${1 + 0.006 * e})` }}>{children}</AbsoluteFill>;
};

const dur = (s: Shot) => s.to - s.from;

export const AivenStudios: React.FC = () => {
  const { fps } = useVideoConfig();
  const shot = (name: string, s: Shot, render: (d: number) => React.ReactNode) => (
    <Sequence key={name} name={name} from={toFrame(s.from, fps)} durationInFrames={shotFrames(s, fps)} premountFor={toFrame(0.5, fps)}>
      {render(dur(s))}
    </Sequence>
  );
  const last = (s: Shot) => shotFrames(s, fps) - 1;
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Audio src={staticFile("audio/music.wav")} />
      <BassBump>
        {shot("00 Initialize", S.terminal, (d) => <TerminalBoot dur={d} />)}
        {shot("01 Manifesto", S.manifesto, (d) => <Manifesto dur={d} />)}
        {shot("02 Philosophy", S.philosophy, (d) => <Philosophy dur={d} />)}
        {shot("001 AI-integratie", S.ai, (d) => <AutonomousAI dur={d} />)}
        {shot("002 Automatisering", S.data, (d) => <DataEngineering dur={d} />)}
        {shot("003 Websites", S.saas, (d) => <SaasArchitecture dur={d} />)}
        {shot("Swipe", S.swipe, (d) => (
          <ContentWhip
            dur={d}
            axis="y"
            id="st-swipe"
            outgoing={
              <Freeze frame={last(S.saas)}>
                <SaasArchitecture dur={dur(S.saas)} />
              </Freeze>
            }
            incoming={
              <Freeze frame={0}>
                <Advantage dur={dur(S.advantage)} />
              </Freeze>
            }
          />
        ))}
        {shot("Oneerlijk digitaal voordeel", S.advantage, (d) => <Advantage dur={d} />)}
        {shot("Whip", S.whip, (d) => (
          <ContentWhip
            dur={d}
            axis="x"
            id="st-whip"
            outgoing={
              <Freeze frame={last(S.advantage)}>
                <Advantage dur={dur(S.advantage)} />
              </Freeze>
            }
            incoming={
              <Freeze frame={0}>
                <ProcessRelay dur={dur(S.process)} />
              </Freeze>
            }
          />
        ))}
        {shot("Denk bouw groei", S.process, (d) => <ProcessRelay dur={d} />)}
        {shot("Overview", S.overview, (d) => <Overview dur={d} />)}
        {shot("Precisie", S.lock, (d) => <Lock dur={d} />)}
        {shot("Stack", S.marquee, (d) => <Marquee dur={d} />)}
        {shot("Launch sequence", S.launch, (d) => <Launch dur={d} />)}
        {shot("Aiven Studios", S.hero, (d) => <Hero dur={d} />)}
        {shot("Horizon", S.horizon, (d) => <Horizon dur={d} />)}
        {shot("Shaping the inevitable", S.slogan, (d) => <Slogan dur={d} />)}
        {shot("Kom praten", S.cta, (d) => <CallToAction dur={d} />)}
        {shot("Logo", S.logo, (d) => <LogoEnd dur={d} />)}
      </BassBump>
      {t < MUSIC_STOP ? <Grain opacity={0.2} /> : null}
      <Flashes at={STUDIO_FLASHES} peak={0.6} />
      <Preload />
    </AbsoluteFill>
  );
};
