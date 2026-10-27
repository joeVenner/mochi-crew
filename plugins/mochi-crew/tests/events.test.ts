import { describe, expect, test } from 'claude-code/testing'

import { ACHIEVEMENTS, achievementList, newlyUnlocked, parseUnlocked } from '../hooks/achievements'
import { QUIP_MS, SQUASH_MS, activeQuip, isBugAlive, quipFor, spawnBug, squashBug, visibleBug } from '../hooks/events'

describe('bugs', () => {
  test('a failure spawns one bug; more failures keep the same bug', async () => {
    const first = spawnBug(null, 'npm test', 10)
    expect(first).toEqual({ command: 'npm test', spawnedAt: 10 })
    expect(spawnBug(first, 'make', 20)).toBe(first)
  })

  test('a success squashes a live bug once; a new failure brings a new one', async () => {
    const live = spawnBug(null, 'npm test', 10)
    const squashed = squashBug(live, 50)
    expect(squashed?.squashedAt).toBe(50)
    expect(isBugAlive(squashed)).toBe(false)
    expect(squashBug(squashed, 60)).toBe(squashed)
    expect(squashBug(null, 60)).toBeNull()
    expect(spawnBug(squashed, 'make', 70)).toEqual({ command: 'make', spawnedAt: 70 })
  })

  test('the squash burst shows briefly, then the bug is gone', async () => {
    const squashed = { command: 'x', spawnedAt: 0, squashedAt: 100 }
    expect(visibleBug(squashed, 100 + SQUASH_MS - 1)).toBe(squashed)
    expect(visibleBug(squashed, 100 + SQUASH_MS)).toBeNull()
  })
})

describe('quips', () => {
  test('quips fill in the detail and vary with the seed', async () => {
    expect(quipFor('hire', 'Auditor', 0, 5).text).toContain('Auditor')
    const lines = new Set([0, 1, 2].map(seed => quipFor('bug', '', seed, 0).text))
    expect(lines.size).toBeGreaterThan(1)
  })

  test('a quip shows for a few seconds', async () => {
    const quip = quipFor('pet', '', 0, 1000)
    expect(activeQuip(quip, 1000 + QUIP_MS - 1)).toBe(quip)
    expect(activeQuip(quip, 1000 + QUIP_MS)).toBeNull()
  })
})

describe('achievements', () => {
  test('facts unlock the matching badges, once', async () => {
    expect(newlyUnlocked([], { hasHired: true, crewSize: 3 }).map(a => a.id)).toEqual(['first-hire', 'full-crew'])
    expect(newlyUnlocked(['first-hire'], { hasHired: true }).map(a => a.id)).toEqual([])
    expect(newlyUnlocked([], { combo: 10, level: 5, editHour: 2 }).map(a => a.id)).toEqual(['combo-10', 'night-owl', 'level-5'])
    expect(newlyUnlocked([], { combo: 9, level: 4, editHour: 4 })).toEqual([])
    expect(newlyUnlocked([], { hasSquashed: true }).map(a => a.id)).toEqual(['bug-squasher'])
  })

  test('saved badges keep only known ids, once each', async () => {
    expect(parseUnlocked(['first-hire', 'first-hire', 'hacked', 7])).toEqual(['first-hire'])
    expect(parseUnlocked('nope')).toEqual([])
  })

  test('the list marks earned and locked badges', async () => {
    const list = achievementList(['level-5'])
    expect(list.split('\n')).toHaveLength(ACHIEVEMENTS.length + 1)
    expect(list).toContain(`Badges 1/${ACHIEVEMENTS.length}`)
    expect(list).toContain('[x] Veteran')
    expect(list).toContain('[ ] Night Owl')
  })
})

describe('copy', () => {
  test('quips stay calm: no exclamation marks, whatever the event or variant', async () => {
    const events = ['bug', 'squash', 'hire', 'level', 'achievement', 'pet', 'feed', 'wake', 'tests', 'shipped', 'mission'] as const
    for (const event of events) {
      for (let seed = 0; seed < 6; seed += 1) expect(quipFor(event, 'X', seed, 0).text).not.toContain('!')
    }
  })

  test('tutor quips have no exclamation marks', async () => {
    const events = ['tutor-start', 'tutor-right', 'tutor-wrong', 'tutor-done', 'tutor-perfect'] as const
    for (const event of events) {
      for (let seed = 0; seed < 6; seed += 1) {
        const text = quipFor(event, '3/5', seed, 0).text
        expect(text).not.toContain('!')
        expect(text).not.toContain('{}')
      }
    }
    expect(quipFor('tutor-done', '3/5', 0, 0).text).toBe('3/5 right. Nice work.')
    expect(quipFor('tutor-done', '3/5', 1, 0).text).toBe('Round done: 3/5.')
  })
})
