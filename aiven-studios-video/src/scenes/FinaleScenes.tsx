import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { Ground } from "../components/Ground";
import { PillButton } from "../components/Panels";
import { ScrambleLabel } from "../components/ScrambleLabel";
import "../fonts";

const ease = (frame: number, a: number, z: number, from = 0, to = 1) =>
  interpolate(frame, [a, z], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

// Where the full stop of "RUIS." sits on the 1920×1080 frame (checked against a rendered still).
export const DOT_X = 513;
export const DOT_Y = 758;

const line: React.CSSProperties = {
  fontFamily: "Manrope",
  fontWeight: 800,
  fontSize: 180,
  lineHeight: 0.89,
  letterSpacing: "-0.055em",
  whiteSpace: "nowrap",
  color: C.white,
};

/** GEEN ONNODIGE RUIS. — then the full stop grows into the black hole. 6 beats. */
export const BlackHole: React.FC = () => {
  const frame = useCurrentFrame();
  const word = (at: number) => ease(frame, b(at), b(at) + 8);
  const radius = interpolate(frame, [b(3), b(3) + 30], [0, 2300], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.65, 0, 0.35, 1),
  });

  return (
    <Ground theme="black" label="AIVEN // HORIZON" counter="05 / 06">
      <AbsoluteFill style={{ clipPath: `circle(${radius}px at ${DOT_X}px ${DOT_Y}px)` }}>
        <Img
          src={staticFile("brand/blackhole.jpg")}
          // Black hole sits right of centre so the headline stays on dark space
          style={{ width: 1920, height: 1080, translate: "640px 0px", scale: String(ease(frame, b(3), b(6), 1.2, 1)), WebkitMaskImage: "linear-gradient(90deg, transparent 0%, black 30%)" }}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 120 }}>
        {["GEEN", "ONNODIGE", "RUIS."].map((text, i) => (
          <div
            key={text}
            style={{
              ...line,
              color: i === 1 ? C.mutedOnDark : C.white,
              opacity: word(i),
              translate: `0px ${(1 - word(i)) * 40}px`,
              filter: `blur(${(1 - word(i)) * 12}px)`,
            }}
          >
            {text}
          </div>
        ))}
      </AbsoluteFill>
    </Ground>
  );
};

/** LATEN WE PRATEN. + the pill; pressing it is the scene's one accent. 6 beats. */
export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const word = (at: number) => ease(frame, b(at), b(at) + 8);
  const pill = ease(frame, b(2), b(2) + 12);
  return (
    <Ground theme="paper" label="AIVEN // CONTACT" counter="06 / 06">
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 150 }}>
        <ScrambleLabel text="06 / CONTACT" delay={0} color={C.mutedOnPaper} />
        <div style={{ height: 18 }} />
        {["LATEN WE", "PRATEN."].map((text, i) => (
          <div
            key={text}
            style={{
              ...line,
              fontSize: 300,
              lineHeight: 0.9,
              letterSpacing: "-0.05em",
              color: C.ink,
              opacity: word(i),
              translate: `0px ${(1 - word(i)) * 40}px`,
              filter: `blur(${(1 - word(i)) * 12}px)`,
            }}
          >
            {text}
          </div>
        ))}
        <div style={{ marginTop: 64, display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ opacity: pill, scale: String(0.8 + 0.2 * pill), transformOrigin: "0% 50%" }}>
            <PillButton label="PLAN EEN GESPREK" pressed={frame >= b(4)} />
          </div>
          <ScrambleLabel text="AIVENSTUDIOS.COM" delay={b(3)} fontSize={44} color={C.ink} />
        </div>
      </AbsoluteFill>
    </Ground>
  );
};
