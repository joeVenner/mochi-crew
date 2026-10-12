import type { CacheTotals, LimitWindow, Measure, Provider } from '../types'
import { BAR_GLYPH, barCells, column, gutter } from './hud'
import { formatSpan, formatTokens, formatUsd, hitRatio, isCacheUnreported, isMetered, shortModel, windowLabel } from './meter'

/**
 * How a piece of a meter row is drawn, matching the HUD's rules: dim labels, one accent for
 * bars, the theme's alert color only when a figure needs you, a muted track for empty cells.
 */
export type Tone = 'label' | 'value' | 'strong' | 'accent' | 'track' | 'alert' | 'dim'

/** One run of text in one tone. */
export type Cell = { readonly text: string; readonly tone: Tone }

/** One HUD line of the meter group; `key` is stable for the renderer. */
export type MeterRow = { readonly key: string; readonly cells: readonly Cell[] }

/** Everything the meter rows show, already read from the session. */
export type MeterView = {
  readonly modelId: string | null
  readonly provider: Provider
  readonly measure: Measure | null
  readonly cache: CacheTotals
  /** Time since the last main-thread turn ended, null before one or while a turn runs. */
  readonly idleMs: number | null
  /** Whether the prompt cache has certainly expired. */
  readonly isCold: boolean
}

/** Context fill that turns the row to the alert color: auto-compact is close. */
export const CONTEXT_ALERT_PERCENT = 85
/** Plan window use that turns its row to the alert color. */
export const LIMIT_ALERT_PERCENT = 90
/** Idle time below this is not worth showing. */
export const IDLE_SHOWN_FROM_MS = 60_000

/** Short provider tags for the model row: who serves the session, in the HUD's lowercase voice. */
const PROVIDER_TAGS: Readonly<Record<Provider, string>> = {
  subscription: 'plan',
  'api-key': 'api key',
  anthropic: 'claude',
  bedrock: 'bedrock',
  vertex: 'vertex',
  foundry: 'foundry',
  'anthropic-aws': 'aws',
  gateway: 'gateway',
  unknown: '',
}

const bar = (percent: number, width: number, tone: Tone): readonly Cell[] => {
  const { filled, empty } = barCells(percent / 100, width)
  const cells: Cell[] = []
  if (filled > 0) cells.push({ text: BAR_GLYPH.repeat(filled), tone })
  if (empty > 0) cells.push({ text: BAR_GLYPH.repeat(empty), tone: 'track' })
  return cells
}

const modelRow = (view: MeterView): MeterRow => {
  const tag = PROVIDER_TAGS[view.provider]
  return {
    key: 'meter-model',
    cells: [
      { text: gutter('model'), tone: 'label' },
      { text: view.modelId === null ? '–' : shortModel(view.modelId), tone: 'strong' },
      ...(tag === '' ? [] : [{ text: `  ${tag}`, tone: 'dim' as const }]),
    ],
  }
}

const contextRow = (measure: Measure, barWidth: number): MeterRow => {
  const percent = measure.tokens === undefined ? undefined : measure.percent
  const tone: Tone = percent !== undefined && percent >= CONTEXT_ALERT_PERCENT ? 'alert' : 'accent'
  const fraction = measure.window > 0 ? `  ${measure.tokens === undefined ? '—' : formatTokens(measure.tokens)}/${formatTokens(measure.window)}` : ''
  return {
    key: 'meter-context',
    cells: [
      { text: gutter('context'), tone: 'label' },
      { text: `${column(percent === undefined ? '–' : String(Math.round(percent)), 3)}  `, tone: tone === 'alert' ? 'alert' : 'strong' },
      ...bar(percent ?? 0, barWidth, tone),
      ...(fraction === '' ? [] : [{ text: fraction, tone: 'dim' as const }]),
    ],
  }
}

