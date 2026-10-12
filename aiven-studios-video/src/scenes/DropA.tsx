import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useVideoConfig } from "remotion";
import { FeedWall } from "../feed";
import { BEBAS, SANS } from "../fonts";
import {
  BlurDef,
  Brush,
  Camera,
  GlitchText,
  GrungeDef,
  INOUT,
  OUT,
  OUT3,
  Plate,
  Slam,
  Tint,
  Vignette,
  clamp,
  shake,
  tw,
  useTime,
} from "../fx";
import { BEAT } from "../timeline";

const crowd = staticFile("tex/crowd.jpg");
const eye = staticFile("tex/eye_halftone.png");
const city = staticFile("tex/city.jpg");

/** b(0): the drop. Crowd glued to their phones, red brush, SCROLL. */
export const ScrollShot: React.FC<{ dur: number }> = ({ dur }) => (
  <AbsoluteFill style={{ background: "#0a0a0a" }}>
    <Camera dur={dur} zoom={[1, 1.05]} punch={0.07} hits={[0, BEAT]} amp={18}>
      <Plate
        src={crowd}
        nw={3000}
        nh={1500}
        dur={dur}
        z={[1.22, 1.3]}
        c0={[0.44, 0.7]}
        c1={[0.52, 0.7]}
        style={{ filter: "grayscale(1) contrast(1.4) brightness(0.92)" }}
      />
      <Tint color="#5b7ca3" mode="soft-light" opacity={0.7} />
      <Vignette strength={0.75} />
      <Brush at={0} wipe={0.075} variant={1} width={1880} style={{ opacity: 0.96 }} />
      <GrungeDef id="g-scroll" seed={4} amount={0.85} />
      <Slam at={0} from={1.32}>
        <GlitchText text="SCROLL." size={310} hits={[0, BEAT]} filter="url(#g-scroll)" seed="sc" />
      </Slam>
    </Camera>
  </AbsoluteFill>
);

const Cursor: React.FC<{ x: number; y: number; s: number }> = ({ x, y, s }) => (
  <svg
    width={72}
    height={96}
    viewBox="0 0 24 32"
    style={{ position: "absolute", left: x, top: y, transform: `scale(${s})`, transformOrigin: "4px 4px", filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.55))" }}
  >
    <path d="M2 2 L2 26 L8.2 20.4 L12.4 30 L16.6 28.2 L12.5 18.8 L20.6 18.8 Z" fill="#fff" stroke="#000" strokeWidth={1.6} strokeLinejoin="round" />
  </svg>
);

/** The universal gesture: hitting "Skip Ad". Click lands on beat 3 of the bar. */
export const SkipShot: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const click = BEAT;
  const travel = tw(t, 0, click - 0.02, 0, 1, INOUT);
  const cx = interpolate(travel, [0, 1], [1960, 1352]);
  const cy = interpolate(travel, [0, 1], [1180, 676]);
  const pressed = t >= click;
  const squash = pressed ? 1 - 0.07 * Math.exp(-(t - click) / 0.07) : 1;
  const cursorScale = pressed ? 1 - 0.14 * Math.exp(-(t - click) / 0.06) : 1;
  const ring = tw(t, click, click + 0.3, 0, 1, OUT);
  const after = tw(t, click, click + 0.2, 0, 1, OUT3);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <Camera dur={dur} zoom={[1.0, 1.07]} punch={0.05} hits={[0, click]} amp={10}>
        <BlurDef id="adblur" x={6 + after * 30} y={6} />
        <AbsoluteFill style={{ filter: `url(#adblur) grayscale(1) brightness(${0.55 - after * 0.25}) contrast(1.2)` }}>
          <Plate src={city} nw={3840} nh={2400} dur={dur} z={[1.15, 1.22]} c0={[0.6, 0.45]} />
        </AbsoluteFill>
        <div style={{ position: "absolute", left: 80, top: 930, fontFamily: SANS, fontWeight: 600, fontSize: 32, color: "#f0f0f0", letterSpacing: "0.02em" }}>
          Ad · 1 of 2 · 0:15
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, top: 1000, height: 8, background: "rgba(255,255,255,0.28)" }}>
          <div style={{ width: `${31 + t * 4}%`, height: "100%", background: "#e5271d" }} />
        </div>
        <div
          style={{
            position: "absolute",
            left: 880,
            top: 560,
            width: 840,
            height: 210,
            transform: `scale(${squash})`,
            borderRadius: 6,
            border: "4px solid rgba(255,255,255,0.85)",
            background: pressed ? "#f4f4f4" : "rgba(0,0,0,0.62)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 34,
            color: pressed ? "#0b0b0b" : "#fff",
            fontFamily: SANS,
            fontWeight: 600,
            fontSize: 100,
            letterSpacing: "-0.01em",
          }}
        >
          Skip Ad
          <svg width={92} height={92} viewBox="0 0 24 24">
            <path d="M5 4 L16 12 L5 20 Z" fill="currentColor" />
            <rect x={17.5} y={4} width={3} height={16} fill="currentColor" />
          </svg>
        </div>
        {pressed ? (
          <div
            style={{
              position: "absolute",
              left: 1356 - 120,
              top: 680 - 120,
              width: 240,
              height: 240,
              borderRadius: 120,
              border: "5px solid #fff",
              transform: `scale(${0.2 + ring * 1.6})`,
              opacity: 1 - ring,
            }}
          />
        ) : null}
        <Cursor x={cx} y={cy} s={cursorScale} />
      </Camera>
      <Tint color="#6283a8" mode="soft-light" opacity={0.6} />
      <Vignette strength={0.7} />
    </AbsoluteFill>
  );
};

