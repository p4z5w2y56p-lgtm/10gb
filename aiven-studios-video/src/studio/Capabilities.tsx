import React, { useMemo } from "react";
import { AbsoluteFill, Easing, interpolate, random } from "remotion";
import { JBMONO } from "../fonts";
import { Camera, OUT, OUT3, Vignette, clamp, tw, useTime } from "../fx";
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
import { V3, fibSphere, iso, knnEdges, project, rotX, rotY } from "./three";

const Title: React.FC<{
  n: string;
  label: string;
  title: string;
  color?: string;
  muted?: string;
}> = ({ n, label, title, color = C.white, muted = C.mutedOnDark }) => {
  const { V } = useStage();
  if (V) {
    // vertical: two stacked lines (last word on its own line), bottom safe area
    const cut = title.lastIndexOf(" ");
    const lines =
      cut > 0 ? [title.slice(0, cut), title.slice(cut + 1)] : [title];
    return (
      <div style={{ position: "absolute", left: 72, bottom: 400 }}>
        <div style={{ marginBottom: 22 }}>
          <Eyebrow n={n} label={label} color={muted} at={0.02} size={26} />
        </div>
        <MaskLine at={0.03}>
          {lines.map((l) => (
            <div key={l} style={headline(titleSizeV(lines), color)}>
              {l}
            </div>
          ))}
        </MaskLine>
      </div>
    );
  }
  return (
    <div style={{ position: "absolute", left: 120, bottom: 110 }}>
      <div style={{ marginBottom: 18 }}>
        <Eyebrow n={n} label={label} color={muted} at={0.02} />
      </div>
      <MaskLine at={0.03}>
        <div style={headline(150, color)}>{title}</div>
      </MaskLine>
    </div>
  );
};

/** Vertical title size: 116 px, shrunk so the longest line ("AUTOMATISERING.") stays ≈ 930 px wide. */
const TITLE_V = 116;
const titleSizeV = (lines: string[]) =>
  Math.min(TITLE_V, Math.floor(930 / (0.62 * Math.max(...lines.map((l) => l.length)))));

/** Sparse, sharp ambient particles (star field) drifting slowly. */
export const Dust: React.FC<{ n?: number; color?: string; seed?: string }> = ({
  n = 70,
  color = C.white,
  seed = "d",
}) => {
  const t = useTime();
  const { W, H } = useStage();
  return (
    <svg width={W} height={H} style={{ position: "absolute", left: 0, top: 0 }}>
      {Array.from({ length: n }, (_, i) => {
        const x =
          (random(`${seed}x${i}`) * W + t * (8 + random(`${seed}v${i}`) * 30)) %
          W;
        const y = random(`${seed}y${i}`) * H;
        const r = 0.6 + random(`${seed}r${i}`) * 1.3;
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={r}
            fill={color}
            opacity={0.25 + random(`${seed}o${i}`) * 0.55}
          />
        );
      })}
    </svg>
  );
};

