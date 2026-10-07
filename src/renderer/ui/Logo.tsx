/** The ARC mark: two nested arcs, orange outside and cyan inside, on a dark rounded square. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="AIVEN ARC">
      <rect className="logo__bg" x="1" y="1" width="46" height="46" rx="13" />
      <path className="logo__arc logo__arc--outer" d="M9 31a15 15 0 0 1 30 0" />
      <path className="logo__arc logo__arc--inner" d="M17 31a7 7 0 0 1 14 0" />
      <circle className="logo__dot" cx="24" cy="34.5" r="2.2" />
    </svg>
  )
}

/** AIVEN as a small mono eyebrow over ARC in Inter 800. */
export function Wordmark() {
  return (
    <span className="wordmark">
      <span className="wordmark__top">AIVEN</span>
      <span className="wordmark__main">ARC</span>
    </span>
  )
}
