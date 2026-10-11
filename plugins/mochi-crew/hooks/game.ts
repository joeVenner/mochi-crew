import type { CrewStats } from '../types'
import { XP_PER_REPEAT_EDIT } from './progress'

export const XP_PER_EDIT = 10
export const XP_PER_LEVEL = 100
const COMBO_BONUS_CAP = 10

export const EMPTY_STATS: CrewStats = { xp: 0, edits: 0, combo: 0 }

/**
 * Scores one finished edit: XP plus a combo bonus on success; a failure breaks the combo.
 * A repeat (a file already edited this turn) earns XP_PER_REPEAT_EDIT and leaves the combo as it is,
 * so touching one file over and over is not farmed into a streak.
 */
export const applyEdit = (stats: CrewStats, hasFailed: boolean, isRepeat = false): CrewStats =>
  hasFailed
    ? { ...stats, combo: 0 }
    : isRepeat
      ? { ...stats, xp: stats.xp + XP_PER_REPEAT_EDIT, edits: stats.edits + 1 }
      : {
        xp: stats.xp + XP_PER_EDIT + Math.min(stats.combo * 2, COMBO_BONUS_CAP),
        edits: stats.edits + 1,
        combo: stats.combo + 1,
      }

export type Level = { level: number; intoLevel: number; needed: number }

export const levelOf = (xp: number): Level => ({
  level: Math.floor(xp / XP_PER_LEVEL) + 1,
  intoLevel: xp % XP_PER_LEVEL,
  needed: XP_PER_LEVEL,
})

// Far above any real session; a bigger saved number means the store was tampered with or corrupted.
const MAX_SAVED_COUNT = 10_000_000

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_SAVED_COUNT

/** Reads stats saved in the store; anything malformed starts fresh rather than breaking the HUD. */
export const parseStats = (saved: unknown): CrewStats => {
  if (typeof saved !== 'object' || saved === null) return EMPTY_STATS
  const { xp, edits, combo } = saved as Record<string, unknown>
  return isCount(xp) && isCount(edits) && isCount(combo) ? { xp, edits, combo } : EMPTY_STATS
}