/** 001 / AUTONOMOUS AI — a neural sphere born from the singularity; on the 2nd kick it expands and a core ignites. */
export const AutonomousAI: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const outer = useMemo(() => fibSphere(150), []);
  const outerEdges = useMemo(() => knnEdges(outer, 3), [outer]);
  const inner = useMemo(() => fibSphere(64), []);
  const innerEdges = useMemo(() => knnEdges(inner, 3), [inner]);
  const birth = tw(t, 0, 0.2, 0.02, 1, OUT);
  const expand = tw(t, BEAT, BEAT + 0.22, 0, 1, OUT);
  const scale = birth * (1 + 0.55 * expand);
  const yaw = 0.9 + t * 1.3;
  const pitch = 0.32;
  const focal = V ? 960 : 1150; // vertical: expanded sphere stays inside the 1080 width
  const dist = 3.8;
  const draw = (
    pts: V3[],
    edges: [number, number][],
    r: number,
    spin: number,
    key: string,
    bright: number,
  ) => {
    const P = pts.map((p) => {
      const q = rotX(rotY([p[0] * r, p[1] * r, p[2] * r], spin), pitch);
      return V
        ? project(q, focal, dist, 540, 700)
        : project(q, focal, dist, 960, 500);
    });
    const depth = (z: number) =>
      interpolate(z, [dist - 1.6 * r, dist + 1.6 * r], [1, 0.12], clamp);
    return (
      <g key={key}>
        {edges.map(([a, b2], i) => {
          const A = P[a];
          const B = P[b2];
          return (
            <line
              key={i}
              x1={A.x}
              y1={A.y}
              x2={B.x}
              y2={B.y}
              stroke={C.white}
              strokeWidth={1.3}
              opacity={depth((A.z + B.z) / 2) * bright}
            />
          );
        })}
        {P.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={1.6 + 1.4 * depth(p.z)}
            fill={C.white}
            opacity={0.35 + 0.65 * depth(p.z)}
          />
        ))}
        {edges
          .filter((_, i) => i % 7 === 0)
          .map(([a, b2], i) => {
            const f = (t * 1.9 + random(`p${key}${i}`)) % 1;
            const A = P[a];
            const B = P[b2];
            return (
              <circle
                key={`s${i}`}
                cx={A.x + (B.x - A.x) * f}
                cy={A.y + (B.y - A.y) * f}
                r={2.6}
                fill={C.white}
                opacity={depth((A.z + B.z) / 2)}
              />
            );
          })}
      </g>
    );
  };
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Dust seed="ai" />
      <Camera
        dur={dur}
        zoom={[1.0, 1.06]}
        punch={0.05}
        hits={[0, BEAT]}
        amp={6}
      >
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          {draw(outer, outerEdges, scale, yaw, "o", 1)}
          {expand > 0
            ? draw(
                inner,
                innerEdges,
                0.48 * expand * birth,
                -yaw * 1.6,
                "i",
                0.9,
              )
            : null}
        </svg>
        <div
          style={{
            position: "absolute",
            right: V ? 72 : 120,
            top: V ? 200 : 100,
            ...mono(V ? 22 : 20, C.mutedOnDark, 400),
            textAlign: "right",
            lineHeight: 1.7,
          }}
        >
          NODES {expand > 0 ? 214 : 150}
          <br />
          EDGES{" "}
          {expand > 0
            ? outerEdges.length + innerEdges.length
            : outerEdges.length}
        </div>
        <Title n="001" label="KERNDIENST" title="AI-INTEGRATIE." />
      </Camera>
      <Vignette strength={0.55} />
    </AbsoluteFill>
  );
};

const GLYPHS = "0123456789ABCDEF<>/=+*#%$&{}[]:;";

type Rain = {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  dx: number;
  dy: number;
  font: number;
};
type Mat = {
  x0: number;
  y0: number;
  cols: number;
  rows: number;
  w: number;
  h: number;
};
type DataLayout = {
  rain: Rain;
  mat: Mat;
  /** stream / funnel axis: landscape flows left → right, vertical flows top → bottom */
  down: boolean;
  /** funnel mouth (start of flow axis), neck start/end along the flow axis, neck centre across it */
  mouth: number;
  neckA: number;
  neckB: number;
  neck: number;
  /** funnel mouth extent across the flow axis */
  span: [number, number];
  /** stream: packet origin range across the axis, flow length */
  src: [number, number];
  flow: number;
  streamFont: number;
  cellFont: number;
  colFont: number;
  ar: number;
  ac: number;
};

const DATA_LAND: DataLayout = {
  rain: { x0: 168, y0: 236, cols: 23, rows: 19, dx: 30, dy: 26, font: 21 },
  mat: { x0: 1092, y0: 282, cols: 10, rows: 9, w: 66, h: 46 },
  down: false,
  mouth: 870,
  neckA: 1020,
  neckB: 1060,
  neck: 480,
  span: [236, 724],
  src: [250, 440],
  flow: 236,
  streamFont: 18,
  cellFont: 17,
  colFont: 13,
  ar: 1,
  ac: 8,
};

// 9:16 — rain band on top, funnel pointing down, 8×9 matrix below, title in the bottom safe area.
const MAT_V: Mat = { x0: 72, y0: 690, cols: 8, rows: 9, w: 100, h: 50 };
const DATA_VERT: DataLayout = {
  rain: { x0: 108, y0: 262, cols: 28, rows: 8, dx: 32, dy: 26, font: 23 },
  mat: MAT_V,
  down: true,
  mouth: 470,
  neckA: 584,
  neckB: 624,
  neck: MAT_V.x0 + (MAT_V.cols * MAT_V.w) / 2,
  span: [72, 1008],
  src: [96, 888],
  flow: 234,
  streamFont: 21,
  cellFont: 21,
  colFont: 15,
  ar: 1,
  ac: 7,
};

