import React from "react";
import { AbsoluteFill, interpolate } from "remotion";
import { MANROPE } from "../fonts";
import { OUT3, Vignette, clamp, shake, tw, useTime } from "../fx";
import { BEAT } from "../timeline";
import { C, mono, useStage } from "./brand";
import { iso } from "./three";

const WORDS = ["ONEERLIJK", "DIGITAAL", "VOORDEEL."];
const ADV_V = 144;

/** X-ray view of the SaaS tower: thin grey construction lines on white. */
const XRay: React.FC = () => {
  const { W, H, V } = useStage();
  // vertical: tower rises behind the stacked words from the lower right, bleeding off the bottom
  const s = V ? 78 : 62;
  const cx = V ? 700 : 1330;
  const cy = V ? 1790 : 1010;
  const lines: React.ReactNode[] = [];
  for (let i = 0; i < 15; i++) {
    const y = i * 0.62;
    const pts = [
      iso(0, y, 0, s, cx, cy),
      iso(3.2, y, 0, s, cx, cy),
      iso(3.2, y, 3.2, s, cx, cy),
      iso(0, y, 3.2, s, cx, cy),
    ];
    lines.push(
      <polygon
        key={`f${i}`}
        points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
      />,
    );
  }
  [
    [0, 0],
    [3.2, 0],
    [3.2, 3.2],
    [0, 3.2],
  ].forEach(([x, z], i) => {
    const a = iso(x, 0, z, s, cx, cy);
    const b = iso(x, 14 * 0.62, z, s, cx, cy);
    lines.push(<line key={`v${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />);
  });
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      <g stroke="#7d7d84" strokeWidth={1.4} strokeDasharray="7 5">
        {lines}
      </g>
    </svg>
  );
};

/** ONEERLIJK / DIGITAAL / VOORDEEL. one word per beat, ground alternating paper ↔ black; beat 4 is the X-ray cut. */
export const Advantage: React.FC<{ dur: number; uid?: string }> = ({ dur }) => {
  const t = useTime();
  const { V } = useStage();
  // vertical: longest word ("ONEERLIJK") sized to ≈ 800 px of the 1080 frame
  const size = V ? ADV_V : 230;
  const pad = V ? 64 : 120;
  const top = V ? 200 : 120;
  const beat = Math.floor(t / BEAT + 1e-6);
  const xray = beat === 3;
  const dark = beat === 1;
  const out = tw(t, 4 * BEAT, dur, 0, 1, OUT3);
  const sh = shake(t, [0, BEAT, 2 * BEAT, 3 * BEAT], 3, 0.12, "adv");
  const zoom = interpolate(t, [0, dur], [1, 1.06], clamp);
  const ink = dark ? C.white : C.ink;
  return (
    <AbsoluteFill
      style={{
        background: dark ? C.black : xray ? "#ffffff" : C.paper,
        overflow: "hidden",
      }}
    >
      {xray ? <XRay /> : null}
      <div
        style={{
          position: "absolute",
          left: pad,
          top,
          ...mono(22, dark ? C.mutedOnDark : C.mutedOnPaper),
        }}
      >
        AIVEN // POSITIE
      </div>
      <div
        style={{
          position: "absolute",
          right: pad,
          top,
          ...mono(22, dark ? C.mutedOnDark : C.mutedOnPaper, 400),
        }}
      >
        {xray ? "X-RAY // STRUCTUUR" : `0${Math.min(beat, 2) + 1} / 03`}
      </div>
      <AbsoluteFill
        style={{
          transform: `translate(${sh.x}px, ${sh.y}px) scale(${zoom + out * 0.05})`,
          filter: out > 0.01 ? `blur(${out * 20}px)` : undefined,
          opacity: 1 - out * 0.4,
          justifyContent: "center",
          paddingLeft: pad,
        }}
      >
        {WORDS.map((w, i) => {
          const lt = t - i * BEAT;
          if (lt < 0)
            return <div key={w} style={{ height: V ? size * 0.89 : 205 }} />;
          const p = tw(lt, 0, 0.12, 0, 1, OUT3);
          return (
            <div
              key={w}
              style={{
                fontFamily: MANROPE,
                fontWeight: 800,
                fontSize: size,
                lineHeight: 0.89,
                letterSpacing: "-0.055em",
                // X-ray outline: a 5px stroke painted under a fill in the ground colour, so only the
                // outer 2.5px shows and the overlapping glyph contours (the A's crossbars) stay hidden.
                color: xray ? "#ffffff" : ink,
                WebkitTextStroke: xray ? `5px ${C.ink}` : undefined,
                paintOrder: xray ? "stroke fill" : undefined,
                opacity: p,
                transform: `translateY(${(1 - p) * 40}px)`,
                filter: p < 0.99 ? `blur(${(1 - p) * 12}px)` : undefined,
                whiteSpace: "nowrap",
              }}
            >
              {w}
            </div>
          );
        })}
      </AbsoluteFill>
      {dark ? <Vignette strength={0.5} /> : null}
    </AbsoluteFill>
  );
};