const cacheRow = (view: MeterView): MeterRow => {
  const label: Cell = { text: gutter('cache'), tone: 'label' }
  if (isCacheUnreported(view.cache)) return { key: 'meter-cache', cells: [label, { text: 'not reported', tone: 'alert' }] }
  const ratio = hitRatio(view.cache)
  const idle: Cell[] = view.idleMs === null || view.idleMs < IDLE_SHOWN_FROM_MS
    ? []
    : [
        { text: `  idle ${formatSpan(view.idleMs)}`, tone: 'dim' },
        ...(view.isCold ? [{ text: ' cold', tone: 'accent' as const }] : []),
      ]
  return {
    key: 'meter-cache',
    cells: [label, { text: column(ratio === null ? '–' : `${Math.round(ratio * 100)}%`, 3), tone: 'strong' }, ...idle],
  }
}

/**
 * The plan row: the fullest window as a bar under its own label (`5h`), the others as a
 * note, plus the estimate on a metered gateway. One row however many windows there are.
 */
const limitsRow = (limits: readonly LimitWindow[], costNote: string, barWidth: number): MeterRow | null => {
  const fullest = [...limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (fullest === undefined) return null
  const tone: Tone = fullest.percentUsed >= LIMIT_ALERT_PERCENT ? 'alert' : 'accent'
  const others = limits
    .filter(window => window !== fullest)
    .map(window => `${windowLabel(window.kind)} ${Math.round(window.percentUsed)}%`)
  const note = [...others, ...(costNote === '' ? [] : [costNote])].join(' · ')
  return {
    key: 'meter-limits',
    cells: [
      { text: gutter(windowLabel(fullest.kind)), tone: 'label' },
      { text: `${column(String(Math.round(fullest.percentUsed)), 3)}  `, tone: tone === 'alert' ? 'alert' : 'strong' },
      ...bar(fullest.percentUsed, barWidth, tone),
      ...(note === '' ? [] : [{ text: `  ${note}`, tone: 'dim' as const }]),
    ],
  }
}

const costNoteFor = (view: MeterView): string =>
  isMetered(view.provider) && view.measure?.costUsd !== undefined ? `${formatUsd(view.measure.costUsd)} est` : ''

/**
 * The meter's HUD rows: model, context, cache, then plan windows or the cost estimate.
 * Nothing before the first measurement, so the HUD does not grow empty rows. Every row is
 * one line; the renderer truncates rather than wraps, so the row count stays exact.
 */
export const meterRows = (view: MeterView, barWidth: number): readonly MeterRow[] => {
  if (view.measure === null) return []
  const costNote = costNoteFor(view)
  const limits = limitsRow(view.measure.limits, costNote, barWidth)
  const cost: MeterRow | null = limits === null && costNote !== ''
    ? { key: 'meter-cost', cells: [{ text: gutter('cost'), tone: 'label' }, { text: formatUsd(view.measure.costUsd ?? 0), tone: 'strong' }, { text: ' est', tone: 'dim' }] }
    : null
  return [modelRow(view), contextRow(view.measure, barWidth), cacheRow(view), ...(limits === null ? [] : [limits]), ...(cost === null ? [] : [cost])]
}

/** The meter in one line for a compact pane: `ctx 62% · cache 91% · 5h 34%`, null before a measurement. */
export const meterSummary = (view: MeterView): string | null => {
  const measure = view.measure
  if (measure === null) return null
  const parts: string[] = []
  parts.push(`ctx ${measure.tokens === undefined || measure.percent === undefined ? '–' : `${Math.round(measure.percent)}%`}`)
  const ratio = hitRatio(view.cache)
  if (isCacheUnreported(view.cache)) parts.push('cache off')
  else if (ratio !== null) parts.push(`cache ${Math.round(ratio * 100)}%`)
  const fullest = [...measure.limits].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  if (fullest !== undefined) parts.push(`${windowLabel(fullest.kind)} ${Math.round(fullest.percentUsed)}%`)
  else {
    const costNote = costNoteFor(view)
    if (costNote !== '') parts.push(costNote)
  }
  return parts.join(' · ')
}
