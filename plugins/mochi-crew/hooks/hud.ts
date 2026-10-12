import type { Worker } from '../types'
import { MAX_VISIBLE_WORKERS } from './crew'
import { ROLE_INFO, roleFor } from './roles'

/** Rows the full HUD always shows: status, 2 rules, level, mood, energy, streak, next, log, keys. */
export const FULL_HUD_ROWS = 10

/** The HUD rows that come and go. */
export type HudExtras = {
  /** A quip in the speech bubble. */
  hasBubble: boolean
  /** The "Your turn · took 42s" line. */
  hasTurnLine: boolean
  /** Workers on stage. */
  workerCount: number
  /** Session meter rows showing (none before its first measurement), its rule not included. */
  meterRows: number
  /** The file tree's line: its header, or the one folded `files` line. */
  hasTreeLine?: boolean
}

const NO_EXTRAS: HudExtras = { hasBubble: false, hasTurnLine: false, workerCount: 0, meterRows: 0 }

/** Rows the full HUD needs right now: the fixed rows plus whatever optional rows are showing. */
export const fullHudRows = ({ hasBubble, hasTurnLine, workerCount, meterRows, hasTreeLine = false }: HudExtras): number =>
  FULL_HUD_ROWS +
  Number(hasTreeLine) +
  Number(hasBubble) +
  Number(hasTurnLine) +
  Math.min(workerCount, MAX_VISIBLE_WORKERS) +
  Number(workerCount > MAX_VISIBLE_WORKERS) +
  // The meter's rows, plus the rule above them.
  (meterRows > 0 ? meterRows + 1 : 0)

/** How much of the HUD fits the pane. */
export type HudPlan = {
  /** A short pane: secondary lines go, and workers fold into one summary line. */
  isCompact: boolean
}

/**
 * Plans the HUD for a pane showing `bodyRows` rows under a scene of `sceneRows`, counting
 * the optional rows showing now, so the controls never scroll out of view.
 */
export const hudPlan = (bodyRows: number, sceneRows: number, extras: HudExtras = NO_EXTRAS): HudPlan => ({
  isCompact: bodyRows < sceneRows + fullHudRows(extras),
})

/**
 * Rows left for the file tree's entries under the full HUD (which already holds the tree's
 * header line), less the rule above the tree. The tree only takes what is left over, so
 * showing it never folds the rest of the HUD.
 */
export const treeBudget = (bodyRows: number, sceneRows: number, extras: HudExtras): number =>
  Math.max(0, bodyRows - sceneRows - fullHudRows({ ...extras, hasTreeLine: true }) - 1)

/**
 * Bars are drawn with a heavy line glyph, not background-colored cells: a background fills
 * the whole line height, so bars on consecutive rows merged into one block.
 */
export const BAR_GLYPH = '━'

/** Width of the label column every HUD row starts with. */
export const GUTTER = 8

/** A row label padded to the gutter, so every value starts in the same column. */
export const gutter = (label: string): string => label.padEnd(GUTTER)

/** A value padded to a fixed width on the left, so numbers line up down the HUD. */
export const column = (value: string, width: number): string => value.padStart(width)

/** How many cells a stat bar gets in a pane `columns` wide: room left after gutter, value and note. */
export const barWidthFor = (columns: number): number => Math.max(8, Math.min(24, columns - 2 - GUTTER - 5 - 8))

/** The filled and empty cells of a bar for `fraction` (clamped to 0–1). */
export const barCells = (fraction: number, width: number): { filled: number; empty: number } => {
  const filled = Math.round(Math.max(0, Math.min(1, fraction)) * width)
  return { filled, empty: width - filled }
}

/** A thin rule between HUD groups, a little narrower than the pane. */
export const ruleFor = (columns: number): string => '─'.repeat(Math.max(10, Math.min(62, columns - 2)))

/** A word after a vital only when it needs attention. */
export const vitalNote = (value: number): string => (value < 25 ? 'low' : '')

/** The streak for its row; nothing below a streak of 2. */
export const comboBadge = (combo: number): string => (combo > 1 ? `x${combo}` : '')

/** The crew row's value in a compact pane: `EXP DEV +1`, or null with nobody on stage. */
export const crewSummary = (onStage: readonly Worker[]): string | null => {
  if (onStage.length === 0) return null
  const shown = onStage.slice(0, MAX_VISIBLE_WORKERS).map(worker => ROLE_INFO[roleFor(worker.type)].tag).join(' ')
  const more = onStage.length - MAX_VISIBLE_WORKERS
  return `${shown}${more > 0 ? ` +${more}` : ''}`
}
