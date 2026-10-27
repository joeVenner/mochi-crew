import type { FlashRating, TutorCard, TutorFlash, TutorFocus, TutorProject, TutorQuestion, TutorSession, TutorState } from '../types'
import { MAX_MASTERED, capDeck, dueCards, keepLast, promoteCard, storedQuestion } from './tutorProgress'
import type { TutorEvent } from './tutorRound'

/** Cards in one flashcard session at most (A.3). */
export const FLASH_SESSION = 10
/** Flashcard XP one conversation can earn at most (A.6), so flipping can't farm XP. */
export const FLASH_XP_CAP = 10

/** What `/mascot tutor cards` replies; neutral, as the command may run from any screen (A.2). */
export const FLASH_REPLIES: Readonly<{ opened: string; empty: string }> = {
  opened: 'Flashcards open in the Tutor tab.',
  empty: 'No flashcards yet: play a round first, or press k on an answer to keep it.',
}

/** Something that happened in a flashcard session; `applyTutor` hands these to `applyFlash`. */
export type FlashEvent =
  /** `focus` is the Home the session returns to; `xpLeft` is `flashXpLeft` when it opened. */
  | { kind: 'cards-open'; ids: readonly string[]; at: number; focus: TutorFocus; xpLeft: number }
  | { kind: 'flip' }
  /** `id` is the card rated, the one `flashCurrent` drew, so a card skipped as gone is never credited. */
  | { kind: 'rate'; id: string; rating: FlashRating; wasDue: boolean }
  | { kind: 'cards-end' }

/** Whether a card is due: its due round is at or below the rounds played. */
export const isCardDue = (project: TutorProject, card: TutorCard): boolean => card.dueRound <= project.rounds

/**
 * The cards for a session (A.3): every due card first, oldest due first as `dueCards` orders
 * them, then the rest by box ascending and due round ascending, at most `max`.
 */
export const flashDeck = (project: TutorProject, max: number = FLASH_SESSION): readonly TutorCard[] => {
  if (max <= 0) return []
  const due = dueCards(project, project.deck.length)
  const ahead = project.deck
    .filter(card => !isCardDue(project, card))
    .sort((a, b) => a.box - b.box || a.dueRound - b.dueRound)
  return [...due, ...ahead].slice(0, max)
}

/**
 * The card on screen: the first one from `flash.index` on that the deck still holds, with its
 * place in the session, or null when every card left is gone (mastered or reset elsewhere).
 */
export const flashCurrent = (flash: TutorFlash, deck: readonly TutorCard[]): { readonly index: number; readonly card: TutorCard } | null => {
  for (let index = flash.index; index < flash.ids.length; index += 1) {
    const card = deck.find(held => held.question.id === flash.ids[index])
    if (card !== undefined) return { index, card }
  }
  return null
}

/** Flashcard XP the conversation can still earn (A.6); the cap's only arithmetic besides `flashXpOf`. */
export const flashXpLeft = (session: TutorSession): number => Math.max(0, FLASH_XP_CAP - session.flashXp)

/** XP a session has earned so far: one per `good` on a due card, within what was left when it opened. */
export const flashXpOf = (flash: TutorFlash): number => {
  const earned = flash.ratings.filter(rated => rated.rating === 'good' && rated.wasDue).length
  return Math.max(0, Math.min(earned, flash.xpLeft))
}

/** `good` ratings in a row at the end of the session, for the streak quip. */
export const goodStreak = (flash: TutorFlash): number => {
  const last = flash.ratings.findLastIndex(rated => rated.rating !== 'good')
  return flash.ratings.length - 1 - last
}

/**
 * The project after one rating (A.5): `again` sends the card to box 1 and `hard` keeps its box,
 * both due after one more round; `good` on a due card promotes it as a clean review answer does,
 * retiring it into `mastered` from box 3; `good` on a card not yet due changes nothing, so
 * flipping ahead can't cram a card to mastery. A card no longer in the deck leaves it as it was.
 */
