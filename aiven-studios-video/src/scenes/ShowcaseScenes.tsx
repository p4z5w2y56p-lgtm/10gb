import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { Ground } from "../components/Ground";
import { Corners, StatCard, StepPanel } from "../components/Panels";
import { ScrambleLabel } from "../components/ScrambleLabel";
import { Terminal } from "../components/Terminal";
import "../fonts";

const ease = (frame: number, a: number, z: number, from: number, to: number) =>
  interpolate(frame, [a, z], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

/** The drop: monogram slams in, reticle locks on (accent), wordmark follows. 6 beats. */
export const LogoDrop: React.FC = () => {
  const frame = useCurrentFrame();
  const lift = ease(frame, b(2), b(2) + 14, 0, 1);
  const lockW = ease(frame, 0, b(1), 980, 600);
  const lockH = ease(frame, 0, b(1), 800, 500);
  return (
    <Ground theme="black" label="AIVEN // IDENTITY" counter="00 / 06" grid>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            position: "relative",
            width: lockW,
            height: lockH,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            translate: `0px ${lift * -150}px`,
            scale: String(1 - lift * 0.3),
          }}
        >
          <Corners w={lockW} h={lockH} len={44} color={frame >= b(1) ? C.accent : C.white} />
          <div
            style={{
              scale: String(ease(frame, 0, 10, 1.4, 1)),
              filter: `blur(${ease(frame, 0, 8, 20, 0)}px)`,
            }}
          >
            <BrandLogo mark="monogram" width={440} />
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            top: 680,
            opacity: lift,
            translate: `0px ${(1 - lift) * 40}px`,
            filter: `blur(${(1 - lift) * 12}px)`,
          }}
        >
          <BrandLogo mark="wordmark" width={980} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 90, display: "flex", justifyContent: "center" }}>
        <ScrambleLabel text="AI-INTEGRATIE / AUTOMATISERING / WEBSITES" delay={b(4)} color={C.mutedOnDark} />
      </div>
    </Ground>
  );
};

/** The assistant at work: one terminal line per beat, reticle locks on the result. 6 beats. */
export const AiTerminal: React.FC = () => {
  const frame = useCurrentFrame();
  const p = ease(frame, 0, 12, 0, 1);
  return (
    <Ground theme="black" label="AIVEN // ASSISTENT" counter="01 / 03" grid>
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "relative", padding: 40, opacity: p, translate: `0px ${(1 - p) * 60}px`, filter: `blur(${(1 - p) * 12}px)` }}>
          <Corners w={1320} h={560} color={frame >= b(5) ? C.accent : C.white} />
          <Terminal
            title="aiven@studios: ~/assistent"
            lines={[
              { at: 1, text: "$ aiven scan --inbox" },
              { at: 2, text: "> 48 berichten gelezen", muted: true },
              { at: 3, text: "> 12 offerte-aanvragen herkend", muted: true },
              { at: 4, text: "> 3 met prioriteit naar het CRM", muted: true },
              { at: 5, text: "[OK]   klanten beantwoord in 40s" },
            ]}
          />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};

/** LEES. DENK. DOE. — one panel lights per beat, the last inverts. 6 beats. */
export const AutoSteps: React.FC = () => (
  <Ground theme="black" label="AIVEN // PROCESS" counter="02 / 03">
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 40 }}>
      <StepPanel n="01" word="LEES." icon="terminal" enterAt={0} litAt={1} />
      <StepPanel n="02" word="DENK." icon="cpu" enterAt={0} litAt={2} />
      <StepPanel n="03" word="DOE." icon="arrow" enterAt={0} litAt={3} inverted />
    </AbsoluteFill>
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 70, display: "flex", justifyContent: "center" }}>
      <ScrambleLabel text="ALL SYSTEMS NOMINAL" delay={b(4)} fontSize={22} weight={500} color={C.mutedOnDark} />
    </div>
  </Ground>
);

/** Proof: the numbers carry it, one card per beat. 4 beats. */
export const Proof: React.FC = () => (
  <Ground theme="paper" label="AIVEN // PROOF" counter="02 / 03">
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", flexDirection: "row", gap: 40 }}>
      <StatCard value="24/7" label="ALTIJD AAN" caption="01 / PROOF" at={0} />
      <StatCard value="1" label="CENTRAAL SYSTEEM" caption="02 / PROOF" at={1} />
      <StatCard value="0" label="HANDWERK" caption="03 / PROOF" at={2} />
    </AbsoluteFill>
  </Ground>
);
