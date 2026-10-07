const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const i = trimmed.lastIndexOf('/')
  if (i < 0) return ''
  return i === 0 ? '/' : trimmed.slice(0, i)
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then a short date. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, (now - t) / 1000)
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(secs / 3600)
  if (hours < 24) return `${hours} h ago`
  if (hours < 48) return 'yesterday'
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} days ago`
  const d = new Date(t)
  const sameYear = new Date(now).getUTCFullYear() === d.getUTCFullYear()
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${sameYear ? '' : ` ${d.getUTCFullYear()}`}`
}
