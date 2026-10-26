import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_TUTOR_CONFIG, FIVE_MINUTES_MS, FORK_MAX_CONTEXT_TOKENS, choosePlan, isForkMiss, parseTutorConfig, planLabel,
} from '../hooks/tutorPlan'
import type { TutorPlan, TutorPlanInput } from '../hooks/tutorPlan'

const NOW = 10_000_000
const MINUTE = 60_000
const PINNED_5M = { CLAUDE_CODE_PROMPT_CACHE_TTL: '5m' }

/** A warm, ordinary session two minutes after Claude's last reply, with any field overridden. */
const input = (over: Partial<TutorPlanInput> = {}): TutorPlanInput => ({
  config: DEFAULT_TUTOR_CONFIG,
  isDigestOnly: false,
  lastResponseAt: NOW - 2 * MINUTE,
  now: NOW,
  isWorking: false,
  ttl: {},
  contextTokens: 148_000,
  modelNow: 'claude-opus-4-1',
  modelAtResponse: 'claude-opus-4-1',
  isForkSuspect: false,
  ...over,
})
const idle = (ms: number, over: Partial<TutorPlanInput> = {}): TutorPlanInput => input({ lastResponseAt: NOW - ms, ...over })
const usage = (read: number, write: number, uncached: number) => ({
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
  input_tokens: uncached,
  output_tokens: 10,
})

describe('tutor config', () => {
  test('parseTutorConfig fills defaults from empty options', async () => {
    expect(parseTutorConfig({})).toEqual({ model: 'haiku', context: 'auto' })
  })

  test('parseTutorConfig passes valid picks through', async () => {
    expect(parseTutorConfig({ tutorModel: 'opus', tutorContext: 'session' })).toEqual({ model: 'opus', context: 'session' })
    expect(parseTutorConfig({ tutorModel: 'sonnet', tutorContext: 'digest' })).toEqual({ model: 'sonnet', context: 'digest' })
  })

  test('parseTutorConfig falls back on unknown or mistyped values', async () => {
    expect(parseTutorConfig({ tutorModel: 'gpt', tutorContext: 'digest' })).toEqual({ model: 'haiku', context: 'digest' })
    expect(parseTutorConfig({ tutorModel: 'sonnet', tutorContext: 3 })).toEqual({ model: 'sonnet', context: 'auto' })
    expect(parseTutorConfig({ tutorModel: true, tutorContext: ['session'] })).toEqual(DEFAULT_TUTOR_CONFIG)
    // Case and whitespace are not forgiven: the engine already treats them as unset.
    expect(parseTutorConfig({ tutorModel: 'Haiku ', tutorContext: 'SESSION' })).toEqual(DEFAULT_TUTOR_CONFIG)
  })
})

