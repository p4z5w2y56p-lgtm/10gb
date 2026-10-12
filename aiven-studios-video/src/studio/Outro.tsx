import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  staticFile,
} from "remotion";
import { JBMONO, MANROPE } from "../fonts";
import { OUT, OUT3, Vignette, clamp, tw, useTime } from "../fx";
import { BEAT } from "../timeline";
import { C, Eyebrow, MaskLine, headline, mono, useStage } from "./brand";

/** The hero returns once: the black hole in the silence, then SHAPING / THE / INEVITABLE. on the returning kicks. */
export const Slogan: React.FC<{ dur: number }> = ({ dur }) => {
  const t = useTime();
  const { W, H, V } = useStage();
  const size = V ? 168 : 210;
  const reveal = tw(t, 0, 0.6, 0, 1, OUT);
  const textOn = tw(t, 2 * BEAT - 0.1, 2 * BEAT + 0.3, 0, 1, OUT3);
  const push = interpolate(t, [0, dur], [1.06, 1.16], clamp);
  return (
    <AbsoluteFill style={{ background: C.black }}>
      <AbsoluteFill
        style={{
          opacity: reveal * (1 - 0.45 * textOn),
          transform: `scale(${push})`,
          filter: reveal < 0.99 ? `blur(${(1 - reveal) * 16}px)` : undefined,
        }}
      >
        <OffthreadVideo
          src={staticFile(
            V ? "brand/blackhole-vertical.mp4" : "brand/blackhole.mp4",
          )}
          muted
          style={{ width: W, height: H }}
        />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: V ? 210 : 150,
          textAlign: "center",
          ...mono(V ? 26 : 22),
          opacity: reveal,
        }}
      >
        AIVEN // THE INEVITABLE
      </div>
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <MaskLine at={2 * BEAT}>
          <div style={headline(size, C.white)}>SHAPING</div>
        </MaskLine>
        <MaskLine at={3 * BEAT}>
          <div style={headline(size, C.white)}>THE</div>
        </MaskLine>
        <MaskLine at={4 * BEAT}>
          <div style={headline(size, C.white)}>INEVITABLE.</div>
        </MaskLine>
      </AbsoluteFill>
      <Vignette strength={0.5} />
    </AbsoluteFill>
  );
};

