import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { noise2D } from "@remotion/noise";
import { ANTON } from "./fonts";

export const RED = "#d8291f";
export const BLUE = "#2f5fd0";
export const INK = "#141414";

export const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
export const OUT = Easing.bezier(0.16, 1, 0.3, 1); // fast-out, long settle
export const OUT3 = Easing.out(Easing.cubic);
export const INOUT = Easing.inOut(Easing.cubic);
export const IN = Easing.in(Easing.cubic);

/** Seconds since the start of the current Sequence. */
export const useTime = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
};

/** interpolate() over seconds with clamping + easing. */
export const tw = (t: number, a: number, b: number, from: number, to: number, easing = OUT) =>
  interpolate(t, [a, b], [from, to], { ...clamp, easing });

/** Smooth (noise-based, not per-frame random) camera shake that decays after each hit. */
export const shake = (t: number, hits: number[], amp = 16, decay = 0.16, seed = "s") => {
  let x = 0;
  let y = 0;
  let r = 0;
  for (const h of hits) {
    const dt = t - h;
    if (dt < 0 || dt > decay * 4) continue;
    const k = Math.exp(-dt / decay) * amp;
    x += noise2D(`${seed}x`, dt * 26, h * 7) * k;
    y += noise2D(`${seed}y`, dt * 26, h * 7) * k * 0.8;
    r += noise2D(`${seed}r`, dt * 20, h * 7) * k * 0.04;
  }
  return { x, y, r };
};

/** 30 Hz stepped random, the cadence of film grain / glitch flicker. */
export const useStep = () => Math.floor(useCurrentFrame() / 2);

const GRAIN = Array.from({ length: 12 }, (_, i) => staticFile(`tex/grain_${String(i).padStart(2, "0")}.png`));

