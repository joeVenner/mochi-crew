import type { ModelUsage, PluginOptions } from 'claude-code'

import { formatSpan, formatTokens, isCertainlyCold } from './meter'
import type { TtlEnv } from './meter'

/** The tutor's two `/config` pickers, already checked against their options. */
export type TutorConfig = { readonly model: 'haiku' | 'sonnet' | 'opus'; readonly context: 'auto' | 'digest' | 'session' }

/** What the tutor uses when `/config` says nothing, or something it does not offer. */
export const DEFAULT_TUTOR_CONFIG: TutorConfig = { model: 'haiku', context: 'auto' }

/** Above this many context tokens a fork re-reads too much to be worth it; the digest is capped instead. */
export const FORK_MAX_CONTEXT_TOKENS = 300_000

/** The one cache TTL every account is guaranteed; past it a fork may re-bill the whole chat. */
export const FIVE_MINUTES_MS = 300_000

const TUTOR_MODELS: readonly TutorConfig['model'][] = ['haiku', 'sonnet', 'opus']
const TUTOR_CONTEXTS: readonly TutorConfig['context'][] = ['auto', 'digest', 'session']

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.find(option => option === value) ?? fallback

/**
 * The tutor config from the plugin's options. Each field falls back to its default on its own,
 * so one unknown or mistyped value never resets the other.
 */
export const parseTutorConfig = (options: PluginOptions): TutorConfig => ({
  model: pick(options.tutorModel, TUTOR_MODELS, DEFAULT_TUTOR_CONFIG.model),
  context: pick(options.tutorContext, TUTOR_CONTEXTS, DEFAULT_TUTOR_CONFIG.context),
})

/** Everything `choosePlan` weighs, read from the session at press or draw time. */
export type TutorPlanInput = {
  readonly config: TutorConfig
  /** The learner pressed `g` on Home: use the digest this time. */
  readonly isDigestOnly: boolean
  /** When the main thread last responded, null before any response or after `/clear`. */
  readonly lastResponseAt: number | null
  readonly now: number
  /** Whether a main-thread turn is running, which keeps its cache warm. */
  readonly isWorking: boolean
  readonly ttl: TtlEnv
  readonly contextTokens: number | undefined
  readonly modelNow: string | null
  readonly modelAtResponse: string | null
  /** The latch a cache-missing fork sets, cleared by the next main-thread turn. */
  readonly isForkSuspect: boolean
}

/** Why a round reads the digest instead of forking the chat. */
export type TutorDigestWhy = 'chosen' | 'config' | 'no-reply' | 'fork-missed-cache' | 'model-changed' | 'unknown-context' | 'too-large' | 'cold'

/** Where the next round's questions come from, and why. */
export type TutorPlan =
  | { readonly source: 'fork'; readonly why: 'warm' | 'working' | 'forced'; readonly idleMs: number | null; readonly isMaybeCold: boolean; readonly contextTokens?: number }
  | {
      readonly source: 'digest'
      readonly why: TutorDigestWhy
      readonly idleMs: number | null
      readonly contextTokens?: number
      /** Set on `cold` only: whether the TTL is known to have passed, which the label words apart. */
      readonly isCertainlyCold?: boolean
    }

const withTokens = (contextTokens: number | undefined): { readonly contextTokens?: number } =>
  contextTokens === undefined ? {} : { contextTokens }

/**
 * Fork or digest for the next round. The rules run in a fixed order: the learner's and the
 * config's choice first, then every gate that would make a fork fail or re-bill the chat. In
 * `auto`, a fork happens only while Claude works or within five minutes of its last response,
 * since a longer TTL is never certain and a lapsed cache bills the whole prefix again.
 */
