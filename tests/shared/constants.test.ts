import { describe, expect, it } from 'vitest'
import {
  AUTOPILOT_DEFAULT_ROUNDS,
  BASH_DEFAULT_TIMEOUT_MS,
  BASH_MAX_TIMEOUT_MS,
  COMPACT_THRESHOLD,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MODEL,
  KILL_GRACE_MS,
  MAX_STEPS,
  PROMPTER_TEMPERATURE,
  RETRY_MAX,
  TOOL_OUTPUT_CAP,
} from '../../src/shared/constants'

describe('spec constants', () => {
  it('pins the values the spec fixes', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.8-flash')
    expect(MAX_STEPS).toBe(40)
    expect(TOOL_OUTPUT_CAP).toBe(30_000)
    expect(BASH_DEFAULT_TIMEOUT_MS).toBe(120_000)
    expect(BASH_MAX_TIMEOUT_MS).toBe(600_000)
    expect(KILL_GRACE_MS).toBe(2_000)
    expect(RETRY_MAX).toBe(4)
    expect(COMPACT_THRESHOLD).toBe(0.85)
    expect(AUTOPILOT_DEFAULT_ROUNDS).toBe(5)
    expect(PROMPTER_TEMPERATURE).toBe(1.3)
    expect(DEFAULT_CONTEXT_WINDOW).toBe(1_048_576)
  })
})
