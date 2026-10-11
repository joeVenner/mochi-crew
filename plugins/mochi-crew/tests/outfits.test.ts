import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_STATS, parseStats } from '../hooks/game'
import { MASCOT_USAGE, isOutfitName, parseMascotCommand } from '../hooks/outfits'

describe('/mascot arguments', () => {
  test('no arguments opens the pane', async () => {
    expect(parseMascotCommand('')).toEqual({ kind: 'open' })
    expect(parseMascotCommand('   ')).toEqual({ kind: 'open' })
  })

  test('outfits lists, outfit <name> switches, case-insensitively', async () => {
    expect(parseMascotCommand('outfits')).toEqual({ kind: 'list' })
    expect(parseMascotCommand('outfit Wizard')).toEqual({ kind: 'outfit', name: 'wizard' })
  })

  test('pet, feed and dance react', async () => {
    expect(parseMascotCommand('pet')).toEqual({ kind: 'react', reaction: 'pet' })
    expect(parseMascotCommand('FEED')).toEqual({ kind: 'react', reaction: 'feed' })
    expect(parseMascotCommand('dance')).toEqual({ kind: 'react', reaction: 'dance' })
  })

  test('sound on/off toggles', async () => {
    expect(parseMascotCommand('sound on')).toEqual({ kind: 'sound', isOn: true })
    expect(parseMascotCommand('sound off')).toEqual({ kind: 'sound', isOn: false })
  })

  test('unknown requests answer with help, never throw', async () => {
    expect(parseMascotCommand('outfit tuxedo')).toEqual({
      kind: 'error',
      message: expect.stringContaining('unknown outfit "tuxedo"'),
    })
    expect(parseMascotCommand('jump')).toEqual({ kind: 'error', message: MASCOT_USAGE })
    expect(parseMascotCommand('pet twice')).toEqual({ kind: 'error', message: MASCOT_USAGE })
    expect(parseMascotCommand('sound loud')).toEqual({ kind: 'error', message: MASCOT_USAGE })
    expect(parseMascotCommand('outfit wizard now')).toEqual({ kind: 'error', message: MASCOT_USAGE })
  })

  test('isOutfitName rejects non-outfits, including prototype keys', async () => {
    expect(isOutfitName('crown')).toBe(true)
    expect(isOutfitName('toString')).toBe(false)
    expect(isOutfitName(42)).toBe(false)
  })
})

describe('saved stats', () => {
  test('valid saved stats load as-is', async () => {
    expect(parseStats({ xp: 120, edits: 9, combo: 2 })).toEqual({ xp: 120, edits: 9, combo: 2 })
  })

  test('malformed saved stats start fresh', async () => {
    for (const saved of [undefined, null, 'x', { xp: -1, edits: 0, combo: 0 }, { xp: 1.5, edits: 0, combo: 0 }, { xp: 1 }]) {
      expect(parseStats(saved)).toEqual(EMPTY_STATS)
    }
  })
})
