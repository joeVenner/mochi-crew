import { describe, expect, test } from 'claude-code/testing'

import {
  CACHE_PROOF_TURNS, EMPTY_CACHE, addUsage, billedBy, describeFailure, certainlyColdAfterMs, detectProvider, formatSpan, formatTokens,
  formatUsd, hitRatio, hostOf, isCacheUnreported, isCertainlyCold, isFlagOn, isMetered, settleProvider, shortModel,
} from '../hooks/meter'
import type { ProviderSignals } from '../hooks/meter'

const signals = (over: Partial<ProviderSignals> = {}): ProviderSignals => ({ env: {}, authKind: null, limitKinds: [], ...over })
const usage = (read: number, write: number, input: number, output = 10) => ({
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  input_tokens: input,
  output_tokens: output,
})

describe('provider detection', () => {
  test('flags read like Claude Code reads them', async () => {
    expect(isFlagOn('1')).toBe(true)
    expect(isFlagOn('true')).toBe(true)
    expect(isFlagOn(undefined)).toBe(false)
    expect(isFlagOn('')).toBe(false)
    expect(isFlagOn(' 0 ')).toBe(false)
    expect(isFlagOn('FALSE')).toBe(false)
    expect(isFlagOn(' TRUE ')).toBe(true)
    expect(isFlagOn('yes')).toBe(true)
    // Claude Code ignores anything but an explicit yes; so does the meter.
    expect(isFlagOn('enabled')).toBe(false)
    expect(isFlagOn('2')).toBe(false)
  })

  test('each cloud provider is picked by its own flag', async () => {
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_BEDROCK: '1' } }))).toBe('bedrock')
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_MANTLE: '1' } }))).toBe('bedrock')
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_VERTEX: '1' } }))).toBe('vertex')
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_FOUNDRY: '1' } }))).toBe('foundry')
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_ANTHROPIC_AWS: '1' } }))).toBe('anthropic-aws')
  })

  test('a provider flag wins over plan windows and credentials', async () => {
    const foundry = signals({ env: { CLAUDE_CODE_USE_FOUNDRY: '1' }, authKind: 'api-key', limitKinds: ['five_hour'] })
    expect(detectProvider(foundry)).toBe('foundry')
  })

  test('a flag set to 0 does not select its provider', async () => {
    expect(detectProvider(signals({ env: { CLAUDE_CODE_USE_BEDROCK: '0' }, authKind: 'api-key' }))).toBe('api-key')
  })

  test('a gateway is a spend-limit window or a non-Anthropic base URL', async () => {
    expect(detectProvider(signals({ limitKinds: ['spend_limit'], authKind: 'bearer' }))).toBe('gateway')
    expect(detectProvider(signals({ env: { ANTHROPIC_BASE_URL: 'https://llm.corp.example:4000/v1' } }))).toBe('gateway')
    expect(detectProvider(signals({ env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }, authKind: 'api-key' }))).toBe('api-key')
  })

  test('plan windows win over a proxy base URL: only a Claude plan reports them', async () => {
    const proxied = signals({ env: { ANTHROPIC_BASE_URL: 'http://localhost:8080' }, authKind: 'bearer', limitKinds: ['five_hour'] })
    expect(detectProvider(proxied)).toBe('subscription')
  })

  test('plan windows mean a subscription; a key means the Console', async () => {
    expect(detectProvider(signals({ authKind: 'bearer', limitKinds: ['five_hour', 'seven_day'] }))).toBe('subscription')
    expect(detectProvider(signals({ authKind: 'api-key' }))).toBe('api-key')
  })

  test('a bearer with no plan windows yet is not guessed to be a subscription', async () => {
    expect(detectProvider(signals({ authKind: 'bearer' }))).toBe('anthropic')
    expect(detectProvider(signals())).toBe('unknown')
  })

  test('a subscription stays one after its plan windows reset and drop out', async () => {
    expect(settleProvider('subscription', 'anthropic')).toBe('subscription')
    expect(settleProvider('subscription', 'subscription')).toBe('subscription')
    // Real changes still land: a provider flag, or a fresh start.
    expect(settleProvider('subscription', 'bedrock')).toBe('bedrock')
    expect(settleProvider('anthropic', 'anthropic')).toBe('anthropic')
    expect(settleProvider('unknown', 'api-key')).toBe('api-key')
  })

  test('only a subscription is unmetered, and every provider names who bills', async () => {
    expect(isMetered('subscription')).toBe(false)
    expect(isMetered('anthropic')).toBe(false)
    expect(isMetered('unknown')).toBe(false)
    expect(isMetered('api-key')).toBe(true)
    expect(isMetered('foundry')).toBe(true)
    expect(billedBy('foundry')).toContain('Azure')
    expect(billedBy('bedrock')).toContain('AWS')
  })

  test('hosts are read without a URL parser', async () => {
    expect(hostOf('https://user:pw@Gateway.Example.com:8443/x?y')).toBe('gateway.example.com')
    expect(hostOf('http://localhost')).toBe('localhost')
    expect(hostOf('not a url')).toBe(null)
  })
})

