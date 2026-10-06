const MARK = '[REDACTED]'

const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /AIza[0-9A-Za-z_-]{35}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
]

const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Strip API keys, tokens, private keys and any exact `secrets` from text. */
export function redact(text: string, secrets: string[] = []): string {
  let out = text
  for (const re of PATTERNS) out = out.replace(re, MARK)
  out = out.replace(BEARER, `$1${MARK}`)
  for (const secret of secrets) {
    if (secret.length < 8) continue
    out = out.replace(new RegExp(escapeRegExp(secret), 'g'), MARK)
  }
  return out
}
