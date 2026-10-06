import { describe, expect, it } from 'vitest'
import { checkUrl, isPublicIp, safeLookup } from '../../src/main/safety/ssrf'

describe('isPublicIp', () => {
  it.each(['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'treats %s as public',
    (ip) => expect(isPublicIp(ip)).toBe(true),
  )

  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '192.168.0.1',
    '172.16.0.1',
    '172.31.255.255',
    '169.254.169.254',
    '100.64.0.1',
    '224.0.0.1',
    '240.0.0.1',
    '::',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:10.0.0.1',
    '2001:db8::1',
    'not-an-ip',
  ])('treats %s as not public', (ip) => expect(isPublicIp(ip)).toBe(false))

  it('does not over-block neighbours of private ranges', () => {
    expect(isPublicIp('172.15.0.1')).toBe(true)
    expect(isPublicIp('172.32.0.1')).toBe(true)
    expect(isPublicIp('100.63.0.1')).toBe(true)
  })
})

describe('checkUrl', () => {
  const resolveTo = (...ips: string[]) => async () => ips

  it('rejects non-http schemes', async () => {
    expect((await checkUrl('ftp://example.com/x')).ok).toBe(false)
    expect((await checkUrl('file:///etc/passwd')).ok).toBe(false)
  })

  it('rejects credentials in the URL', async () => {
    expect((await checkUrl('http://user:pw@example.com', resolveTo('93.184.216.34'))).ok).toBe(false)
  })

  it('rejects a hostname that resolves to a private address', async () => {
    expect((await checkUrl('http://intranet.test/', resolveTo('10.1.2.3'))).ok).toBe(false)
  })

  it('rejects when any resolved address is private', async () => {
    expect((await checkUrl('http://mixed.test/', resolveTo('93.184.216.34', '127.0.0.1'))).ok).toBe(false)
  })

  it('rejects the cloud metadata address and numeric tricks', async () => {
    expect((await checkUrl('http://169.254.169.254/latest/meta-data')).ok).toBe(false)
    expect((await checkUrl('http://2130706433/')).ok).toBe(false)
    expect((await checkUrl('http://[::1]:8080/')).ok).toBe(false)
  })

  it('rejects an unresolvable host', async () => {
    expect((await checkUrl('http://nope.test/', resolveTo())).ok).toBe(false)
  })

  it('accepts a public host', async () => {
    const r = await checkUrl('https://example.com/page?q=1', resolveTo('93.184.216.34'))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.url.hostname).toBe('example.com')
  })
})

describe('safeLookup', () => {
  it('refuses loopback results', async () => {
    const err = await new Promise<Error | null>((res) =>
      safeLookup('localhost', {}, (e) => res(e as Error | null)),
    )
    expect(err).toBeTruthy()
  })

  it('passes a public literal address through', async () => {
    const addr = await new Promise<string>((res, rej) =>
      safeLookup('8.8.8.8', {}, (e, a) => (e ? rej(e) : res(a as string))),
    )
    expect(addr).toBe('8.8.8.8')
  })
})
