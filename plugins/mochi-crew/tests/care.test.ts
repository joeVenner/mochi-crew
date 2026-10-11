import { describe, expect, test } from 'claude-code/testing'

import { FRESH_CARE, REACTION_MS, activeReaction, applyCare, careAt, feelingOf, parseCare } from '../hooks/care'

describe('care', () => {
  test('mood and energy wear down over time, never below zero', async () => {
    const start = { mood: 50, energy: 50, updatedAt: 0 }
    const later = careAt(start, 90_000 * 10)
    expect(later.mood).toBe(40)
    expect(later.energy).toBeLessThan(50)
    expect(careAt(start, 1e12)).toMatchObject({ mood: 0, energy: 0 })
  })

  test('petting, feeding and edits move the needles, capped at 100', async () => {
    const start = { mood: 50, energy: 50, updatedAt: 0 }
    expect(applyCare(start, 'pet', 0).mood).toBe(62)
    expect(applyCare(start, 'feed', 0).energy).toBe(75)
    expect(applyCare(start, 'failed-edit', 0).mood).toBe(46)
    expect(applyCare({ mood: 99, energy: 99, updatedAt: 0 }, 'pet', 0).mood).toBe(100)
  })

  test('feelings follow the levels, tired first', async () => {
    expect(feelingOf({ mood: 90, energy: 10, updatedAt: 0 })).toBe('tired')
    expect(feelingOf({ mood: 10, energy: 90, updatedAt: 0 })).toBe('sad')
    expect(feelingOf({ mood: 80, energy: 80, updatedAt: 0 })).toBe('happy')
    expect(feelingOf(FRESH_CARE)).toBe('okay')
  })

  test('saved care is validated; junk or future timestamps start fresh', async () => {
    expect(parseCare({ mood: 30, energy: 40, updatedAt: 5 }, 10)).toEqual({ mood: 30, energy: 40, updatedAt: 5 })
    for (const junk of [null, 'x', { mood: 500, energy: 1, updatedAt: 0 }, { mood: 1, energy: 1, updatedAt: 99 }]) {
      expect(parseCare(junk, 10)).toEqual({ ...FRESH_CARE, updatedAt: 10 })
    }
  })

  test('reactions play for their duration only', async () => {
    const pet = { kind: 'pet', at: 1000 } as const
    expect(activeReaction(pet, 1000 + REACTION_MS.pet - 1)).toBe(pet)
    expect(activeReaction(pet, 1000 + REACTION_MS.pet)).toBeNull()
    expect(activeReaction(null, 0)).toBeNull()
  })

})