/** Red, the feed flying past, IGNORE. */
export const IgnoreShot: React.FC<{ dur: number; uid?: string }> = ({ dur, uid = "" }) => {
  const t = useTime();
  return (
    <AbsoluteFill style={{ background: "#140202" }}>
      <BlurDef id={`ignblur${uid}`} x={0} y={18} />
      <Camera dur={dur} zoom={[1.06, 1.12]} punch={0.06} hits={[0, BEAT]} amp={16}>
        <AbsoluteFill style={{ filter: `url(#ignblur${uid}) grayscale(1) contrast(1.5) brightness(1.15)` }}>
          <FeedWall scroll={2600 + t * 3200} seed="red" speeds={[1, 1.1, 0.93, 1.06]} />
        </AbsoluteFill>
        <Tint color="#e3271b" mode="multiply" />
        <Tint color="#3b0101" mode="lighten" opacity={0.8} />
      </Camera>
      <Vignette strength={0.85} />
      <GrungeDef id={`g-ign${uid}`} seed={7} amount={0.9} />
      <Slam at={0} from={1.3}>
        <GlitchText text="IGNORE." size={300} hits={[0, BEAT]} filter={`url(#g-ign${uid})`} seed="ig" color="#e9e9e9" />
      </Slam>
    </AbsoluteFill>
  );
};

