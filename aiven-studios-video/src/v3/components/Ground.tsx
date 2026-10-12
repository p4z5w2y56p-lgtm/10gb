import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame, useVideoConfig } from "remotion";
import { C, Theme, themeMuted } from "../brand";

const STARS = new Array(40).fill(true).map((_, i) => ({
  x: random(`x${i}`) * 1920,
  y: random(`y${i}`) * 1080,
  s: random(`s${i}`) < 0.8 ? 2 : 3,
  v: 0.3 + random(`v${i}`) * 0.9,
}));

/**
 * Scene ground (Paper or Black), corner meta labels and the camera breath:
 * a slow 1.00 -> 1.045 zoom across the scene.
 */
export const Ground: React.FC<{
  theme: Theme;
  label?: string;
  counter?: string;
  grid?: boolean;
  children: React.ReactNode;
}> = ({ theme, label, counter, grid = false, children }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const dark = theme === "black";
  const meta: React.CSSProperties = {
    position: "absolute",
    top: 64,
    fontFamily: "JetBrains Mono Var",
    fontWeight: 500,
    fontSize: 22,
    letterSpacing: "0.14em",
    color: themeMuted(theme),
  };

  return (
    <AbsoluteFill style={{ backgroundColor: dark ? C.black : C.paper, overflow: "hidden" }}>
      {dark && grid ? (
        <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: "50% 35%" }}>
          <div
            style={{
              position: "absolute",
              left: -1400,
              right: -1400,
              top: 600,
              height: 1500,
              backgroundImage: `linear-gradient(${C.grid} 1px, transparent 1px), linear-gradient(90deg, ${C.grid} 1px, transparent 1px)`,
              backgroundSize: "110px 110px",
              backgroundPosition: `0px ${frame * 6}px`,
              transform: "rotateX(74deg)",
              transformOrigin: "50% 0%",
              WebkitMaskImage: "linear-gradient(180deg, transparent, black 30%, black 55%, transparent)",
            }}
          />
        </AbsoluteFill>
      ) : null}
      {dark
        ? STARS.map((s, i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: (s.x - frame * s.v * 2 + 1920 * 4) % 1920,
                top: s.y,
                width: s.s,
                height: s.s,
                background: C.white,
                opacity: 0.45,
              }}
            />
          ))
        : null}
      <AbsoluteFill
        style={{
          scale: String(interpolate(frame, [0, durationInFrames], [1, 1.045])),
        }}
      >
        {children}
      </AbsoluteFill>
      {dark ? (
        <AbsoluteFill
          style={{ background: "radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,0.55) 100%)" }}
        />
      ) : null}
      {label ? <div style={{ ...meta, left: 120 }}>{label}</div> : null}
      {counter ? <div style={{ ...meta, right: 120 }}>{counter}</div> : null}
    </AbsoluteFill>
  );
};
