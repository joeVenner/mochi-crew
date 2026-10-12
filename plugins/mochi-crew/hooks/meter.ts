import type { HookFailure } from 'claude-code'

import type { CacheTotals, Provider } from '../types'

/** The environment variables that pick the provider, read with string literals in register. */
export type ProviderEnv = {
  readonly CLAUDE_CODE_USE_ANTHROPIC_AWS?: string
  readonly CLAUDE_CODE_USE_BEDROCK?: string
  readonly CLAUDE_CODE_USE_MANTLE?: string
  readonly CLAUDE_CODE_USE_VERTEX?: string
  readonly CLAUDE_CODE_USE_FOUNDRY?: string
  readonly ANTHROPIC_BASE_URL?: string
}

/** What the session tells us about who serves it. */
export type ProviderSignals = {
  readonly env: ProviderEnv
  /** `$.session.authorize()`'s kind; null with no first-party credential. */
  readonly authKind: 'bearer' | 'api-key' | null
  /** Kinds of the rate-limit windows the last response reported. */
  readonly limitKinds: readonly string[]
}

const TRUTHY_FLAGS = new Set(['1', 'true', 'yes', 'on'])

/**
 * Whether an env flag is on, the way Claude Code reads `CLAUDE_CODE_USE_*`: only an explicit
 * yes counts, so a value Claude Code ignores (`enabled`, `2`) never picks a provider here.
 */
export const isFlagOn = (value: string | undefined): boolean =>
  value !== undefined && TRUTHY_FLAGS.has(value.trim().toLowerCase())

/** The host of a URL, lowercased, without a URL parser (the module has no DOM or Node globals). */
export const hostOf = (url: string): string | null => {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#]+)/i.exec(url.trim())
  return match?.[1]?.toLowerCase() ?? null
}

const isAnthropicHost = (host: string): boolean => host === 'anthropic.com' || host.endsWith('.anthropic.com')

/**
 * Who serves the session. Explicit provider flags win, then a gateway (a spend-limit window
 * or a non-Anthropic base URL), then what the account reports: plan windows mean a
 * subscription, an API key means Console billing. A first-party bearer without plan
 * windows yet stays `anthropic` rather than guessing.
 */
export const detectProvider = ({ env, authKind, limitKinds }: ProviderSignals): Provider => {
  if (isFlagOn(env.CLAUDE_CODE_USE_ANTHROPIC_AWS)) return 'anthropic-aws'
  // Mantle is a Bedrock endpoint, billed by AWS like Bedrock itself.
  if (isFlagOn(env.CLAUDE_CODE_USE_BEDROCK) || isFlagOn(env.CLAUDE_CODE_USE_MANTLE)) return 'bedrock'
  if (isFlagOn(env.CLAUDE_CODE_USE_VERTEX)) return 'vertex'
  if (isFlagOn(env.CLAUDE_CODE_USE_FOUNDRY)) return 'foundry'
  if (limitKinds.includes('spend_limit')) return 'gateway'
  // Only a Claude plan reports 5h/7d windows, so they win over a proxy in ANTHROPIC_BASE_URL.
  if (limitKinds.includes('five_hour') || limitKinds.includes('seven_day')) return 'subscription'
  const baseHost = env.ANTHROPIC_BASE_URL === undefined ? null : hostOf(env.ANTHROPIC_BASE_URL)
  if (baseHost !== null && !isAnthropicHost(baseHost)) return 'gateway'
  if (authKind === 'api-key') return 'api-key'
  if (authKind === 'bearer') return 'anthropic'
  return 'unknown'
}

/**
 * Keeps a subscription verdict once made: Claude Code drops a plan window when its reset time
 * passes, which would otherwise flip the meter back to first-party-unknown and show dollars.
 */
export const settleProvider = (previous: Provider, detected: Provider): Provider =>
  previous === 'subscription' && detected === 'anthropic' ? 'subscription' : detected

/**
 * Whether the provider is known to bill per token, so a dollar estimate means something. A
 * first-party sign-in without plan windows yet (a resumed session before its first response)
 * may well be a plan, so it counts as unknown rather than metered.
 */
export const isMetered = (provider: Provider): boolean =>
  provider !== 'subscription' && provider !== 'anthropic' && provider !== 'unknown'

const WINDOW_LABELS: Readonly<Record<string, string>> = { five_hour: '5h', seven_day: '7d', spend_limit: 'spend' }

/** A rate-limit window's short label: `5h`, `7d`, `spend`, or its own kind. */
export const windowLabel = (kind: string): string => WINDOW_LABELS[kind] ?? kind

/** Who sends the bill, for the meter report notes. */
export const billedBy = (provider: Provider): string => {
  switch (provider) {
    case 'subscription': return 'your Claude plan (cost shown is not billed)'
    case 'api-key': return 'Claude Console, per token'
    case 'anthropic': return 'Anthropic (plan or key not reported yet)'
    case 'bedrock': return 'AWS, per token'
    case 'vertex': return 'Google Cloud, per token'
    case 'foundry': return 'Azure (Claude Consumption Units), per token'
    case 'anthropic-aws': return 'AWS Marketplace, per token'
    case 'gateway': return 'your gateway'
    case 'unknown': return 'unknown'
  }
}

const MAX_MODEL_LABEL = 18

/**
 * A model id without its provider wrapping: region and vendor prefixes, ARN paths, `@date`,
 * `-v1:0`, date stamps and a `[1m]` suffix. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`
 * → `claude-sonnet-4-5`; a deployment name comes back as given.
 */
