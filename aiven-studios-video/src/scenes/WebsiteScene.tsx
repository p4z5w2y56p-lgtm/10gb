import React from "react";
import { AbsoluteFill, Easing, Interactive, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { ServiceHeader } from "../components/ServiceHeader";
import { CLICK_AT, SiteMock } from "../components/SiteMock";
import "../fonts";

const URL_TEXT = "jouwmerk.nl";

export const WebsiteScene: React.FC = () => {
  const frame = useCurrentFrame();
  const url = URL_TEXT.slice(0, Math.max(0, Math.floor((frame - 140) * 0.5)));

  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("audio/whoosh.wav")} from={30} volume={0.45} />
      <Audio src={staticFile("audio/keys.wav")} from={140} volume={0.4} />
      <Audio src={staticFile("audio/click.wav")} from={CLICK_AT} volume={0.8} />
      <Audio src={staticFile("audio/whoosh.wav")} from={280} volume={0.4} />

      <ServiceHeader
        label="03 / WEBSITES"
        headline="Sites die converteren."
        body="Snel. Strak. Gebouwd om te verkopen."
      />

      <Interactive.Div
        name="Browser"
        style={{
          position: "absolute",
          left: 250,
          top: 280,
          width: 1160,
          height: 650,
          borderRadius: 30,
          overflow: "hidden",
          background: "#0B0B0D",
          border: "1.5px solid rgba(250,250,250,0.16)",
          boxShadow: "0 10px 30px rgba(0,0,0,0.15)",
          opacity: interpolate(frame, [120, 150], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [120, 165], ["0px 200px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0, 0, 0.2, 1),
          }),
          filter: `blur(${interpolate(frame, [120, 160], [12, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })}px)`,
        }}
      >
        <div
          style={{
            height: 66,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "0 28px",
            fontFamily: "JetBrains Mono",
            fontWeight: 500,
            fontSize: 22,
            color: "#FAFAFA",
          }}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid rgba(250,250,250,0.4)" }} />
          ))}
          <div
            style={{
              marginLeft: 200,
              width: 480,
              height: 40,
              borderRadius: 100,
              border: "1.5px solid rgba(250,250,250,0.14)",
              display: "flex",
              alignItems: "center",
              padding: "0 22px",
            }}
          >
            https://{url}
          </div>
        </div>
        <SiteMock />
      </Interactive.Div>

      <Interactive.Div
        name="Phone"
        style={{
          position: "absolute",
          left: 1380,
          top: 360,
          width: 290,
          height: 580,
          borderRadius: 50,
          padding: 12,
          background: "#0B0B0D",
          border: "1.5px solid rgba(250,250,250,0.25)",
          opacity: interpolate(frame, [280, 300], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: interpolate(frame, [280, 325], ["300px 60px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
          rotate: interpolate(frame, [280, 325], ["12deg", "0deg"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 40,
            background: "#F7F7F9",
            padding: "64px 24px 0",
            display: "flex",
            flexDirection: "column",
            gap: 20,
            fontFamily: "Manrope",
            fontWeight: 800,
            color: "#030303",
          }}
        >
          <div style={{ fontSize: 15, letterSpacing: "0.04em" }}>JOUW MERK</div>
          <div style={{ fontSize: 46, lineHeight: 0.9, letterSpacing: "-0.045em" }}>
            JOUW MERK.
            <br />
            <span style={{ color: "transparent", WebkitTextStroke: "1.5px #030303" }}>ONLINE.</span>
          </div>
          <div style={{ padding: "14px 0", borderRadius: 100, background: "#030303", color: "#F7F7F9", textAlign: "center", fontSize: 15, letterSpacing: "0.04em" }}>
            START PROJECT
          </div>
          <div style={{ height: 110, borderRadius: 24, background: "#FFFFFF", border: "1.5px solid #E2E2E5" }} />
          <div style={{ height: 110, borderRadius: 24, background: "#FFFFFF", border: "1.5px solid #E2E2E5" }} />
        </div>
      </Interactive.Div>
    </AbsoluteFill>
  );
};
