import React from "react";
import { getStaticFiles, Img, staticFile } from "remotion";

/**
 * Official AIVEN STUDIOS logo files only (Stijlgids §10): never redrawn.
 * Drop the files from Drive (Aiven assests / Logos) into public/brand/.
 * The supplied art is black ink; on a dark ground it is inverted to white.
 * Until a file exists, an empty hairline slot keeps its place.
 */
export const BrandLogo: React.FC<{
  file: "as-monogram.png" | "wordmark.png";
  width: number;
  height: number;
  onDark?: boolean;
}> = ({ file, width, height, onDark = true }) => {
  const available = getStaticFiles().some((f) => f.name === `brand/${file}`);

  if (!available) {
    return (
      <div
        style={{
          width,
          height,
          border: `2px dashed ${onDark ? "rgba(250,250,250,0.35)" : "rgba(3,3,3,0.35)"}`,
          borderRadius: 30,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "JetBrains Mono",
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: "0.12em",
          color: onDark ? "rgba(250,250,250,0.5)" : "rgba(3,3,3,0.5)",
          textTransform: "uppercase",
        }}
      >
        public/brand/{file}
      </div>
    );
  }

  return (
    <Img
      src={staticFile(`brand/${file}`)}
      style={{
        width,
        height,
        objectFit: "contain",
        filter: onDark ? "invert(1)" : undefined,
      }}
    />
  );
};