export const rateCard = (project: TutorProject, id: string, rating: FlashRating, now: number): TutorProject => {
  const card = project.deck.find(held => held.question.id === id)
  if (card === undefined) return project
  const replaced = (next: TutorCard): TutorProject => ({ ...project, deck: project.deck.map(held => (held === card ? next : held)), updatedAt: now })
  switch (rating) {
    case 'again':
      return replaced({ ...card, box: 1, dueRound: project.rounds + 1 })
    case 'hard':
      return replaced({ ...card, dueRound: project.rounds + 1 })
    case 'good': {
      if (!isCardDue(project, card)) return { ...project, updatedAt: now }
      const promoted = promoteCard(card, project.rounds)
      if (promoted !== null) return replaced(promoted)
      return {
        ...project,
        deck: project.deck.filter(held => held !== card),
        mastered: keepLast([...project.mastered, card.question.topic], MAX_MASTERED),
        updatedAt: now,
      }
    }
  }
}

/** Whether `k` may keep this question (A.7): not a replayed card, and not one the deck holds. */
export const canKeepCard = (project: TutorProject, question: TutorQuestion): boolean =>
  question.isReview !== true && !project.deck.some(held => held.question.id === question.id)

/**
 * The project with a question kept for flashcards (A.7): box 1, due after one more round, through
 * the deck cap with the kept card protected as a miss is, so the card just kept is the last to go.
 * A question `canKeepCard` refuses leaves the project as it was.
 */
export const keepCard = (project: TutorProject, question: TutorQuestion, now: number): TutorProject => {
  if (!canKeepCard(project, question)) return project
  const kept: TutorCard = { question: storedQuestion(question), box: 1, dueRound: project.rounds + 1 }
  return { ...project, deck: capDeck([...project.deck, kept], new Set([question.id])), updatedAt: now }
}

type CardsState = Extract<TutorState, { phase: 'cards' }>
type CardsDoneState = Extract<TutorState, { phase: 'cards-done' }>

const done = (flash: TutorFlash): CardsDoneState => ({ phase: 'cards-done', flash, xp: flashXpOf(flash) })

const home = (flash: TutorFlash): TutorState => ({ phase: 'home', focus: flash.focus, isDigestOnly: false })

const opened = (event: Extract<FlashEvent, { kind: 'cards-open' }>): TutorState => ({
  phase: 'cards',
  flash: {
    ids: event.ids,
    index: 0,
    isFlipped: false,
    ratings: [],
    startedAt: event.at,
    focus: event.focus,
    xpLeft: Number.isFinite(event.xpLeft) ? Math.max(0, Math.floor(event.xpLeft)) : 0,
  },
})

const onCards = (state: CardsState, event: TutorEvent): TutorState => {
  const { flash } = state
  switch (event.kind) {
    case 'flip':
      return { phase: 'cards', flash: { ...flash, isFlipped: !flash.isFlipped } }
    case 'rate': {
      // Rated only once its answer was seen; the id must be this card or one after a skipped gap.
      const at = flash.ids.indexOf(event.id, flash.index)
      if (!flash.isFlipped || at < 0) return state
      const rated: TutorFlash = { ...flash, ratings: [...flash.ratings, { id: event.id, rating: event.rating, wasDue: event.wasDue }] }
      if (at + 1 >= flash.ids.length) return done(rated)
      return { phase: 'cards', flash: { ...rated, index: at + 1, isFlipped: false } }
    }
    case 'cards-end':
      return flash.ratings.length === 0 ? home(flash) : done(flash)
    case 'cancel':
      return home(flash)
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onCardsDone = (state: CardsDoneState, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'cards-open':
      return event.ids.length === 0 ? state : opened(event)
    case 'cancel':
      return home(state.flash)
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

/**
 * The flashcard part of `applyTutor`: `cards-open` from Home, the summary, an error or a finished
 * session (an empty deck opens nothing), and every event on the two flashcard screens. `rate`
 * needs the card flipped; the last rating, or `cards-end` after any, shows `cards-done`, and
 * `cards-end` with none goes Home. An event that does not fit returns the same object.
 */
export const applyFlash = (state: TutorState, event: TutorEvent): TutorState => {
  switch (state.phase) {
    case 'cards':
      return onCards(state, event)
    case 'cards-done':
      return onCardsDone(state, event)
    case 'home':
    case 'summary':
    case 'error':
      return event.kind === 'cards-open' && event.ids.length > 0 ? opened(event) : state
    default:
      return state
  }
}