export const choosePlan = (input: TutorPlanInput): TutorPlan => {
  const { config, contextTokens } = input
  // A non-finite clock reading proves nothing about the cache, so it counts as no reply: every
  // comparison against NaN is false and would otherwise fall through to a fork.
  const rawIdleMs = input.lastResponseAt === null ? Number.NaN : input.now - input.lastResponseAt
  const idleMs = Number.isFinite(rawIdleMs) ? Math.max(0, rawIdleMs) : null
  const tokens = withTokens(contextTokens)
  const digest = (why: TutorDigestWhy): Extract<TutorPlan, { source: 'digest' }> => ({ source: 'digest', why, idleMs, ...tokens })

  if (input.isDigestOnly) return digest('chosen')
  if (config.context === 'digest') return digest('config')
  // There is nothing to fork before the first response; `model.fork` would refuse.
  if (idleMs === null) return digest('no-reply')
  if (config.context === 'session') {
    return { source: 'fork', why: 'forced', idleMs, isMaybeCold: !input.isWorking && idleMs >= FIVE_MINUTES_MS, ...tokens }
  }
  if (input.isForkSuspect) return digest('fork-missed-cache')
  // A different model has its own cache, so the fork would re-read the chat at full price.
  if (input.modelNow !== null && input.modelAtResponse !== null && input.modelNow !== input.modelAtResponse) return digest('model-changed')
  if (contextTokens === undefined || !Number.isFinite(contextTokens)) return digest('unknown-context')
  if (contextTokens > FORK_MAX_CONTEXT_TOKENS) return digest('too-large')
  if (input.isWorking) return { source: 'fork', why: 'working', idleMs, isMaybeCold: false, ...tokens }
  if (idleMs >= FIVE_MINUTES_MS) return { ...digest('cold'), isCertainlyCold: isCertainlyCold(idleMs, input.ttl) }
  return { source: 'fork', why: 'warm', idleMs, isMaybeCold: false, ...tokens }
}

/** Home's wording per digest reason; `cold` and `too-large` carry a figure and are built in `planLabel`. */
const DIGEST_TEXT: Readonly<Record<Exclude<TutorDigestWhy, 'cold' | 'too-large'>, string>> = {
  chosen: 'digest · you chose it',
  config: 'digest · set in /config',
  'no-reply': 'digest · no reply yet',
  'fork-missed-cache': 'digest · last fork missed the cache',
  'model-changed': 'digest · model changed',
  'unknown-context': 'digest · chat size unknown',
}

/**
 * Home's `ctx` line for a plan. Only a forced fork that may hit a lapsed cache warns: every
 * other path already picked the cheap source. `model` is the tutor model, accepted so the
 * label can name it; the Home copy does not, since the loading screen already shows it.
 */
export const planLabel = (plan: TutorPlan, model: string): { readonly text: string; readonly isWarning: boolean } => {
  const idle = plan.idleMs === null ? null : formatSpan(plan.idleMs)
  if (plan.source === 'fork') {
    if (plan.why === 'working') return { text: 'session · Claude is working', isWarning: false }
    if (plan.isMaybeCold) return { text: `session · maybe warm (idle ${idle ?? '?'}): full price if the cache lapsed`, isWarning: true }
    if (plan.why === 'forced') return { text: 'session · forced in /config', isWarning: false }
    return { text: `session · warm (${idle ?? '?'} idle)`, isWarning: false }
  }
  if (plan.why === 'too-large') return { text: `digest · chat too large (${formatTokens(plan.contextTokens ?? 0)})`, isWarning: false }
  if (plan.why !== 'cold') return { text: DIGEST_TEXT[plan.why], isWarning: false }
  // A plan built by hand has no certainty flag; an unpinned TTL's hour is the safe claim then.
  const isCold = plan.isCertainlyCold ?? (plan.idleMs !== null && isCertainlyCold(plan.idleMs, {}))
  return isCold
    ? { text: `digest · cache cold (idle ${idle ?? '?'})`, isWarning: false }
    : { text: `digest · cache may have lapsed (idle ${idle ?? '?'})`, isWarning: false }
}

/** Share of a fork's input read from the cache below which it counts as having missed. */
const FORK_HIT_SHARE = 0.5

const tokenCount = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

/**
 * Whether a fork re-read the chat instead of reading it from the cache: under half its input
 * was a cache read. No input at all counts as a miss too, since nothing proves the cache held.
 */
export const isForkMiss = (usage: ModelUsage): boolean => {
  const read = tokenCount(usage.cache_read_input_tokens)
  const total = read + tokenCount(usage.cache_creation_input_tokens) + tokenCount(usage.input_tokens)
  return total === 0 || read / total < FORK_HIT_SHARE
}
