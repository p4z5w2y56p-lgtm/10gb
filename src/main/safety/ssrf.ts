import dns from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'

function v4Parts(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  return parts.every((p) => p <= 255) ? parts : null
}

function publicV4([a, b, c]: number[]): boolean {
  if (a === 0 || a === 10 || a === 127) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 0 && c === 0) return false
  if (a === 192 && b === 168) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a >= 224) return false
  return true
}

/** Expand an IPv6 address into 8 hextets, or null when malformed. */
function v6Hextets(ip: string): number[] | null {
  let s = ip.split('%')[0]
  const tail = s.lastIndexOf(':')
  const v4 = v4Parts(s.slice(tail + 1))
  if (v4) {
    s = `${s.slice(0, tail + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - head.length - rest.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest]
  const nums = all.map((h) => parseInt(h, 16))
  return nums.length === 8 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? nums : null
}

/** True only for globally routable addresses (no loopback, private, link-local, multicast, reserved). */
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return publicV4(v4Parts(ip)!)
  if (family !== 6) return false
  const h = v6Hextets(ip)
  if (!h) return false
  if (h.every((x) => x === 0)) return false
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return false
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) {
    return publicV4([h[6] >> 8, h[6] & 255, h[7] >> 8, h[7] & 255])
  }
  if (h.slice(0, 6).every((x) => x === 0)) return false
  if ((h[0] & 0xfe00) === 0xfc00) return false
  if ((h[0] & 0xffc0) === 0xfe80) return false
  if ((h[0] & 0xff00) === 0xff00) return false
  if (h[0] === 0x2001 && h[1] === 0x0db8) return false
  return true
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

async function systemResolve(host: string): Promise<string[]> {
  const found = await dns.promises.lookup(host, { all: true })
  return found.map((f) => f.address)
}

/** Validate a URL before fetching: http(s) only, no credentials, every resolved address public. */
export async function checkUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = systemResolve,
): Promise<UrlCheck> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: `Not a valid URL: ${raw}` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `Only http and https URLs can be fetched, not ${url.protocol}` }
  }
  if (url.username || url.password) return { ok: false, reason: 'URLs with embedded credentials are not allowed' }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) {
    addresses = [host]
  } else {
    try {
      addresses = await resolve(host)
    } catch {
      return { ok: false, reason: `Could not resolve ${host}` }
    }
  }
  if (addresses.length === 0) return { ok: false, reason: `Could not resolve ${host}` }
  const bad = addresses.find((a) => !isPublicIp(a))
  if (bad) return { ok: false, reason: `${host} points to a non-public address (${bad})` }
  return { ok: true, url }
}

/** `connect.lookup` for undici: resolves like the OS, then refuses non-public results (blocks DNS rebinding). */
export const safeLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err, address as never, family as never)
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address as string]
    const bad = list.find((a) => !isPublicIp(a))
    if (bad) {
      return callback(
        Object.assign(new Error(`Blocked non-public address ${bad} for ${hostname}`), { code: 'EBLOCKED' }),
        address as never,
        family as never,
      )
    }
    callback(null, address as never, family as never)
  })
}