export const baseModelId = (id: string): string => {
  let name = id.trim().replace(/\[[^\]]*\]$/, '')
  name = name.slice(name.lastIndexOf('/') + 1)
  const vendorAt = name.indexOf('anthropic.')
  if (vendorAt >= 0) name = name.slice(vendorAt + 'anthropic.'.length)
  return name.replace(/@.*$/, '').replace(/-v\d+(?::\d+)?$/, '').replace(/-\d{8}$/, '')
}

/** Whether an id names a Claude model, rather than a deployment or profile name Claude Code cannot map. */
export const isClaudeModelId = (id: string): boolean => baseModelId(id).startsWith('claude-')

/**
 * A short model label from any provider's id: `claude-opus-5-5[1m]` → `opus 5.5`,
 * `us.anthropic.claude-sonnet-4-5-20250929-v1:0` → `sonnet 4.5`, `claude-3-5-haiku@20241022`
 * → `haiku 3.5`. Anything else (a Foundry deployment name, an inference profile) is kept,
 * cut to fit.
 */
export const shortModel = (id: string): string => {
  let name = baseModelId(id)
  if (name.startsWith('claude-')) {
    const parts = name.slice('claude-'.length).split('-').filter(part => part !== '')
    const family = parts.find(part => !/^\d+$/.test(part))
    if (family !== undefined) {
      const version = parts.filter(part => /^\d+$/.test(part)).join('.')
      const extras = parts.filter(part => part !== family && !/^\d+$/.test(part))
      name = [family, version, ...extras].filter(part => part !== '').join(' ')
    }
  }
  if (name === '') return id.trim().slice(0, MAX_MODEL_LABEL) || '?'
  return name.length > MAX_MODEL_LABEL ? `${name.slice(0, MAX_MODEL_LABEL - 1)}…` : name
}

/** Token counts the way the meter prints them: `950`, `9.5k`, `620k`, `1M`, `1.2M`. */
export const formatTokens = (count: number): string => {
  if (!Number.isFinite(count)) return '—'
  const n = Math.max(0, Math.round(count))
  if (n < 1000) return String(n)
  if (n < 10_000) return `${trimZero((n / 1000).toFixed(1))}k`
  if (n < 999_500) return `${Math.round(n / 1000)}k`
  return `${trimZero((n / 1_000_000).toFixed(1))}M`
}

const trimZero = (fixed: string): string => fixed.replace(/\.0$/, '')

/** A short span: `12s`, `4m`, `1h5m`, `3h`. */
export const formatSpan = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h${rest}m`
}

/** Dollars with cents, or tenths of a cent under a dime: `$4.12`, `$0.031`. */
export const formatUsd = (usd: number): string => {
  if (!Number.isFinite(usd)) return '$—'
  const value = Math.max(0, usd)
  return value < 0.1 && value > 0 ? `$${value.toFixed(3)}` : `$${value.toFixed(2)}`
}

export const EMPTY_CACHE: CacheTotals = { turns: 0, read: 0, write: 0, uncached: 0, output: 0 }

/** The four token counts one turn's usage carries, in the API's spelling. */
export type UsageCounts = {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_read_input_tokens: number
  readonly cache_creation_input_tokens: number
}

const count = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)

/** Adds one main-thread turn's usage to the totals. */
export const addUsage = (totals: CacheTotals, usage: UsageCounts): CacheTotals => ({
  turns: totals.turns + 1,
  read: totals.read + count(usage.cache_read_input_tokens),
  write: totals.write + count(usage.cache_creation_input_tokens),
  uncached: totals.uncached + count(usage.input_tokens),
  output: totals.output + count(usage.output_tokens),
})

/**
 * Cache reads over all input, 0 to 1: the status line's `hit_ratio` formula. Null while
 * there is no input yet.
 */
export const hitRatio = (totals: CacheTotals): number | null => {
  const input = totals.read + totals.write + totals.uncached
  return input === 0 ? null : totals.read / input
}

/** Turns with usage before an all-zero cache means caching is off or stripped, not just warming up. */
export const CACHE_PROOF_TURNS = 3

/**
 * Whether the provider or gateway reports no prompt caching at all: several turns in and not
 * one token read from or written to the cache (caching disabled, or a gateway stripping the
 * cache markers, which bills the whole conversation uncached every turn).
 */
export const isCacheUnreported = (totals: CacheTotals): boolean =>
  totals.turns >= CACHE_PROOF_TURNS && totals.read === 0 && totals.write === 0

/** The env variables that pin the main conversation's cache TTL, read in register. */
export type TtlEnv = {
  readonly FORCE_PROMPT_CACHING_5M?: string
  readonly CLAUDE_CODE_PROMPT_CACHE_TTL?: string
}

const FIVE_MINUTES = 5 * 60_000
const ONE_HOUR = 60 * 60_000

/**
 * How long after the last response the cache is certainly cold. Only the two top-precedence
 * controls can pin five minutes; anything else (plan default, usage credits, settings) is
 * at most an hour, so an hour is the one claim that is always true.
 */
export const certainlyColdAfterMs = (env: TtlEnv): number =>
  isFlagOn(env.FORCE_PROMPT_CACHING_5M) || env.CLAUDE_CODE_PROMPT_CACHE_TTL?.trim() === '5m' ? FIVE_MINUTES : ONE_HOUR

/** Whether the cache has certainly expired after `idleMs` without a main-thread response. */
export const isCertainlyCold = (idleMs: number, env: TtlEnv): boolean => idleMs >= certainlyColdAfterMs(env)

/** A hook failure in words for the debug log: its message when it has one, else its kind. */
export const describeFailure = (failure: Pick<HookFailure, 'kind' | 'message'>): string => failure.message ?? failure.kind
