import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { Ground } from "../components/Ground";
import { LineIcon } from "../components/LineIcon";
import "../fonts";

const ease = (frame: number, a: number, z: number, from = 0, to = 1) =>
  interpolate(frame, [a, z], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const URL = "jouwmerk.nl";

/** A client site builds itself, one part per beat; the CTA press is the accent moment. 8 beats. */
export const WebBuild: React.FC = () => {
  const frame = useCurrentFrame();
  const win = ease(frame, 0, 12);
  const pressed = frame >= b(5);
  const cx = ease(frame, b(4), b(5) - 2, 900, 210);
  const cy = ease(frame, b(4), b(5) - 2, 560, 412);
  const phone = ease(frame, b(6), b(6) + 14);

  return (
    <Ground theme="paper" label="AIVEN // BUILD" counter="03 / 03">
      <div
        style={{
          position: "absolute",
          left: 180,
          top: 200,
          width: 1240,
          height: 680,
          borderRadius: 30,
          overflow: "hidden",
          background: C.cardWhite,
          border: `1px solid ${C.hairPaper}`,
          boxShadow: "0 10px 20px rgba(0,0,0,0.1)",
          opacity: win,
          translate: `0px ${(1 - win) * 60}px`,
          filter: `blur(${(1 - win) * 12}px)`,
        }}
      >
        <div style={{ height: 56, display: "flex", alignItems: "center", gap: 10, padding: "0 24px", borderBottom: `1px solid ${C.hairPaper}` }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 12, height: 12, borderRadius: 6, border: `1.5px solid ${C.mutedOnPaper}` }} />
          ))}
          <div style={{ marginLeft: 300, fontFamily: "JetBrains Mono", fontSize: 20, letterSpacing: "0.04em", color: C.mutedOnPaper }}>
            https://{URL.slice(0, Math.floor(ease(frame, 2, b(1), 0, URL.length)))}
          </div>
        </div>
        <div style={{ position: "relative", height: 624, background: C.black, padding: "0 56px", overflow: "hidden" }}>
          <div
            style={{
              height: 76,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: `1px solid ${C.hair}`,
              fontFamily: "Manrope",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: "0.04em",
              color: C.mutedOnDark,
              translate: `0px ${ease(frame, b(1), b(1) + 10, -76, 0)}px`,
            }}
          >
            <span style={{ color: C.white, fontSize: 24 }}>JOUW MERK</span>
            <span style={{ display: "flex", gap: 36 }}>
              <span>DIENSTEN</span>
              <span>WERK</span>
              <span>CONTACT</span>
            </span>
          </div>
          <div style={{ marginTop: 48, fontFamily: "Manrope", fontWeight: 800, fontSize: 120, lineHeight: 0.9, letterSpacing: "-0.05em" }}>
            <div style={{ overflow: "hidden" }}>
              <div style={{ color: C.white, translate: `0px ${ease(frame, b(2), b(2) + 14, 110, 0)}%` }}>JOUW MERK.</div>
            </div>
            <div style={{ overflow: "hidden" }}>
              <div style={{ color: C.mutedOnDark, translate: `0px ${ease(frame, b(2) + 4, b(2) + 18, 110, 0)}%` }}>ONLINE.</div>
            </div>
          </div>
          <div
            style={{
              marginTop: 32,
              display: "inline-flex",
              alignItems: "center",
              gap: 16,
              padding: "22px 44px",
              borderRadius: 100,
              background: pressed ? C.accent : C.paper,
              color: C.ink,
              fontFamily: "Manrope",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: "0.02em",
              scale: String(ease(frame, b(3), b(3) + 10) * (pressed ? 0.95 : 1)),
            }}
          >
            START PROJECT
            <LineIcon name="arrow" size={28} color={C.ink} />
          </div>
          <div style={{ marginTop: 40, display: "flex", gap: 24 }}>
            {[0, 1, 2].map((i) => {
              const p = ease(frame, b(4) + i * 3, b(4) + i * 3 + 12);
              return (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    height: 120,
                    borderRadius: 30,
                    background: C.panel,
                    border: `1px solid ${C.hair}`,
                    padding: "24px 30px",
                    fontFamily: "JetBrains Mono",
                    fontSize: 20,
                    letterSpacing: "0.14em",
                    color: C.mutedOnDark,
                    opacity: p,
                    translate: `0px ${(1 - p) * 40}px`,
                  }}
                >
                  0{i + 1} / {["SNEL", "STRAK", "SCHAALBAAR"][i]}
                </div>
              );
            })}
          </div>
          <svg
            width={44}
            height={44}
            viewBox="0 0 24 24"
            style={{ position: "absolute", left: cx, top: cy, opacity: ease(frame, b(4), b(4) + 4), scale: pressed && frame < b(5) + 6 ? "0.85" : "1" }}
          >
            <path d="M4 2 L4 19 L8.5 15 L11.5 22 L14.5 20.7 L11.6 14 L18 14 Z" fill={C.paper} stroke={C.ink} strokeWidth={1.4} strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <AbsoluteFill style={{ pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            left: 1380,
            top: 300,
            width: 300,
            height: 600,
            borderRadius: 50,
            padding: 12,
            background: C.ink,
            boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
            opacity: phone,
            translate: `${(1 - phone) * 320}px 0px`,
            rotate: `${(1 - phone) * 14}deg`,
          }}
        >
          <div style={{ height: "100%", borderRadius: 40, background: C.black, padding: "64px 24px 0", fontFamily: "Manrope", fontWeight: 800, color: C.white }}>
            <div style={{ fontSize: 15, letterSpacing: "0.04em", color: C.mutedOnDark }}>JOUW MERK</div>
            <div style={{ marginTop: 28, fontSize: 48, lineHeight: 0.9, letterSpacing: "-0.05em" }}>
              JOUW
              <br />
              MERK.
              <br />
              <span style={{ color: C.mutedOnDark }}>ONLINE.</span>
            </div>
            <div style={{ marginTop: 28, padding: "16px 0", borderRadius: 100, background: C.paper, color: C.ink, textAlign: "center", fontSize: 16 }}>
              START PROJECT
            </div>
            <div style={{ marginTop: 20, height: 110, borderRadius: 24, background: C.panel, border: `1px solid ${C.hair}` }} />
          </div>
        </div>
      </AbsoluteFill>
    </Ground>
  );
};
