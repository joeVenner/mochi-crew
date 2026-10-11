import { describe, expect, test } from 'claude-code/testing'

import type { Turn, TurnOutcome } from '../types'
import { HANDOFF_MS, STALE_TURN_MS, completeTurn, formatDuration, isHandingOff, isThinking, isTurnTrouble, keepTurnAlive, startTurn, touchTurn, turnLabel } from '../hooks/turn'

/** A completed turn from nothing running, for checks that don't care about ordering. */
const done = (outcome: TurnOutcome, durationMs: number, now: number): Turn | null =>
  completeTurn(null, 't', outcome, durationMs, now).turn

describe('turn', () => {
  test('a started turn is thinking until it completes', async () => {
    const working = startTurn('t1', 100)
    expect(isThinking(working)).toBe(true)
    expect(isThinking(completeTurn(working, 't1', 'answer', 5000, 200).turn)).toBe(false)
    expect(isThinking(null)).toBe(false)
  })

  test('a repeated completion is a duplicate; a late one never hides a newer turn', async () => {
    const first = completeTurn(startTurn('t1', 0), 't1', 'answer', 5000, 10)
    expect(first.isDuplicate).toBe(false)
    expect(completeTurn(first.turn, 't1', 'answer', 5000, 20)).toEqual({ turn: first.turn, isDuplicate: true })
    const newer = startTurn('t2', 30)
    expect(completeTurn(newer, 't1', 'answer', 5000, 40)).toEqual({ turn: newer, isDuplicate: false })
  })

  test('Mochi hands the turn back for a few seconds only', async () => {
    const handed = done('answer', 5000, 1000)
    expect(isHandingOff(handed, 1000)).toBe(true)
    expect(isHandingOff(handed, 1000 + HANDOFF_MS)).toBe(false)
    expect(isHandingOff(startTurn('t', 0), 0)).toBe(false)
    expect(isHandingOff(null, 0)).toBe(false)
  })

  test('durations read at a glance', async () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(8_400)).toBe('8s')
    expect(formatDuration(65_000)).toBe('1m 05s')
    expect(formatDuration(3_725_000)).toBe('1h 02m')
    expect(formatDuration(-50)).toBe('0s')
  })

  test('the HUD line names the outcome and how long it took', async () => {
    expect(turnLabel(null)).toBeNull()
    expect(turnLabel(startTurn('t', 0))).toBeNull()
    expect(turnLabel(done('answer', 42_000, 0))).toBe('Your turn · took 42s')
    expect(turnLabel(done('aborted', 3_000, 0))).toBe('Interrupted · your turn · took 3s')
    expect(turnLabel(done('error', 1_000, 0))).toBe('API error · turn ended · took 1s')
  })

  test('only errors and refusals read as trouble', async () => {
    expect(isTurnTrouble(done('error', 0, 0))).toBe(true)
    expect(isTurnTrouble(done('refusal', 0, 0))).toBe(true)
    expect(isTurnTrouble(done('answer', 0, 0))).toBe(false)
    expect(isTurnTrouble(done('aborted', 0, 0))).toBe(false)
    expect(isTurnTrouble(null)).toBe(false)
  })
})

describe('stale turns', () => {
  const MINUTE = 60_000

  test('a quiet working turn is dropped after STALE_TURN_MS; a busy one never', async () => {
    const working = startTurn('t1', 0)
    expect(keepTurnAlive(working, STALE_TURN_MS - 1, false)).toBe(working)
    expect(keepTurnAlive(working, STALE_TURN_MS, false)).toBeNull()
    expect(keepTurnAlive(working, 10 * STALE_TURN_MS, true)).toEqual({ ...working, lastSeenAt: 10 * STALE_TURN_MS })
  })

  test('being busy refreshes the sign of life at most once a minute', async () => {
    const working = startTurn('t1', 0)
    expect(keepTurnAlive(working, 30_000, true)).toBe(working)
    const touched = keepTurnAlive(working, MINUTE, true)
    expect(touched).toEqual({ ...working, lastSeenAt: MINUTE })
    // Quiet from there: the clock restarts at the last sign of life.
    expect(keepTurnAlive(touched, MINUTE + STALE_TURN_MS - 1, false)).toBe(touched)
    expect(keepTurnAlive(touched, MINUTE + STALE_TURN_MS, false)).toBeNull()
  })

  test('a call marks the turn alive; waiting turns and no turn are left alone', async () => {
    expect(touchTurn(startTurn('t1', 0), 500)).toEqual({ phase: 'working', turnId: 't1', since: 0, lastSeenAt: 500 })
    const waiting = done('answer', 1, 0)
    expect(touchTurn(waiting, 500)).toBe(waiting)
    expect(keepTurnAlive(waiting, 10 * STALE_TURN_MS, false)).toBe(waiting)
    expect(touchTurn(null, 5)).toBeNull()
    expect(keepTurnAlive(null, 5, true)).toBeNull()
  })
})
