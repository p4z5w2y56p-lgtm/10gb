import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

export type TerminalLine = { tag: string; text: string; at: number };

/**
 * Dark terminal panel (Stijlgids §9): 3–6 lines that tell a story,
 * each line typed out on its own beat.
 */
export const Terminal: React.FC<{
  title: string;
  lines: TerminalLine[];
  enterAt: number;
  width?: number;
}> = ({ title, lines, enterAt, width = 1320 }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [enterAt, enterAt + 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0, 0, 0.2, 1),
  });

  return (
    <div
      style={{
        width,
        borderRadius: 30,
        background: "#0B0B0D",
        border: "1.5px solid rgba(250,250,250,0.14)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        overflow: "hidden",
        opacity: enter,
        translate: `0px ${(1 - enter) * 120}px`,
        filter: `blur(${(1 - enter) * 12}px)`,
        fontFamily: "JetBrains Mono",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "26px 40px",
          borderBottom: "1.5px solid rgba(250,250,250,0.1)",
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "0.12em",
          color: "#8A8A8A",
        }}
      >
        <span>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 12, color: "#FAFAFA" }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#FAFAFA",
              opacity: Math.floor(frame / 15) % 2 === 0 ? 1 : 0.3,
            }}
          />
          LIVE
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22, padding: "36px 40px 44px" }}>
        {lines.map((line) => {
          const typed = line.text.slice(0, Math.max(0, Math.floor((frame - line.at) * 1.4)));
          const visible = frame >= line.at;
          const typing = visible && typed.length < line.text.length;
          return (
            <div
              key={line.tag}
              style={{
                display: "flex",
                fontSize: 40,
                fontWeight: 500,
                lineHeight: 1.3,
                opacity: visible ? 1 : 0,
                minHeight: 52,
              }}
            >
              <span style={{ width: 300, flexShrink: 0, color: "#8A8A8A" }}>{line.tag}</span>
              <span style={{ color: "#FAFAFA" }}>
                {typed}
                {typing ? (
                  <span
                    style={{
                      display: "inline-block",
                      width: 22,
                      height: 40,
                      marginLeft: 4,
                      translate: "0px 6px",
                      background: "#FAFAFA",
                    }}
                  />
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
