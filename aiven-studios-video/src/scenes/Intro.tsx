import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FeedWall } from "../feed";
import { MONO, SANS, SERIF } from "../fonts";
import { BlurDef, Camera, OUT, OUT3, RED, Tint, Vignette, clamp, tw, useStep, useTime } from "../fx";
import { BEAT } from "../timeline";
import waveform from "../waveform.json";
import { AivenMark } from "../mark";

/** Scrolling audio waveform silhouette (bottom of frame), like the reference's interview segments. */
export const Waveform: React.FC<{ opacity?: number }> = ({ opacity = 0.5 }) => {
  const frame = useCurrentFrame();
  const { fps, width: W } = useVideoConfig();
  const data = waveform as number[];
  const perSec = 240;
  const pos = (frame / fps) * perSec;
  const base = Math.floor(pos);
  const frac = pos - base;
  const span = 480; // 2 s of audio across the frame
  const h = 150;
  const step = W / span;
  const pts: string[] = [];
  for (let i = 0; i <= span + 1; i++) {
    const idx = base - span + i;
    const v = idx >= 0 && idx < data.length ? data[idx] : 0;
    pts.push(`${((i - frac) * step).toFixed(2)},${(h - v * h * 0.92).toFixed(2)}`);
  }
  const d = `M0,${h} L${pts.join(" L")} L${W},${h} Z`;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", pointerEvents: "none" }}>
      <svg width={W} height={h} style={{ opacity, mixBlendMode: "screen" }}>
        <defs>
          <linearGradient id="wf" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.3" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path d={d} fill="url(#wf)" />
      </svg>
    </AbsoluteFill>
  );
};

/** Word-by-word subtitle in the reference's caption style. */
const Caption: React.FC<{ lines: { text: string; at: number }[][]; label?: string }> = ({ lines, label }) => {
  const t = useTime();
  return (
    <div style={{ position: "absolute", left: 210, top: 395, width: 1300 }}>
      {label ? (
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 500,
            fontSize: 24,
            color: "rgba(255,255,255,0.82)",
            marginBottom: 14,
            opacity: tw(t, 0.05, 0.35, 0, 1),
            textShadow: "0 2px 6px rgba(0,0,0,0.6)",
          }}
        >
          {label}
        </div>
      ) : null}
      {lines.map((line, li) => (
        <div key={li} style={{ display: "flex", flexWrap: "wrap", columnGap: 16 }}>
          {line.map((w, wi) => {
            const p = tw(t, w.at, w.at + 0.16, 0, 1, OUT3);
            return (
              <span
                key={wi}
                style={{
                  fontFamily: SANS,
                  fontWeight: 700,
                  fontSize: 58,
                  lineHeight: 1.12,
                  color: "#fff",
                  opacity: p,
                  transform: `translateY(${(1 - p) * 10}px)`,
                  filter: p < 0.99 ? `blur(${(1 - p) * 6}px)` : undefined,
                  textShadow: "0 0 2px rgba(0,0,0,0.9), 0 3px 10px rgba(0,0,0,0.55)",
                  display: "inline-block",
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};

const words = (s: string, at: number, gap: number) => s.split(" ").map((text, i) => ({ text, at: at + i * gap }));

export const FeedIntro: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  // Steady thumb-scroll, then a flick that accelerates into the cut as "everything." lands.
  const base = 150;
  const flickAt = 1.2;
  const flick = 2600;
  const q = Math.max(0, (t - flickAt) / (dur - flickAt));
  const scroll = base * t + flick * q ** 3;
  const vel = base + (t > flickAt ? (3 * flick * q ** 2) / (dur - flickAt) : 0); // px/s
  const blurY = Math.min(38, (vel / 60) * 0.55);
  const surge = 1 + 0.06 * q ** 3;
  return (
    <AbsoluteFill style={{ background: "#07080a" }}>
      <BlurDef id="feedblur" x={0} y={blurY} />
      <Camera dur={dur} zoom={[1.1, 1.02]} punch={0} hits={[]}>
        <AbsoluteFill style={{ filter: "url(#feedblur) grayscale(1) contrast(1.05) brightness(0.62)", transform: `scale(${surge})` }}>
          <FeedWall scroll={scroll} seed="intro" speeds={[1, 1.12, 0.94, 1.06]} />
        </AbsoluteFill>
      </Camera>
      <Tint color="#3d6a9a" mode="soft-light" opacity={0.85} />
      <Tint color="#0e1a28" mode="lighten" opacity={0.55} />
      <Vignette strength={0.75} />
      <AbsoluteFill style={{ background: "radial-gradient(ellipse 48% 30% at 34% 44%, rgba(4,8,14,0.6) 0%, rgba(4,8,14,0) 100%)" }} />
      <Waveform opacity={0.55} />
      <Caption
        label="Aiven Studios  —  on attention"
        lines={[words("Every day, your audience scrolls past", 0.3, 0.13), words("everything.", 1.3, 0)]}
      />
      <AbsoluteFill style={{ background: "#000", opacity: tw(t, 0, 0.28, 1, 0, OUT3) }} />
    </AbsoluteFill>
  );
};

export const Headline: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const hl = tw(t, 0.38, 0.78, 0, 1, OUT3);
  const focus = tw(t, 0, 0.34, 7, 0, OUT3); // rack focus in on the cut
  return (
    <AbsoluteFill style={{ background: "#efede8" }}>
      <Camera
        dur={dur}
        zoom={[1.1, 1.17]}
        punch={0}
        hits={[]}
        rotate={tw(t, 0, dur, -0.35, 0.15, (n) => n)}
        style={{ filter: focus > 0.05 ? `blur(${focus}px)` : undefined }}
      >
        <Img src={staticFile("tex/paper.jpg")} style={{ position: "absolute", width: 1920, height: 1080 }} />
        <div style={{ position: "absolute", left: 300, top: 150, width: 1320 }}>
          <div
            style={{
              fontFamily: SANS,
              fontWeight: 700,
              fontSize: 19,
              letterSpacing: "0.2em",
              color: RED,
              paddingBottom: 14,
              borderBottom: "2px solid #1a1a1a",
              width: 420,
            }}
          >
            THE ATTENTION ECONOMY
          </div>
          <div
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: 84,
              lineHeight: 1.04,
              letterSpacing: "-0.012em",
              color: "#151515",
              marginTop: 30,
              textWrap: "balance",
            }}
          >
            The world’s most valuable resource is no longer oil, but{" "}
            <span style={{ position: "relative", display: "inline-block" }}>
              <span
                style={{
                  position: "absolute",
                  left: -6,
                  right: -6,
                  top: "18%",
                  bottom: "4%",
                  background: "#f2d64b",
                  transformOrigin: "left center",
                  transform: `scaleX(${hl})`,
                  mixBlendMode: "multiply",
                }}
              />
              <span style={{ position: "relative" }}>attention</span>
            </span>
          </div>
          <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 34, lineHeight: 1.3, color: "#4a4a4a", marginTop: 26, width: 1100, textWrap: "balance" }}>
            The scroll has rewritten the rules of advertising. Brands need a new way to tell stories
          </div>
          <div style={{ marginTop: 40, width: 1320, height: 330, overflow: "hidden", position: "relative" }}>
            <Img
              src={staticFile("tex/city.jpg")}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                objectPosition: "30% 40%",
                filter: "grayscale(1) contrast(1.4) brightness(1.05)",
                mixBlendMode: "multiply",
                opacity: 0.8,
              }}
            />
          </div>
        </div>
      </Camera>
      <Vignette strength={0.28} inner={50} />
    </AbsoluteFill>
  );
};

