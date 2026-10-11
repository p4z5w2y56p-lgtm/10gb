import React from "react";
import {
  AbsoluteFill,
  interpolate,
  random,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// Project palette (monochrome, per Stijlgids §5)
// ground #040404 · ink #FAFAFA · ink-muted #8A8A8A · inverted ground #F7F7F9

const NOISE_SVG = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.6 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}")`;

const STARS = new Array(46).fill(true).map((_, i) => ({
  x: random(`sx${i}`) * 1920,
  y: random(`sy${i}`) * 1080,
  size: random(`ss${i}`) < 0.85 ? 2 : 3,
  speed: 0.15 + random(`sp${i}`) * 0.5,
  twinkle: random(`st${i}`) * Math.PI * 2,
}));

/**
 * Brutal-minimal backdrop: solid ground, a slowly receding perspective grid,
 * a sparse sharp starfield, HUD corner frames and 35mm grain.
 */
export const Background: React.FC<{ inverted?: boolean; grid?: boolean }> = ({
  inverted = false,
  grid = true,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const line = inverted ? "rgba(3,3,3,0.09)" : "rgba(250,250,250,0.07)";
  const ink = inverted ? "#030303" : "#FAFAFA";

  return (
    <AbsoluteFill
      style={{
        backgroundColor: inverted ? "#F7F7F9" : "#040404",
        overflow: "hidden",
      }}
    >
      {grid ? (
        <AbsoluteFill style={{ perspective: 900, perspectiveOrigin: "50% 30%" }}>
          <div
            style={{
              position: "absolute",
              left: -1200,
              right: -1200,
              top: 560,
              height: 1400,
              backgroundImage: `linear-gradient(${line} 2px, transparent 2px), linear-gradient(90deg, ${line} 2px, transparent 2px)`,
              backgroundSize: "120px 120px",
              backgroundPosition: `0px ${interpolate(frame, [0, durationInFrames], [0, 240])}px`,
              transform: "rotateX(72deg)",
              transformOrigin: "50% 0%",
              maskImage: "linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)",
              WebkitMaskImage:
                "linear-gradient(180deg, transparent 0%, black 35%, black 60%, transparent 100%)",
            }}
          />
        </AbsoluteFill>
      ) : null}

      {STARS.map((s, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: s.x,
            top: (s.y - frame * s.speed + 1080) % 1080,
            width: s.size,
            height: s.size,
            background: ink,
            opacity: 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(frame / 20 + s.twinkle)),
          }}
        />
      ))}

      {/* HUD corner frames, constant 2px line */}
      {[
        { left: 56, top: 56, borderLeft: true, borderTop: true },
        { right: 56, top: 56, borderRight: true, borderTop: true },
        { left: 56, bottom: 56, borderLeft: true, borderBottom: true },
        { right: 56, bottom: 56, borderRight: true, borderBottom: true },
      ].map((c, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: c.left,
            right: c.right,
            top: c.top,
            bottom: c.bottom,
            width: 44,
            height: 44,
            borderLeft: c.borderLeft ? `2px solid ${ink}` : undefined,
            borderRight: c.borderRight ? `2px solid ${ink}` : undefined,
            borderTop: c.borderTop ? `2px solid ${ink}` : undefined,
            borderBottom: c.borderBottom ? `2px solid ${ink}` : undefined,
            opacity: 0.35,
          }}
        />
      ))}

      <AbsoluteFill
        style={{
          backgroundImage: NOISE_SVG,
          backgroundPosition: `${Math.floor(random(`gx${frame}`) * 240)}px ${Math.floor(random(`gy${frame}`) * 240)}px`,
          opacity: inverted ? 0.1 : 0.06,
          mixBlendMode: inverted ? "multiply" : "overlay",
        }}
      />
    </AbsoluteFill>
  );
};