const glyph = (seed: string) =>
  GLYPHS[Math.floor(random(seed) * GLYPHS.length)];

/** Raw glyph rain (ink on paper). Each column has its own head speed; glyphs mutate as the head passes. */
const GlyphRain: React.FC<{ t: number; dim: number; RAIN: Rain }> = ({
  t,
  dim,
  RAIN,
}) => {
  const L = RAIN.rows * RAIN.dy + 220;
  const nodes: React.ReactNode[] = [];
  for (let c = 0; c < RAIN.cols; c++) {
    const v = 520 + random(`rv${c}`) * 620;
    const head = (random(`ro${c}`) * L + t * v) % L;
    const edge = Math.min(1, c / 3, (RAIN.cols - 1 - c) / 4);
    for (let r = 0; r < RAIN.rows; r++) {
      const y = r * RAIN.dy;
      const d = (((head - y) % L) + L) % L;
      const a = d < RAIN.dy ? 1 : Math.exp(-d / 240) * 0.9;
      if (a < 0.04) continue;
      const isHead = d < RAIN.dy;
      const tick = Math.floor(t * 22 + random(`rt${c}-${r}`) * 9);
      nodes.push(
        <text
          key={`${c}-${r}`}
          x={RAIN.x0 + c * RAIN.dx}
          y={RAIN.y0 + y}
          fill={isHead ? C.ink : "#36363a"}
          opacity={a * edge * (1 - dim * 0.72)}
          fontWeight={isHead ? 800 : 500}
        >
          {glyph(`g${c}-${r}-${tick}`)}
        </text>,
      );
    }
  }
  return (
    <g fontFamily={JBMONO} fontSize={RAIN.font} textAnchor="middle">
      {nodes}
    </g>
  );
};

/** Glyph packets pulled out of the rain, compressed through the slot toward the matrix. */
const Stream: React.FC<{ t: number; stop: number; L: DataLayout }> = ({
  t,
  stop,
  L,
}) => {
  const nodes: React.ReactNode[] = [];
  for (let i = 0; i < 46; i++) {
    const ph = (t * 1.9 + random(`sp${i}`)) % 1;
    const a0 = L.src[0] + random(`sy${i}`) * L.src[1];
    const a1 = L.neck + (random(`sn${i}`) - 0.5) * 44;
    const k = Easing.inOut(Easing.cubic)(Math.min(1, ph * 1.35));
    const along = L.mouth + ph * L.flow;
    const across = a0 + (a1 - a0) * k;
    const a = Math.min(1, ph * 8, (1 - ph) * 6) * (1 - stop);
    if (a < 0.03) continue;
    nodes.push(
      <text
        key={i}
        x={L.down ? across : along}
        y={L.down ? along : across}
        opacity={a}
        fill={C.ink}
        fontWeight={ph > 0.7 ? 800 : 500}
      >
        {glyph(`sg${i}-${Math.floor(t * 18 + i)}`)}
      </text>,
    );
  }
  return (
    <g fontFamily={JBMONO} fontSize={L.streamFont} textAnchor="middle">
      {nodes}
    </g>
  );
};

