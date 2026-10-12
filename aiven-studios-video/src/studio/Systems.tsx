import React from "react";
import { AbsoluteFill, Easing, interpolate } from "remotion";
import { noise2D } from "@remotion/noise";
import { MANROPE } from "../fonts";
import {
  BlurDef,
  Camera,
  IN,
  OUT,
  OUT3,
  Vignette,
  clamp,
  tw,
  useTime,
} from "../fx";
import { BEAT } from "../timeline";
import {
  C,
  Corners,
  MaskLine,
  Scramble,
  headline,
  mono,
  useStage,
} from "./brand";

/** Wireframe terrain flown over at speed (perspective grid with noise heights). */
const Terrain: React.FC<{
  speed: number;
  horizon?: number;
  ceiling?: boolean;
  flat?: boolean;
  focal?: number;
}> = ({ speed, horizon = 470, ceiling = false, flat = false, focal = 900 }) => {
  const t = useTime();
  const { W, H } = useStage();
  const cx = W / 2;
  const f = focal;
  const travel = t * speed;
  const zs = Array.from(
    { length: 44 },
    (_, i) => i * 0.7 + 2.4 - (travel % 0.7),
  );
  const xs = Array.from({ length: 49 }, (_, i) => -16.8 + i * 0.7);
  const h = (x: number, z: number) =>
    flat
      ? 0
      : Math.max(
          0,
          noise2D("terrain", x * 0.16, (z + travel) * 0.16) * 3.6 + 0.6,
        ) * Math.min(1, Math.max(0, (z - 3) / 7));
  const P = (x: number, y: number, z: number, sign: number) => ({
    x: cx + (x * f) / z,
    y: horizon + (sign * (2.6 - y) * f) / z,
  });
  const fade = (z: number) => interpolate(z, [2.4, 32], [1, 0], clamp);
  const layer = (sign: number) => (
    <g key={sign}>
      {zs.map((z, i) => (
        <polyline
          key={`r${i}`}
          points={xs
            .map((x) => {
              const p = P(x, sign > 0 ? h(x, z) : 0, z, sign);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={C.white}
          strokeWidth={1.4}
          opacity={fade(z) * 0.95}
        />
      ))}
      {xs.map((x, i) => (
        <polyline
          key={`c${i}`}
          points={zs
            .map((z) => {
              const p = P(x, sign > 0 ? h(x, z) : 0, z, sign);
              return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={C.white}
          strokeWidth={1}
          opacity={0.32}
        />
      ))}
    </g>
  );
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      {layer(1)}
      {ceiling ? layer(-1) : null}
      <line
        x1={0}
        y1={horizon}
        x2={W}
        y2={horizon}
        stroke={C.white}
        strokeWidth={1.5}
        opacity={0.9}
      />
    </svg>
  );
};

/** Target-HUD lock: the frame contracts over the terrain and locks on the second kick. */
export const Lock: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const k = tw(t, 0, BEAT, 0, 1, Easing.bezier(0.16, 1, 0.3, 1));
  const locked = t >= BEAT;
  const size =
    interpolate(k, [0, 1], V ? [720, 270] : [640, 230]) *
    (locked ? 1 - 0.08 * Math.exp(-(t - BEAT) / 0.06) : 1);
  const tx = V ? 540 : 1180;
  const ty = V ? 760 : 470;
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.05]}
        punch={0.04}
        hits={[0, BEAT]}
        amp={5}
      >
        <Terrain speed={9} horizon={V ? 500 : 400} focal={V ? 1450 : 900} />
        <Corners
          x={tx - size / 2}
          y={ty - size / 2}
          w={size}
          h={size}
          len={40}
          color={locked ? C.accent : C.white}
          width={3}
        />
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <g
            stroke={locked ? C.accent : C.white}
            strokeWidth={1.5}
            opacity={0.9}
          >
            <line x1={tx - size / 2 - 60} y1={ty} x2={tx - 18} y2={ty} />
            <line x1={tx + 18} y1={ty} x2={tx + size / 2 + 60} y2={ty} />
            <line x1={tx} y1={ty - size / 2 - 60} x2={tx} y2={ty - 18} />
            <line x1={tx} y1={ty + 18} x2={tx} y2={ty + size / 2 + 60} />
          </g>
          <circle cx={tx} cy={ty} r={5} fill={locked ? C.accent : C.white} />
        </svg>
        <div
          style={{
            position: "absolute",
            ...(V
              ? { left: tx - size / 2, top: ty + size / 2 + 80 }
              : { left: tx + size / 2 + 26, top: ty - size / 2 }),
            ...mono(V ? 24 : 20, locked ? C.white : C.mutedOnDark, 400),
            lineHeight: 1.7,
          }}
        >
          {locked ? (
            <>
              DOEL VERGRENDELD
              <br />
              LOCK TIME 0.36S
            </>
          ) : (
            <Scramble text="DOEL ZOEKEN" at={0.02} dur={0.25} />
          )}
        </div>
        <div
          style={{
            position: "absolute",
            left: V ? 80 : 120,
            top: V ? 210 : 100,
            ...mono(V ? 26 : 22),
          }}
        >
          AIVEN // DOELGERICHT
        </div>
        <div
          style={{
            position: "absolute",
            left: V ? 80 : 120,
            bottom: V ? 400 : 110,
          }}
        >
          <MaskLine at={BEAT}>
            <div style={headline(V ? 165 : 170, C.white)}>PRECISIE.</div>
          </MaskLine>
        </div>
      </Camera>
      <Vignette strength={0.6} />
    </AbsoluteFill>
  );
};

const STACK = "PYTHON ✦ TENSORFLOW ✦ REACT ✦ NODE.JS ✦ OPENAI ✦ REMOTION ✦ ";
const SERVICES =
  "AI-INTEGRATIE ✦ AUTOMATISERING ✦ WEBSITES ✦ MOTION ✦ ";

const Band: React.FC<{
  text: string;
  speed: number;
  top: number;
  dark: boolean;
  outline: boolean;
  phase?: number;
}> = ({ text, speed, top, dark, outline, phase = 0 }) => {
  const t = useTime();
  const { W } = useStage();
  const unit = 3600;
  const x = ((-t * speed) % unit) - (speed < 0 ? unit : 0) - phase;
  // Bands overhang the frame by 200 px each side (landscape); vertical needs more for the steeper tilt.
  const over = W < 1920 ? 520 : 200;
  return (
    <div
      style={{
        position: "absolute",
        left: -over,
        width: W + 2 * over,
        top,
        height: 240,
        background: dark ? C.ink : "transparent",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 38,
          left: x,
          fontFamily: MANROPE,
          fontWeight: 800,
          fontSize: 150,
          lineHeight: 1,
          letterSpacing: "-0.04em",
          whiteSpace: "nowrap",
          // Outline bands: 5px stroke under a paper fill, so only the outer 2.5px shows and the
          // overlapping glyph contours stay hidden (no crossed lines inside the A's).
          color: outline ? C.paper : dark ? C.white : C.ink,
          WebkitTextStroke: outline ? `5px ${C.ink}` : undefined,
          paintOrder: outline ? "stroke fill" : undefined,
        }}
      >
        {text.repeat(4)}
      </div>
    </div>
  );
};

/** The stack: two full-bleed marquee bands; on the 2nd kick they tilt and reverse (full change). */
export const Marquee: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const flip = tw(t, BEAT, BEAT + 0.2, 0, 1, OUT);
  const dir = t >= BEAT ? -1 : 1;
  const { V } = useStage();
  return (
    <AbsoluteFill style={{ background: C.paper, overflow: "hidden" }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.04]}
        punch={0.04}
        hits={[0, BEAT]}
        amp={5}
      >
        {V ? (
          // Vertical: five stacked bands (alternating solid / outline), steeper tilt on the flip.
          <AbsoluteFill
            style={{
              transform: `rotate(${-11 * flip}deg) scale(${1 + 0.12 * flip})`,
            }}
          >
            <Band
              text={STACK}
              speed={2600 * dir}
              top={290}
              dark
              outline={false}
            />
            <Band
              text={SERVICES}
              speed={-2200 * dir}
              top={610}
              dark={false}
              outline
            />
            <Band
              text={SERVICES}
              speed={2400 * dir}
              top={930}
              dark
              outline={false}
              phase={900}
            />
            <Band
              text={STACK}
              speed={-2000 * dir}
              top={1250}
              dark={false}
              outline
              phase={1400}
            />
            <Band
              text={STACK}
              speed={2200 * dir}
              top={1570}
              dark
              outline={false}
              phase={2100}
            />
          </AbsoluteFill>
        ) : (
          <AbsoluteFill
            style={{
              transform: `rotate(${-7 * flip}deg) scale(${1 + 0.12 * flip})`,
            }}
          >
            <Band
              text={STACK}
              speed={2600 * dir}
              top={250}
              dark
              outline={false}
            />
            <Band
              text={SERVICES}
              speed={-2200 * dir}
              top={560}
              dark={false}
              outline
            />
          </AbsoluteFill>
        )}
        <div
          style={{
            position: "absolute",
            left: V ? 80 : 120,
            top: V ? 200 : 100,
            ...mono(V ? 26 : 22, C.mutedOnPaper),
          }}
        >
          AIVEN // STACK
        </div>
      </Camera>
    </AbsoluteFill>
  );
};

