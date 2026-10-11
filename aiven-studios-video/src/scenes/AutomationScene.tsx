import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { LineIcon } from "../components/LineIcon";
import { ServiceHeader } from "../components/ServiceHeader";
import "../fonts";

const NODE_Y = 500;
const NODE_X = [330, 750, 1170, 1590];
// The task pulse hits one node per beat: beats 6, 7, 8, 9 at 60fps.
const HITS = [180, 210, 240, 270];

const NODES = [
  { label: "001 / LEAD", icon: "lead" },
  { label: "002 / AI", icon: "cpu" },
  { label: "003 / CRM", icon: "crm" },
  { label: "004 / MAIL", icon: "mail" },
] as const;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const FlowNode: React.FC<{ index: number }> = ({ index }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [120 + index * 8, 160 + index * 8], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const active = frame >= HITS[index];
  const hit = interpolate(frame, [HITS[index], HITS[index] + 4, HITS[index] + 24], [1, 1.06, 1], clamp);
  const badge = interpolate(frame, [HITS[index], HITS[index] + 20], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.34, 1.56, 0.64, 1),
  });

  return (
    <div
      style={{
        position: "absolute",
        left: NODE_X[index] - 160,
        top: NODE_Y - 130,
        width: 320,
        height: 260,
        borderRadius: 30,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 30,
        background: "#0B0B0D",
        border: `1.5px solid ${active ? "#FAFAFA" : "rgba(250,250,250,0.14)"}`,
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        opacity: enter,
        filter: `blur(${(1 - enter) * 10}px)`,
        translate: `0px ${(1 - enter) * 80}px`,
        scale: String(hit),
      }}
    >
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: 30,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          background: active ? "#FAFAFA" : "transparent",
          border: "1.5px solid rgba(250,250,250,0.3)",
        }}
      >
        <LineIcon name={NODES[index].icon} size={56} color={active ? "#030303" : "#FAFAFA"} />
      </div>
      <div
        style={{
          fontFamily: "JetBrains Mono",
          fontWeight: 800,
          fontSize: 30,
          letterSpacing: "0.12em",
          color: active ? "#FAFAFA" : "#8A8A8A",
        }}
      >
        {NODES[index].label}
      </div>
      <div style={{ position: "absolute", top: -22, right: -22, scale: String(badge), background: "#040404", borderRadius: "50%" }}>
        <LineIcon name="check" size={52} />
      </div>
    </div>
  );
};

export const AutomationScene: React.FC = () => {
  const frame = useCurrentFrame();
  const pulseX = interpolate(frame, [HITS[0], HITS[3]], [NODE_X[0], NODE_X[3]], clamp);
  // After the first run, tasks keep flying through on every half beat
  const lap = (((frame - 285) % 15) + 15) % 15;
  const lapX = NODE_X[0] + (lap / 15) * (NODE_X[3] - NODE_X[0]);

  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("audio/whoosh.wav")} from={30} volume={0.45} />
      {HITS.map((at) => (
        <Audio key={at} src={staticFile("audio/click.wav")} from={at} volume={0.6} />
      ))}
      <Audio src={staticFile("audio/impact.wav")} from={300} volume={0.5} />

      <ServiceHeader
        label="02 / AUTOMATISERING"
        headline="Handwerk stopt hier."
        body="Kan een proces automatisch? Dan gebeurt het automatisch."
      />

      <div
        style={{
          position: "absolute",
          left: NODE_X[0],
          top: NODE_Y - 1,
          width: NODE_X[3] - NODE_X[0],
          height: 2,
          background: "rgba(250,250,250,0.25)",
          scale: `${interpolate(frame, [135, 175], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) })} 1`,
          transformOrigin: "left",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: NODE_X[0],
          top: NODE_Y - 2,
          width: pulseX - NODE_X[0],
          height: 4,
          background: "#FAFAFA",
        }}
      />
      {frame >= 285 ? (
        <div
          style={{
            position: "absolute",
            left: lapX - 140,
            top: NODE_Y - 3,
            width: 140,
            height: 6,
            background: "linear-gradient(90deg, transparent, #FAFAFA)",
          }}
        />
      ) : null}

      {NODE_X.map((_, i) => (
        <FlowNode key={i} index={i} />
      ))}

      <Interactive.Div
        name="Stat"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 720,
          display: "flex",
          justifyContent: "center",
          alignItems: "baseline",
          gap: 36,
          opacity: interpolate(frame, [300, 330], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          translate: interpolate(frame, [300, 340], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <span style={{ fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 150, color: "#FAFAFA" }}>24/7</span>
        <span style={{ fontFamily: "JetBrains Mono", fontWeight: 800, fontSize: 40, letterSpacing: "0.12em", color: "#8A8A8A" }}>
          ZONDER PAUZE.
        </span>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