describe('choosePlan', () => {
  test('choosePlan forks while warm and Claude responded recently', async () => {
    expect(choosePlan(input())).toEqual({ source: 'fork', why: 'warm', idleMs: 2 * MINUTE, isMaybeCold: false, contextTokens: 148_000 })
    expect(choosePlan(idle(FIVE_MINUTES_MS - 1))).toMatchObject({ source: 'fork', why: 'warm', isMaybeCold: false })
  })

  test('choosePlan forks while Claude is working whatever the idle', async () => {
    expect(choosePlan(idle(3 * 60 * MINUTE, { isWorking: true }))).toMatchObject({ source: 'fork', why: 'working', isMaybeCold: false })
    expect(choosePlan(idle(0, { isWorking: true }))).toMatchObject({ source: 'fork', why: 'working' })
  })

  test('choosePlan digests before any reply', async () => {
    expect(choosePlan(input({ lastResponseAt: null }))).toEqual({ source: 'digest', why: 'no-reply', idleMs: null, contextTokens: 148_000 })
    expect(choosePlan(input({ lastResponseAt: null, isWorking: true }))).toMatchObject({ source: 'digest', why: 'no-reply' })
  })

  test('choosePlan digests from five minutes idle, certainly cold or not', async () => {
    // Amended rule: in auto, five minutes is the only TTL every account is promised.
    expect(choosePlan(idle(FIVE_MINUTES_MS))).toMatchObject({ source: 'digest', why: 'cold', isCertainlyCold: false })
    expect(choosePlan(idle(12 * MINUTE))).toMatchObject({ source: 'digest', why: 'cold', isCertainlyCold: false })
    expect(choosePlan(idle(FIVE_MINUTES_MS, { ttl: PINNED_5M }))).toMatchObject({ source: 'digest', why: 'cold', isCertainlyCold: true })
    expect(choosePlan(idle(60 * MINUTE))).toMatchObject({ source: 'digest', why: 'cold', isCertainlyCold: true })
    expect(choosePlan(idle(60 * MINUTE - 1))).toMatchObject({ why: 'cold', isCertainlyCold: false })
  })

  test('choosePlan marks a forced fork idle past five minutes as maybe cold', async () => {
    const session = { ...DEFAULT_TUTOR_CONFIG, context: 'session' as const }
    expect(choosePlan(idle(FIVE_MINUTES_MS - 1, { config: session }))).toMatchObject({ source: 'fork', why: 'forced', isMaybeCold: false })
    expect(choosePlan(idle(FIVE_MINUTES_MS, { config: session }))).toMatchObject({ source: 'fork', why: 'forced', isMaybeCold: true })
    expect(choosePlan(idle(2 * 60 * MINUTE, { config: session }))).toMatchObject({ why: 'forced', isMaybeCold: true })
    // A running turn keeps the cache warm whatever the clock says.
    expect(choosePlan(idle(2 * 60 * MINUTE, { config: session, isWorking: true }))).toMatchObject({ why: 'forced', isMaybeCold: false })
  })

  test('choosePlan digests when the model changed', async () => {
    expect(choosePlan(input({ modelNow: 'claude-sonnet-4-5' }))).toMatchObject({ source: 'digest', why: 'model-changed' })
    // An unread model on either side is not evidence of a change.
    expect(choosePlan(input({ modelNow: null }))).toMatchObject({ source: 'fork', why: 'warm' })
    expect(choosePlan(input({ modelAtResponse: null }))).toMatchObject({ source: 'fork', why: 'warm' })
  })

  test('choosePlan digests over the fork context cap and forks at it', async () => {
    expect(choosePlan(input({ contextTokens: FORK_MAX_CONTEXT_TOKENS }))).toMatchObject({ source: 'fork', why: 'warm' })
    expect(choosePlan(input({ contextTokens: FORK_MAX_CONTEXT_TOKENS + 1 }))).toMatchObject({ source: 'digest', why: 'too-large', contextTokens: 300_001 })
    // The cap is checked before the working shortcut.
    expect(choosePlan(input({ contextTokens: 412_000, isWorking: true }))).toMatchObject({ source: 'digest', why: 'too-large' })
  })

  test('choosePlan digests with unknown context', async () => {
    const plan = choosePlan(input({ contextTokens: undefined }))
    expect(plan).toEqual({ source: 'digest', why: 'unknown-context', idleMs: 2 * MINUTE })
    expect('contextTokens' in plan).toBe(false)
    // A NaN size compares false against the cap, so it must not slip through to a fork.
    expect(choosePlan(input({ contextTokens: Number.NaN }))).toMatchObject({ source: 'digest', why: 'unknown-context' })
  })

  test('choosePlan digests after a fork missed the cache', async () => {
    expect(choosePlan(input({ isForkSuspect: true }))).toMatchObject({ source: 'digest', why: 'fork-missed-cache' })
    expect(choosePlan(input({ isForkSuspect: true, isWorking: true }))).toMatchObject({ source: 'digest', why: 'fork-missed-cache' })
  })

  test('choosePlan honours digest-only and config digest', async () => {
    expect(choosePlan(input({ isDigestOnly: true }))).toMatchObject({ source: 'digest', why: 'chosen' })
    expect(choosePlan(input({ isDigestOnly: true, lastResponseAt: null }))).toMatchObject({ why: 'chosen' })
    const digest = { ...DEFAULT_TUTOR_CONFIG, context: 'digest' as const }
    expect(choosePlan(input({ config: digest }))).toMatchObject({ source: 'digest', why: 'config' })
    expect(choosePlan(input({ config: digest, isDigestOnly: true }))).toMatchObject({ why: 'chosen' })
  })

  test('config session forces a fork but not before any reply', async () => {
    const session = { ...DEFAULT_TUTOR_CONFIG, context: 'session' as const }
    expect(choosePlan(input({ config: session, lastResponseAt: null }))).toMatchObject({ source: 'digest', why: 'no-reply' })
    // Forced skips the cost gates: the learner asked for the chat every time.
    const risky = input({ config: session, isForkSuspect: true, contextTokens: undefined, modelNow: 'claude-haiku-4-5' })
    expect(choosePlan(risky)).toMatchObject({ source: 'fork', why: 'forced', isMaybeCold: false })
    expect(choosePlan(input({ config: session, isDigestOnly: true }))).toMatchObject({ source: 'digest', why: 'chosen' })
  })

  test('choosePlan never reports a negative idle and distrusts a broken clock', async () => {
    expect(choosePlan(input({ lastResponseAt: NOW + 5000 }))).toMatchObject({ source: 'fork', why: 'warm', idleMs: 0 })
    // A broken clock reading is treated as no reply, never as a warm cache.
    expect(choosePlan(input({ lastResponseAt: Number.NaN }))).toMatchObject({ source: 'digest', why: 'no-reply', idleMs: null })
    expect(choosePlan(input({ now: Number.POSITIVE_INFINITY }))).toMatchObject({ source: 'digest', why: 'no-reply', idleMs: null })
  })
})

