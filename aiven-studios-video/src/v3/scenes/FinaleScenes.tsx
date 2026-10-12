import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { b, C } from "../brand";
import { Ground } from "../components/Ground";
import { Corners, PillButton } from "../components/Panels";
import { ScrambleLabel } from "../components/ScrambleLabel";
import { CapTitle, Star, Terrain } from "../components/Visuals";
import "../../fonts";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (frame: number, a: number, z: number, from = 0, to = 1) =>
  interpolate(frame, [a, z], [from, to], { ...clamp, easing: Easing.bezier(0.16, 1, 0.3, 1) });

/** Two bands sliding past: filled services, then the promise in grey. 2 beats. */
export const Marquee: React.FC = () => {
  const frame = useCurrentFrame();
  const item = (text: string, color: string, key: number) => (
    <div key={key} style={{ display: "flex", alignItems: "center", gap: 48, marginRight: 48 }}>
      <span>{text}</span>
      <Star size={64} color={color} />
    </div>
  );
  const band = (words: string[], color: string): React.ReactNode[] =>
    Array.from({ length: 4 }, (_, r) => words.map((w, i) => item(w, color, r * 10 + i))).flat();
  return (
    <Ground theme="paper" label="AIVEN // STACK" counter="03 / 03">
      <div style={{ position: "absolute", left: 0, right: 0, top: 330, height: 150, background: C.ink, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", whiteSpace: "nowrap", fontFamily: "Manrope", fontWeight: 800, fontSize: 104, letterSpacing: "-0.04em", color: C.paper, translate: `${-frame * 15 - 100}px 0px` }}>
          {band(["AI", "AUTOMATISERING", "WEBSITES"], C.paper)}
        </div>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 540, height: 150, overflow: "hidden", display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", whiteSpace: "nowrap", fontFamily: "Manrope", fontWeight: 800, fontSize: 104, letterSpacing: "-0.04em", color: "#b4b4ba", translate: `${frame * 15 - 2400}px 0px` }}>
          {band(["SNEL", "STRAK", "SCHAALBAAR"], "#b4b4ba")}
        </div>
      </div>
    </Ground>
  );
};

/** Wireframe terrain, reticle shrinks and locks red. 4 beats. */
export const Precision: React.FC = () => {
  const frame = useCurrentFrame();
  const w = ease(frame, 0, b(2.6), 1100, 360);
  const h = ease(frame, 0, b(2.6), 640, 230);
  const cx = ease(frame, 0, b(2.6), 960, 1280);
  const cy = ease(frame, 0, b(2.6), 400, 330);
  const locked = frame >= b(2.8);
  return (
    <Ground theme="black" label="AIVEN // TARGETING" counter="03 / 03">
      <Terrain cy={470} />
      <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0, opacity: 0.35 }}>
        <line x1={cx} y1={0} x2={cx} y2={760} stroke={C.white} strokeWidth={1.5} />
        <line x1={0} y1={cy} x2={1920} y2={cy} stroke={C.white} strokeWidth={1.5} />
      </svg>
      <div style={{ position: "absolute", left: cx - w / 2, top: cy - h / 2 }}>
        <Corners w={w} h={h} color={locked ? C.accent : C.white} />
      </div>
      {locked ? (
        <div style={{ position: "absolute", left: cx + w / 2 + 24, top: cy - 50 }}>
          <ScrambleLabel text="DOEL VERGRENDELD" delay={b(2.8)} fontSize={22} weight={500} color={C.white} />
          <ScrambleLabel text="0 ONNODIGE RUIS" delay={b(2.9)} fontSize={22} weight={500} color={C.mutedOnDark} />
        </div>
      ) : null}
      <CapTitle n="003" label="TARGETING" title="PRECISIE." at={1} color={C.white} muted={C.mutedOnDark} />
    </Ground>
  );
};

const ARROW = "M0 120 H600 V20 L900 180 L600 340 V240 H0 Z M80 150 H200 V210 H80 Z M240 150 H360 V210 H240 Z M400 150 H520 V210 H400 Z";

