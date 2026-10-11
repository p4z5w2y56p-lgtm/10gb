import React from "react";
import { AbsoluteFill, staticFile } from "remotion";
import { Audio } from "@remotion/media";
import { Background } from "../components/Background";
import { ServiceHeader } from "../components/ServiceHeader";
import { Terminal } from "../components/Terminal";
import "../fonts";

// 12 beats (+10 frames transition overlap). Statement beats 0–3, demo beats 4–11.
export const AiScene: React.FC = () => {
  return (
    <AbsoluteFill>
      <Background />
      <Audio src={staticFile("audio/whoosh.wav")} from={30} volume={0.45} />
      <Audio src={staticFile("audio/keys.wav")} from={150} volume={0.5} />
      <Audio src={staticFile("audio/keys.wav")} from={180} volume={0.5} />
      <Audio src={staticFile("audio/keys.wav")} from={210} volume={0.5} />
      <Audio src={staticFile("audio/keys.wav")} from={240} volume={0.5} />
      <Audio src={staticFile("audio/click.wav")} from={285} volume={0.6} />

      <ServiceHeader
        label="01 / AI-INTEGRATIE"
        headline="AI in jouw systemen."
        body="Assistenten die je CRM, mail en agenda kennen."
      />

      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", paddingTop: 60 }}>
        <Terminal
          title="AIVEN // ASSISTENT"
          enterAt={120}
          lines={[
            { tag: "SCAN", text: "inbox — 48 nieuwe berichten", at: 150 },
            { tag: "GEVONDEN", text: "12 offerte-aanvragen herkend", at: 180 },
            { tag: "ACTIE", text: "3 met prioriteit naar het CRM", at: 210 },
            { tag: "RESULTAAT", text: "klanten beantwoord binnen 40s", at: 240 },
            { tag: "STATUS", text: "ALL SYSTEMS NOMINAL.", at: 285 },
          ]}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