/** Solid arrow with punched slots (evenodd), the Annular "forward impact" device. */
const Arrow: React.FC<{ fill: string }> = ({ fill }) => (
  <svg width={900} height={360} viewBox="0 0 900 360">
    <path
      fillRule="evenodd"
      fill={fill}
      d="M0 120 H600 V20 L900 180 L600 340 V240 H0 Z M80 150 H200 V210 H80 Z M240 150 H360 V210 H240 Z M400 150 H520 V210 H400 Z"
    />
  </svg>
);

/** LAUNCH / SEQUENCE. — climax on the two strongest kicks: the arrow slams in, then launches out of frame. */
export const Launch: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const slam = tw(t, 0, 0.12, 0, 1, OUT3);
  const go = tw(t, BEAT, BEAT + 0.2, 0, 1, IN);
  const x = interpolate(slam, [0, 1], [-1000, V ? 90 : 120]) + go * 2300;
  // Vertical: word sits above the arrow, speed lines run through the arrow's band.
  const arrowTop = V ? 1010 : 600;
  const linesTop = V ? 960 : 300;
  const blur = (1 - slam) * 50 + go * 90;
  const word = t >= BEAT ? "SEQUENCE." : "LAUNCH";
  return (
    <AbsoluteFill style={{ background: C.black, overflow: "hidden" }}>
      <BlurDef id="arrowblur" x={blur} y={0} />
      <Camera
        dur={dur}
        zoom={[1.0, 1.03]}
        punch={0.07}
        hits={[0, BEAT]}
        amp={12}
      >
        <div
          style={{
            position: "absolute",
            left: x,
            top: arrowTop,
            filter: blur > 0.5 ? "url(#arrowblur)" : undefined,
          }}
        >
          <Arrow fill={C.accent} />
        </div>
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0, opacity: go }}
        >
          {Array.from({ length: 14 }, (_, i) => (
            <line
              key={i}
              x1={0}
              y1={linesTop + i * 34}
              x2={W * go}
              y2={linesTop + i * 34}
              stroke={C.white}
              strokeWidth={i % 3 === 0 ? 2 : 1}
              opacity={0.25 + (i % 4) * 0.12}
            />
          ))}
        </svg>
        <div
          style={
            V
              ? { position: "absolute", right: 80, bottom: H - 900 }
              : { position: "absolute", right: 120, top: 250 }
          }
        >
          <MaskLine at={t >= BEAT ? BEAT : 0.02} dur={0.18} key={word}>
            <div
              style={{
                ...headline(
                  word.length > 7 ? (V ? 160 : 230) : V ? 230 : 280,
                  C.white,
                ),
                textAlign: "right",
              }}
            >
              {word}
            </div>
          </MaskLine>
        </div>
        <div
          style={{
            position: "absolute",
            left: V ? 80 : 120,
            top: V ? 210 : 100,
            ...mono(V ? 26 : 22),
          }}
        >
          AIVEN // LAUNCH
        </div>
      </Camera>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

