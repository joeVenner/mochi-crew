import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_STATS, XP_PER_EDIT, applyEdit, levelOf } from '../hooks/game'

describe('game', () => {
  test('a success earns XP and grows the combo', async () => {
    const once = applyEdit(EMPTY_STATS, false)
    expect(once).toEqual({ xp: XP_PER_EDIT, edits: 1, combo: 1 })
    expect(applyEdit(once, false).xp).toBe(XP_PER_EDIT * 2 + 2)
  })

  test('a failure breaks the combo and earns nothing', async () => {
    expect(applyEdit({ xp: 50, edits: 5, combo: 4 }, true)).toEqual({ xp: 50, edits: 5, combo: 0 })
  })

  test('the combo bonus is capped', async () => {
    expect(applyEdit({ xp: 0, edits: 0, combo: 99 }, false).xp).toBe(XP_PER_EDIT + 10)
  })

  test('levels roll over every 100 XP', async () => {
    expect(levelOf(0)).toEqual({ level: 1, intoLevel: 0, needed: 100 })
    expect(levelOf(250)).toEqual({ level: 3, intoLevel: 50, needed: 100 })
  })

})
