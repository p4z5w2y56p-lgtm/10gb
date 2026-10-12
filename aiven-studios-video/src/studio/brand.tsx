import React from "react";
import { interpolate, useVideoConfig } from "remotion";
import { JBMONO, MANROPE } from "../fonts";
import { OUT, OUT3, clamp, tw, useTime } from "../fx";

// Project palette (stijlgids §5): monochrome ground/ink/muted + one red accent for key moments only.
/** Frame size of the composition being rendered: 1920×1080 (film) or 1080×1920 (TikTok, V = true). */
export const useStage = () => {
  const { width, height } = useVideoConfig();
  return { W: width, H: height, V: height > width };
};

export const C = {
  black: "#050505",
  paper: "#f7f7f9",
  ink: "#030303",
  white: "#f7f7f9",
  mutedOnDark: "#8a8a8e",
  mutedOnPaper: "#666666",
  hair: "#2a2a2c",
  hairPaper: "#e2e2e5",
  accent: "#d8291f",
};

/** Manrope headline: UPPERCASE, heavy, tight negative tracking (video spec −0.045…−0.055em). */
export const headline = (
  size: number,
  color: string = C.white,
): React.CSSProperties => ({
  fontFamily: MANROPE,
  fontWeight: 800,
  fontSize: size,
  lineHeight: 0.9,
  letterSpacing: "-0.05em",
  textTransform: "uppercase",
  color,
  whiteSpace: "nowrap",
});

/** JetBrains Mono eyebrow/label: UPPERCASE, +2px-style tracking. */
export const mono = (
  size: number,
  color: string = C.mutedOnDark,
  weight = 800,
): React.CSSProperties => ({
  fontFamily: JBMONO,
  fontWeight: weight,
  fontSize: size,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color,
  whiteSpace: "nowrap",
});

/** Line that slides up out of a mask (site motion: translateY(110%) → 0, brutalSnap curve). */
export const MaskLine: React.FC<{
  at: number;
  children: React.ReactNode;
  dur?: number;
  out?: number;
  style?: React.CSSProperties;
}> = ({ at, children, dur = 0.42, out, style }) => {
  const t = useTime();
  const p = tw(t, at, at + dur, 0, 1, OUT);
  const gone = out === undefined ? 0 : tw(t, out, out + 0.16, 0, 1, OUT3);
  return (
    <div style={{ overflow: "hidden", paddingBottom: "0.06em", ...style }}>
      <div
        style={{
          transform: `translateY(${(1 - p) * 110 - gone * 110}%)`,
          opacity: p > 0 ? 1 : 0,
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** Numbered eyebrow, e.g. "01 / THE MANIFESTO". */
export const Eyebrow: React.FC<{
  n: string;
  label: string;
  at?: number;
  color?: string;
  size?: number;
}> = ({ n, label, at = 0, color = C.mutedOnDark, size = 24 }) => {
  const t = useTime();
  const p = tw(t, at, at + 0.3, 0, 1, OUT3);
  return (
    <div
      style={{
        ...mono(size, color),
        opacity: p,
        transform: `translateX(${(1 - p) * -14}px)`,
      }}
    >
      {n} / {label}
    </div>
  );
};

/** Monochrome corner brackets with constant line width. */
export const Corners: React.FC<{
  x: number;
  y: number;
  w: number;
  h: number;
  len?: number;
  color?: string;
  width?: number;
  opacity?: number;
}> = ({ x, y, w, h, len = 34, color = C.white, width = 2, opacity = 1 }) => {
  const { W, H } = useStage();
  return (
    <svg
      width={W}
      height={H}
      style={{ position: "absolute", left: 0, top: 0, opacity }}
    >
      <g stroke={color} strokeWidth={width} fill="none" strokeLinecap="square">
        <path d={`M${x} ${y + len} V${y} H${x + len}`} />
        <path d={`M${x + w - len} ${y} H${x + w} V${y + len}`} />
        <path d={`M${x + w} ${y + h - len} V${y + h} H${x + w - len}`} />
        <path d={`M${x + len} ${y + h} H${x} V${y + h - len}`} />
      </g>
    </svg>
  );
};

/** Stepped "split-flap" scramble for small mono labels / stats, resolving at `at + dur`. */
export const Scramble: React.FC<{ text: string; at: number; dur?: number }> = ({
  text,
  at,
  dur = 0.3,
}) => {
  const t = useTime();
  const p = interpolate(t, [at, at + dur], [0, 1], clamp);
  if (t < at) return <span style={{ opacity: 0 }}>{text}</span>;
  const glyphs = "0123456789/<>#*+=-";
  const step = Math.floor(t * 30);
  const shown = text
    .split("")
    .map((ch, i) => {
      if (ch === " " || p >= 1 || i / text.length < p) return ch;
      return glyphs[(step * 7 + i * 13) % glyphs.length];
    })
    .join("");
  return <span>{shown}</span>;
};
