import type { Bug, Quip } from '../types'

/** How long the squash burst plays before the bug is gone for good. */
export const SQUASH_MS = 1200
/** How long a quip stays in the speech bubble. */
export const QUIP_MS = 5000

/** A failed command spawns a bug, unless one is already on the loose. */
export const spawnBug = (bug: Bug | null, command: string, now: number): Bug =>
  bug !== null && bug.squashedAt === undefined ? bug : { command, spawnedAt: now }

/** A successful command squashes a live bug; returns the same bug when there is nothing to squash. */
export const squashBug = (bug: Bug | null, now: number): Bug | null =>
  bug !== null && bug.squashedAt === undefined ? { ...bug, squashedAt: now } : bug

/** The bug still worth drawing at `now`: alive, or mid-squash. */
export const visibleBug = (bug: Bug | null, now: number): Bug | null =>
  bug === null || (bug.squashedAt !== undefined && now - bug.squashedAt >= SQUASH_MS) ? null : bug

export const isBugAlive = (bug: Bug | null): boolean => bug !== null && bug.squashedAt === undefined

export type QuipEvent =
  | 'bug' | 'squash' | 'hire' | 'level' | 'achievement' | 'pet' | 'feed' | 'wake' | 'tests' | 'shipped' | 'mission'
  | 'tutor-start' | 'tutor-right' | 'tutor-wrong' | 'tutor-done' | 'tutor-perfect'

const QUIPS: Readonly<Record<QuipEvent, readonly string[]>> = {
  // Calm, short, no exclamation marks: Mochi talks like a colleague, not a cereal box.
  bug: ['Something broke. On it.', 'A bug. Paws ready.', 'That failed. Let’s see why.'],
  squash: ['Fixed.', 'That one won’t be back.', 'Bug gone. Next.'],
  hire: ['Welcome aboard, {}.', 'Good to have you, {}.', '{} joins the crew.'],
  level: ['Level {}.', 'Level {}. Fresh whiskers.'],
  achievement: ['Badge earned: {}.', 'New badge: {}.'],
  pet: ['That tickles.', 'Thanks.'],
  feed: ['Fish. My favorite.', 'Nom.'],
  wake: ['Awake.', 'Just resting my eyes.'],
  tests: ['Tests pass.', 'All green.'],
  shipped: ['Shipped.', 'Another change landed.'],
  mission: ['Mission done: {}.', 'Checked off: {}.'],
  // Tutor lines are fixed local text: model output never reaches a quip. `tutor-done` gets the score, e.g. "3/5".
  'tutor-start': ['Quiz time.', 'Let’s see what stuck.'],
  'tutor-right': ['Right.', 'You know this one.', 'Exactly.'],
  'tutor-wrong': ['Close. Read the why.', 'That one’s tricky.'],
  'tutor-done': ['{} right. Nice work.', 'Round done: {}.'],
  'tutor-perfect': ['Perfect round.', 'You really know this code.'],
}

/**
 * A quip for an event, `{}` filled with `detail`. `seed` picks among the lines
 * so repeats vary without randomness (tests stay deterministic).
 */
export const quipFor = (event: QuipEvent, detail: string, seed: number, now: number): Quip => {
  const lines = QUIPS[event]
  const line = lines[Math.abs(Math.floor(seed)) % lines.length] ?? lines[0] ?? ''
  return { text: line.replace('{}', detail), at: now }
}

/** The quip still showing at `now`, if any. */
export const activeQuip = (quip: Quip | null, now: number): Quip | null =>
  quip !== null && now - quip.at < QUIP_MS ? quip : null
