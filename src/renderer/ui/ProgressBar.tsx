/** A thin bar. The value is clamped to 0..max. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const clamped = Math.min(Math.max(value, 0), Math.max(max, 0))
  const pct = max > 0 ? (clamped / max) * 100 : 0
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={clamped}>
      <div className="progress__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
