import React from "react";
import { C } from "../brand";
import { BrandLogo } from "../components/BrandLogo";
import { Ground } from "../components/Ground";
import { Statement } from "../components/Statement";
import "../../fonts";

// Scene lengths are in beats of the track (129.59 BPM). Copy: Dutch, uppercase, full stops.

/** The manifest: four lines, one per beat; the red full stop lands on GROEI. 4 beats. */
export const Manifest: React.FC = () => (
  <Ground theme="paper" label="AIVEN // MANIFEST" counter="01 / 06">
    <Statement
      theme="paper"
      eyebrow="01 / MANIFEST"
      size={200}
      lines={[
        { text: "Minder", at: 0, muted: true },
        { text: "handwerk.", at: 1, muted: true },
        { text: "Meer", at: 2 },
        { text: "groei.", at: 3, accentDot: true },
      ]}
    />
  </Ground>
);

export const EndCard: React.FC = () => (
  <div style={{ position: "absolute", inset: 0, background: C.black, display: "flex", justifyContent: "center", alignItems: "center" }}>
    {/* Wordmark alone, centred, silent hold. */}
    <BrandLogo mark="wordmark" width={1100} />
  </div>
);
