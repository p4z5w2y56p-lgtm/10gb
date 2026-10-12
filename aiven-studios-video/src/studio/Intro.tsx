import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile } from "remotion";
import { JBMONO } from "../fonts";
import { Camera, OUT, OUT3, Vignette, clamp, tw, useTime } from "../fx";
import { Waveform } from "../scenes/Intro";
import { BEAT } from "../timeline";
import {
  C,
  Corners,
  Eyebrow,
  MaskLine,
  headline,
  mono,
  useStage,
} from "./brand";

const LINES: { at: number; text: string; color: string; typed?: boolean }[] = [
  {
    at: 0.22,
    text: "$ ./initialize --studio aiven",
    color: "#f7f7f9",
    typed: true,
  },
  { at: 0.95, text: "[SCAN] 3 kerndiensten online", color: "#8a8a8e" },
  { at: 1.22, text: "[OK]   onnodige ruis verwijderd", color: "#8a8a8e" },
  { at: 1.5, text: "[OK]   ALL SYSTEMS NOMINAL", color: "#f7f7f9" },
];

/** 00 / INITIALIZE — the studio boots in its own system voice. */
export const TerminalBoot: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { V } = useStage();
  const winIn = tw(t, 0.0, 0.5, 0, 1, OUT);
  const blink = Math.floor(t * 2.4) % 2 === 0;
  // window geometry: landscape 1100×420 centred-ish; vertical a narrower, taller phone card
  const win = V
    ? { x: 70, y: 700, w: 940, h: 500 }
    : { x: 410, y: 300, w: 1100, h: 420 };
  const fs = V ? 40 : 34;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera dur={dur} zoom={[1.0, 1.045]} punch={0} hits={[]}>
        <div
          style={{
            position: "absolute",
            left: V ? 70 : 100,
            top: V ? 200 : 92,
          }}
        >
          <Eyebrow n="00" label="INITIALIZE" at={0.1} size={V ? 28 : 24} />
        </div>
        <div
          style={{
            position: "absolute",
            ...(V ? { left: 70, top: 252 } : { right: 100, top: 92 }),
            ...mono(V ? 24 : 22, C.mutedOnDark, 400),
            opacity: tw(t, 0.2, 0.5, 0, 1),
          }}
        >
          AIVEN // AIVEN STUDIOS
        </div>
        <div
          style={{
            position: "absolute",
            left: win.x,
            top: win.y,
            width: win.w,
            height: win.h,
            borderRadius: 16,
            background: "#0b0b0c",
            border: `1px solid ${C.hair}`,
            boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
            opacity: winIn,
            transform: `translateY(${(1 - winIn) * 30}px)`,
            filter: winIn < 0.99 ? `blur(${(1 - winIn) * 10}px)` : undefined,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: V ? 64 : 54,
              borderBottom: `1px solid ${C.hair}`,
              display: "flex",
              alignItems: "center",
              padding: V ? "0 30px" : "0 24px",
              gap: V ? 12 : 10,
            }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: V ? 14 : 12,
                  height: V ? 14 : 12,
                  borderRadius: V ? 7 : 6,
                  border: `1.5px solid ${C.mutedOnDark}`,
                }}
              />
            ))}
            <span
              style={{
                ...mono(V ? 22 : 18, C.mutedOnDark, 400),
                marginLeft: 18,
                letterSpacing: "0.04em",
                textTransform: "none",
              }}
            >
              root@aiven-studios:~
            </span>
          </div>
          <div
            style={{
              padding: V ? "44px 40px" : "34px 40px",
              fontFamily: JBMONO,
              fontSize: fs,
              lineHeight: V ? 1.9 : 1.75,
              fontWeight: 500,
            }}
          >
            {LINES.map((l, i) => {
              if (t < l.at) return null;
              const n = l.typed
                ? Math.min(l.text.length, Math.floor((t - l.at) * 52))
                : l.text.length;
              const isLast = i === LINES.length - 1 || t < LINES[i + 1].at;
              return (
                <div key={i} style={{ color: l.color, whiteSpace: "pre" }}>
                  {l.text.slice(0, n)}
                  {isLast && blink ? (
                    <span
                      style={{
                        display: "inline-block",
                        width: V ? 21 : 18,
                        height: fs,
                        background: C.white,
                        verticalAlign: V ? "-5px" : "-4px",
                        marginLeft: 6,
                      }}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
        <Corners
          x={win.x - 30}
          y={win.y - 30}
          w={win.w + 60}
          h={win.h + 60}
          opacity={winIn * 0.9}
        />
      </Camera>
      <Vignette strength={0.7} />
      <Waveform opacity={0.32} />
      <AbsoluteFill
        style={{ background: "#000", opacity: tw(t, 0, 0.25, 1, 0, OUT3) }}
      />
    </AbsoluteFill>
  );
};

/** 01 / THE MANIFESTO — black on paper, mask reveals, outgoing words cleared before new ones enter. */
export const Manifesto: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { V } = useStage();
  const focus = tw(t, 0, 0.3, 6, 0, OUT3);
  const second = 2 * BEAT;
  if (V) {
    // portrait: the two phrases restacked into short, phone-width lines, left-aligned on a 80 px margin
    const s1 = 196;
    const s2 = 166;
    return (
      <AbsoluteFill style={{ background: C.paper }}>
        <Camera
          dur={dur}
          zoom={[1.0, 1.05]}
          punch={0}
          hits={[]}
          style={{ filter: focus > 0.05 ? `blur(${focus}px)` : undefined }}
        >
          <div style={{ position: "absolute", left: 84, top: 610 }}>
            <Eyebrow
              n="01"
              label="HET MANIFEST"
              color={C.mutedOnPaper}
              size={28}
            />
          </div>
          <div style={{ position: "absolute", left: 70, top: 690 }}>
            <MaskLine at={0.04} out={second - 0.12}>
              <div style={headline(s1, C.ink)}>WE</div>
            </MaskLine>
            <MaskLine at={0.08} out={second - 0.11}>
              <div style={headline(s1, C.ink)}>WACHTEN</div>
            </MaskLine>
            <MaskLine at={0.12} out={second - 0.1}>
              <div style={headline(s1, C.ink)}>NIET</div>
            </MaskLine>
            <MaskLine at={0.16} out={second - 0.09}>
              <div style={headline(s1, C.ink)}>AF.</div>
            </MaskLine>
          </div>
          <div style={{ position: "absolute", left: 70, top: 690 }}>
            <MaskLine at={second}>
              <div style={headline(s2, C.ink)}>WE</div>
            </MaskLine>
            <MaskLine at={second + 0.04}>
              <div style={headline(s2, C.ink)}>BOUWEN</div>
            </MaskLine>
            <MaskLine at={second + 0.08}>
              <div style={headline(s2, C.ink)}>DE</div>
            </MaskLine>
            <MaskLine at={second + 0.12}>
              <div style={headline(s2, C.ink)}>TOEKOMST.</div>
            </MaskLine>
          </div>
        </Camera>
        <Vignette strength={0.12} inner={45} />
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.05]}
        punch={0}
        hits={[]}
        style={{ filter: focus > 0.05 ? `blur(${focus}px)` : undefined }}
      >
        <div style={{ position: "absolute", left: 150, top: 250 }}>
          <Eyebrow n="01" label="HET MANIFEST" color={C.mutedOnPaper} />
        </div>
        <div style={{ position: "absolute", left: 140, top: 330 }}>
          <MaskLine at={0.04} out={second - 0.12}>
            <div style={headline(150, C.ink)}>WE WACHTEN</div>
          </MaskLine>
          <MaskLine at={0.12} out={second - 0.1}>
            <div style={headline(150, C.ink)}>NIET AF.</div>
          </MaskLine>
        </div>
        <div style={{ position: "absolute", left: 140, top: 330 }}>
          <MaskLine at={second}>
            <div style={headline(210, C.ink)}>WE BOUWEN</div>
          </MaskLine>
          <MaskLine at={second + 0.1}>
            <div style={headline(210, C.ink)}>DE TOEKOMST.</div>
          </MaskLine>
        </div>
      </Camera>
      <Vignette strength={0.12} inner={45} />
    </AbsoluteFill>
  );
};

const R_HOLE = 204; // black-hole shadow radius once the plate fills the frame
const R_HOLE_V = 156; // same, for the 1080×1920 vertical plate (shadow centred at 540, 960)

// Vertical Philosophy layout: three phrases restacked into seven right-aligned lines.
const PV = { size: 128, right: 70, top: 500, gap: 32 };
const PV_LINE = PV.size * 0.9 + PV.size * 0.06; // MaskLine height: line box + 0.06em padding

/** 02 / THE PHILOSOPHY — three lines on the pickup kicks; the last full stop detaches and becomes the black hole. */
export const Philosophy: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const clearAt = 3 * BEAT - 0.02;
  const dive = tw(t, clearAt + 0.04, dur, 0, 1, Easing.inOut(Easing.cubic));
  // the detached full stop: from the end of line 3 to the centre, growing into the shadow
  const dot0 = V ? Math.round(14 * (PV.size / 118)) : 14;
  const pad = V ? Math.round(34 * (PV.size / 118)) : 34;
  const dotX0 = V ? W - PV.right - dot0 : 1770 - 14;
  const dotY0 = V ? PV.top + 6 * PV_LINE + 2 * PV.gap + PV.size * 0.589 : 676;
  const dx = interpolate(dive, [0, 1], [dotX0, V ? W / 2 : 960]);
  const dy = interpolate(dive, [0, 1], [dotY0, V ? H / 2 : 540]);
  const dr = interpolate(dive, [0, 1], [dot0, V ? R_HOLE_V : R_HOLE], {
    easing: Easing.in(Easing.quad),
  });
  const plate = tw(t, dur - 0.16, dur, 0, 1, OUT3);
  const lineStyle = headline(V ? PV.size : 118, C.white);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera dur={dur} zoom={[1.0, 1.03]} punch={0} hits={[]}>
        <div
          style={{
            position: "absolute",
            right: V ? PV.right + 6 : 150,
            top: V ? PV.top - 80 : 300,
            opacity: 1 - tw(t, clearAt, clearAt + 0.15, 0, 1),
          }}
        >
          <Eyebrow n="02" label="DE FILOSOFIE" size={V ? 28 : 24} />
        </div>
        {V ? (
          <div
            style={{
              position: "absolute",
              right: PV.right,
              top: PV.top,
              textAlign: "right",
            }}
          >
            <MaskLine at={0.02} out={clearAt}>
              <div style={lineStyle}>GEEN</div>
            </MaskLine>
            <MaskLine at={0.04} out={clearAt + 0.005}>
              <div style={lineStyle}>ONNODIGE</div>
            </MaskLine>
            <MaskLine at={0.06} out={clearAt + 0.01}>
              <div style={lineStyle}>RUIS.</div>
            </MaskLine>
            <MaskLine
              at={BEAT}
              out={clearAt + 0.03}
              style={{ marginTop: PV.gap }}
            >
              <div style={lineStyle}>STRAK</div>
            </MaskLine>
            <MaskLine at={BEAT + 0.04} out={clearAt + 0.04}>
              <div style={lineStyle}>ONTWERP.</div>
            </MaskLine>
            <MaskLine
              at={2 * BEAT}
              out={clearAt + 0.06}
              style={{ marginTop: PV.gap }}
            >
              <div style={{ ...lineStyle, paddingRight: pad }}>EXTREME</div>
            </MaskLine>
            <MaskLine at={2 * BEAT + 0.04} out={clearAt + 0.07}>
              <div style={{ ...lineStyle, paddingRight: pad }}>UITVOERING</div>
            </MaskLine>
          </div>
        ) : (
          <div
            style={{
              position: "absolute",
              right: 150,
              top: 380,
              textAlign: "right",
            }}
          >
            <MaskLine at={0.02} out={clearAt}>
              <div style={lineStyle}>GEEN ONNODIGE RUIS.</div>
            </MaskLine>
            <MaskLine at={BEAT} out={clearAt + 0.03}>
              <div style={lineStyle}>STRAK ONTWERP.</div>
            </MaskLine>
            <MaskLine at={2 * BEAT} out={clearAt + 0.06}>
              <div style={{ ...lineStyle, paddingRight: 34 }}>
                EXTREME UITVOERING
              </div>
            </MaskLine>
          </div>
        )}
        {t >= 2 * BEAT + 0.14 ? (
          <div
            style={{
              position: "absolute",
              left: dx - dr,
              top: dy - dr,
              width: dr * 2,
              height: dr * 2,
              borderRadius: "50%",
              background: dive > 0.6 ? C.black : C.white,
              boxShadow:
                dive > 0.6
                  ? `0 0 0 ${Math.max(2, dr * 0.04)}px rgba(247,247,249,${0.9 * (1 - plate)})`
                  : undefined,
            }}
          />
        ) : null}
      </Camera>
      <AbsoluteFill style={{ opacity: plate }}>
        <Img
          src={staticFile(
            V
              ? "brand/blackhole-vertical-still.jpg"
              : "brand/blackhole-still.jpg",
          )}
          style={{
            width: W,
            height: H,
            transform: `scale(${interpolate(plate, [0, 1], [1.25, 1.0], clamp)})`,
          }}
        />
      </AbsoluteFill>
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};
