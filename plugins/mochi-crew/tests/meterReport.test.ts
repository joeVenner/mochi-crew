import { describe, expect, test } from 'claude-code/testing'

import type { Measure } from '../types'
import { EMPTY_CACHE, isClaudeModelId } from '../hooks/meter'
import { isFoundryWindowSuspect, meterReport } from '../hooks/meterReport'
import type { ReportInput } from '../hooks/meterReport'

const measure = (over: Partial<Measure> = {}): Measure => ({ tokens: 620_000, window: 1_000_000, percent: 62, limits: [], costUsd: 4.12, ...over })
const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  modelId: 'claude-opus-5-5',
  provider: 'api-key',
  measure: measure(),
  cache: { turns: 4, read: 940_000, write: 50_000, uncached: 1_200, output: 5_300 },
  idleMs: 2 * 60_000,
  isCold: false,
  coldAfterMs: 3_600_000,
  ...over,
})

describe('meter report', () => {
  test('an API key session reads in full', async () => {
    const text = meterReport(input())
    expect(text).toContain('model     opus 5.5 (claude-opus-5-5)')
    expect(text).toContain('provider  Claude API key · billed by Claude Console, per token')
    expect(text).toContain('context   620k of 1M (62%)')
    expect(text).toContain('95% of input read from cache over 4 turns')
    expect(text).toContain('read 940k · written 50k · uncached 1.2k · output 5.3k')
    expect(text).toContain('idle      2m · cache certainly cold after 1h idle')
    expect(text).toContain('cost      $4.12 est')
    expect(text).toContain('promptCacheTtl')
  })

  test('a subscription shows its windows and says the cost is not billed', async () => {
    const limits = [{ kind: 'five_hour', percentUsed: 34 }, { kind: 'seven_day', percentUsed: 12 }]
    const text = meterReport(input({ provider: 'subscription', measure: measure({ limits }) }))
    expect(text).toContain('limits    5h 34% · 7d 12%')
    expect(text).toContain('not billed on a plan')
    expect(text).not.toContain('est\n')
  })

  test('a sign-in with no plan windows yet labels the cost as unbilled-unknown', async () => {
    expect(meterReport(input({ provider: 'anthropic' }))).toContain('$4.12 at API rates (billing not known yet)')
  })

  test('a fresh session says what is not known yet', async () => {
    const text = meterReport(input({ modelId: null, measure: null, cache: EMPTY_CACHE, idleMs: null, provider: 'unknown' }))
    expect(text).toContain('model     not known yet')
    expect(text).toContain('context   no measurement yet')
    expect(text).toContain('cache     no main-thread response yet')
    expect(text).not.toContain('idle ')
    expect(text).not.toContain('cost ')
  })

  test('after a compact the context waits for the next response', async () => {
    expect(meterReport(input({ measure: measure({ tokens: undefined, percent: undefined }) }))).toContain('— of 1M (until the next response)')
  })

  test('past five minutes on a 5m-default provider the cache is called likely cold, not certainly', async () => {
    expect(meterReport(input({ idleMs: 12 * 60_000 }))).toContain('12m · likely cold if the default 5m TTL applies; certainly after 1h')
    expect(meterReport(input({ provider: 'subscription', idleMs: 12 * 60_000 }))).toContain('12m · cache certainly cold after 1h idle')
    expect(meterReport(input({ idleMs: 3 * 60_000 }))).toContain('3m · cache certainly cold after 1h idle')
  })

  test('the notes point at their sources', async () => {
    expect(meterReport(input())).toContain('sources are in the README')
  })

  test('a cold cache and an unreported cache are explained', async () => {
    expect(meterReport(input({ idleMs: 70 * 60_000, isCold: true }))).toContain('1h10m · cache cold')
    const stripped = { turns: 3, read: 0, write: 0, uncached: 90_000, output: 10 }
    expect(meterReport(input({ provider: 'gateway', cache: stripped }))).toContain('not reported: every turn is billed as uncached input')
  })

  test('Foundry notes name Azure billing and the ITPM rule', async () => {
    const text = meterReport(input({ provider: 'foundry', modelId: 'claude-opus-4-8' }))
    expect(text).toContain('Claude Consumption Units')
    expect(text).toContain('ITPM')
    expect(text).not.toContain('modelOverrides')
  })

  test('a Foundry deployment name with a 200K window gets the modelOverrides hint', async () => {
    const text = meterReport(input({ provider: 'foundry', modelId: 'team-opus-prod', measure: measure({ window: 200_000, tokens: 50_000, percent: 25 }) }))
    expect(text).toContain('modelOverrides')
  })

})

describe('Foundry window check', () => {
  test('only an unmappable Foundry deployment at exactly 200K is suspect', async () => {
    expect(isFoundryWindowSuspect('foundry', 200_000, 'team-opus-prod')).toBe(true)
    expect(isFoundryWindowSuspect('foundry', 200_000, 'claude-haiku-4-5')).toBe(false)
    expect(isFoundryWindowSuspect('foundry', 1_000_000, 'team-opus-prod')).toBe(false)
    expect(isFoundryWindowSuspect('bedrock', 200_000, 'team-opus-prod')).toBe(false)
    expect(isFoundryWindowSuspect('foundry', undefined, 'team-opus-prod')).toBe(false)
    expect(isFoundryWindowSuspect('foundry', 200_000, null)).toBe(false)
  })

  test('Claude ids are recognised through any provider wrapping', async () => {
    expect(isClaudeModelId('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe(true)
    expect(isClaudeModelId('claude-opus-4-8[1m]')).toBe(true)
    expect(isClaudeModelId('team-opus-prod')).toBe(false)
  })
})
