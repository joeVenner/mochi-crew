import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_JOURNAL, record } from '../hooks/journal'
import { MISSIONS, missionLine, missionReport, newlyCompleted } from '../hooks/missions'
import { parseMascotCommand } from '../hooks/outfits'

const shipped = (times: number) =>
  Array.from({ length: times }).reduce(journal => record(journal as typeof EMPTY_JOURNAL, { kind: 'shipped' }), EMPTY_JOURNAL) as typeof EMPTY_JOURNAL

describe('missions', () => {
  test('a mission completes once its count reaches the target, and only once', async () => {
    expect(newlyCompleted([], shipped(2)).map(mission => mission.id)).toEqual([])
    expect(newlyCompleted([], shipped(3)).map(mission => mission.id)).toEqual(['ship-3'])
    expect(newlyCompleted(['ship-3'], shipped(4))).toEqual([])
  })

  test('several can complete at once, in list order', async () => {
    const busy = [{ kind: 'green' }, { kind: 'fix' }, { kind: 'hire' }] as const
    expect(newlyCompleted([], busy.reduce(record, EMPTY_JOURNAL)).map(mission => mission.id)).toEqual(['green', 'squash', 'delegate'])
  })

  test('the HUD line shows the count and the next open mission with its progress', async () => {
    expect(missionLine([], EMPTY_JOURNAL)).toBe('Get the tests green')
    expect(missionLine(['green'], shipped(1))).toBe('Ship 3 turns (1/3)')
    expect(missionLine(MISSIONS.map(mission => mission.id), EMPTY_JOURNAL)).toBe('All missions done')
  })

  test('the report ticks done missions and caps progress at the target', async () => {
    const report = missionReport(['ship-3'], shipped(5))
    expect(report).toContain('[x] Ship 3 turns  3/3')
    expect(report).toContain('[ ] Get the tests green  0/1')
  })

  test('/mascot missions parses', async () => {
    expect(parseMascotCommand('missions')).toEqual({ kind: 'missions' })
  })
})
