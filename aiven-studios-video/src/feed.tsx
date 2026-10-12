import React, { useMemo } from "react";
import { Img, random, staticFile } from "remotion";

// A wall of generic social-feed cards (no real brands), used as "screen footage".

type Media = { src: string; pos: string; ratio: number; zoom: number };
type Card = { h: number; media?: Media; lines: number[]; avatar: number; name: number; likes: number };

const PLATES = [
  { src: "tex/crowd.jpg" },
  { src: "tex/city.jpg" },
  { src: "tex/eye_gray.png" },
];

const CARD_W = 420;
const GAP = 26;

const makeColumn = (seed: string, count: number): { cards: Card[]; y: number[] } => {
  const cards: Card[] = [];
  const y: number[] = [];
  let acc = random(`${seed}-off`) * -300;
  for (let i = 0; i < count; i++) {
    const r = (k: string) => random(`${seed}-${i}-${k}`);
    const hasMedia = r("m") < 0.68;
    const ratio = [1, 1.25, 0.5625, 1][Math.floor(r("ratio") * 4)];
    const media = hasMedia
      ? {
          src: staticFile(PLATES[Math.floor(r("p") * PLATES.length)].src),
          pos: `${Math.round(r("px") * 100)}% ${Math.round(r("py") * 100)}%`,
          ratio,
          zoom: 1 + r("z") * 1.6,
        }
      : undefined;
    const lines = Array.from({ length: hasMedia ? 1 + Math.floor(r("l") * 2) : 3 + Math.floor(r("l") * 3) }, (_, k) =>
      k === 0 ? 0.6 + r(`w${k}`) * 0.38 : 0.35 + r(`w${k}`) * 0.6,
    );
    const h = 76 + (media ? (CARD_W - 28) * media.ratio + 14 : 0) + lines.length * 26 + 60;
    cards.push({ h, media, lines, avatar: r("a"), name: 0.3 + r("n") * 0.25, likes: 0.12 + r("lk") * 0.12 });
    y.push(acc);
    acc += h + GAP;
  }
  return { cards, y };
};

const Heart = () => (
  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#8a919c" strokeWidth={2}>
    <path d="M12 21s-7.5-4.6-9.3-9.2C1.4 8.4 3.6 5 7 5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.4 0 5.6 3.4 4.3 6.8C19.5 16.4 12 21 12 21z" />
  </svg>
);
const Bubble = () => (
  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#8a919c" strokeWidth={2}>
    <path d="M4 5h16v11H9l-5 4z" />
  </svg>
);
const Send = () => (
  <svg width={26} height={26} viewBox="0 0 24 24" fill="none" stroke="#8a919c" strokeWidth={2}>
    <path d="M3 11l18-8-7 18-2-8z" />
  </svg>
);

const CardView: React.FC<{ c: Card; top: number }> = ({ c, top }) => (
  <div
    style={{
      position: "absolute",
      top,
      left: 0,
      width: CARD_W,
      height: c.h,
      borderRadius: 18,
      background: "#15181d",
      border: "1px solid #23272e",
      overflow: "hidden",
      padding: 14,
      boxSizing: "border-box",
    }}
  >
    <div style={{ display: "flex", alignItems: "center", gap: 12, height: 48 }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          background: `hsl(210 8% ${22 + c.avatar * 30}%)`,
          flexShrink: 0,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ width: `${c.name * 100}%`, height: 12, borderRadius: 6, background: "#6b727d", marginBottom: 8 }} />
        <div style={{ width: `${c.name * 60}%`, height: 9, borderRadius: 5, background: "#3c424b" }} />
      </div>
      <div style={{ color: "#5d646e", fontSize: 26, letterSpacing: 2, fontFamily: "sans-serif" }}>···</div>
    </div>
    <div style={{ height: 14 }} />
    {c.media ? (
      <div
        style={{
          width: "100%",
          height: (CARD_W - 28) * c.media.ratio,
          borderRadius: 10,
          overflow: "hidden",
          marginBottom: 14,
          background: "#222",
        }}
      >
        <Img
          src={c.media.src}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: c.media.pos,
            transform: `scale(${c.media.zoom})`,
            filter: "grayscale(1) contrast(1.15)",
          }}
        />
      </div>
    ) : null}
    {c.lines.map((w, i) => (
      <div key={i} style={{ width: `${w * 100}%`, height: 12, borderRadius: 6, background: "#4a505a", marginBottom: 14 }} />
    ))}
    <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 6 }}>
      <Heart />
      <Bubble />
      <Send />
      <div style={{ width: `${c.likes * 100}%`, height: 10, borderRadius: 5, background: "#3c424b", marginLeft: "auto" }} />
    </div>
  </div>
);

/** Columns of cards; `scroll` is the content offset in px. Only visible cards are mounted. */
export const FeedWall: React.FC<{ scroll: number; seed?: string; columns?: number; speeds?: number[] }> = ({
  scroll,
  seed = "feed",
  columns = 4,
  speeds,
}) => {
  const cols = useMemo(
    () => Array.from({ length: columns }, (_, i) => makeColumn(`${seed}${i}`, 26)),
    [seed, columns],
  );
  const total = columns * CARD_W + (columns - 1) * GAP;
  return (
    <div style={{ position: "absolute", inset: 0, background: "#08090b", overflow: "hidden" }}>
      {cols.map((col, ci) => {
        const s = scroll * (speeds?.[ci] ?? 1) + ci * 137;
        return (
          <div
            key={ci}
            style={{ position: "absolute", top: 0, left: 960 - total / 2 + ci * (CARD_W + GAP), width: CARD_W, height: 1080 }}
          >
            {col.cards.map((c, i) => {
              const top = col.y[i] - s;
              if (top > 1200 || top + c.h < -120) return null;
              return <CardView key={i} c={c} top={top} />;
            })}
          </div>
        );
      })}
    </div>
  );
};