/** 002 / DATA ENGINEERING — raw glyph rain is pulled through a slot into a structured matrix that locks on the kick. */
export const DataEngineering: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const L = V ? DATA_VERT : DATA_LAND;
  const MAT = L.mat;
  const lock = tw(t, BEAT, BEAT + 0.16, 0, 1, OUT);
  const locked = t >= BEAT;
  const fillEnd = BEAT - 0.06;
  const mw = MAT.cols * MAT.w;
  const mh = MAT.rows * MAT.h;
  const scan = interpolate(t, [BEAT + 0.02, dur], [0, 1], {
    ...clamp,
    easing: Easing.out(Easing.quad),
  });
  // single accent cell: the system's flagged signal
  const ar = L.ar;
  const ac = L.ac;
  const cells: React.ReactNode[] = [];
  for (let r = 0; r < MAT.rows; r++) {
    for (let c = 0; c < MAT.cols; c++) {
      const at = ((c + r) / (MAT.cols + MAT.rows - 2)) * (fillEnd - 0.1) + 0.02;
      const p = tw(t, at, at + 0.1, 0, 1, OUT);
      if (p <= 0) continue;
      const v = random(`mv${r}-${c}`);
      const val = locked ? v : random(`ms${r}-${c}-${Math.floor(t * 30)}`);
      const heat = lock * (0.08 + 0.86 * v * v);
      const x = MAT.x0 + c * MAT.w;
      const y = MAT.y0 + r * MAT.h;
      const inv = heat > 0.48;
      cells.push(
        <g key={`${r}-${c}`} opacity={p}>
          <rect
            x={x + 3}
            y={y + 3}
            width={MAT.w - 6}
            height={MAT.h - 6}
            fill={C.ink}
            fillOpacity={heat}
            stroke={C.ink}
            strokeOpacity={0.35 + 0.4 * (1 - lock)}
            strokeWidth={1.2}
          />
          <text
            x={x + MAT.w / 2}
            y={y + MAT.h / 2 + (V ? 7 : 6)}
            fill={inv ? C.paper : C.ink}
            textAnchor="middle"
            opacity={locked ? 1 : 0.7}
          >
            {val.toFixed(2).slice(1)}
          </text>
        </g>,
      );
    }
  }
  const ax = MAT.x0 + ac * MAT.w;
  const ay = MAT.y0 + ar * MAT.h;
  const flag = tw(t, BEAT + 0.08, BEAT + 0.2, 0, 1, OUT3);
  const h = 34; // half-width of the slot
  const funnel = L.down
    ? [
        `M ${L.span[0]} ${L.mouth} L ${L.neck - h} ${L.neckA} L ${L.neck - h} ${L.neckB}`,
        `M ${L.span[1]} ${L.mouth} L ${L.neck + h} ${L.neckA} L ${L.neck + h} ${L.neckB}`,
      ]
    : [
        `M ${L.mouth} ${L.span[0]} L ${L.neckA} ${L.neck - h} L ${L.neckB} ${L.neck - h}`,
        `M ${L.mouth} ${L.span[1]} L ${L.neckA} ${L.neck + h} L ${L.neckB} ${L.neck + h}`,
      ];
  // corner brackets: landscape keeps its original offsets; vertical hugs the matrix a little tighter
  const cp = V
    ? { x: 24, y: 44, w: 48, h: 76 }
    : { x: 36, y: 48, w: 72, h: 84 };
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.05]}
        punch={0.04}
        hits={[0, BEAT]}
        amp={5}
      >
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <GlyphRain t={t} dim={lock} RAIN={L.rain} />
          <g stroke={C.ink} strokeWidth={2} fill="none">
            <path d={funnel[0]} />
            <path d={funnel[1]} />
          </g>
          <Stream t={t} stop={lock} L={L} />
          <g
            fontFamily={JBMONO}
            fontSize={L.colFont}
            fontWeight={700}
            fill={C.mutedOnPaper}
            textAnchor="middle"
            letterSpacing="0.08em"
          >
            {Array.from({ length: MAT.cols }, (_, c) => (
              <text
                key={c}
                x={MAT.x0 + c * MAT.w + MAT.w / 2}
                y={MAT.y0 - 14}
                opacity={tw(t, 0.02 + c * 0.012, 0.12 + c * 0.012, 0, 1)}
              >
                {`C${String(c + 1).padStart(2, "0")}`}
              </text>
            ))}
          </g>
          <g fontFamily={JBMONO} fontSize={L.cellFont} fontWeight={700}>
            {cells}
          </g>
          {locked ? (
            <rect
              x={MAT.x0}
              y={MAT.y0 + scan * mh - 1}
              width={mw}
              height={2}
              fill={C.ink}
              opacity={1 - scan}
            />
          ) : null}
          {flag > 0 ? (
            <g opacity={flag}>
              <rect
                x={ax + 1}
                y={ay + 1}
                width={MAT.w - 2}
                height={MAT.h - 2}
                fill="none"
                stroke={C.accent}
                strokeWidth={3}
              />
              <line
                x1={ax + MAT.w}
                y1={ay + MAT.h / 2}
                x2={MAT.x0 + mw + 40 * flag}
                y2={ay + MAT.h / 2}
                stroke={C.accent}
                strokeWidth={2}
              />
            </g>
          ) : null}
        </svg>
        <Corners
          x={MAT.x0 - cp.x - (1 - lock) * 40}
          y={MAT.y0 - cp.y - (1 - lock) * 40}
          w={mw + cp.w + (1 - lock) * 80}
          h={mh + cp.h + (1 - lock) * 80}
          color={C.ink}
          opacity={lock}
        />
        <div
          style={{
            position: "absolute",
            left: V ? 72 : L.rain.x0 - 10,
            top: V ? 196 : 180,
            ...mono(V ? 22 : 20, C.mutedOnPaper),
          }}
        >
          HANDWERK
        </div>
        <div
          style={{
            position: "absolute",
            left: V ? MAT.x0 : MAT.x0 - 18,
            top: V ? MAT.y0 + mh + 52 : 180,
            ...mono(V ? 20 : 20, C.ink),
            opacity: lock,
          }}
        >
          AUTOMATISCH // VERGRENDELD
        </div>
        <div
          style={{
            position: "absolute",
            left: MAT.x0 + mw + 50,
            top: ay + MAT.h / 2 - (V ? 13 : 11),
            ...mono(V ? 20 : 17, C.accent),
            opacity: flag,
            whiteSpace: "nowrap",
          }}
        >
          SIGNAAL
        </div>
        <Title
          n="002"
          label="KERNDIENST"
          title="AUTOMATISERING."
          color={C.ink}
          muted={C.mutedOnPaper}
        />
      </Camera>
      <Vignette strength={0.1} inner={50} />
    </AbsoluteFill>
  );
};

