import React from "react";
import { Easing, interpolate, useCurrentFrame } from "remotion";
import { C, Theme, themeText } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { Ground } from "../components/Ground";
import { Statement } from "../components/Statement";
import "../fonts";

// Scene lengths are in beats (168 BPM). Copy: Dutch, uppercase, full stops.

export const HookA: React.FC = () => (
  <Ground theme="black" label="AIVEN // BOOT" counter="00 / 06" grid>
    <Statement theme="black" eyebrow="00 / INITIALIZE" size={230} lines={[{ text: "Minder", at: 1 }, { text: "handwerk.", at: 2 }]} />
  </Ground>
);

export const HookB: React.FC = () => (
  <Ground theme="paper" label="AIVEN // POSITION" counter="00 / 06">
    <Statement theme="paper" size={330} lines={[{ text: "Meer", at: 0, muted: true }, { text: "groei.", at: 1, accentDot: true }]} />
  </Ground>
);

export const AiStatement: React.FC = () => (
  <Ground theme="paper" label="AIVEN // CAPABILITY" counter="01 / 03">
    <Statement
      theme="paper"
      eyebrow="01 / AI-INTEGRATIE"
      size={230}
      lines={[{ text: "AI die", at: 0 }, { text: "meewerkt.", at: 1 }]}
      lead="Assistenten die je CRM, mail en agenda kennen."
    />
  </Ground>
);

export const AutoStatement: React.FC = () => (
  <Ground theme="paper" label="AIVEN // CAPABILITY" counter="02 / 03">
    <Statement
      theme="paper"
      eyebrow="02 / AUTOMATISERING"
      size={210}
      lines={[{ text: "Alles", at: 0 }, { text: "automatisch.", at: 1 }]}
      lead="Repetitief werk draait voortaan vanzelf."
    />
  </Ground>
);

export const WebStatement: React.FC = () => (
  <Ground theme="black" label="AIVEN // CAPABILITY" counter="03 / 03" grid>
    <Statement
      theme="black"
      eyebrow="03 / WEBSITES"
      size={230}
      lines={[{ text: "Sites die", at: 0 }, { text: "verkopen.", at: 1 }]}
      lead="Snel, strak en gebouwd om te converteren."
    />
  </Ground>
);

export const Slogan: React.FC = () => (
  <Ground theme="black" label="AIVEN // SIGNAL" counter="06 / 06" grid>
    <Statement theme="black" size={230} lines={[{ text: "Shaping the", at: 0 }, { text: "inevitable.", at: 1 }]} />
  </Ground>
);

/** One word, one beat: the manifesto hits that flip the ground on every cut. */
const WordHit: React.FC<{ theme: Theme; word: string; counter: string }> = ({ theme, word, counter }) => {
  const frame = useCurrentFrame();
  return (
    <Ground theme={theme} label="AIVEN // MANIFESTO" counter={counter}>
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          fontFamily: "Manrope",
          fontWeight: 800,
          fontSize: 330,
          lineHeight: 0.9,
          letterSpacing: "-0.05em",
          whiteSpace: "nowrap",
          color: themeText(theme),
          scale: String(interpolate(frame, [0, 10], [1.12, 1], { extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) })),
          transformOrigin: "0% 50%",
          filter: `blur(${interpolate(frame, [0, 6], [12, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        {word}
      </div>
    </Ground>
  );
};

export const WordSlim: React.FC = () => <WordHit theme="black" word="SLIM." counter="04 / 06" />;
export const WordSnel: React.FC = () => <WordHit theme="paper" word="SNEL." counter="04 / 06" />;
export const WordOpMaat: React.FC = () => <WordHit theme="black" word="OP MAAT." counter="04 / 06" />;

export const EndCard: React.FC = () => (
  <div style={{ position: "absolute", inset: 0, background: C.black, display: "flex", justifyContent: "center", alignItems: "center" }}>
    {/* Wordmark alone, centred, silent hold. */}
    <BrandLogo mark="wordmark" width={1100} />
  </div>
);
