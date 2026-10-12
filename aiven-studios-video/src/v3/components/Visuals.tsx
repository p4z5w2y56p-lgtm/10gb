import React from "react";
import { Easing, interpolate, random, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { Corners } from "./Panels";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/* ------------------------------------------------------------------ */
/* Neural sphere: Fibonacci point cloud, nearest-neighbour edges       */
/* ------------------------------------------------------------------ */
const PTS: [number, number, number][] = Array.from({ length: 64 }, (_, i) => {
  const y = 1 - (i / 63) * 2;
  const r = Math.sqrt(1 - y * y);
  const th = i * 2.399963;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
});
const EDGES: [number, number][] = (() => {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  PTS.forEach((p, i) => {
    PTS.map((q, j) => [j, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2] as const)
      .filter(([j]) => j !== i)
      .sort((x, y) => x[1] - y[1])
      .slice(0, 3)
      .forEach(([j]) => {
        const k = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push([i, j]);
        }
      });
  });
  return out;
})();

export const NeuralSphere: React.FC<{ cx: number; cy: number; R: number; grow: number }> = ({ cx, cy, R, grow }) => {
  const frame = useCurrentFrame();
  const a = frame * 0.012;
  const tilt = 0.4;
  const half = Math.floor(frame / (b(1) / 2));
  const proj = PTS.map(([x, y, z]) => {
    const x1 = x * Math.cos(a) + z * Math.sin(a);
    const z1 = -x * Math.sin(a) + z * Math.cos(a);
    const y2 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
    const z2 = y * Math.sin(tilt) + z1 * Math.cos(tilt);
    return { sx: cx + x1 * R * grow, sy: cy + y2 * R * grow, d: (z2 + 1) / 2 };
  });
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
      <circle cx={cx} cy={cy} r={R * grow} fill="none" stroke={C.hair} strokeWidth={1.5} />
      {EDGES.map(([i, j], k) => {
        const p = proj[i];
        const q = proj[j];
        const hot = random(`e${k}-${half}`) < 0.1;
        return (
          <line
            key={k}
            x1={p.sx}
            y1={p.sy}
            x2={q.sx}
            y2={q.sy}
            stroke={hot ? C.white : C.mutedOnDark}
            strokeWidth={hot ? 2.5 : 1.2}
            opacity={hot ? 1 : 0.18 + 0.5 * ((p.d + q.d) / 2)}
          />
        );
      })}
      {proj.map((p, i) => (
        <circle key={i} cx={p.sx} cy={p.sy} r={2 + 2.5 * p.d} fill={C.white} opacity={0.35 + 0.65 * p.d} />
      ))}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Chaos -> grid: raw noise funnels into a locked, ordered grid        */
/* ------------------------------------------------------------------ */
const COLS = 14;
const ROWS = 8;
const CELL = 44;
const GRID_X = 1090;
const GRID_Y = 322;
const SPOUT = { x: 905, y: 500 };

export const ChaosToGrid: React.FC = () => {
  const frame = useCurrentFrame();
  const dots = Array.from({ length: COLS * ROWS }, (_, i) => {
    const hx = 150 + random(`hx${i}`) * 500;
    const hy = 240 + random(`hy${i}`) * 520;
    const start = 0.2 + random(`hs${i}`) * 1.8; // beat on which this dot leaves the noise (all home by beat 2.9)
    const p = interpolate(frame, [b(start), b(start) + 22], [0, 1], { ...clamp, easing: Easing.bezier(0.45, 0, 0.2, 1) });
    const tx = GRID_X + (i % COLS) * CELL + CELL / 2;
    const ty = GRID_Y + Math.floor(i / COLS) * CELL + CELL / 2;
    const driftX = Math.sin(frame / 14 + i) * 10 * (1 - p);
    const driftY = Math.cos(frame / 11 + i * 1.7) * 10 * (1 - p);
    let x = hx + driftX;
    let y = hy + driftY;
    if (p > 0) {
      const p1 = Math.min(1, p * 2);
      const p2 = Math.max(0, p * 2 - 1);
      const mx = hx + (SPOUT.x - hx) * p1;
      const my = hy + (SPOUT.y + (random(`sj${i}`) - 0.5) * 30 - hy) * p1;
      x = mx + (tx - mx) * p2;
      y = my + (ty - my) * p2;
    }
    return { x, y, p, tx, ty, i };
  });
  const locked = frame >= b(3);
  const mono: React.CSSProperties = {
    position: "absolute",
    fontFamily: "JetBrains Mono Var",
    fontWeight: 500,
    fontSize: 22,
    letterSpacing: "0.14em",
    color: C.mutedOnPaper,
  };
  return (
    <>
      <div style={{ ...mono, left: 150, top: 190 }}>RUIS</div>
      <div style={{ ...mono, left: GRID_X, top: 260, color: locked ? C.ink : C.mutedOnPaper }}>
        {locked ? "STRUCTUUR // LOCKED" : "STRUCTUUR // ..."}
      </div>
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
        <polyline points={`690,250 ${SPOUT.x},470 ${SPOUT.x + 70},470`} fill="none" stroke={C.ink} strokeWidth={1.5} opacity={0.7} />
        <polyline points={`690,750 ${SPOUT.x},530 ${SPOUT.x + 70},530`} fill="none" stroke={C.ink} strokeWidth={1.5} opacity={0.7} />
        {dots.map((d) =>
          d.p >= 1 ? (
            <rect key={d.i} x={d.tx - 18} y={d.ty - 18} width={36} height={36} fill={C.ink} />
          ) : (
            <rect key={d.i} x={d.x - 3} y={d.y - 3} width={6} height={6} fill={C.ink} />
          ),
        )}
      </svg>
      <div style={{ position: "absolute", left: GRID_X - 40, top: GRID_Y - 40 }}>
        <Corners w={COLS * CELL + 80} h={ROWS * CELL + 80} color={locked ? C.accent : C.ink} />
      </div>
    </>
  );
};

/* ------------------------------------------------------------------ */
/* Isometric web stack: plates lift into a layered site                */
/* ------------------------------------------------------------------ */
const W = 330;
const D = 330;
const H = 16;

export const IsoWeb: React.FC<{ ox: number; oy: number }> = ({ ox, oy }) => {
  const frame = useCurrentFrame();
  const iso = (x: number, y: number, z: number): [number, number] => [ox + (x - y) * 0.866, oy + (x + y) * 0.5 - z];
  const pts = (list: [number, number, number][]) => list.map(([x, y, z]) => iso(x, y, z).join(",")).join(" ");
  const rect = (x0: number, y0: number, w: number, d: number, z: number) =>
    pts([[x0, y0, z], [x0 + w, y0, z], [x0 + w, y0 + d, z], [x0, y0 + d, z]]);
  const LAYERS = 5;
  const lift = (i: number) =>
    interpolate(frame, [b(0.3 + i * 0.35), b(0.3 + i * 0.35) + 24], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  const done = frame >= b(2.8);

  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
      {/* ground grid */}
      {Array.from({ length: 9 }, (_, i) => (
        <React.Fragment key={i}>
          <polyline points={pts([[-60 + i * 55, -60, 0], [-60 + i * 55, W + 60, 0]])} stroke={C.grid} strokeWidth={1} fill="none" />
          <polyline points={pts([[-60, -60 + i * 55, 0], [W + 60, -60 + i * 55, 0]])} stroke={C.grid} strokeWidth={1} fill="none" />
        </React.Fragment>
      ))}
      {Array.from({ length: LAYERS }, (_, i) => {
        const z = lift(i) * i * 78;
        const top = i === LAYERS - 1;
        return (
          <g key={i} opacity={Math.min(1, lift(i) * 3)}>
            {/* side faces */}
            <polygon points={pts([[0, D, z], [W, D, z], [W, D, z - H], [0, D, z - H]])} fill={C.terminal} stroke={C.mutedOnDark} strokeWidth={1.5} />
            <polygon points={pts([[W, 0, z], [W, D, z], [W, D, z - H], [W, 0, z - H]])} fill="#080809" stroke={C.mutedOnDark} strokeWidth={1.5} />
            {/* top face */}
            <polygon points={rect(0, 0, W, D, z)} fill="#121214" stroke={C.white} strokeWidth={1.5} />
            {/* page wireframe */}
            <polyline points={pts([[0, 52, z], [W, 52, z]])} stroke={C.mutedOnDark} strokeWidth={1.2} fill="none" />
            <polygon points={rect(24, 80, 170, 22, z)} fill="none" stroke={C.white} strokeWidth={1.2} />
            <polygon points={rect(24, 112, 110, 14, z)} fill="none" stroke={C.mutedOnDark} strokeWidth={1.2} />
            {[0, 1, 2].map((k) => (
              <polygon key={k} points={rect(24 + k * 98, 190, 82, 100, z)} fill="none" stroke={C.mutedOnDark} strokeWidth={1.2} />
            ))}
            {top && done ? <polygon points={rect(24, 140, 76, 26, z)} fill={C.accent} /> : null}
          </g>
        );
      })}
      {/* construction guides */}
      {done
        ? [[0, 0], [W, 0], [W, D], [0, D]].map(([x, y], k) => (
            <polyline key={k} points={pts([[x, y, 0], [x, y, (LAYERS - 1) * 78]])} stroke={C.mutedOnDark} strokeWidth={1.4} strokeDasharray="7 5" fill="none" />
          ))
        : null}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Wireframe terrain, scrolling toward the camera                      */
/* ------------------------------------------------------------------ */
export const Terrain: React.FC<{ cy: number }> = ({ cy }) => {
  const frame = useCurrentFrame();
  const ROWS_N = 30;
  const COLS_N = 64;
  const speed = 0.045;
  const scroll = frame * speed;
  const base = Math.floor(scroll);
  const off = scroll - base;
  const height = (x: number, row: number) =>
    Math.sin(x * 2.3 + row * 0.55) * 0.3 + Math.sin(x * 5.1 - row * 0.9) * 0.12 + Math.sin(row * 0.31 + x) * 0.2;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
      {Array.from({ length: ROWS_N }, (_, i) => {
        const zz = (ROWS_N - 1 - i + off) * 0.14 + 0.32;
        const row = base + (ROWS_N - 1 - i);
        const f = 900 / zz;
        const points = Array.from({ length: COLS_N }, (_, c) => {
          const x = (c / (COLS_N - 1) - 0.5) * 6;
          const h = height(x, row);
          return `${960 + x * f * 0.5},${cy + (1.05 - h * 1.25) * f * 0.42}`;
        }).join(" ");
        const near = Math.min(1, 1.15 / zz);
        return <polyline key={i} points={points} fill="none" stroke={C.white} strokeWidth={1.3} opacity={0.12 + 0.55 * near} />;
      })}
    </svg>
  );
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */
export const Waveform: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", right: 120, bottom: 70, display: "flex", alignItems: "flex-end", gap: 4, height: 44 }}>
      {Array.from({ length: 70 }, (_, i) => (
        <div
          key={i}
          style={{
            width: 4,
            height: 6 + random(`wf${i}-${Math.floor(frame / 2)}`) * (10 + 30 * Math.abs(Math.sin(i * 0.19 + frame * 0.05))),
            background: C.unlit,
          }}
        />
      ))}
    </div>
  );
};

export const Star: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
    <path d="M12 1.5 C12.9 7.6 16.4 11.1 22.5 12 C16.4 12.9 12.9 16.4 12 22.5 C11.1 16.4 7.6 12.9 1.5 12 C7.6 11.1 11.1 7.6 12 1.5 Z" fill={color} />
  </svg>
);

/** Bottom-left capability title: mono eyebrow + one big line, as in the Studios system. */
export const CapTitle: React.FC<{ n: string; label: string; title: string; at: number; color: string; muted: string }> = ({
  n,
  label,
  title,
  at,
  color,
  muted,
}) => {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [b(at), b(at) + 8], [0, 1], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return (
    <div style={{ position: "absolute", left: 120, bottom: 96, opacity: p, translate: `0px ${(1 - p) * 40}px`, filter: `blur(${(1 - p) * 12}px)` }}>
      <div style={{ fontFamily: "JetBrains Mono Var", fontWeight: 800, fontSize: 24, letterSpacing: "0.14em", color: muted, marginBottom: 18 }}>
        {n} / {label}
      </div>
      <div style={{ fontFamily: "Manrope", fontWeight: 800, fontSize: 118, lineHeight: 0.9, letterSpacing: "-0.05em", whiteSpace: "nowrap", color }}>
        {title}
      </div>
    </div>
  );
};
