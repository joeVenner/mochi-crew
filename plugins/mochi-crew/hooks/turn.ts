import type { Turn, TurnOutcome } from '../types'

/** How long Mochi waves at you after Claude hands the turn back. */
export const HANDOFF_MS = 4000

/** A main-loop turn that just began. */
export const startTurn = (turnId: string, now: number): Turn => ({ phase: 'working', turnId, since: now })

/**
 * The turn after `turnId` completed. A completion with no turn running (a reload
 * mid-turn) still counts: the engine's `durationMs` is the source of truth.
 * `isDuplicate` when this turn was already handed back; a completion of an older
 * turn that arrives after a newer one started leaves the newer one on screen.
 */
export const completeTurn = (
  current: Turn | null,
  turnId: string,
  outcome: TurnOutcome,
  durationMs: number,
  now: number,
): { turn: Turn | null; isDuplicate: boolean } => {
  if (current?.turnId === turnId && current.phase === 'waiting') return { turn: current, isDuplicate: true }
  if (current?.phase === 'working' && current.turnId !== turnId) return { turn: current, isDuplicate: false }
  return {
    turn: { phase: 'waiting', turnId, since: now, outcome, durationMs: Math.max(0, Math.round(durationMs)) },
    isDuplicate: false,
  }
}

/** A working turn with no sign of life this long is assumed lost (its completion never came). */
export const STALE_TURN_MS = 30 * 60_000
/** Busy turns refresh their sign of life at most this often, so the ticker rarely writes. */
const TOUCH_EVERY_MS = 60_000

const lastSignOf = (turn: Turn): number => (turn.phase === 'working' ? turn.lastSeenAt ?? turn.since : turn.since)

/**
 * Keeps a working turn's sign of life current and drops one that has shown none for
 * STALE_TURN_MS: Mochi stops "thinking" forever when a completion was lost (another
 * hook answered it, a crash). Dropped, not completed: nothing is claimed about how it
 * ended. Returns the same turn when nothing changes.
 *
 * @param isBusy the main loop is visibly working: a tool call running or workers on stage
 */
export const keepTurnAlive = (turn: Turn | null, now: number, isBusy: boolean): Turn | null => {
  if (turn === null || turn.phase !== 'working') return turn
  const quietFor = now - lastSignOf(turn)
  if (isBusy) return quietFor >= TOUCH_EVERY_MS ? { ...turn, lastSeenAt: now } : turn
  return quietFor >= STALE_TURN_MS ? null : turn
}

/** A main-loop call began or ended: the turn is alive. */
export const touchTurn = (turn: Turn | null, now: number): Turn | null =>
  turn?.phase === 'working' ? { ...turn, lastSeenAt: now } : turn

export const isThinking = (turn: Turn | null): boolean => turn?.phase === 'working'

/** True for the first moments after a turn ends, while Mochi waves for attention. */
export const isHandingOff = (turn: Turn | null, now: number): boolean =>
  turn?.phase === 'waiting' && now - turn.since < HANDOFF_MS

/** A compact duration: `8s`, `1m 05s`, `1h 02m`. */
export const formatDuration = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

const OUTCOME_LINES: Readonly<Record<TurnOutcome, string>> = {
  answer: 'Your turn',
  aborted: 'Interrupted · your turn',
  refusal: 'Declined · your turn',
  error: 'API error · turn ended',
}

/**
 * The HUD's turn line once Claude hands the turn back: whose move it is and how
 * long the turn took. Null while Claude works (Mochi's own label shows that) and
 * before the first turn.
 */
export const turnLabel = (turn: Turn | null): string | null => {
  if (turn === null || turn.phase === 'working') return null
  return `${OUTCOME_LINES[turn.outcome]} · took ${formatDuration(turn.durationMs)}`
}

/** Whether the turn line should read as a warning. */
export const isTurnTrouble = (turn: Turn | null): boolean =>
  turn?.phase === 'waiting' && (turn.outcome === 'error' || turn.outcome === 'refusal')
