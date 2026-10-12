import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { b, C } from "../brand";

export type TerminalLine = { at: number; text: string; muted?: boolean };

/** Design-system TerminalWindow: 16px radius, dotted title bar, mono 34px / 1.75; one line per beat. */
export const Terminal: React.FC<{ title: string; lines: TerminalLine[]; width?: number }> = ({
  title,
  lines,
  width = 1240,
}) => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        width,
        borderRadius: 16,
        background: C.terminal,
        border: `1px solid ${C.hair}`,
        boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: 54,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "0 24px",
          borderBottom: `1px solid ${C.hair}`,
        }}
      >
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 6, border: `1.5px solid ${C.mutedOnDark}` }} />
        ))}
        <div
          style={{
            marginLeft: 18,
            fontFamily: "JetBrains Mono",
            fontSize: 18,
            letterSpacing: "0.04em",
            color: C.mutedOnDark,
          }}
        >
          {title}
        </div>
      </div>
      <div
        style={{
          padding: "34px 40px",
          fontFamily: "JetBrains Mono",
          fontWeight: 500,
          fontSize: 34,
          lineHeight: 1.75,
          whiteSpace: "pre",
        }}
      >
        {lines.map((line) => {
          const chars = Math.floor(interpolate(frame, [b(line.at), b(line.at) + 12], [0, line.text.length], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }));
          const typing = frame >= b(line.at) && chars < line.text.length;
          return (
            <div key={line.text} style={{ color: line.muted ? C.mutedOnDark : C.white, minHeight: 60 }}>
              {line.text.slice(0, chars)}
              {typing ? (
                <span style={{ display: "inline-block", width: "0.53em", height: "1em", background: C.paper, verticalAlign: "-0.12em", marginLeft: "0.18em" }} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
