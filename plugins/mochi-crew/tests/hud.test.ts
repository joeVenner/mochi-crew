import { describe, expect, test } from 'claude-code/testing'

import type { Worker } from '../types'
import { FULL_HUD_ROWS, GUTTER, fullHudRows, barCells, barWidthFor, column, comboBadge, crewSummary, gutter, hudPlan, ruleFor, vitalNote } from '../hooks/hud'
import { missionCount } from '../hooks/missions'

const worker = (id: string, type: string): Worker => ({ id, type, description: 'x', joinedAt: 0 })

describe('hud', () => {
  test('a pane too short for scene + full HUD goes compact', async () => {
    expect(hudPlan(16 + FULL_HUD_ROWS, 16).isCompact).toBe(false)
    expect(hudPlan(16 + FULL_HUD_ROWS - 1, 16).isCompact).toBe(true)
    // Without a scene (desktop) the HUD alone fits sooner.
    expect(hudPlan(FULL_HUD_ROWS, 0).isCompact).toBe(false)
  })

  test('optional rows count: bubble, turn line, up to three workers and a "more" line', async () => {
    expect(fullHudRows({ hasBubble: false, hasTurnLine: false, workerCount: 0, meterRows: 0 })).toBe(FULL_HUD_ROWS)
    expect(fullHudRows({ hasBubble: true, hasTurnLine: true, workerCount: 2, meterRows: 0 })).toBe(FULL_HUD_ROWS + 4)
    expect(fullHudRows({ hasBubble: false, hasTurnLine: false, workerCount: 5, meterRows: 0 })).toBe(FULL_HUD_ROWS + 4)
    // A pane that fits the quiet HUD goes compact once a busy crew would push the keys away.
    const busy = { hasBubble: true, hasTurnLine: true, workerCount: 3, meterRows: 0 }
    expect(hudPlan(16 + FULL_HUD_ROWS, 16).isCompact).toBe(false)
    expect(hudPlan(16 + FULL_HUD_ROWS, 16, busy).isCompact).toBe(true)
    expect(hudPlan(16 + fullHudRows(busy), 16, busy).isCompact).toBe(false)
  })

  test('the session meter adds its rows and one rule, and nothing before its first measurement', async () => {
    const quiet = { hasBubble: false, hasTurnLine: false, workerCount: 0, meterRows: 0 }
    expect(fullHudRows(quiet)).toBe(FULL_HUD_ROWS)
    expect(fullHudRows({ ...quiet, meterRows: 4 })).toBe(FULL_HUD_ROWS + 5)
    // A pane that fits the HUD goes compact once the meter's rows would push the keys away.
    expect(hudPlan(16 + FULL_HUD_ROWS, 16, quiet).isCompact).toBe(false)
    expect(hudPlan(16 + FULL_HUD_ROWS, 16, { ...quiet, meterRows: 4 }).isCompact).toBe(true)
    expect(hudPlan(16 + FULL_HUD_ROWS + 5, 16, { ...quiet, meterRows: 4 }).isCompact).toBe(false)
  })

  test('the combo badge shows from a streak of 2', async () => {
    expect(comboBadge(0)).toBe('')
    expect(comboBadge(1)).toBe('')
    expect(comboBadge(5)).toBe('x5')
  })

  test('the crew folds into one line of role emojis', async () => {
    expect(crewSummary([])).toBeNull()
    expect(crewSummary([worker('a', 'Explore'), worker('b', 'Plan')])).toBe('EXP ARC')
    const five = ['a', 'b', 'c', 'd', 'e'].map(id => worker(id, 'general-purpose'))
    expect(crewSummary(five)).toBe('DEV DEV DEV +2')
  })
})

describe('instrument panel layout', () => {
  test('every row starts its value in the same column', async () => {
    for (const label of ['level', 'mood', 'energy', 'streak', 'next', 'log', 'AUD']) expect(gutter(label)).toHaveLength(GUTTER)
    expect(column('6', 3)).toBe('  6')
    expect(column('100', 3)).toBe('100')
  })

  test('bars fit the narrowest and widest panes', async () => {
    expect(barWidthFor(40)).toBe(17)
    expect(barWidthFor(64)).toBe(24)
    expect(barWidthFor(20)).toBe(8)
    // gutter + value + gap + bar + note stays inside 40 columns
    expect(2 + GUTTER + 5 + barWidthFor(40) + 5).toBeLessThanOrEqual(40)
  })

  test('bar cells split by fraction and clamp', async () => {
    expect(barCells(0.47, 10)).toEqual({ filled: 5, empty: 5 })
    expect(barCells(-1, 10)).toEqual({ filled: 0, empty: 10 })
    expect(barCells(3, 10)).toEqual({ filled: 10, empty: 0 })
  })

  test('rules, notes and counts', async () => {
    expect(ruleFor(40)).toHaveLength(38)
    expect(ruleFor(200)).toHaveLength(62)
    expect(vitalNote(16)).toBe('low')
    expect(vitalNote(25)).toBe('')
    expect(missionCount(['green'])).toBe('1/4')
  })
})
