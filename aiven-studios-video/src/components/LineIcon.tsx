import React from "react";

// Own line set (Stijlgids §9): 24px grid, 1.5px stroke, round caps/joins, no fills.
const PATHS: Record<string, React.ReactNode> = {
  lead: (
    <>
      <circle cx={9} cy={8} r={4} />
      <path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7" />
      <path d="M19 6v6M16 9h6" />
    </>
  ),
  cpu: (
    <>
      <rect x={6} y={6} width={12} height={12} rx={2} />
      <rect x={9.5} y={9.5} width={5} height={5} rx={1} />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  crm: (
    <>
      <ellipse cx={12} cy={5} rx={8} ry={3} />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
      <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  mail: (
    <>
      <rect x={2} y={4} width={20} height={16} rx={3} />
      <path d="M2 7l10 7 10-7" />
    </>
  ),
  check: (
    <>
      <circle cx={12} cy={12} r={10} />
      <path d="M7.5 12.5l3 3 6-6.5" />
    </>
  ),
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  terminal: (
    <>
      <rect x={3} y={5} width={18} height={14} rx={2.5} />
      <path d="M7 10l3 2-3 2M12.5 15H17" />
    </>
  ),
};

export const LineIcon: React.FC<{
  name: keyof typeof PATHS;
  size: number;
  color?: string;
}> = ({ name, size, color = "#FAFAFA" }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {PATHS[name]}
  </svg>
);