type Floor = { y: number; w: number; d: number; h: number };

const Box: React.FC<{
  x: number;
  z: number;
  f: Floor;
  s: number;
  cx: number;
  cy: number;
  o: number;
}> = ({ x, z, f, s, cx, cy, o }) => {
  const P = (px: number, py: number, pz: number) => iso(px, py, pz, s, cx, cy);
  const a = P(x, f.y + f.h, z);
  const b2 = P(x + f.w, f.y + f.h, z);
  const c = P(x + f.w, f.y + f.h, z + f.d);
  const d = P(x, f.y + f.h, z + f.d);
  const b3 = P(x + f.w, f.y, z);
  const c3 = P(x + f.w, f.y, z + f.d);
  const d3 = P(x, f.y, z + f.d);
  return (
    <g opacity={o}>
      <path
        d={`M${d.x} ${d.y} L${c.x} ${c.y} L${c3.x} ${c3.y} L${d3.x} ${d3.y} Z`}
        fill="#0b0b0c"
        stroke={C.white}
        strokeWidth={1.5}
      />
      <path
        d={`M${b2.x} ${b2.y} L${c.x} ${c.y} L${c3.x} ${c3.y} L${b3.x} ${b3.y} Z`}
        fill="#080809"
        stroke={C.white}
        strokeWidth={1.5}
      />
      <path
        d={`M${a.x} ${a.y} L${b2.x} ${b2.y} L${c.x} ${c.y} L${d.x} ${d.y} Z`}
        fill="#121214"
        stroke={C.white}
        strokeWidth={1.5}
      />
      {[0.33, 0.66].map((k) => {
        const l = P(x, f.y + f.h * k, z + f.d);
        const r = P(x + f.w, f.y + f.h * k, z + f.d);
        const r2 = P(x + f.w, f.y + f.h * k, z);
        return (
          <g key={k} stroke={C.white} strokeWidth={0.8} opacity={0.45}>
            <line x1={l.x} y1={l.y} x2={r.x} y2={r.y} />
            <line x1={r.x} y1={r.y} x2={r2.x} y2={r2.y} />
          </g>
        );
      })}
    </g>
  );
};

