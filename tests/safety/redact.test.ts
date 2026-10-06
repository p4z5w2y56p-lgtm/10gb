import { describe, expect, it } from 'vitest'
import { redact } from '../../src/main/safety/redact'

describe('redact', () => {
  it('redacts a Google API key shape', () => {
    const key = 'AIzaSy' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'
    expect(redact(`key=${key} done`)).toBe('key=[REDACTED] done')
  })

  it('redacts an sk- style token', () => {
    const tok = 'sk-' + 'abcdefghij0123456789ABCDEFGHIJ'
    expect(redact(`token ${tok}`)).toBe('token [REDACTED]')
  })

  it('redacts a whole PEM private key block', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\nabcdef\n-----END PRIVATE KEY-----'
    expect(redact(`before\n${pem}\nafter`)).toBe('before\n[REDACTED]\nafter')
  })

  it('redacts bearer tokens but keeps the header name', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer [REDACTED]')
  })

  it('redacts exact secrets wherever they appear, including twice', () => {
    expect(redact('x hunter2hunter2 y hunter2hunter2', ['hunter2hunter2'])).toBe(
      'x [REDACTED] y [REDACTED]',
    )
  })

  it('leaves ordinary text and short strings alone', () => {
    expect(redact('hello world, ls -la, sk-short')).toBe('hello world, ls -la, sk-short')
  })

  it('ignores supplied secrets shorter than 8 chars', () => {
    expect(redact('the cat sat', ['cat'])).toBe('the cat sat')
  })

  it('escapes regex metacharacters in supplied secrets', () => {
    expect(redact('a.b*c+d?e', ['a.b*c+d?e'])).toBe('[REDACTED]')
    expect(redact('aXbbbbcd', ['a.b*c+d?e'])).toBe('aXbbbbcd')
  })
})
