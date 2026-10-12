import type { CacheTotals, Measure, Provider } from '../types'
import { billedBy, formatSpan, formatTokens, formatUsd, hitRatio, isCacheUnreported, isClaudeModelId, isMetered, shortModel, windowLabel } from './meter'

/** Everything `/mascot meter` reports on. */
export type ReportInput = {
  readonly modelId: string | null
  readonly provider: Provider
  readonly measure: Measure | null
  readonly cache: CacheTotals
  /** Time since the last main-thread response, null before one. */
  readonly idleMs: number | null
  readonly isCold: boolean
  /** When the cache is certainly cold, in ms after the last response. */
  readonly coldAfterMs: number
}

const PROVIDER_NAMES: Readonly<Record<Provider, string>> = {
  subscription: 'Claude subscription',
  'api-key': 'Claude API key',
  anthropic: 'Anthropic (first-party)',
  bedrock: 'Amazon Bedrock',
  vertex: "Google Cloud's Agent Platform",
  foundry: 'Microsoft Foundry (Azure)',
  'anthropic-aws': 'Claude Platform on AWS',
  gateway: 'Gateway / custom base URL',
  unknown: 'unknown',
}

/** What the provider changes about reading these figures, from each provider's own docs. */
const PROVIDER_NOTES: Readonly<Record<Provider, readonly string[]>> = {
  subscription: [
    'The cost figure is not billed on a plan; the 5h and 7d windows are your limit.',
    'The main conversation caches for 1h within plan usage, 5m once you draw on usage credits.',
  ],
  'api-key': [
    'Cost is estimated at list price (or your org\'s modelPricing); the Console usage page is the bill.',
    'Cache TTL defaults to 5m: set promptCacheTtl to 1h if you often step away mid-task.',
  ],
  anthropic: ['Plan windows appear after the first response if this is a subscription.'],
  bedrock: [
    'Billed by AWS; the cost here is a list-price estimate.',
    'Prompt caching, its minimum prefix and the 1h TTL vary by model on Bedrock.',
  ],
  vertex: ['Billed by Google Cloud; the cost here is a list-price estimate. Cache TTL defaults to 5m.'],
  foundry: [
    'Billed by Azure in Claude Consumption Units; the cost here is a list-price estimate.',
    'Cache TTL defaults to 5m (ENABLE_PROMPT_CACHING_1H for 1h). Cache reads do not count toward Foundry\'s ITPM quota.',
  ],
  'anthropic-aws': ['Billed through AWS; the cost here is a list-price estimate.'],
  gateway: [
    'Caching works only if the gateway forwards cache_control markers; the 1h TTL also needs the anthropic-beta header.',
  ],
  unknown: ['No provider flag, key or plan reported yet.'],
}

const FOUNDRY_DEFAULT_WINDOW = 200_000

/**
 * Whether a Foundry window looks like Claude Code's fallback: it assumes 200K for a deployment
 * name it cannot map to a model, even when the deployment serves a 1M model.
 */
export const isFoundryWindowSuspect = (provider: Provider, window: number | undefined, modelId: string | null): boolean =>
  provider === 'foundry' && window === FOUNDRY_DEFAULT_WINDOW && modelId !== null && !isClaudeModelId(modelId)

/** What the dollar figure is, for this provider. */
const costNote = (provider: Provider): string => {
  if (isMetered(provider)) return 'est'
  return provider === 'subscription' ? 'at API rates (not billed on a plan)' : 'at API rates (billing not known yet)'
}

const row = (label: string, value: string): string => `${label.padEnd(10)}${value}`
const percent = (value: number): string => `${Math.round(value)}%`

const contextRow = (measure: Measure | null): string => {
  if (measure === null) return row('context', 'no measurement yet')
  if (measure.window <= 0) return row('context', 'window size not reported')
  const window = formatTokens(measure.window)
  if (measure.tokens === undefined || measure.percent === undefined) return row('context', `— of ${window} (until the next response)`)
  return row('context', `${formatTokens(measure.tokens)} of ${window} (${percent(measure.percent)})`)
}

const cacheRows = (cache: CacheTotals): readonly string[] => {
  const ratio = hitRatio(cache)
  if (ratio === null) return [row('cache', 'no main-thread response yet')]
  const summary = isCacheUnreported(cache)
    ? 'not reported: every turn is billed as uncached input'
    : `${percent(ratio * 100)} of input read from cache over ${cache.turns} turn${cache.turns === 1 ? '' : 's'}`
  const detail = `read ${formatTokens(cache.read)} · written ${formatTokens(cache.write)} · uncached ${formatTokens(cache.uncached)} · output ${formatTokens(cache.output)}`
  return [row('cache', summary), row('', detail)]
}

/** Providers whose main conversation caches for five minutes unless a TTL is chosen. */
const FIVE_MINUTE_DEFAULT: ReadonlySet<Provider> = new Set(['api-key', 'bedrock', 'vertex', 'foundry', 'anthropic-aws'])
const FIVE_MINUTES = 5 * 60_000

const idleRow = ({ idleMs, isCold, coldAfterMs, provider }: ReportInput): string | null => {
  if (idleMs === null) return null
  const state = isCold
    ? 'cache cold: the next turn re-reads the whole context'
    : FIVE_MINUTE_DEFAULT.has(provider) && idleMs >= FIVE_MINUTES
      ? `likely cold if the default 5m TTL applies; certainly after ${formatSpan(coldAfterMs)}`
      : `cache certainly cold after ${formatSpan(coldAfterMs)} idle`
  return row('idle', `${formatSpan(idleMs)} · ${state}`)
}

/** The `/mascot meter` report: every figure the band abbreviates, plus what the provider changes about them. */
export const meterReport = (input: ReportInput): string => {
  const { modelId, provider, measure, cache } = input
  const lines: string[] = ['Session meter', '']
  lines.push(row('model', modelId === null ? 'not known yet' : `${shortModel(modelId)} (${modelId})`))
  lines.push(row('provider', `${PROVIDER_NAMES[provider]} · billed by ${billedBy(provider)}`))
  lines.push(contextRow(measure))
  lines.push(...cacheRows(cache))
  const idle = idleRow(input)
  if (idle !== null) lines.push(idle)
  const limits = measure?.limits ?? []
  if (limits.length > 0) lines.push(row('limits', limits.map(window => `${windowLabel(window.kind)} ${percent(window.percentUsed)}`).join(' · ')))
  if (measure?.costUsd !== undefined) {
    lines.push(row('cost', `${formatUsd(measure.costUsd)} ${costNote(provider)}`))
  }

  const notes = [...PROVIDER_NOTES[provider]]
  if (isFoundryWindowSuspect(provider, measure?.window, modelId)) {
    notes.push('The window reads 200K because the deployment name is not a model ID. If it serves a 1M model, name it with the model ID or map it with modelOverrides.')
  }
  notes.push('Provider details follow each provider\'s docs as of October 2026; sources are in the README.')
  lines.push('', 'notes', ...notes.map(note => `  - ${note}`))
  return lines.join('\n')
}
