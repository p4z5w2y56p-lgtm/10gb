import React from "react";
import { RED } from "./fx";

/** The Aiven mark: a play button turned upright into an "A". */
export const AivenMark: React.FC<{ size: number; color?: string; holes?: number; style?: React.CSSProperties }> = ({
  size,
  color = RED,
  holes = 1,
  style,
}) => {
  // Outer triangle, counter (hole) and the gap between the legs scale in with `holes`.
  const c = 50;
  const counter = [
    [50, 60 - 24 * holes],
    [50 + 12.55 * holes, 60],
    [50 - 12.55 * holes, 60],
  ];
  const notchTop = 92 - 18 * holes;
  const nh = 6.5 * holes;
  const nb = nh + 9.4 * holes;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={style}>
      <path
        fillRule="evenodd"
        fill={color}
        d={`M${c} 4 L96 92 L4 92 Z M${counter[0][0]} ${counter[0][1]} L${counter[1][0]} ${counter[1][1]} L${counter[2][0]} ${counter[2][1]} Z M${50 - nh} ${notchTop} L${50 + nh} ${notchTop} L${50 + nb} 92 L${50 - nb} 92 Z`}
      />
    </svg>
  );
};