/** Pre-drop: the eye fades up, flickers on the pickup beats, then the camera dives into the pupil. */
export const EyeIntro: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const step = useStep();
  const pickups = [2 * BEAT, 2.5 * BEAT, 3 * BEAT]; // the 4th pickup belongs to the dive
  let flick = 0;
  for (const p of pickups) {
    const dt = t - p;
    if (dt >= 0 && dt < 0.09) flick = Math.max(flick, 1 - dt / 0.09);
  }
  const dive = tw(t, dur - 0.24, dur, 0, 1, Easing.in(Easing.cubic));
  const glint = tw(t, dur - 0.34, dur, 0, 1, Easing.in(Easing.quad));
  const zoom = interpolate(t, [0, dur - 0.24], [1.0, 1.12], clamp) * (1 + dive * 1.6);
  const fadeIn = tw(t, 0, 0.35, 0, 1, OUT3);
  const txt = tw(t, 0.12, 0.62, 0, 1, OUT);
  return (
    <AbsoluteFill style={{ background: "#050505" }}>
      <BlurDef id="dive" x={dive * 10} y={dive * 10} />
      <AbsoluteFill
        style={{
          opacity: fadeIn,
          transform: `scale(${zoom}) translate(${flick * (step % 2 ? 8 : -8)}px, 0px)`,
          transformOrigin: "50% 54%",
          filter: "url(#dive)",
        }}
      >
        <AbsoluteFill style={{ filter: flick > 0.5 ? "invert(1)" : undefined }}>
          <Img
            src={staticFile("tex/eye_halftone.png")}
            style={{ position: "absolute", left: -6.5, top: 0, width: 1933, height: 1087, opacity: 0.86 }}
          />
        </AbsoluteFill>
        {glint > 0 ? (
          <div
            style={{
              position: "absolute",
              left: 960 - 60,
              top: 569 - 60,
              width: 120,
              height: 120,
              opacity: Math.min(1, glint * 1.6),
              transform: `scale(${0.25 + glint * 1.9})`,
              filter: "drop-shadow(0 0 16px rgba(216,41,31,0.95))",
            }}
          >
            <AivenMark size={120} holes={0} style={{ transform: "rotate(90deg)" }} />
          </div>
        ) : null}
      </AbsoluteFill>
      <Tint color="#5a7fa6" mode="multiply" opacity={0.55} />
      <Vignette strength={0.9} inner={30} />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: 865,
          textAlign: "center",
          fontFamily: SERIF,
          fontStyle: "italic",
          fontSize: 54,
          color: "#f1f1f1",
          opacity: txt * (1 - dive),
          filter: `blur(${(1 - txt) * 16}px)`,
          textShadow: "0 2px 18px rgba(0,0,0,0.9)",
        }}
      >
        Most brands lose it in a second.
      </div>
      <div
        style={{
          position: "absolute",
          right: 70,
          top: 56,
          fontFamily: MONO,
          fontSize: 20,
          color: "rgba(255,255,255,0.55)",
          letterSpacing: "0.08em",
          opacity: fadeIn,
        }}
      >
        ● REC
      </div>
    </AbsoluteFill>
  );
};
