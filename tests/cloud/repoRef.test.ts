import { describe, expect, it } from 'vitest'
import { isSafeBranchName, makeBranchName, parseRepoRef } from '../../src/main/cloud/repoRef'

describe('parseRepoRef: accepted forms', () => {
  const ok: Array<[string, string]> = [
    ['owner/name', 'bare owner/name'],
    ['https://github.com/owner/name', 'https url'],
    ['https://github.com/owner/name.git', 'https url with .git'],
    ['https://github.com/owner/name/', 'https url with trailing slash'],
    ['https://github.com/owner/name.git/', 'https url with .git and trailing slash'],
    ['github.com/owner/name', 'host without scheme'],
    ['GitHub.com/owner/name', 'host in upper case'],
    ['https://GITHUB.COM/owner/name', 'https url with upper case host'],
  ]
  it.each(ok)('accepts %s (%s)', (input) => {
    expect(parseRepoRef(input)).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'name',
      slug: 'owner/name',
      httpsUrl: 'https://github.com/owner/name',
    })
  })

  it('keeps the case of owner and name and allows dots, dashes and underscores', () => {
    const r = parseRepoRef('My-Org_1/repo.js-v2_x')
    expect(r.owner).toBe('My-Org_1')
    expect(r.name).toBe('repo.js-v2_x')
    expect(r.slug).toBe('My-Org_1/repo.js-v2_x')
  })

  it('only strips one .git suffix, so a repo named x.git.git keeps its first', () => {
    expect(parseRepoRef('o/x.git.git').name).toBe('x.git')
  })

  it('allows a name that merely contains dots', () => {
    expect(parseRepoRef('o/.github').name).toBe('.github')
    expect(parseRepoRef('o/a..b').name).toBe('a..b')
  })

  it('uses the first configured host for owner/name and accepts every configured host in a URL', () => {
    const hosts = ['ghe.example.com', 'github.com']
    expect(parseRepoRef('o/n', { hosts })).toMatchObject({ host: 'ghe.example.com', httpsUrl: 'https://ghe.example.com/o/n' })
    expect(parseRepoRef('https://github.com/o/n', { hosts })).toMatchObject({ host: 'github.com' })
    expect(parseRepoRef('ghe.example.com/o/n', { hosts })).toMatchObject({ host: 'ghe.example.com' })
  })

  it('replaces the default host list, so github.com is refused when only an enterprise host is configured', () => {
    expect(() => parseRepoRef('https://github.com/o/n', { hosts: ['ghe.example.com'] })).toThrow(/not an allowed host/)
  })

  it('matches configured hosts case-insensitively', () => {
    expect(parseRepoRef('https://GHE.Example.com/o/n', { hosts: ['ghe.EXAMPLE.com'] }).host).toBe('ghe.example.com')
  })
})