/** The one solid glyph: a red launch arrow crosses, then the horizon grid and a T-minus. 4 beats. */
export const Launch: React.FC = () => {
  const frame = useCurrentFrame();
  const split = b(2);
  const arrowX = interpolate(frame, [0, b(1.7)], [-1000, 1050], { ...clamp, easing: Easing.bezier(0.3, 0, 0.1, 1) });
  const t = interpolate(frame, [split, b(4)], [8, 0], clamp);
  return (
    <Ground theme="black" label="AIVEN // LANCERING" counter="05 / 06">
      {frame < split ? (
        <>
          <svg width={900} height={360} viewBox="0 0 900 360" style={{ position: "absolute", left: arrowX, top: 560 }}>
            <path fillRule="evenodd" fill={C.accent} d={ARROW} />
          </svg>
          <div style={{ position: "absolute", right: 120, top: 150, fontFamily: "Manrope", fontWeight: 800, fontSize: 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.white, opacity: ease(frame, 0, 8), translate: `0px ${(1 - ease(frame, 0, 8)) * 40}px` }}>
            LANCEER.
          </div>
        </>
      ) : (
        <>
          <svg width={1920} height={1080} style={{ position: "absolute", left: 0, top: 0 }}>
            {Array.from({ length: 22 }, (_, i) => {
              const y = 540 + Math.pow((i + ((frame * 0.05) % 1)) / 22, 2.2) * 540;
              return <line key={i} x1={0} y1={y} x2={1920} y2={y} stroke={C.white} strokeWidth={1.2} opacity={0.1 + 0.4 * (i / 22)} />;
            })}
            {Array.from({ length: 31 }, (_, i) => (
              <line key={i} x1={960} y1={540} x2={960 + (i - 15) * 260} y2={1080} stroke={C.white} strokeWidth={1.2} opacity={0.22} />
            ))}
            <rect x={0} y={538} width={1920} height={2} fill={C.white} opacity={0.6} />
          </svg>
          <AbsoluteFill style={{ background: `radial-gradient(ellipse 40% 12% at 50% 50%, rgba(247,247,249,${ease(frame, split, b(4), 0.05, 0.4)}), transparent)` }} />
          <div style={{ position: "absolute", left: 0, right: 0, top: 150, textAlign: "center", fontFamily: "JetBrains Mono Var", fontWeight: 500, fontSize: 24, letterSpacing: "0.14em", color: C.white }}>
            LAUNCH SEQUENCE // T-{t.toFixed(2).padStart(5, "0")}
          </div>
          <div style={{ position: "absolute", left: 0, right: 0, top: 300, textAlign: "center", fontFamily: "Manrope", fontWeight: 800, fontSize: 210, lineHeight: 0.9, letterSpacing: "-0.05em", color: C.white, opacity: ease(frame, split, split + 8), translate: `0px ${(1 - ease(frame, split, split + 8)) * 40}px` }}>
            AIVEN.
          </div>
        </>
      )}
    </Ground>
  );
};

/** SHAPING / THE / INEVITABLE. over the black hole, one word per beat. 6 beats. */
export const SloganHole: React.FC = () => {
  const frame = useCurrentFrame();
  const words = ["SHAPING", "THE", "INEVITABLE."];
  return (
    <Ground theme="black" label="AIVEN // HET ONVERMIJDELIJKE" counter="06 / 06">
      <Img
        src={staticFile("brand/blackhole-still.jpg")}
        style={{ position: "absolute", inset: 0, width: 1920, height: 1080, opacity: 0.55, scale: String(ease(frame, 0, b(6), 1.35, 1.05)) }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        {words.map((text, i) => {
          const p = ease(frame, b(i), b(i) + 8);
          return (
            <div
              key={text}
              style={{ fontFamily: "Manrope", fontWeight: 800, fontSize: 210, lineHeight: 0.89, letterSpacing: "-0.055em", color: C.white, opacity: p, translate: `0px ${(1 - p) * 40}px`, filter: `blur(${(1 - p) * 12}px)` }}
            >
              {text}
            </div>
          );
        })}
      </AbsoluteFill>
    </Ground>
  );
};

/** LATEN WE PRATEN. + lead, pill (pressed = the one red), url, founders. 8 beats. */
export const Cta: React.FC = () => {
  const frame = useCurrentFrame();
  const word = (at: number) => ease(frame, b(at), b(at) + 8);
  const pill = ease(frame, b(2.5), b(2.5) + 12);
  return (
    <Ground theme="paper" label="AIVEN // VOLGENDE STAP" counter="06 / 06">
      <AbsoluteFill style={{ justifyContent: "center", paddingLeft: 150 }}>
        {["LATEN WE", "PRATEN."].map((text, i) => (
          <div
            key={text}
            style={{ fontFamily: "Manrope", fontWeight: 800, fontSize: 300, lineHeight: 0.9, letterSpacing: "-0.05em", whiteSpace: "nowrap", color: C.ink, opacity: word(i), translate: `0px ${(1 - word(i)) * 40}px`, filter: `blur(${(1 - word(i)) * 12}px)` }}
          >
            {text}
          </div>
        ))}
        <div style={{ marginTop: 28, fontFamily: "Manrope", fontWeight: 300, fontSize: 46, color: C.mutedOnPaper, opacity: word(2) }}>
          AI-integratie. Automatisering. Websites.
        </div>
        <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 40 }}>
          <div style={{ opacity: pill, scale: String(0.8 + 0.2 * pill), transformOrigin: "0% 50%" }}>
            <PillButton label="PLAN EEN GESPREK" pressed={frame >= b(5)} />
          </div>
          <ScrambleLabel text="AIVENSTUDIOS.COM" delay={b(3.5)} fontSize={44} color={C.ink} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 150, bottom: 70 }}>
        <ScrambleLabel text="MATTHIJS VAN HOORN / MARK WAAIJENBERG - AIVEN STUDIOS V.O.F." delay={b(6)} fontSize={20} weight={500} color={C.mutedOnPaper} />
      </div>
    </Ground>
  );
};
