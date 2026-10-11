import type { MascotActivity } from '../types'
import { layoutFor, scatter } from './world'

/** Mochi's width in pixels; positions below are Mochi's left edge. */
export const MASCOT_WIDTH = 16
export const HOME_X = 2
/** Walking speed in pixels per second. */
const WALK_PX_PER_MS = 0.024
/** Nothing happening for this long and Mochi dozes off. */
export const SLEEP_MS = 120_000
/** A `using` activity older than this is assumed orphaned and settles to idle. */
export const STALE_USING_MS = 10 * 60_000
/** Each idle routine (look, sip, wave, …) lasts this long. */
export const ROUTINE_MS = 3500
const WANDER_SPOTS: readonly number[] = [0, 5, 9, 3, 7, 1]

/** Where Mochi stands to type: close enough that a paw reaches the desk. */
export const deskX = (width: number): number => layoutFor(width).deskLeft - MASCOT_WIDTH + 5

const walk = (from: number, to: number, elapsedMs: number): number => {
  const distance = to - from
  const moved = Math.min(Math.abs(distance), Math.max(0, elapsedMs) * WALK_PX_PER_MS)
  return Math.round(from + Math.sign(distance) * moved)
}

const walkMs = (from: number, to: number): number => Math.abs(to - from) / WALK_PX_PER_MS

export type IdleRoutine = 'returning' | 'look' | 'wander' | 'sip' | 'wave' | 'yawn' | 'stretch' | 'read' | 'sleep'
const ROUTINES: readonly IdleRoutine[] = ['look', 'wander', 'sip', 'read', 'look', 'stretch', 'wave', 'wander', 'yawn', 'read']
// Every idle spell opens by looking around (work just stopped); after that the routines shuffle.
const routineAt = (segment: number): IdleRoutine =>
  segment === 0 ? 'look' : ROUTINES[scatter(segment + 5) % ROUTINES.length] ?? 'look'

/** Which idle routine plays `elapsedMs` into an idle spell that started at `fromX`. */
export const idleRoutine = (fromX: number, elapsedMs: number): IdleRoutine => {
  if (elapsedMs >= SLEEP_MS) return 'sleep'
  const returnMs = walkMs(fromX, HOME_X)
  if (elapsedMs < returnMs) return 'returning'
  return routineAt(Math.floor((elapsedMs - returnMs) / ROUTINE_MS))
}

/** An idle routine and how far into it Mochi is, 0 at its start to 1 at its end. */
export type IdleMoment = { routine: IdleRoutine; progress: number }

/**
 * Like idleRoutine, plus the progress through the routine, so a routine plays as a short
 * scene (lift the mug, drink, lower it) instead of toggling on every tick. Walking back
 * runs from 0 to 1 over the walk; sleep stays at 0.
 */
export const idleMoment = (fromX: number, elapsedMs: number): IdleMoment => {
  const routine = idleRoutine(fromX, elapsedMs)
  if (routine === 'sleep') return { routine, progress: 0 }
  const returnMs = walkMs(fromX, HOME_X)
  if (routine === 'returning') return { routine, progress: returnMs === 0 ? 1 : elapsedMs / returnMs }
  return { routine, progress: ((elapsedMs - returnMs) % ROUTINE_MS) / ROUTINE_MS }
}

const spotAt = (segment: number): number => HOME_X + (WANDER_SPOTS[segment % WANDER_SPOTS.length] ?? 0)

/**
 * Mochi's x once home: each 'wander' routine walks to a new spot; every other
 * routine stays wherever the last wander ended. Bounded by SLEEP_MS / ROUTINE_MS steps.
 */
const idleX = (sinceHome: number): number => {
  const current = Math.floor(sinceHome / ROUTINE_MS)
  let x = HOME_X
  for (let segment = 0; segment < current; segment += 1) {
    if (routineAt(segment) === 'wander') x = spotAt(segment)
  }
  return routineAt(current) === 'wander' ? walk(x, spotAt(current), sinceHome - current * ROUTINE_MS) : x
}

/** Mochi's left edge at `now`, walking smoothly between home, wander spots and the desk. */
export const mascotXAt = (activity: MascotActivity, now: number, width: number): number => {
  switch (activity.kind) {
    case 'editing':
      return walk(activity.fromX ?? HOME_X, deskX(width), now - activity.since)
    case 'using':
      return activity.fromX ?? HOME_X
    case 'done':
      return activity.x ?? deskX(width)
    case 'idle': {
      const fromX = activity.fromX ?? HOME_X
      const elapsed = now - activity.since
      const returnMs = walkMs(fromX, HOME_X)
      if (elapsed < returnMs) return walk(fromX, HOME_X, elapsed)
      // Asleep, Mochi stays where the last routine left off.
      return idleX(Math.min(elapsed, SLEEP_MS - 1) - returnMs)
    }
  }
}

/** True while Mochi's legs should be walking. */
export const isMascotWalking = (activity: MascotActivity, now: number, width: number): boolean => {
  if (activity.kind === 'editing') return mascotXAt(activity, now, width) !== deskX(width)
  if (activity.kind !== 'idle') return false
  const routine = idleRoutine(activity.fromX ?? HOME_X, now - activity.since)
  if (routine === 'returning') return true
  if (routine !== 'wander') return false
  return mascotXAt(activity, now, width) !== mascotXAt(activity, now + 200, width)
}

/** The activity a finished "done" pose settles into, starting a walk home from where Mochi stood. */
export const settle = (activity: MascotActivity, now: number, doneMs: number, width: number): MascotActivity => {
  const isDoneOver = activity.kind === 'done' && now - activity.at >= doneMs
  // A gadget call never runs this long; if its put-away was lost, don't keep the gadget forever.
  const isUsingStale = activity.kind === 'using' && now - activity.since >= STALE_USING_MS
  return isDoneOver || isUsingStale ? { kind: 'idle', since: now, fromX: mascotXAt(activity, now, width) } : activity
}