describe('model labels', () => {
  test('first-party ids lose the vendor prefix and context suffix', async () => {
    expect(shortModel('claude-opus-5-5')).toBe('opus 5.5')
    expect(shortModel('claude-opus-4-8[1m]')).toBe('opus 4.8')
    expect(shortModel('claude-opus-5')).toBe('opus 5')
    expect(shortModel('claude-fable-5-1')).toBe('fable 5.1')
    expect(shortModel('claude-mythos-preview')).toBe('mythos preview')
  })

  test('Bedrock, Vertex and dated ids reduce to the same label', async () => {
    expect(shortModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')).toBe('sonnet 4.5')
    expect(shortModel('global.anthropic.claude-haiku-5-5-v1')).toBe('haiku 5.5')
    expect(shortModel('claude-sonnet-4-5@20250929')).toBe('sonnet 4.5')
    expect(shortModel('claude-3-5-haiku-20241022')).toBe('haiku 3.5')
    expect(shortModel('arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-opus-4-8-v1:0')).toBe('opus 4.8')
  })

  test('deployment names and profiles are kept, cut to fit', async () => {
    expect(shortModel('team-opus-prod')).toBe('team-opus-prod')
    expect(shortModel('arn:aws:bedrock:us-east-1:1:application-inference-profile/abc123')).toBe('abc123')
    expect(shortModel('a-very-long-foundry-deployment-name')).toBe('a-very-long-found…')
    expect(shortModel('   ')).toBe('?')
  })
})

describe('formatting', () => {
  test('tokens', async () => {
    expect(formatTokens(0)).toBe('0')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1000)).toBe('1k')
    expect(formatTokens(9_540)).toBe('9.5k')
    expect(formatTokens(620_400)).toBe('620k')
    expect(formatTokens(999_600)).toBe('1M')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(1_240_000)).toBe('1.2M')
    expect(formatTokens(-5)).toBe('0')
    expect(formatTokens(Number.NaN)).toBe('—')
    expect(formatTokens(Number.POSITIVE_INFINITY)).toBe('—')
  })

  test('spans', async () => {
    expect(formatSpan(0)).toBe('0s')
    expect(formatSpan(59_999)).toBe('59s')
    expect(formatSpan(4 * 60_000)).toBe('4m')
    expect(formatSpan(65 * 60_000)).toBe('1h5m')
    expect(formatSpan(3 * 3_600_000)).toBe('3h')
    expect(formatSpan(-1)).toBe('0s')
  })

  test('dollars', async () => {
    expect(formatUsd(4.123)).toBe('$4.12')
    expect(formatUsd(0.031)).toBe('$0.031')
    expect(formatUsd(0)).toBe('$0.00')
    expect(formatUsd(-2)).toBe('$0.00')
    expect(formatUsd(Number.NaN)).toBe('$—')
  })
})

describe('prompt cache', () => {
  test('totals sum turn by turn and ignore bad counts', async () => {
    const once = addUsage(EMPTY_CACHE, usage(0, 40_000, 500))
    const twice = addUsage(once, usage(40_000, 2_000, 300))
    expect(twice).toEqual({ turns: 2, read: 40_000, write: 42_000, uncached: 800, output: 20 })
    expect(addUsage(EMPTY_CACHE, usage(Number.NaN, -1, 5))).toEqual({ turns: 1, read: 0, write: 0, uncached: 5, output: 10 })
  })

  test('hit ratio is reads over all input, null with no input', async () => {
    expect(hitRatio(EMPTY_CACHE)).toBe(null)
    expect(hitRatio({ turns: 2, read: 90, write: 5, uncached: 5, output: 0 })).toBe(0.9)
  })

  test('caching counts as unreported only after several turns of zeros', async () => {
    const zeros = (turns: number) => ({ turns, read: 0, write: 0, uncached: 1000 * turns, output: 0 })
    expect(isCacheUnreported(zeros(CACHE_PROOF_TURNS - 1))).toBe(false)
    expect(isCacheUnreported(zeros(CACHE_PROOF_TURNS))).toBe(true)
    expect(isCacheUnreported({ ...zeros(5), write: 1 })).toBe(false)
  })

  test('cold is claimed only when certain', async () => {
    expect(certainlyColdAfterMs({})).toBe(3_600_000)
    expect(certainlyColdAfterMs({ FORCE_PROMPT_CACHING_5M: '1' })).toBe(300_000)
    expect(certainlyColdAfterMs({ CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' })).toBe(300_000)
    expect(certainlyColdAfterMs({ CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' })).toBe(3_600_000)
    expect(isCertainlyCold(10 * 60_000, {})).toBe(false)
    expect(isCertainlyCold(10 * 60_000, { FORCE_PROMPT_CACHING_5M: '1' })).toBe(true)
    expect(isCertainlyCold(3_600_000, {})).toBe(true)
  })
})

describe('failures', () => {
  test('read as their message, else their kind, never [object Object]', async () => {
    expect(describeFailure({ kind: 'throw', message: 'boom' })).toBe('boom')
    expect(describeFailure({ kind: 'timeout' })).toBe('timeout')
  })
})