/** AIVEN (filled) / STUDIOS (outline) — the site's hero trick, one word per kick. */
export const Hero: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const a = tw(t, 0, 0.14, 0, 1, OUT3);
  const s = tw(t, BEAT, BEAT + 0.14, 0, 1, OUT3);
  const { V } = useStage();
  const word = (p: number): React.CSSProperties => ({
    opacity: p,
    transform: `scale(${1.12 - 0.12 * p})`,
    filter: p < 0.99 ? `blur(${(1 - p) * 14}px)` : undefined,
  });
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.05]}
        punch={0.06}
        hits={[0, BEAT]}
        amp={8}
      >
        <AbsoluteFill
          style={{ justifyContent: "center", alignItems: "center" }}
        >
          {/* Vertical: AIVEN and STUDIOS sized to the same ~900 px measure, stacked as a justified block. */}
          <div
            style={{
              ...headline(V ? 325 : 330, C.white),
              lineHeight: 0.86,
              ...word(a),
            }}
          >
            AIVEN
          </div>
          <div
            style={{
              ...headline(V ? 212 : 330, "transparent"),
              lineHeight: 0.86,
              WebkitTextStroke: `${V ? 2.5 : 3}px ${C.white}`,
              ...word(s),
            }}
          >
            STUDIOS
          </div>
        </AbsoluteFill>
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: V ? 420 : 96,
            textAlign: "center",
            ...mono(V ? 20 : 22, C.mutedOnDark, 400),
            opacity: tw(t, BEAT + 0.08, BEAT + 0.3, 0, 1, OUT3),
          }}
        >
          AIVEN STUDIOS V.O.F. ✦ HOEVELAKEN, NL ✦ EST. 2026
        </div>
      </Camera>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

/** Horizon dive: the grid rushes at the camera, becomes a tunnel on the 2nd kick, then everything stops dead. */
export const Horizon: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const tunnel = t >= BEAT;
  const remaining = Math.max(0, dur - t);
  const { V } = useStage();
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.12]}
        punch={0.05}
        hits={[0, BEAT]}
        amp={6}
      >
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse ${V ? "70% 9%" : "45% 18%"} at 50% 50%, rgba(247,247,249,0.22) 0%, rgba(247,247,249,0) 100%)`,
          }}
        />
        <Terrain
          speed={tunnel ? 34 : 16}
          horizon={V ? 960 : 540}
          ceiling={tunnel}
          flat
          focal={V ? 1100 : 900}
        />
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: V ? 230 : 120,
            textAlign: "center",
            ...mono(V ? 28 : 26, C.white, 800),
          }}
        >
          LAUNCH SEQUENCE // T-{remaining.toFixed(2).padStart(5, "0")}
        </div>
      </Camera>
      <Vignette strength={0.7} />
    </AbsoluteFill>
  );
};
