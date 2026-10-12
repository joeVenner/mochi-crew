import { describe, expect, test } from 'claude-code/testing'

import type { Measure } from '../types'
import { BAR_GLYPH, barWidthFor } from '../hooks/hud'
import { EMPTY_CACHE } from '../hooks/meter'
import { meterRows, meterSummary } from '../hooks/meterRows'
import type { MeterRow, MeterView } from '../hooks/meterRows'

const textOf = (row: MeterRow | undefined): string => row?.cells.map(cell => cell.text).join('') ?? ''
const toneOf = (row: MeterRow | undefined, text: string): string | undefined => row?.cells.find(cell => cell.text.includes(text))?.tone
const rowNamed = (rows: readonly MeterRow[], key: string): MeterRow | undefined => rows.find(row => row.key === key)

const measure = (over: Partial<Measure> = {}): Measure => ({ tokens: 620_000, window: 1_000_000, percent: 62, limits: [], costUsd: 4.12, ...over })
const view = (over: Partial<MeterView> = {}): MeterView => ({
  modelId: 'claude-opus-5-5',
  provider: 'api-key',
  measure: measure(),
  cache: { turns: 4, read: 910, write: 60, uncached: 30, output: 5 },
  idleMs: 2 * 60_000,
  isCold: false,
  ...over,
})

const BAR = 10

describe('meter rows', () => {
  test('nothing before the first measurement', async () => {
    expect(meterRows(view({ measure: null }), BAR)).toEqual([])
    expect(meterSummary(view({ measure: null }))).toBe(null)
  })

  test('an API key session: model, context, cache and cost, four rows', async () => {
    const rows = meterRows(view(), BAR)
    expect(rows.map(row => row.key)).toEqual(['meter-model', 'meter-context', 'meter-cache', 'meter-cost'])
    expect(textOf(rows[0])).toBe('model   opus 5.5  api key')
    expect(textOf(rows[1])).toBe(`context  62  ${BAR_GLYPH.repeat(BAR)}  620k/1M`)
    expect(textOf(rows[2])).toBe('cache   91%  idle 2m')
    expect(textOf(rows[3])).toBe('cost    $4.12 est')
  })

  test('a subscription shows its fullest window as a bar, the rest as a note, and no dollars', async () => {
    const limits = [{ kind: 'five_hour', percentUsed: 34 }, { kind: 'seven_day', percentUsed: 61 }]
    const rows = meterRows(view({ provider: 'subscription', measure: measure({ limits }) }), BAR)
    expect(rows.map(row => row.key)).toEqual(['meter-model', 'meter-context', 'meter-cache', 'meter-limits'])
    expect(textOf(rowNamed(rows, 'meter-limits'))).toBe(`7d       61  ${BAR_GLYPH.repeat(BAR)}  5h 34%`)
    expect(textOf(rows[0])).toBe('model   opus 5.5  plan')
    expect(rows.some(row => textOf(row).includes('$'))).toBe(false)
  })

  test('a gateway spend window carries the estimate in its note', async () => {
    const rows = meterRows(view({ provider: 'gateway', measure: measure({ limits: [{ kind: 'spend_limit', percentUsed: 63 }] }) }), BAR)
    expect(textOf(rowNamed(rows, 'meter-limits'))).toContain('$4.12 est')
    expect(rowNamed(rows, 'meter-cost')).toBeUndefined()
  })

  test('a sign-in without plan windows yet shows three rows and no dollars', async () => {
    expect(meterRows(view({ provider: 'anthropic' }), BAR).map(row => row.key)).toEqual(['meter-model', 'meter-context', 'meter-cache'])
  })

  test('figures that need you turn to the alert color', async () => {
    const full = meterRows(view({ measure: measure({ tokens: 870_000, percent: 87, limits: [{ kind: 'five_hour', percentUsed: 93 }] }), provider: 'subscription' }), BAR)
    expect(toneOf(rowNamed(full, 'meter-context'), ' 87')).toBe('alert')
    expect(toneOf(rowNamed(full, 'meter-limits'), ' 93')).toBe('alert')
    const calm = meterRows(view(), BAR)
    expect(toneOf(rowNamed(calm, 'meter-context'), ' 62')).toBe('strong')
  })

  test('after a compact the context reads unknown until the next reply', async () => {
    const rows = meterRows(view({ measure: measure({ tokens: undefined, percent: undefined }) }), BAR)
    expect(textOf(rowNamed(rows, 'meter-context'))).toBe(`context   –  ${BAR_GLYPH.repeat(BAR)}  —/1M`)
  })

  test('no window size means no fraction', async () => {
    expect(textOf(rowNamed(meterRows(view({ measure: measure({ window: 0 }) }), BAR), 'meter-context'))).not.toContain('/')
  })

  test('cache: unreported is called out, idle shows from a minute, cold only when certain', async () => {
    const stripped = { turns: 3, read: 0, write: 0, uncached: 90_000, output: 30 }
    const off = rowNamed(meterRows(view({ cache: stripped }), BAR), 'meter-cache')
    expect(textOf(off)).toBe('cache   not reported')
    expect(toneOf(off, 'not reported')).toBe('alert')
    expect(textOf(rowNamed(meterRows(view({ idleMs: 59_000 }), BAR), 'meter-cache'))).toBe('cache   91%')
    expect(textOf(rowNamed(meterRows(view({ idleMs: 70 * 60_000, isCold: true }), BAR), 'meter-cache'))).toBe('cache   91%  idle 1h10m cold')
    expect(textOf(rowNamed(meterRows(view({ cache: EMPTY_CACHE, idleMs: null }), BAR), 'meter-cache'))).toBe('cache     –')
  })

  test('Foundry and Bedrock ids read short; deployment names stay', async () => {
    expect(textOf(meterRows(view({ provider: 'bedrock', modelId: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0' }), BAR)[0])).toBe('model   sonnet 4.5  bedrock')
    expect(textOf(meterRows(view({ provider: 'foundry', modelId: 'team-opus-prod' }), BAR)[0])).toBe('model   team-opus-prod  foundry')
  })

  test('at the narrowest pane the bars still leave the core of every row visible', async () => {
    // The HUD lays out in bodyColumns less its padding; rows are truncated, never wrapped.
    for (const columns of [30, 40, 60, 90]) {
      const width = barWidthFor(columns)
      const rows = meterRows(view({ provider: 'subscription', measure: measure({ limits: [{ kind: 'five_hour', percentUsed: 34 }] }) }), width)
      for (const row of rows) {
        const core = row.cells.filter(cell => cell.tone !== 'dim').map(cell => cell.text).join('')
        expect(core.length <= Math.max(columns - 2, 8 + 5 + width)).toBe(true)
      }
    }
  })
})

describe('meter summary (compact pane)', () => {
  test('context, cache and the fullest window or the estimate', async () => {
    expect(meterSummary(view())).toBe('ctx 62% · cache 91% · $4.12 est')
    const limits = [{ kind: 'five_hour', percentUsed: 34 }, { kind: 'seven_day', percentUsed: 12 }]
    expect(meterSummary(view({ provider: 'subscription', measure: measure({ limits }) }))).toBe('ctx 62% · cache 91% · 5h 34%')
    expect(meterSummary(view({ measure: measure({ tokens: undefined, percent: undefined }), cache: EMPTY_CACHE, provider: 'anthropic' }))).toBe('ctx –')
    expect(meterSummary(view({ cache: { turns: 3, read: 0, write: 0, uncached: 9, output: 0 } }))).toContain('cache off')
  })
})
