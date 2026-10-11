import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";

const ease = (frame: number, a: number, b: number, from = 0, to = 1) =>
  interpolate(frame, [a, b], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

export const CLICK_AT = 270;

/** A client site being built in the Studios grammar: paper ground, black ink, one pill CTA. */
export const SiteMock: React.FC = () => {
  const frame = useCurrentFrame();
  const press = interpolate(frame, [CLICK_AT, CLICK_AT + 5, CLICK_AT + 16], [1, 0.9, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "relative", height: 584, background: "#F7F7F9", overflow: "hidden", color: "#030303" }}>
      <div
        style={{
          height: 80,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 48px",
          borderBottom: "1.5px solid #E2E2E5",
          fontFamily: "Manrope",
          fontWeight: 800,
          fontSize: 20,
          letterSpacing: "0.04em",
          opacity: ease(frame, 150, 170),
          translate: `0px ${ease(frame, 150, 175, -80, 0)}px`,
        }}
      >
        <span style={{ fontSize: 26, letterSpacing: "-0.03em" }}>JOUW MERK</span>
        <span style={{ display: "flex", gap: 36, alignItems: "center", color: "#666666" }}>
          <span>DIENSTEN</span>
          <span>WERK</span>
          <span>CONTACT</span>
        </span>
      </div>

      <div style={{ padding: "52px 48px 0", fontFamily: "Manrope", fontWeight: 800, fontSize: 92, lineHeight: 0.9, letterSpacing: "-0.045em" }}>
        <div style={{ overflow: "hidden" }}>
          <div style={{ translate: `0px ${ease(frame, 160, 200, 110, 0)}%` }}>JOUW MERK.</div>
        </div>
        <div style={{ overflow: "hidden" }}>
          <div style={{ translate: `0px ${ease(frame, 168, 208, 110, 0)}%`, color: "transparent", WebkitTextStroke: "2px #030303" }}>
            ONLINE.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 40, padding: "28px 48px 0" }}>
        <div
          style={{
            position: "relative",
            padding: "20px 40px",
            borderRadius: 100,
            background: "#030303",
            color: "#F7F7F9",
            fontFamily: "Manrope",
            fontWeight: 800,
            fontSize: 22,
            letterSpacing: "0.04em",
            boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
            scale: String(ease(frame, 195, 225) * press),
          }}
        >
          START PROJECT
          <div
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 80,
              height: 80,
              margin: "-40px 0 0 -40px",
              borderRadius: "50%",
              border: "2px solid #030303",
              scale: String(ease(frame, CLICK_AT, CLICK_AT + 36, 0.2, 3.4)),
              opacity: frame < CLICK_AT ? 0 : ease(frame, CLICK_AT, CLICK_AT + 36, 0.8, 0),
            }}
          />
        </div>
        <span style={{ fontFamily: "Manrope", fontWeight: 300, fontSize: 22, color: "#666666", opacity: ease(frame, 185, 215) }}>
          Gebouwd om te converteren.
        </span>
      </div>

      <div style={{ display: "flex", gap: 24, padding: "40px 48px 0" }}>
        {[205, 213, 221].map((at, i) => (
          <div
            key={at}
            style={{
              flex: 1,
              height: 120,
              borderRadius: 30,
              background: "#FFFFFF",
              border: "1.5px solid #E2E2E5",
              boxShadow: "0 10px 20px rgba(0,0,0,0.06)",
              padding: "22px 26px",
              fontFamily: "JetBrains Mono",
              fontWeight: 800,
              fontSize: 18,
              letterSpacing: "0.12em",
              color: "#666666",
              opacity: ease(frame, at, at + 24),
              translate: `0px ${ease(frame, at, at + 30, 50, 0)}px`,
            }}
          >
            0{i + 1} / {["SNEL", "STRAK", "SCHAALBAAR"][i]}
            <div style={{ marginTop: 18, height: 10, width: "85%", borderRadius: 5, background: "#E2E2E5" }} />
            <div style={{ marginTop: 10, height: 10, width: "60%", borderRadius: 5, background: "#E2E2E5" }} />
          </div>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          translate: `${ease(frame, 225, 265, 980, 170)}px ${ease(frame, 225, 265, 560, 352)}px`,
          scale: String(press),
          opacity: ease(frame, 222, 230),
          transformOrigin: "0px 0px",
        }}
      >
        <svg width={44} height={44} viewBox="0 0 24 24">
          <path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill="#030303" stroke="#F7F7F9" strokeWidth={1.4} strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
};
