import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { LineIcon } from "./LineIcon";
import { ScrambleLabel } from "./ScrambleLabel";

const pop = (frame: number, at: number) =>
  interpolate(frame, [b(at), b(at) + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

/** Four L brackets, 2px, square caps; `locked` turns them accent. */
export const Corners: React.FC<{ w: number; h: number; len?: number; color: string }> = ({ w, h, len = 34, color }) => {
  const leg = (s: React.CSSProperties) => (
    <div style={{ position: "absolute", width: len, height: len, borderColor: color, borderStyle: "solid", borderWidth: 0, ...s }} />
  );
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: w, height: h, pointerEvents: "none" }}>
      {leg({ left: 0, top: 0, borderLeftWidth: 2, borderTopWidth: 2 })}
      {leg({ right: 0, top: 0, borderRightWidth: 2, borderTopWidth: 2 })}
      {leg({ right: 0, bottom: 0, borderRightWidth: 2, borderBottomWidth: 2 })}
      {leg({ left: 0, bottom: 0, borderLeftWidth: 2, borderBottomWidth: 2 })}
    </div>
  );
};

/** Process step on black: unlit until its beat, then lit; the last one inverts. */
export const StepPanel: React.FC<{
  n: string;
  word: string;
  icon: "cpu" | "terminal" | "arrow";
  enterAt: number;
  litAt: number;
  inverted?: boolean;
}> = ({ n, word, icon, enterAt, litAt, inverted }) => {
  const frame = useCurrentFrame();
  const p = pop(frame, enterAt);
  const lit = frame >= b(litAt);
  const inv = inverted && lit;
  const fg = inv ? C.ink : lit ? C.white : C.unlit;
  return (
    <div
      style={{
        width: 520,
        height: 600,
        padding: 44,
        borderRadius: 30,
        background: inv ? C.cardWhite : C.panel,
        border: `1.5px solid ${lit ? C.paper : C.hair}`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity: p,
        translate: `0px ${(1 - p) * 60}px`,
        filter: `blur(${(1 - p) * 12}px)`,
        scale: String(lit ? interpolate(frame, [b(litAt), b(litAt) + 3, b(litAt) + 12], [1, 1.04, 1], { extrapolateRight: "clamp" }) : 1),
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontFamily: "JetBrains Mono Var", fontWeight: 800, fontSize: 24, letterSpacing: "0.14em", color: inv ? C.mutedOnPaper : C.mutedOnDark }}>
          {n} / STEP
        </div>
        <LineIcon name={icon} size={48} color={inv ? C.ink : lit ? C.white : C.mutedOnDark} />
      </div>
      <div style={{ fontFamily: "Manrope", fontWeight: 800, fontSize: 118, lineHeight: 0.9, letterSpacing: "-0.05em", color: fg }}>
        {word}
      </div>
    </div>
  );
};

/** Proof number on a white card (paper scene). */
export const StatCard: React.FC<{ value: string; label: string; caption: string; at: number }> = ({ value, label, caption, at }) => {
  const frame = useCurrentFrame();
  const p = pop(frame, at);
  return (
    <div
      style={{
        width: 480,
        height: 500,
        padding: 46,
        borderRadius: 30,
        background: C.cardWhite,
        border: `1px solid ${C.hairPaper}`,
        boxShadow: "0 10px 20px rgba(0,0,0,0.1)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        opacity: p,
        translate: `0px ${(1 - p) * 60}px`,
        filter: `blur(${(1 - p) * 12}px)`,
      }}
    >
      <ScrambleLabel text={caption} delay={b(at)} fontSize={20} weight={500} color={C.mutedOnPaper} />
      <div>
        <div style={{ fontFamily: "JetBrains Mono Var", fontWeight: 800, fontSize: value.length > 2 ? 170 : 230, lineHeight: 1, letterSpacing: "-0.04em", color: C.ink }}>
          {value}
        </div>
        <div style={{ marginTop: 18, fontFamily: "JetBrains Mono Var", fontWeight: 800, fontSize: 24, letterSpacing: "0.14em", color: C.ink }}>
          {label}
        </div>
      </div>
    </div>
  );
};

/** The CTA pill: ink on paper; pressed turns accent with on-accent label and squashes 5%. */
export const PillButton: React.FC<{ label: string; pressed: boolean }> = ({ label, pressed }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 24,
      padding: "36px 66px",
      borderRadius: 100,
      background: pressed ? C.accent : C.ink,
      color: pressed ? C.ink : C.paper,
      fontFamily: "Manrope",
      fontWeight: 800,
      fontSize: 44,
      lineHeight: 1,
      letterSpacing: "0.02em",
      boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
      scale: pressed ? "0.95" : "1",
    }}
  >
    {label}
    <LineIcon name="arrow" size={44} color={pressed ? C.ink : C.paper} />
  </div>
);