/** Real whip-pan between two frozen shots: both slide together under directional motion blur. */
export const ContentWhip: React.FC<{
  dur: number;
  axis: "x" | "y";
  outgoing: React.ReactNode;
  incoming: React.ReactNode;
  id: string;
}> = ({ dur, axis, outgoing, incoming, id }) => {
  const { fps, width, height } = useVideoConfig();
  const t = useTime();
  // Vertical = a feed swipe that lands right on the next beat; horizontal = a classic whip-pan.
  const ease = axis === "y" ? Easing.bezier(0.75, 0, 0.3, 1) : Easing.bezier(0.7, 0, 0.18, 1);
  const at = (time: number) => ease(interpolate(time, [0, dur], [0, 1], clamp));
  const size = axis === "x" ? width : height;
  const pos = at(t) * size;
  const perFrame = (Math.abs(at(t + 1 / fps) - at(t - 1 / fps)) * size) / 2;
  const blur = Math.min(80, perFrame * 0.6);
  const move = (o: number) => (axis === "x" ? `translateX(${o}px)` : `translateY(${o}px)`);
  return (
    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
      <BlurDef id={id} x={axis === "x" ? blur : 0} y={axis === "y" ? blur : 0} />
      <AbsoluteFill style={{ filter: blur > 0.3 ? `url(#${id})` : undefined }}>
        <AbsoluteFill style={{ transform: move(-pos) }}>{outgoing}</AbsoluteFill>
        <AbsoluteFill style={{ transform: move(size - pos) }}>{incoming}</AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

type Word = { text: string; at: number; x: number; light: string; dark: string };
const TRIO: Word[] = [
  { text: "SCROLL", at: 0, x: -540, light: "#c3281e", dark: "#e3382d" },
  { text: "SKIP", at: BEAT, x: 0, light: "#8f8f8f", dark: "#f1f1f1" },
  { text: "IGNORE", at: 2 * BEAT, x: 520, light: "#2a4ea2", dark: "#5584f2" },
];

/** SCROLL / SKIP / IGNORE built one word per beat, background alternating paper ↔ footage. */
export const TrioShot: React.FC<{ dur: number; uid?: string }> = ({ dur, uid = "" }) => {
  const t = useTime();
  const beat = Math.floor(t / BEAT + 1e-6);
  const dark = beat === 1 || beat === 3;
  const out = tw(t, 4 * BEAT, dur, 0, 1, OUT3);
  const sh = shake(t, [0, BEAT, 2 * BEAT, 3 * BEAT], 7, 0.12, "trio");
  const zoom = interpolate(t, [0, dur], [1, 1.07], clamp);
  return (
    <AbsoluteFill style={{ background: "#f1f0ec", overflow: "hidden" }}>
      {dark ? (
        <AbsoluteFill>
          {beat === 1 ? (
            <Plate
              src={crowd}
              nw={3000}
              nh={1500}
              dur={dur}
              z={[1.5, 1.58]}
              c0={[0.3, 0.72]}
              style={{ filter: "grayscale(1) contrast(1.45) brightness(0.7) blur(2px)" }}
            />
          ) : (
            <AbsoluteFill style={{ background: "#060606" }}>
              <Img
                src={eye}
                style={{ position: "absolute", width: 1920, height: 1080, transform: "scale(1.7)", transformOrigin: "50% 54%", opacity: 0.45, filter: "blur(1.5px)" }}
              />
            </AbsoluteFill>
          )}
          <Tint color="#5b7ca3" mode="soft-light" opacity={0.7} />
          <Vignette strength={0.7} />
        </AbsoluteFill>
      ) : (
        <Vignette strength={0.18} inner={40} />
      )}
      <GrungeDef id={`g-trio${uid}`} seed={11} amount={0.75} freq={0.06} />
      <AbsoluteFill
        style={{
          transform: `translate(${sh.x}px, ${sh.y}px) scale(${zoom + out * 0.06})`,
          filter: out > 0.01 ? `blur(${out * 22}px)` : undefined,
          opacity: 1 - out * 0.5,
        }}
      >
        {TRIO.map((w) => {
          const lt = t - w.at;
          if (lt < 0) return null;
          const p = tw(lt, 0, 0.11, 0, 1, OUT3);
          return (
            <div
              key={w.text}
              style={{
                position: "absolute",
                left: 960 + w.x - 400,
                width: 800,
                top: 455,
                textAlign: "center",
                fontFamily: BEBAS,
                fontSize: 196,
                letterSpacing: "0.045em",
                lineHeight: 1,
                color: dark ? w.dark : w.light,
                opacity: p,
                transform: `scale(${1.16 - 0.16 * p})`,
                filter: `url(#g-trio${uid})${p < 0.99 ? ` blur(${(1 - p) * 10}px)` : ""}`,
                textShadow: dark ? "0 6px 24px rgba(0,0,0,0.6)" : "0 6px 18px rgba(0,0,0,0.18)",
              }}
            >
              {w.text}
            </div>
          );
        })}
        {/* Beat 4: a red brush crosses the three habits out, setting up STOP THE SCROLL. */}
        <Brush
          at={3 * BEAT}
          wipe={0.1}
          variant={1}
          width={1780}
          style={{ top: 553 - ((1780 / 2600) * 520) / 2, transform: "scaleY(0.3) rotate(-1.4deg)", opacity: 0.96 }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};