export const Grain: React.FC<{ opacity?: number }> = ({ opacity = 0.3 }) => {
  const step = useStep();
  const src = GRAIN[step % GRAIN.length];
  const ox = Math.floor(random(`gx${step}`) * 120);
  const oy = Math.floor(random(`gy${step}`) * 960);
  return (
    <AbsoluteFill style={{ mixBlendMode: "overlay", opacity, overflow: "hidden", pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: -ox, top: -oy, width: 2048, height: 3072 }}>
        {[0, 1, 2, 3, 4, 5].map((k) => (
          <Img
            key={k}
            src={src}
            style={{ position: "absolute", left: (k % 2) * 1024, top: Math.floor(k / 2) * 1024, width: 1024, height: 1024 }}
          />
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Preloads every texture once so stepped swaps never wait on the network/decoder. */
export const Preload: React.FC = () => (
  <div style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden" }}>
    {[...GRAIN, ...[0, 1, 2, 3, 4, 5].map((i) => staticFile(`tex/dust_${i}.png`))].map((s) => (
      <Img key={s} src={s} style={{ width: 1, height: 1 }} />
    ))}
  </div>
);

/** Sparse film dust / hairs on random 30 Hz steps. */
export const Dust: React.FC<{ opacity?: number }> = ({ opacity = 0.45 }) => {
  const step = useStep();
  if (random(`dust${step}`) > 0.22) return null;
  const i = Math.floor(random(`dusti${step}`) * 6);
  return (
    <AbsoluteFill style={{ mixBlendMode: "screen", opacity, pointerEvents: "none" }}>
      <Img src={staticFile(`tex/dust_${i}.png`)} style={{ width: "100%", height: "100%" }} />
    </AbsoluteFill>
  );
};

export const Vignette: React.FC<{ strength?: number; inner?: number }> = ({ strength = 0.6, inner = 42 }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${strength}) 100%)`,
      pointerEvents: "none",
    }}
  />
);

/** White flash that snaps on at a cut and decays exponentially. */
export const Flashes: React.FC<{ at: number[]; peak?: number }> = ({ at, peak = 0.7 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  let o = 0;
  for (const c of at) {
    const dt = (frame - Math.round(c * fps)) / fps;
    if (dt >= 0 && dt < 0.25) o = Math.max(o, peak * Math.exp(-dt / 0.045));
  }
  if (o < 0.005) return null;
  return <AbsoluteFill style={{ background: "#fff", opacity: o, pointerEvents: "none" }} />;
};

/** Inline SVG filter defs; reference with `filter: url(#id)`. */
export const BlurDef: React.FC<{ id: string; x: number; y?: number }> = ({ id, x, y = 0 }) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id={id} x="-20%" y="-20%" width="140%" height="140%" colorInterpolationFilters="sRGB">
      <feGaussianBlur stdDeviation={`${Math.max(0, x)} ${Math.max(0, y)}`} />
    </filter>
  </svg>
);

/** Punches small holes + roughens edges, for the distressed stencil look on type. */
export const GrungeDef: React.FC<{ id: string; seed?: number; amount?: number; freq?: number }> = ({
  id,
  seed = 3,
  amount = 1,
  freq = 0.045,
}) => (
  <svg width={0} height={0} style={{ position: "absolute" }}>
    <filter id={id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
      <feTurbulence type="fractalNoise" baseFrequency={freq} numOctaves={4} seed={seed} result="n" />
      <feColorMatrix
        in="n"
        type="matrix"
        values={`0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${-9 * amount} ${5.4 + (1 - amount) * 4}`}
        result="holes"
      />
      <feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves={1} seed={seed + 1} result="fine" />
      <feDisplacementMap in="SourceGraphic" in2="fine" scale={2.2 * amount} xChannelSelector="R" yChannelSelector="G" result="rough" />
      <feComposite in="rough" in2="holes" operator="in" />
    </filter>
  </svg>
);

/** Covers the frame with an image and animates a Ken Burns move (normalized focus point + zoom). */
export const Plate: React.FC<{
  src: string;
  nw: number;
  nh: number;
  dur: number;
  z?: [number, number];
  c0?: [number, number];
  c1?: [number, number];
  easing?: (n: number) => number;
  style?: React.CSSProperties;
}> = ({ src, nw, nh, dur, z = [1, 1.08], c0 = [0.5, 0.5], c1, easing = (n) => n, style }) => {
  const t = useTime();
  const p = easing(interpolate(t, [0, dur], [0, 1], clamp));
  const end = c1 ?? c0;
  const zoom = z[0] + (z[1] - z[0]) * p;
  const cx = c0[0] + (end[0] - c0[0]) * p;
  const cy = c0[1] + (end[1] - c0[1]) * p;
  const base = Math.max(1920 / nw, 1080 / nh);
  const w = nw * base;
  const h = nh * base;
  const sw = w * zoom;
  const sh = h * zoom;
  let left = 960 - cx * sw;
  let top = 540 - cy * sh;
  left = Math.min(0, Math.max(1920 - sw, left));
  top = Math.min(0, Math.max(1080 - sh, top));
  return (
    <Img
      src={src}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: w,
        height: h,
        transformOrigin: "0 0",
        transform: `translate(${left}px, ${top}px) scale(${zoom})`,
        ...style,
      }}
    />
  );
};

/** Red dry-brush stroke revealed left→right. */
export const Brush: React.FC<{
  at?: number;
  wipe?: number;
  variant?: 1 | 2 | 3;
  width?: number;
  style?: React.CSSProperties;
}> = ({ at = 0, wipe = 0.09, variant = 1, width = 1800, style }) => {
  const t = useTime();
  const p = tw(t, at, at + wipe, 0, 100, OUT3);
  if (t < at) return null;
  const h = (width / 2600) * 520;
  return (
    <Img
      src={staticFile(`tex/brush_${variant}.png`)}
      style={{
        position: "absolute",
        width,
        height: h,
        left: 960 - width / 2,
        top: 540 - h / 2,
        clipPath: `inset(0 ${100 - p}% 0 0)`,
        ...style,
      }}
    />
  );
};

/** Big type with RGB split + horizontal slice tearing that spikes on hits and decays. */
export const GlitchText: React.FC<{
  text: string;
  size: number;
  hits: number[];
  font?: string;
  color?: string;
  spacing?: string;
  baseSplit?: number;
  filter?: string;
  seed?: string;
}> = ({ text, size, hits, font = ANTON, color = "#ececec", spacing = "0.01em", baseSplit = 3, filter, seed = "g" }) => {
  const t = useTime();
  const step = useStep();
  let energy = 0;
  for (const h of hits) {
    const dt = t - h;
    if (dt >= 0) energy = Math.max(energy, Math.exp(-dt / 0.12));
  }
  const split = baseSplit + energy * 22;
  const jitter = (random(`${seed}j${step}`) - 0.5) * energy * 18;
  const base: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: font,
    fontSize: size,
    letterSpacing: spacing,
    lineHeight: 1,
    whiteSpace: "nowrap",
    textTransform: "uppercase",
  };
  const slices = 9;
  return (
    <AbsoluteFill style={{ filter }}>
      <div style={{ ...base, color: "#ff2b2b", transform: `translateX(${split + jitter}px)`, mixBlendMode: "screen", opacity: 0.85 }}>
        {text}
      </div>
      <div style={{ ...base, color: "#21d6ff", transform: `translateX(${-split + jitter * 0.5}px)`, mixBlendMode: "screen", opacity: 0.85 }}>
        {text}
      </div>
      {Array.from({ length: slices }, (_, i) => {
        const tear = random(`${seed}t${step}-${i}`) > 1 - energy * 0.6 ? (random(`${seed}x${step}-${i}`) - 0.5) * 120 * energy : 0;
        return (
          <div
            key={i}
            style={{
              ...base,
              color,
              clipPath: `inset(${(i / slices) * 100}% 0 ${100 - ((i + 1) / slices) * 100}% 0)`,
              transform: `translateX(${tear + jitter}px)`,
            }}
          >
            {text}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

/** A word that slams in: overscale + blur → settle. */
export const Slam: React.FC<{
  at?: number;
  children: React.ReactNode;
  from?: number;
  dur?: number;
  style?: React.CSSProperties;
}> = ({ at = 0, children, from = 1.3, dur = 0.14, style }) => {
  const t = useTime() - at;
  if (t < 0) return null;
  const s = tw(t, 0, dur, from, 1, OUT3);
  const blur = tw(t, 0, dur * 0.8, 14, 0, OUT3);
  const o = tw(t, 0, 0.034, 0.55, 1, (n) => n);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transform: `scale(${s})`,
        filter: blur > 0.05 ? `blur(${blur}px)` : undefined,
        opacity: o,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** Full-frame camera wrapper: push-in over the shot + a punch on the cut + decaying shake. */
export const Camera: React.FC<{
  dur: number;
  children: React.ReactNode;
  zoom?: [number, number];
  punch?: number;
  hits?: number[];
  amp?: number;
  rotate?: number;
  style?: React.CSSProperties;
}> = ({ dur, children, zoom = [1, 1.06], punch = 0.05, hits = [0], amp = 14, rotate = 0, style }) => {
  const t = useTime();
  const push = zoom[0] + (zoom[1] - zoom[0]) * interpolate(t, [0, dur], [0, 1], clamp);
  const p = punch * Math.exp(-t / 0.09);
  const sh = shake(t, hits, amp);
  return (
    <AbsoluteFill style={{ overflow: "hidden", ...style }}>
      <AbsoluteFill
        style={{
          transform: `translate(${sh.x}px, ${sh.y}px) rotate(${sh.r + rotate}deg) scale(${push + p})`,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/** Colour treatments that match the reference's grade. */
export const Tint: React.FC<{ color: string; mode?: React.CSSProperties["mixBlendMode"]; opacity?: number }> = ({
  color,
  mode = "multiply",
  opacity = 1,
}) => <AbsoluteFill style={{ background: color, mixBlendMode: mode, opacity, pointerEvents: "none" }} />;