/** 06 / KOM PRATEN — one view, one action: the pill is pressed on the last kick before the logo. */
export const CallToAction: React.FC<{ dur: number }> = () => {
  const t = useTime();
  const { V } = useStage();
  const pillIn = tw(t, 2 * BEAT, 2 * BEAT + 0.3, 0, 1, OUT);
  const press = 4 * BEAT;
  const pressed = t >= press;
  const squash = pressed ? 1 - 0.05 * Math.exp(-(t - press) / 0.08) : 1;
  const pill = (fs: number, pad: string, gap: number) => (
    <div
      style={{
        padding: pad,
        borderRadius: 100,
        background: pressed ? C.accent : C.ink,
        color: pressed ? C.ink : C.paper,
        fontFamily: MANROPE,
        fontWeight: 800,
        fontSize: fs,
        letterSpacing: "0.02em",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
        transform: `scale(${squash})`,
        display: "flex",
        alignItems: "center",
        gap,
      }}
    >
      START
      <svg
        width={fs}
        height={fs}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 12h15M13 6l6 6-6 6" />
      </svg>
    </div>
  );
  if (V) {
    // portrait: headline, services, pill + url stacked on one left edge; founders above the TikTok caption zone
    return (
      <AbsoluteFill style={{ background: C.paper }}>
        <div style={{ position: "absolute", left: 84, top: 250 }}>
          <Eyebrow n="06" label="VOLGENDE STAP" color={C.mutedOnPaper} size={28} />
        </div>
        <div style={{ position: "absolute", left: 66, top: 320 }}>
          <MaskLine at={0.02}>
            <div style={headline(220, C.ink)}>KOM</div>
          </MaskLine>
          <MaskLine at={0.08}>
            <div style={headline(220, C.ink)}>PRATEN.</div>
          </MaskLine>
          <MaskLine at={BEAT} dur={0.5}>
            <div
              style={{
                fontFamily: MANROPE,
                fontWeight: 300,
                fontSize: 46,
                lineHeight: 1.45,
                color: C.mutedOnPaper,
                marginTop: 36,
                marginLeft: 12,
              }}
            >
              AI-integratie.
              <br />
              Automatisering.
              <br />
              Websites.
            </div>
          </MaskLine>
        </div>
        <div
          style={{
            position: "absolute",
            left: 84,
            top: 1200,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 40,
            opacity: pillIn,
            transform: `translateY(${(1 - pillIn) * 40}px)`,
          }}
        >
          {pill(44, "36px 66px", 24)}
          <div
            style={{
              fontFamily: JBMONO,
              fontWeight: 800,
              fontSize: 44,
              letterSpacing: "0.06em",
              color: C.ink,
              marginLeft: 4,
            }}
          >
            AIVENSTUDIOS.COM
          </div>
        </div>
        <div
          style={{
            position: "absolute",
            left: 88,
            top: 1460,
            ...mono(24, C.mutedOnPaper, 400),
            lineHeight: 1.6,
            opacity: tw(t, 3 * BEAT, 3 * BEAT + 0.3, 0, 1, OUT3),
          }}
        >
          MATTHIJS VAN HOORN / MARK WAAIJENBERG
          <br />
          AIVEN STUDIOS V.O.F.
        </div>
      </AbsoluteFill>
    );
  }
  return (
    <AbsoluteFill style={{ background: C.paper }}>
      <div style={{ position: "absolute", left: 150, top: 200 }}>
        <Eyebrow n="06" label="VOLGENDE STAP" color={C.mutedOnPaper} />
      </div>
      <div style={{ position: "absolute", left: 140, top: 270 }}>
        <MaskLine at={0.02}>
          <div style={headline(250, C.ink)}>KOM PRATEN.</div>
        </MaskLine>
        <MaskLine at={BEAT} dur={0.5}>
          <div
            style={{
              fontFamily: MANROPE,
              fontWeight: 300,
              fontSize: 40,
              lineHeight: 1.8,
              color: C.mutedOnPaper,
              marginTop: 18,
            }}
          >
            AI-integratie. Automatisering. Websites.
          </div>
        </MaskLine>
      </div>
      <div
        style={{
          position: "absolute",
          left: 150,
          top: 720,
          display: "flex",
          alignItems: "center",
          gap: 44,
          opacity: pillIn,
          transform: `translateY(${(1 - pillIn) * 40}px)`,
        }}
      >
        {pill(34, "30px 56px", 20)}
        <div
          style={{
            fontFamily: JBMONO,
            fontWeight: 800,
            fontSize: 34,
            letterSpacing: "0.06em",
            color: C.ink,
          }}
        >
          AIVENSTUDIOS.COM
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 150,
          bottom: 110,
          ...mono(20, C.mutedOnPaper, 400),
          opacity: tw(t, 3 * BEAT, 3 * BEAT + 0.3, 0, 1, OUT3),
        }}
      >
        MATTHIJS VAN HOORN / MARK WAAIJENBERG — AIVEN STUDIOS V.O.F.
      </div>
    </AbsoluteFill>
  );
};

/** Hard cut to black: official monogram + wordmark (white on dark, per the logo rules) and a silent hold. */
export const LogoEnd: React.FC<{ dur: number }> = () => {
  const t = useTime();
  const { V } = useStage();
  const mw = V ? 400 : 360;
  const ww = V ? 860 : 980;
  const settle = tw(t, 0, 0.5, 1.03, 1, OUT);
  return (
    <AbsoluteFill
      style={{
        background: "#000",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: V ? 80 : 64,
          transform: `scale(${settle})`,
        }}
      >
        <Img
          src={staticFile("brand/monogram-white.png")}
          style={{ width: mw, height: (mw * 1118) / 1415 }}
        />
        <Img
          src={staticFile("brand/wordmark-white.png")}
          style={{ width: ww, height: (ww * 295) / 1948 }}
        />
      </div>
    </AbsoluteFill>
  );
};