/** 003 / SAAS ARCHITECTURE — floors slam in on the kicks; on the 2nd kick the tower doubles and the camera pulls back. */
export const SaasArchitecture: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const pull = tw(t, BEAT, BEAT + 0.3, 0, 1, OUT);
  // vertical: tower larger, left of centre (side block sits to its right), above the title block
  const s = interpolate(pull, [0, 1], V ? [86, 62] : [66, 47]);
  const cx = V ? 400 : 1180;
  const cy = interpolate(pull, [0, 1], V ? [960, 1020] : [760, 820]);
  const lab = V ? 20 : 18;
  const floorsA = Math.floor(
    interpolate(t, [0, 0.24], [0, 7], {
      ...clamp,
      easing: Easing.out(Easing.quad),
    }),
  );
  const floorsB = Math.floor(
    interpolate(t, [BEAT, BEAT + 0.22], [7, 15], {
      ...clamp,
      easing: Easing.out(Easing.quad),
    }),
  );
  const floors = t < BEAT ? floorsA : floorsB;
  const tower: Floor[] = Array.from({ length: floors }, (_, i) => ({
    y: i * 0.62,
    w: 3.2,
    d: 3.2,
    h: 0.5,
  }));
  const side: Floor[] = Array.from(
    { length: Math.floor(pull * 6) },
    (_, i) => ({ y: i * 0.62, w: 2, d: 2, h: 0.5 }),
  );
  const grid = [];
  for (let i = -7; i <= 7; i++) {
    const a1 = iso(i, 0, -7, s, cx, cy);
    const a2 = iso(i, 0, 7, s, cx, cy);
    const b1 = iso(-7, 0, i, s, cx, cy);
    const b2 = iso(7, 0, i, s, cx, cy);
    grid.push(
      <line key={`a${i}`} x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />,
      <line key={`b${i}`} x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} />,
    );
  }
  const trace = [
    iso(-6, 0, 2, s, cx, cy),
    iso(-2, 0, 2, s, cx, cy),
    iso(-2, 0, -1, s, cx, cy),
    iso(0, 0, -1, s, cx, cy),
  ];
  const pulse = (t * 2.4) % 1;
  const pi = Math.min(2, Math.floor(pulse * 3));
  const pf = pulse * 3 - pi;
  const top = iso(0, floors * 0.62, 0, s, cx, cy);
  const base = iso(3.2, 0.6, 3.2, s, cx, cy);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <Camera
        dur={dur}
        zoom={[1.0, 1.04]}
        punch={0.05}
        hits={[0, BEAT]}
        amp={6}
      >
        <svg
          width={W}
          height={H}
          style={{ position: "absolute", left: 0, top: 0 }}
        >
          <g stroke="#2b2b2e" strokeWidth={1}>
            {grid}
          </g>
          <polyline
            points={trace.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke="#6b6b70"
            strokeWidth={2}
          />
          <circle
            cx={trace[pi].x + (trace[pi + 1].x - trace[pi].x) * pf}
            cy={trace[pi].y + (trace[pi + 1].y - trace[pi].y) * pf}
            r={5}
            fill={C.white}
          />
          {side.map((f, i) => (
            <Box
              key={`s${i}`}
              x={4.2}
              z={-3.6}
              f={f}
              s={s}
              cx={cx}
              cy={cy}
              o={1}
            />
          ))}
          {tower.map((f, i) => (
            <Box key={i} x={0} z={0} f={f} s={s} cx={cx} cy={cy} o={1} />
          ))}
          {pull > 0.5 ? (
            <line
              x1={top.x}
              y1={top.y}
              x2={top.x}
              y2={top.y - 90 * pull}
              stroke={C.white}
              strokeWidth={1.5}
            />
          ) : null}
          <g
            opacity={tw(t, BEAT + 0.08, BEAT + 0.24, 0, 1, OUT3)}
            stroke={C.mutedOnDark}
            strokeWidth={1}
          >
            <line
              x1={base.x + 10}
              y1={base.y}
              x2={base.x + 120}
              y2={base.y + 40}
            />
            <line
              x1={top.x + 60}
              y1={top.y + 30}
              x2={top.x + 220}
              y2={top.y - 10}
            />
          </g>
        </svg>
        <div
          style={{
            position: "absolute",
            left: base.x + 128,
            top: base.y + 26,
            ...mono(lab, C.mutedOnDark, 400),
            opacity: tw(t, BEAT + 0.08, BEAT + 0.24, 0, 1, OUT3),
          }}
        >
          GEBOUWD OM TE GROEIEN
        </div>
        <div
          style={{
            position: "absolute",
            left: top.x + 228,
            top: top.y - 26,
            ...mono(lab, C.white, 400),
            opacity: tw(t, BEAT + 0.08, BEAT + 0.24, 0, 1, OUT3),
          }}
        >
          STRAKKE FRONTEND
        </div>
        <Title n="003" label="KERNDIENST" title="WEBSITES." />
      </Camera>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};
