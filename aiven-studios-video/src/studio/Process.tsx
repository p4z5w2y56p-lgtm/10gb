import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { JBMONO, MANROPE } from "../fonts";
import { Camera, OUT, OUT3, Vignette, clamp, tw, useTime } from "../fx";
import { BEAT } from "../timeline";
import { C, Scramble, headline, mono, useStage } from "./brand";

const ICON: Record<string, React.ReactNode> = {
  cpu: (
    <g>
      <rect x={6} y={6} width={12} height={12} rx={2} />
      <rect x={9.5} y={9.5} width={5} height={5} rx={1} />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </g>
  ),
  terminal: (
    <g>
      <rect x={3} y={5} width={18} height={14} rx={2.5} />
      <path d="M7 10l3 2-3 2M12.5 15H17" />
    </g>
  ),
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
};

const STEPS = [
  { n: "01", word: "DENK.", icon: "cpu" },
  { n: "02", word: "BOUW.", icon: "terminal" },
  { n: "03", word: "GROEI.", icon: "arrow" },
];

/** THINK. BUILD. DEPLOY. — split-screen panels arrive on the beat; a packet relays through them. */
export const ProcessRelay: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const arrive = [0, 0.5 * BEAT, BEAT];
  // Landscape: three panels side by side. Vertical: stacked top-to-bottom, packet travels down.
  const pw = V ? 900 : 520;
  const ph = V ? 395 : 600;
  const gap = V ? 36 : 40;
  const x0 = V ? (W - pw) / 2 : (1920 - 3 * pw - 2 * gap) / 2;
  const y0 = V ? 290 : 240;
  const panelX = (i: number) => (V ? x0 : x0 + i * (pw + gap));
  const panelY = (i: number) => (V ? y0 + i * (ph + gap) : y0);
  // Packet rail: horizontal through panel middles (landscape), vertical along the icon column (vertical).
  const railX = x0 + pw - 44 - 30;
  const step = V ? ph + gap : pw + gap;
  const packetT = interpolate(t, [0.1, 1.5 * BEAT], [0, 2], {
    ...clamp,
    easing: Easing.inOut(Easing.cubic),
  });
  const reached = (i: number) => packetT >= i - 0.02;
  const deployOn = tw(t, 1.5 * BEAT, 1.5 * BEAT + 0.05, 0, 1, OUT3);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.04]}
        punch={0.04}
        hits={[0, BEAT]}
        amp={5}
      >
        <div
          style={{
            position: "absolute",
            left: x0,
            top: V ? 226 : 170,
            ...mono(V ? 26 : 22),
          }}
        >
          AIVEN // PROCES
        </div>
        {STEPS.map((s, i) => {
          const p = tw(
            t,
            arrive[i],
            arrive[i] + 0.22,
            0,
            1,
            Easing.bezier(0, 0, 0.2, 1),
          );
          const lit = reached(i);
          const inverted = i === 2 && deployOn > 0.5;
          return (
            <div
              key={s.n}
              style={{
                position: "absolute",
                left: panelX(i),
                top: panelY(i),
                width: pw,
                height: ph,
                borderRadius: 30,
                background: inverted ? C.white : "#0d0d0e",
                border: `1.5px solid ${lit ? C.white : C.hair}`,
                transform: `translateY(${(1 - p) * 160}px)`,
                opacity: p,
                padding: 44,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={mono(
                    V ? 26 : 22,
                    inverted ? C.mutedOnPaper : C.mutedOnDark,
                  )}
                >
                  {s.n} / STAP
                </span>
                <svg
                  width={V ? 60 : 48}
                  height={V ? 60 : 48}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={inverted ? C.ink : lit ? C.white : C.mutedOnDark}
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {ICON[s.icon]}
                </svg>
              </div>
              <div
                style={headline(
                  V ? 160 : 118,
                  inverted ? C.ink : lit ? C.white : "#3a3a3d",
                )}
              >
                {s.word}
              </div>
            </div>
          );
        })}
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {V ? (
            <>
              <line
                x1={railX}
                y1={y0 + ph / 2}
                x2={railX}
                y2={y0 + 2.5 * ph + 2 * gap}
                stroke={C.hair}
                strokeWidth={1.5}
                strokeDasharray="4 8"
              />
              {packetT > 0 && packetT < 2 ? (
                <rect
                  x={railX - 13}
                  y={y0 + ph / 2 + packetT * step - 13}
                  width={26}
                  height={26}
                  fill={C.white}
                />
              ) : null}
            </>
          ) : (
            <>
              <line
                x1={x0 + pw / 2}
                y1={540}
                x2={x0 + 2.5 * pw + 2 * gap}
                y2={540}
                stroke={C.hair}
                strokeWidth={1.5}
                strokeDasharray="4 8"
              />
              {packetT > 0 && packetT < 2 ? (
                <rect
                  x={x0 + pw / 2 + packetT * (pw + gap) - 11}
                  y={529}
                  width={22}
                  height={22}
                  fill={C.white}
                />
              ) : null}
            </>
          )}
        </svg>
      </Camera>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

const STATS = [
  { v: "24/7", label: "AUTOMATISCH" },
  { v: "1", label: "CENTRAAL SYSTEEM" },
  { v: "0", label: "HANDWERK" },
];

/** AIVEN // OVERVIEW — three proof numbers, scrambling into place on the beats. */
export const Overview: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { V } = useStage();
  const at = [0, 0.5 * BEAT, BEAT];
  // Vertical: the three proof cards become a column of wide cards (number left, labels right).
  const cw = V ? 920 : 500;
  const ch = V ? 345 : 500;
  const cx0 = V ? 80 : 160;
  const cy0 = V ? 330 : 290;
  const cgap = V ? 36 : 40;
  const blink = Math.floor(t * 4) % 2 ? 1 : 0.3;
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.04]}
        punch={0.04}
        hits={[0, BEAT]}
        amp={5}
      >
        <div
          style={{
            position: "absolute",
            left: cx0,
            top: V ? 214 : 190,
            ...mono(24, C.mutedOnPaper),
          }}
        >
          AIVEN // OVERZICHT
        </div>
        <div
          style={{
            position: "absolute",
            right: V ? 80 : 160,
            top: V ? 214 : 190,
            ...mono(22, C.ink, 400),
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: C.ink,
              opacity: blink,
            }}
          />
          ALL SYSTEMS NOMINAL
        </div>
        {STATS.map((s, i) => {
          const p = tw(t, at[i], at[i] + 0.2, 0, 1, OUT);
          const value = (
            <div
              style={{
                fontFamily: JBMONO,
                fontWeight: 800,
                fontSize: s.v.length > 2 ? (V ? 180 : 170) : V ? 240 : 230,
                lineHeight: 1,
                color: C.ink,
                letterSpacing: "-0.04em",
              }}
            >
              <Scramble text={s.v} at={at[i] + 0.02} dur={0.22} />
            </div>
          );
          return (
            <div
              key={s.label}
              style={{
                position: "absolute",
                left: V ? cx0 : 160 + i * 540,
                top: V ? cy0 + i * (ch + cgap) : 290,
                width: cw,
                height: ch,
                borderRadius: 30,
                background: "#ffffff",
                boxShadow: "0 10px 20px rgba(0,0,0,0.1)",
                border: `1px solid ${C.hairPaper}`,
                opacity: p,
                transform: `translateY(${(1 - p) * 60}px)`,
                padding: 46,
                boxSizing: "border-box",
                display: "flex",
                flexDirection: V ? "row" : "column",
                justifyContent: "space-between",
                alignItems: V ? "stretch" : undefined,
              }}
            >
              {V ? (
                <>
                  <div style={{ display: "flex", alignItems: "flex-end" }}>
                    {value}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      alignItems: "flex-end",
                    }}
                  >
                    <span style={mono(22, C.mutedOnPaper)}>
                      0{i + 1} / BEWIJS
                    </span>
                    <div
                      style={{
                        ...mono(26, C.ink),
                        textAlign: "right",
                        whiteSpace: "normal",
                        maxWidth: 300,
                        lineHeight: 1.35,
                      }}
                    >
                      {s.label}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <span style={mono(20, C.mutedOnPaper)}>0{i + 1} / BEWIJS</span>
                  <div>
                    {value}
                    <div style={{ ...mono(24, C.ink), marginTop: 18 }}>
                      {s.label}
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: cx0,
            ...(V
              ? {
                  top: cy0 + 3 * ch + 2 * cgap + 50,
                  width: 760,
                  fontSize: 46,
                  lineHeight: 1.2,
                }
              : { bottom: 120, fontSize: 34 }),
            fontFamily: MANROPE,
            fontWeight: 300,
            color: C.mutedOnPaper,
            opacity: tw(t, BEAT, BEAT + 0.2, 0, 1, OUT3),
          }}
        >
          Eén centraal systeem in plaats van een wirwar aan tools.
        </div>
      </Camera>
    </AbsoluteFill>
  );
};
