import { describe, expect, test } from 'claude-code/testing'

import { REARM_MARGIN, checkAlerts } from '../hooks/meterAlerts'
import type { AlertFacts } from '../hooks/meterAlerts'

const facts = (over: Partial<AlertFacts> = {}): AlertFacts => ({ contextPercent: 40, limits: [], isCacheUnreported: false, ...over })

describe('alerts', () => {
  test('nothing is due while everything is comfortable', async () => {
    expect(checkAlerts([], facts())).toEqual({ due: [], raised: [] })
  })

  test('crossing a context threshold fires once', async () => {
    const first = checkAlerts([], facts({ contextPercent: 81 }))
    expect(first.due.map(alert => alert.key)).toEqual(['context:80'])
    expect(first.due[0]?.text).toContain('81%')
    const again = checkAlerts(first.raised, facts({ contextPercent: 84 }))
    expect(again.due).toEqual([])
    expect(again.raised).toEqual(['context:80'])
  })

  test('the next threshold fires on its own, and a jump past both shows only the higher', async () => {
    const at80 = checkAlerts([], facts({ contextPercent: 81 }))
    const at90 = checkAlerts(at80.raised, facts({ contextPercent: 91 }))
    expect(at90.due.map(alert => alert.key)).toEqual(['context:90'])
    expect(at90.due[0]?.text).toContain('auto-compact is close')

    const jump = checkAlerts([], facts({ contextPercent: 95 }))
    expect(jump.due.map(alert => alert.key)).toEqual(['context:90'])
    expect(jump.raised).toEqual(['context:80', 'context:90'])
  })

  test('a compact re-arms the context alerts', async () => {
    const full = checkAlerts([], facts({ contextPercent: 91 }))
    // Right after the compact the fill is unknown: keep the keys, fire nothing.
    const unknown = checkAlerts(full.raised, facts({ contextPercent: undefined }))
    expect(unknown).toEqual({ due: [], raised: ['context:80', 'context:90'] })
    const small = checkAlerts(unknown.raised, facts({ contextPercent: 20 }))
    expect(small.raised).toEqual([])
    expect(checkAlerts(small.raised, facts({ contextPercent: 82 })).due.map(alert => alert.key)).toEqual(['context:80'])
  })

  test('a figure hovering at the line does not re-toast until it clearly drops', async () => {
    const at80 = checkAlerts([], facts({ contextPercent: 80 }))
    const dip = checkAlerts(at80.raised, facts({ contextPercent: 80 - REARM_MARGIN + 1 }))
    expect(dip.raised).toEqual(['context:80'])
    expect(checkAlerts(dip.raised, facts({ contextPercent: 80 })).due).toEqual([])
    const drop = checkAlerts(dip.raised, facts({ contextPercent: 80 - REARM_MARGIN - 1 }))
    expect(drop.raised).toEqual([])
    expect(checkAlerts(drop.raised, facts({ contextPercent: 80 })).due.map(alert => alert.key)).toEqual(['context:80'])
  })

  test('plan windows alert per window and re-arm after their reset', async () => {
    const limits = [{ kind: 'five_hour', percentUsed: 81 }, { kind: 'seven_day', percentUsed: 96 }]
    const first = checkAlerts([], facts({ limits }))
    expect(first.due.map(alert => alert.key)).toEqual(['five_hour:80', 'seven_day:95'])
    expect(first.due[0]?.text).toBe('5h plan window at 81% used.')
    const reset = checkAlerts(first.raised, facts({ limits: [{ kind: 'seven_day', percentUsed: 96 }] }))
    expect(reset.due).toEqual([])
    expect(reset.raised).toEqual(['seven_day:80', 'seven_day:95'])
    expect(checkAlerts(reset.raised, facts({ limits })).due.map(alert => alert.key)).toEqual(['five_hour:80'])
  })

  test('a gateway spend limit reads as such', async () => {
    const due = checkAlerts([], facts({ limits: [{ kind: 'spend_limit', percentUsed: 120 }] })).due
    expect(due.map(alert => alert.text)).toEqual(['Gateway spend limit at 120%.'])
  })

  test('caching that is never reported is called out once', async () => {
    const first = checkAlerts([], facts({ isCacheUnreported: true }))
    expect(first.due[0]?.text).toContain('cache_control')
    expect(checkAlerts(first.raised, facts({ isCacheUnreported: true })).due).toEqual([])
  })
})
