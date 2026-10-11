import type { Care, Reaction } from '../types'

const MAX = 100
/** Mood drops a point every 90 s, energy every 2 min, down to 0. */
const MOOD_DECAY_MS = 90_000
const ENERGY_DECAY_MS = 120_000

export const FRESH_CARE: Care = { mood: 60, energy: 70, updatedAt: 0 }

const clamp = (value: number): number => Math.max(0, Math.min(MAX, Math.round(value)))

/** Care as it stands at `now`, after time has worn it down. */
export const careAt = (care: Care, now: number): Care => {
  const elapsed = Math.max(0, now - care.updatedAt)
  return {
    mood: clamp(care.mood - elapsed / MOOD_DECAY_MS),
    energy: clamp(care.energy - elapsed / ENERGY_DECAY_MS),
    updatedAt: Math.max(now, care.updatedAt),
  }
}

/** What raises or lowers Mochi's care. */
export type CareEvent = 'pet' | 'feed' | 'dance' | 'clean-edit' | 'failed-edit'

const EFFECTS: Readonly<Record<CareEvent, { mood: number; energy: number }>> = {
  pet: { mood: 12, energy: 0 },
  feed: { mood: 5, energy: 25 },
  dance: { mood: 8, energy: -6 },
  'clean-edit': { mood: 3, energy: -1 },
  'failed-edit': { mood: -4, energy: -1 },
}

export const applyCare = (care: Care, event: CareEvent, now: number): Care => {
  const current = careAt(care, now)
  const effect = EFFECTS[event]
  return { mood: clamp(current.mood + effect.mood), energy: clamp(current.energy + effect.energy), updatedAt: now }
}

/** How Mochi feels, which sets the face. */
export type Feeling = 'happy' | 'okay' | 'sad' | 'tired'

export const feelingOf = (care: Care): Feeling => {
  if (care.energy < 20) return 'tired'
  if (care.mood < 25) return 'sad'
  if (care.mood >= 70) return 'happy'
  return 'okay'
}

const isLevel = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX

/** Reads care saved in the store; malformed data starts fresh at `now`. */
export const parseCare = (saved: unknown, now: number): Care => {
  if (typeof saved !== 'object' || saved === null) return { ...FRESH_CARE, updatedAt: now }
  const { mood, energy, updatedAt } = saved as Record<string, unknown>
  const isValidTime = typeof updatedAt === 'number' && Number.isFinite(updatedAt) && updatedAt <= now
  return isLevel(mood) && isLevel(energy) && isValidTime ? { mood, energy, updatedAt } : { ...FRESH_CARE, updatedAt: now }
}

/** How long each reaction plays. */
export const REACTION_MS: Readonly<Record<Reaction['kind'], number>> = { pet: 2500, feed: 2600, dance: 4000 }

/** The reaction still playing at `now`, if any. */
export const activeReaction = (reaction: Reaction | null, now: number): Reaction | null =>
  reaction !== null && now - reaction.at < REACTION_MS[reaction.kind] ? reaction : null