describe('planLabel', () => {
  test('planLabel words every reason and warns on maybe cold', async () => {
    const label = (plan: TutorPlan) => planLabel(plan, 'haiku')
    const fork = (why: 'warm' | 'working' | 'forced', idleMs: number, isMaybeCold = false): TutorPlan => ({ source: 'fork', why, idleMs, isMaybeCold })
    expect(label(fork('warm', 2 * MINUTE))).toEqual({ text: 'session · warm (2m idle)', isWarning: false })
    expect(label(fork('working', 0))).toEqual({ text: 'session · Claude is working', isWarning: false })
    expect(label(fork('forced', MINUTE))).toEqual({ text: 'session · forced in /config', isWarning: false })
    expect(label(fork('forced', 12 * MINUTE, true))).toEqual({ text: 'session · maybe warm (idle 12m): full price if the cache lapsed', isWarning: true })

    expect(label(choosePlan(idle(60 * MINUTE)))).toEqual({ text: 'digest · cache cold (idle 1h)', isWarning: false })
    expect(label(choosePlan(idle(5 * MINUTE, { ttl: PINNED_5M })))).toEqual({ text: 'digest · cache cold (idle 5m)', isWarning: false })
    expect(label(choosePlan(idle(12 * MINUTE)))).toEqual({ text: 'digest · cache may have lapsed (idle 12m)', isWarning: false })
    // Plans built without the certainty flag fall back to the unpinned one-hour rule.
    expect(label({ source: 'digest', why: 'cold', idleMs: 60 * MINUTE })).toEqual({ text: 'digest · cache cold (idle 1h)', isWarning: false })
    expect(label({ source: 'digest', why: 'cold', idleMs: 12 * MINUTE })).toEqual({ text: 'digest · cache may have lapsed (idle 12m)', isWarning: false })
    expect(label(choosePlan(input({ lastResponseAt: null })))).toEqual({ text: 'digest · no reply yet', isWarning: false })
    expect(label(choosePlan(input({ modelNow: 'claude-sonnet-4-5' })))).toEqual({ text: 'digest · model changed', isWarning: false })
    expect(label(choosePlan(input({ contextTokens: 412_000 })))).toEqual({ text: 'digest · chat too large (412k)', isWarning: false })
    expect(label(choosePlan(input({ isForkSuspect: true })))).toEqual({ text: 'digest · last fork missed the cache', isWarning: false })
    expect(label(choosePlan(input({ config: { ...DEFAULT_TUTOR_CONFIG, context: 'digest' } })))).toEqual({ text: 'digest · set in /config', isWarning: false })
    expect(label(choosePlan(input({ isDigestOnly: true })))).toEqual({ text: 'digest · you chose it', isWarning: false })
    expect(label(choosePlan(input({ contextTokens: undefined })))).toEqual({ text: 'digest · chat size unknown', isWarning: false })
  })
})

describe('isForkMiss', () => {
  test('isForkMiss at 0.49, 0.5 and all-zero usage', async () => {
    expect(isForkMiss(usage(49, 51, 0))).toBe(true)
    expect(isForkMiss(usage(49, 0, 51))).toBe(true)
    expect(isForkMiss(usage(50, 25, 25))).toBe(false)
    expect(isForkMiss(usage(148_000, 1_000, 100))).toBe(false)
    expect(isForkMiss(usage(0, 0, 0))).toBe(true)
    expect(isForkMiss(usage(Number.NaN, 0, 0))).toBe(true)
  })
})
