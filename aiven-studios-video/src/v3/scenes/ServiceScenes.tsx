import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { Ground } from "../components/Ground";
import { Corners } from "../components/Panels";
import { Terminal } from "../components/Terminal";
import { CapTitle, ChaosToGrid, IsoWeb, NeuralSphere, Waveform } from "../components/Visuals";
import "../../fonts";

const ease = (frame: number, a: number, z: number, from = 0, to = 1) =>
  interpolate(frame, [a, z], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

/** 00: the studio boots. Terminal types, reticle locks red on ALL SYSTEMS NOMINAL. 4 beats. */
export const Boot: React.FC = () => {
  const frame = useCurrentFrame();
  const p = ease(frame, 0, 12);
  return (
    <Ground theme="black" label="00 / INITIALISEER" counter="AIVEN // AIVEN STUDIOS">
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ position: "relative", padding: 40, opacity: p, translate: `0px ${(1 - p) * 60}px`, filter: `blur(${(1 - p) * 12}px)` }}>
          <Corners w={1320} h={500} color={frame >= b(3.4) ? C.accent : C.white} />
          <Terminal
            title="root@aiven-studios:~"
            lines={[
              { at: 0.3, text: "$ ./initialiseer --studio aiven" },
              { at: 1.2, text: "[SCAN] 3 capaciteiten online", muted: true },
              { at: 2, text: "[OK]   onnodige ruis verwijderd", muted: true },
              { at: 2.8, text: "[OK]   ALL SYSTEMS NOMINAL" },
            ]}
          />
        </div>
      </AbsoluteFill>
      <Waveform />
    </Ground>
  );
};

/** 001 AI-integratie: a neural sphere assembles and starts thinking. 4 beats. */
export const AiSphere: React.FC = () => {
  const frame = useCurrentFrame();
  const grow = ease(frame, 0, b(1.5), 0.55, 1);
  return (
    <Ground theme="black" label="AIVEN // CAPABILITY" counter="01 / 03" grid>
      <NeuralSphere cx={1250} cy={470} R={330} grow={grow} />
      <div style={{ position: "absolute", right: 120, top: 180, fontFamily: "JetBrains Mono Var", fontSize: 22, letterSpacing: "0.14em", color: C.mutedOnDark, textAlign: "right", lineHeight: 1.6 }}>
        <div>AGENTEN {String(Math.round(ease(frame, 0, b(3), 0, 24))).padStart(3, "0")}</div>
        <div>SYSTEMEN {String(Math.round(ease(frame, 0, b(3), 0, 12))).padStart(3, "0")}</div>
      </div>
      <CapTitle n="001" label="AI-INTEGRATIE" title="AI DIE MEEWERKT." at={0.5} color={C.white} muted={C.mutedOnDark} />
    </Ground>
  );
};

/** 002 Automatisering: raw noise funnels into a locked grid. 4 beats. */
export const AutoChaos: React.FC = () => (
  <Ground theme="paper" label="AIVEN // CAPABILITY" counter="02 / 03">
    <ChaosToGrid />
    <CapTitle n="002" label="AUTOMATISERING" title="ALLES AUTOMATISCH." at={0.5} color={C.ink} muted={C.mutedOnPaper} />
  </Ground>
);

/** 003 Websites: five plates lift into a layered site. 4 beats. */
export const WebIso: React.FC = () => (
  <Ground theme="black" label="AIVEN // CAPABILITY" counter="03 / 03">
    <IsoWeb ox={1330} oy={520} />
    <CapTitle n="003" label="WEBSITES" title="SITES DIE VERKOPEN." at={0.5} color={C.white} muted={C.mutedOnDark} />
  </Ground>
);
