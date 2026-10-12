import React from "react";
import { Img, staticFile } from "remotion";

// Official AIVEN STUDIOS marks as supplied (Stijlgids §10): never recoloured or redrawn.
// White files on dark grounds, black files on paper.
const MARKS = {
  monogram: { aspect: 1415 / 1118 },
  wordmark: { aspect: 1948 / 295 },
} as const;

export const BrandLogo: React.FC<{
  mark: keyof typeof MARKS;
  width: number;
  onDark?: boolean;
}> = ({ mark, width, onDark = true }) => {
  return (
    <Img
      src={staticFile(`brand/${mark}-${onDark ? "white" : "black"}.png`)}
      style={{ width, height: width / MARKS[mark].aspect, display: "block" }}
    />
  );
};