describe('parseRepoRef: rejected input', () => {
  const bad: Array<[string, string, RegExp]> = [
    ['file:///etc/passwd', 'file scheme', /not supported/i],
    ['file:/tmp/repo', 'file scheme without slashes', /not supported/i],
    ['ssh://git@github.com/o/n', 'ssh scheme', /not supported/i],
    ['git://github.com/o/n', 'git scheme', /not supported/i],
    ['http://github.com/o/n', 'plain http', /plain http/i],
    ['HTTP://github.com/o/n', 'plain http, upper case', /plain http/i],
    ['ext::sh -c touch% /tmp/pwned', 'ext transport', /not supported|whitespace/i],
    ['ext::sh', 'ext transport without spaces', /not supported/i],
    ['git@github.com:o/n.git', 'scp-like syntax', /ssh|scp|not supported/i],
    ['github.com:o/n', 'host colon path', /not supported/i],
    ['https://user:pass@github.com/o/n', 'credentials in the url', /credentials/i],
    ['https://user@github.com/o/n', 'username in the url', /credentials/i],
    ['https://:pass@github.com/o/n', 'password only in the url', /credentials/i],
    ['https://x-access-token:ghp_abc@github.com/o/n', 'token in the url', /credentials/i],
    ['https://github.com/o/n?x=1', 'query string', /query|fragment/i],
    ['https://github.com/o/n#frag', 'fragment', /query|fragment/i],
    ['https://github.com/o/n?', 'empty query string', /query|fragment/i],
    ['https://github.com/o/n#', 'empty fragment', /query|fragment/i],
    ['https://evil.com/o/n', 'host not in the list', /not an allowed host/],
    ['https://github.com.evil.com/o/n', 'look-alike host', /not an allowed host/],
    ['https://evil.com/github.com/o/n', 'allowed host in the path', /too many|not an allowed host/i],
    ['https://github.com:8443/o/n', 'explicit port', /port/i],
    ['evil.com/o/n', 'bare host not in the list', /not an allowed host/],
    ['-o/n', 'leading dash in owner', /start with a dash|option/i],
    ['--upload-pack=touch /tmp/x', 'option with space', /start with a dash|option|whitespace/i],
    ['--upload-pack=x/y', 'option without space', /start with a dash|option/i],
    ['github.com/-o/n', 'leading dash in owner after a host', /owner/i],
    ['', 'empty string', /empty|owner/i],
    ['   ', 'only spaces', /whitespace|empty/i],
    [' o/n', 'leading space', /whitespace/i],
    ['o/n ', 'trailing space', /whitespace/i],
    ['o /n', 'inner space', /whitespace/i],
    ['o/n\n', 'trailing newline', /whitespace|control/i],
    ['o/n\t', 'tab', /whitespace|control/i],
    ['o/n\u0000', 'nul byte', /control/i],
    ['o/n\u001b[31m', 'escape code', /control/i],
    ['o/n\u007f', 'delete character', /control/i],
    ['o/n ', 'non-breaking space', /whitespace|control|characters/i],
    ['o\\n', 'backslash as separator', /characters|slash/i],
    ['https://github.com\\o\\n', 'backslash url', /backslash|characters/i],
    ['o/n$(id)', 'shell substitution in name', /characters/i],
    ['o/n;rm', 'semicolon in name', /characters/i],
    ['o/n%20x', 'percent escape in name', /characters/i],
    ['o/n:x', 'colon in name', /characters|not supported/i],
    ['o@x/n', 'at sign in owner', /credentials|characters/i],
    ['ö/n', 'non-ascii owner', /characters/i],
    ['o/ñ', 'non-ascii name', /characters/i],
    ['o/.', 'dot name', /name/i],
    ['o/..', 'dot-dot name', /name/i],
    ['./n', 'dot owner', /owner/i],
    ['../n', 'dot-dot owner', /owner/i],
    ['https://github.com/o/..', 'dot-dot name in url', /name/i],
    ['https://github.com/o/.git', 'name that is only .git', /name/i],
    ['o/.git', 'name that is only .git, short form', /name/i],
    ['o', 'only one segment', /owner\/name/i],
    ['https://github.com/o', 'url with only an owner', /owner\/name/i],
    ['https://github.com/', 'url without path', /owner\/name/i],
    ['https://github.com', 'url without slash', /owner\/name/i],
    ['o//n', 'empty segment', /owner\/name|empty/i],
    ['/o/n', 'leading slash', /owner\/name|empty/i],
    ['https://github.com//o/n', 'empty segment in url', /owner\/name|empty/i],
    ['a/b/c', 'three segments, first is not a host', /not an allowed host/],
    ['https://github.com/o/n/tree/main', 'deep link', /too many/i],
    ['https://github.com/o/n/extra', 'extra path segment', /too many/i],
    ['github.com/o/n/extra', 'extra path segment without scheme', /too many/i],
    ['https://', 'scheme only', /owner\/name|host/i],
    ['javascript:alert(1)', 'javascript scheme', /not supported/i],
    ['data:text/plain,hi', 'data scheme', /not supported/i],
  ]
  it.each(bad)('rejects %j (%s) with a plain message', (input, _why, message) => {
    let err: unknown
    try {
      parseRepoRef(input)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(message)
    // plain language: no stack-like or code-like text, and the raw input is never echoed back
    expect((err as Error).message).not.toMatch(/ERR_|TypeError|undefined/)
  })

  it('does not echo credentials from the input into the error message', () => {
    try {
      parseRepoRef('https://user:supersecretpw@github.com/o/n')
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecretpw')
      return
    }
    throw new Error('expected a throw')
  })

  it('rejects non-string input', () => {
    expect(() => parseRepoRef(undefined as unknown as string)).toThrow(/owner\/name/i)
  })

  it('rejects overly long input', () => {
    expect(() => parseRepoRef('o/' + 'n'.repeat(500))).toThrow(/too long/i)
  })
})

describe('makeBranchName', () => {
  const fixed = () => 'ab12'

  it('builds arc/<slug>-<4 hex> from a label', () => {
    expect(makeBranchName('Fix the login bug', fixed)).toBe('arc/fix-the-login-bug-ab12')
  })

  it('falls back to "session" when there is no label', () => {
    expect(makeBranchName(undefined, fixed)).toBe('arc/session-ab12')
    expect(makeBranchName('', fixed)).toBe('arc/session-ab12')
    expect(makeBranchName('   ', fixed)).toBe('arc/session-ab12')
  })

  it('falls back to "session" when the label has no usable characters', () => {
    expect(makeBranchName('!!! ???', fixed)).toBe('arc/session-ab12')
    expect(makeBranchName('日本語', fixed)).toBe('arc/session-ab12')
  })

  it('slugifies: lowercase ascii letters, digits and single dashes only', () => {
    expect(makeBranchName('  Hello,   WORLD__v2.0!  ', fixed)).toBe('arc/hello-world-v2-0-ab12')
    expect(makeBranchName('Café résumé', fixed)).toBe('arc/cafe-resume-ab12')
    expect(makeBranchName('a/../b', fixed)).toBe('arc/a-b-ab12')
    expect(makeBranchName('--x--', fixed)).toBe('arc/x-ab12')
  })

  it('limits the slug to 30 characters and does not leave a trailing dash', () => {
    const long = makeBranchName('a'.repeat(100), fixed)
    expect(long).toBe(`arc/${'a'.repeat(30)}-ab12`)
    const cut = makeBranchName('a'.repeat(29) + ' bbbb', fixed)
    expect(cut).toBe(`arc/${'a'.repeat(29)}-ab12`)
  })

  it('uses random hex by default and always yields a safe branch name', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      const b = makeBranchName('Some task; rm -rf /')
      expect(b).toMatch(/^arc\/[a-z0-9-]{1,30}-[0-9a-f]{4}$/)
      expect(isSafeBranchName(b)).toBe(true)
      seen.add(b)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('refuses a random source that is not 4 lowercase hex characters', () => {
    expect(() => makeBranchName('x', () => 'zz!!')).toThrow()
    expect(() => makeBranchName('x', () => 'ABCD')).toThrow()
  })
})

describe('isSafeBranchName', () => {
  const safe = ['arc/fix-bug-ab12', 'arc/a', 'arc/feature/x', 'arc/v1.2.3', 'arc/a_b-c.d', 'arc/' + 'a'.repeat(116)]
  it.each(safe)('accepts %s', (b) => {
    expect(isSafeBranchName(b)).toBe(true)
  })

  const unsafe: Array<[string, string]> = [
    ['main', 'no arc prefix'],
    ['master', 'default branch'],
    ['ARC/x', 'wrong case prefix'],
    ['arc', 'bare prefix without slash'],
    ['arc/', 'empty after prefix'],
    ['arcx/y', 'prefix lookalike'],
    ['/arc/x', 'leading slash'],
    ['arc/x/', 'trailing slash'],
    ['arc//x', 'double slash'],
    ['arc/../x', 'dot-dot segment'],
    ['arc/x..y', 'dot-dot inside a segment'],
    ['arc/./x', 'dot segment'],
    ['arc/.hidden', 'leading dot segment'],
    ['arc/x/.hidden', 'leading dot in a later segment'],
    ['arc/x.', 'trailing dot'],
    ['arc/x./y', 'trailing dot in a segment'],
    ['arc/x.lock', 'lock suffix'],
    ['arc/x.lock/y', 'lock suffix on a segment'],
    ['arc/x@{1}', 'reflog syntax'],
    ['arc/x@', 'at sign'],
    ['arc/x y', 'space'],
    ['arc/x\ny', 'newline'],
    ['arc/x\u0000', 'nul'],
    ['arc/x~1', 'tilde'],
    ['arc/x^', 'caret'],
    ['arc/x:y', 'colon'],
    ['arc/x?y', 'question mark'],
    ['arc/x*y', 'star'],
    ['arc/x[y]', 'brackets'],
    ['arc/x\\y', 'backslash'],
    ['arc/$(id)', 'substitution'],
    ['arc/;rm', 'semicolon'],
    ['arc/é', 'non-ascii'],
    ['+arc/x', 'plus refspec'],
    ['-arc/x', 'leading dash'],
    ['arc/x:refs/heads/main', 'refspec with destination'],
    ['arc/' + 'a'.repeat(117), 'longer than 120 characters'],
    ['', 'empty'],
  ]
  it.each(unsafe)('rejects %j (%s)', (b) => {
    expect(isSafeBranchName(b)).toBe(false)
  })

  it('rejects non-string input', () => {
    expect(isSafeBranchName(undefined as unknown as string)).toBe(false)
    expect(isSafeBranchName(42 as unknown as string)).toBe(false)
  })
})
