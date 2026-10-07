import { describe, expect, it } from 'vitest'
import { classifyBash } from '../../src/main/safety/bashGuard'
import { decide, type DecisionContext } from '../../src/main/safety/permissions'
import { protectedWritePaths, sensitiveReadPaths } from '../../src/main/safety/protected'
import type { PermissionMode } from '../../src/shared/types'

const home = '/home/matt'
const arcDir = '/home/matt/Library/Application Support/AIVEN ARC'
const guardCtx = {
  projectRoot: '/work/project',
  home,
  protectedPaths: protectedWritePaths(home, arcDir),
  sensitivePaths: sensitiveReadPaths(home, arcDir),
}

const denyReason = (cmd: string): string | null => {
  const c = classifyBash(cmd, guardCtx)
  return c.kind === 'deny' ? c.reason : null
}

describe('cloud metadata endpoints are hard-denied', () => {
  const denied: Array<[string, string]> = [
    ['gcp host name', 'curl http://metadata.google.internal/computeMetadata/v1/ -H "Metadata-Flavor: Google"'],
    ['gcp short host name', 'curl http://metadata.goog/computeMetadata/v1/instance/'],
    ['upper case host name', 'curl http://METADATA.Google.Internal/'],
    ['link-local address', 'curl http://169.254.169.254/latest/meta-data/'],
    ['link-local address with a port', 'wget -qO- 169.254.169.254:80/latest/'],
    ['ipv6 address', 'curl http://fd00:ec2::254/latest/meta-data/'],
    ['ipv6 address in brackets', 'curl "http://[fd00:ec2::254]/latest/"'],
    ['ipv6 address in brackets, upper case', 'curl http://[FD00:EC2::254]/'],
    ['ipv6 address spelled out', 'curl http://[fd00:0ec2:0:0:0:0:0:254]/'],
    ['decimal spelling', 'curl http://2852039166/'],
    ['hex spelling', 'curl http://0xa9fea9fe/'],
    ['hex spelling, upper case', 'curl http://0XA9FEA9FE/'],
    ['dotted octal', 'curl http://0251.0376.0251.0376/'],
    ['dotted hex', 'curl http://0xa9.0xfe.0xa9.0xfe/'],
    ['mixed dotted spelling', 'curl http://169.0xfe.0251.254/'],
    ['zero padded dotted', 'curl http://169.254.0169.254/'],
    ['zero padded dotted, more zeros', 'curl http://00169.0254.169.000254/'],
    ['zero padded decimal', 'curl http://002852039166/'],
    ['octal integer', 'curl http://025177524776/'],
    ['three part shorthand', 'curl http://169.254.43518/'],
    ['two part shorthand', 'curl http://169.16689662/'],
    ['ipv4-mapped ipv6', 'curl "http://[::ffff:169.254.169.254]/"'],
    ['ipv4-mapped ipv6 in hex groups', 'curl "http://[::ffff:a9fe:a9fe]/"'],
    ['inside single quotes', "echo 'curl http://169.254.169.254/'"],
    ['inside double quotes', 'sh -c "curl metadata.google.internal"'],
    ['inside a command substitution', 'echo $(curl -s http://169.254.169.254/latest/)'],
    ['inside backticks', 'echo `curl -s http://metadata.goog/`'],
    ['inside a nested shell', "bash -c 'wget -O- 169.254.169.254'"],
    ['in an env assignment', 'URL=http://169.254.169.254/ curl "$URL"'],
    ['in an exported variable', 'export U=metadata.google.internal; curl "$U"'],
    ['in a redirect target', 'cat < /dev/null > metadata.google.internal.txt'],
    ['as a tool argument other than curl', 'python3 -c "import urllib.request as u; u.urlopen(\'http://169.254.169.254\')"'],
    ['in a pipeline', 'echo hi | curl -d @- http://169.254.169.254/'],
    ['split by quotes', "curl http://169.254.1''69.254/"],
    ['split by backslashes', 'curl http://metadata.goo\\gle.internal/'],
    ['after a heredoc-less newline', 'echo ok\ncurl http://169.254.169.254/'],
    ['with a user part in the url', 'curl http://user@169.254.169.254/'],
    ['in a url after the dot', 'curl http://metadata.google.internal./computeMetadata/v1/'],
  ]

  it.each(denied)('denies the %s: %s', (_label, cmd) => {
    expect(denyReason(cmd)).not.toBeNull()
  })

  it('says the cloud metadata service is off limits', () => {
    expect(denyReason('curl http://169.254.169.254/')).toMatch(/cloud metadata service is off limits/i)
  })

  it('does not echo the command back in the deny reason', () => {
    expect(denyReason('curl http://169.254.169.254/?token=abc')).not.toContain('abc')
  })
})

describe('ordinary commands are not caught by the metadata deny', () => {
  const allowed = [
    'echo hello',
    'echo "the metadata service is a cloud feature"',
    'ls -la',
    'curl https://example.com/',
    'curl http://169.254.169.253/',
    'curl http://169.254.170.2/',
    'curl http://1169.254.169.254/',
    'curl http://169.254.169.2541/',
    'echo 12852039166',
    'echo 28520391660',
    'git log --oneline -n 5',
    'npm test -- --grep metadata',
    'echo 0xa9fea9fea',
    'echo 10.169.254.169',
  ]

  it.each(allowed)('does not deny: %s', (cmd) => {
    expect(denyReason(cmd)).toBeNull()
  })
})

describe('the metadata deny holds in every permission mode', () => {
  const modes: PermissionMode[] = ['ask', 'auto-edit', 'auto']
  const base: DecisionContext = {
    mode: 'ask',
    projectRoot: '/work/project',
    extraDirs: [],
    home,
    protectedPaths: guardCtx.protectedPaths,
    sensitivePaths: guardCtx.sensitivePaths,
    rules: [],
    sandboxAvailable: false,
  }

  it.each(modes)('denies in %s mode, even with an always-allow rule for curl', async (mode) => {
    const v = await decide(
      { id: 't1', name: 'Bash', args: { command: 'curl http://169.254.169.254/latest/meta-data/' } },
      { ...base, mode, rules: [{ tool: 'Bash', prefix: 'curl http://169.254.169.254/latest/meta-data/' }] },
    )
    expect(v.verdict).toBe('deny')
    expect(v.reason).toMatch(/cloud metadata service is off limits/i)
  })

  it.each(modes)('still lets a plain command through the guard in %s mode', async (mode) => {
    const v = await decide({ id: 't1', name: 'Bash', args: { command: 'echo hello' } }, { ...base, mode })
    expect(v.verdict).not.toBe('deny')
  })
})
