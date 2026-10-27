import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, TutorCard, TutorFlash, TutorProject, TutorSession, TutorState } from '../types'
import {
  FLASH_REPLIES,
  FLASH_SESSION,
  FLASH_XP_CAP,
  applyFlash,
  canKeepCard,
  flashCurrent,
  flashDeck,
  flashXpLeft,
  flashXpOf,
  goodStreak,
  isCardDue,
  keepCard,
  rateCard,
} from '../hooks/tutorCards'
import { FRESH_PROJECT, MAX_DECK, MAX_MASTERED } from '../hooks/tutorProgress'
import { EMPTY_USAGE, applyTutor } from '../hooks/tutorRound'
import type { TutorEvent } from '../hooks/tutorRound'

const choice = (id: string, over: Partial<ChoiceQuestion> = {}): ChoiceQuestion => ({
  id,
  kind: 'choice',
  tag: 'why',
  topic: `topic ${id}`,
  prompt: 'Why does the tree read worktrees?',
  options: ['because a', 'because b'],
  answer: 0,
  why: ['right because a', 'wrong because b'],
  ...over,
})

const card = (id: string, box: TutorCard['box'], dueRound: number): TutorCard => ({ question: choice(id), box, dueRound })

const project = (over: Partial<TutorProject> = {}): TutorProject => ({ ...FRESH_PROJECT, ...over })

const session = (flashXp: number): TutorSession => ({ rounds: 0, usage: EMPTY_USAGE, isForkSuspect: false, flashXp })

const flash = (over: Partial<TutorFlash> = {}): TutorFlash => ({
  ids: ['a', 'b', 'c'],
  index: 0,
  isFlipped: false,
  ratings: [],
  startedAt: 100,
  focus: 'project',
  xpLeft: FLASH_XP_CAP,
  ...over,
})

const open = (ids: readonly string[], xpLeft = FLASH_XP_CAP): TutorEvent => ({ kind: 'cards-open', ids, at: 100, focus: 'project', xpLeft })

const apply = (state: TutorState, ...events: readonly TutorEvent[]): TutorState => events.reduce(applyTutor, state)

const flashOf = (state: TutorState): TutorFlash => {
  if (state.phase !== 'cards' && state.phase !== 'cards-done') throw new Error(`no flashcards in ${state.phase}`)
  return state.flash
}

const HOME: TutorState = { phase: 'home', focus: 'project', isDigestOnly: false }

describe('tutor flashcards', () => {
  test('flashDeck puts due cards first, then the rest by box and due round, at most ten', async () => {
    const deck = [card('later-b2', 2, 9), card('due-old', 1, 1), card('later-b1', 1, 8), card('due-new', 3, 4), card('later-b1-soon', 1, 6)]
    const held = project({ rounds: 4, deck })
    expect(flashDeck(held).map(picked => picked.question.id)).toEqual(['due-old', 'due-new', 'later-b1-soon', 'later-b1', 'later-b2'])
    expect(flashDeck(held, 2).map(picked => picked.question.id)).toEqual(['due-old', 'due-new'])
    expect(flashDeck(held, 0)).toEqual([])
    expect(flashDeck(project())).toEqual([])
    const big = project({ deck: Array.from({ length: 15 }, (_, index) => card(`k${index}`, 1, index)) })
    expect(flashDeck(big)).toHaveLength(FLASH_SESSION)
    expect(isCardDue(held, card('x', 1, 4))).toBe(true)
    expect(isCardDue(held, card('x', 1, 5))).toBe(false)
  })

  test('cards-open snapshots the ids from Home, the summary, an error or a finished session', async () => {
    const opened = applyTutor(HOME, open(['a', 'b']))
    expect(opened).toEqual({ phase: 'cards', flash: flash({ ids: ['a', 'b'] }) })
    // An empty deck opens nothing, and a round or the closed tab does not take it.
    expect(applyTutor(HOME, open([]))).toBe(HOME)
    const closed: TutorState = { phase: 'closed' }
    expect(applyTutor(closed, open(['a']))).toBe(closed)
    const error: TutorState = { phase: 'error', failure: { kind: 'timeout' }, focus: 'turn', canTryDigest: false }
    expect(applyTutor(error, open(['a'])).phase).toBe('cards')
    const done: TutorState = { phase: 'cards-done', flash: flash(), xp: 0 }
    expect(applyTutor(done, open(['z']))).toEqual({ phase: 'cards', flash: flash({ ids: ['z'] }) })
    expect(applyTutor(done, open([]))).toBe(done)
    // A bad allowance can't be stored as one.
    expect(flashOf(applyTutor(HOME, open(['a'], -3))).xpLeft).toBe(0)
    expect(flashOf(applyTutor(HOME, open(['a'], Number.NaN))).xpLeft).toBe(0)
    expect(flashOf(applyTutor(HOME, open(['a'], 2.7))).xpLeft).toBe(2)
  })

  test('a card is rated only once flipped, then the next one comes face down', async () => {
    const front = applyTutor(HOME, open(['a', 'b']))
    const early = applyTutor(front, { kind: 'rate', id: 'a', rating: 'good', wasDue: true })
    expect(early).toBe(front)
    const back = applyTutor(front, { kind: 'flip' })
    expect(flashOf(back).isFlipped).toBe(true)
    // Flip toggles, so the learner can look at the front again.
    expect(flashOf(applyTutor(back, { kind: 'flip' })).isFlipped).toBe(false)
    const second = applyTutor(back, { kind: 'rate', id: 'a', rating: 'hard', wasDue: false })
    expect(second).toEqual({ phase: 'cards', flash: flash({ ids: ['a', 'b'], index: 1, ratings: [{ id: 'a', rating: 'hard', wasDue: false }] }) })
    // A card already behind the session, or not in it, is not rated again.
    const flipped = applyTutor(second, { kind: 'flip' })
    expect(applyTutor(flipped, { kind: 'rate', id: 'a', rating: 'good', wasDue: true })).toBe(flipped)
    expect(applyTutor(flipped, { kind: 'rate', id: 'nope', rating: 'good', wasDue: true })).toBe(flipped)
    const last = applyTutor(flipped, { kind: 'rate', id: 'b', rating: 'good', wasDue: true })
    expect(last).toEqual({ phase: 'cards-done', flash: flash({ ids: ['a', 'b'], index: 1, isFlipped: true, ratings: [{ id: 'a', rating: 'hard', wasDue: false }, { id: 'b', rating: 'good', wasDue: true }] }), xp: 1 })
    // Nothing on the done screen rates or flips.
    expect(applyTutor(last, { kind: 'rate', id: 'b', rating: 'good', wasDue: true })).toBe(last)
    expect(applyTutor(last, { kind: 'flip' })).toBe(last)
  })

  test('rating a card after a gone one skips the gap', async () => {
    const state: TutorState = { phase: 'cards', flash: flash({ isFlipped: true }) }
    const skipped = applyTutor(state, { kind: 'rate', id: 'b', rating: 'again', wasDue: true })
    expect(flashOf(skipped)).toMatchObject({ index: 2, isFlipped: false, ratings: [{ id: 'b', rating: 'again', wasDue: true }] })
    const deck = [card('a', 1, 0), card('c', 1, 0)]
    expect(flashCurrent(flash(), deck)).toEqual({ index: 0, card: card('a', 1, 0) })
    expect(flashCurrent(flash({ index: 1 }), deck)).toEqual({ index: 2, card: card('c', 1, 0) })
    expect(flashCurrent(flash({ index: 1 }), [card('a', 1, 0)])).toBeNull()
  })

  test('cards-end shows what was rated, or goes Home with nothing rated; x and close leave', async () => {
    const front = applyTutor(HOME, open(['a', 'b']))
    expect(applyTutor(front, { kind: 'cards-end' })).toEqual(HOME)
    const rated = apply(front, { kind: 'flip' }, { kind: 'rate', id: 'a', rating: 'good', wasDue: true }, { kind: 'cards-end' })
    expect(rated.phase).toBe('cards-done')
    if (rated.phase === 'cards-done') expect(rated.xp).toBe(1)
    expect(applyTutor(front, { kind: 'cancel' })).toEqual(HOME)
    expect(applyTutor(rated, { kind: 'cancel' })).toEqual(HOME)
    expect(applyTutor(front, { kind: 'closed' })).toEqual({ phase: 'closed' })
    expect(applyTutor(rated, { kind: 'closed' })).toEqual({ phase: 'closed' })
    // Round events don't reach flashcards.
    for (const event of [{ kind: 'next' }, { kind: 'skip' }, { kind: 'hint' }, { kind: 'chose', index: 0 }] as const) {
      expect(applyTutor(front, event)).toBe(front)
      expect(applyTutor(rated, event)).toBe(rated)
    }
    // Flashcard events don't reach a round's screens.
    const question: TutorState = { phase: 'loading', epoch: 1, focus: 'recent', source: 'digest', since: 0 }
    for (const event of [{ kind: 'flip' }, { kind: 'cards-end' }, { kind: 'rate', id: 'a', rating: 'good', wasDue: true }, open(['a'])] as const) {
      expect(applyTutor(question, event)).toBe(question)
      expect(applyFlash(question, event)).toBe(question)
    }
  })

  test('rateCard: again to box 1, hard keeps the box, both due after one more round', async () => {
    for (const dueRound of [2, 9]) {
      const held = project({ rounds: 5, deck: [card('x', 3, dueRound), card('y', 2, 1)] })
      const again = rateCard(held, 'x', 'again', 77)
      expect(again.deck).toEqual([card('x', 1, 6), card('y', 2, 1)])
      expect(again.updatedAt).toBe(77)
      const hard = rateCard(held, 'x', 'hard', 77)
      expect(hard.deck).toEqual([card('x', 3, 6), card('y', 2, 1)])
      expect(hard.mastered).toEqual([])
    }
  })

  test('rateCard: good promotes a due card and retires it from box 3, but leaves a card not due', async () => {
    const held = project({ rounds: 5, mastered: ['old'], deck: [card('b1', 1, 5), card('b2', 2, 3), card('b3', 3, 0), card('ahead', 1, 6)] })
    expect(rateCard(held, 'b1', 'good', 1).deck[0]).toEqual(card('b1', 2, 8))
    expect(rateCard(held, 'b2', 'good', 1).deck[1]).toEqual(card('b2', 3, 11))
    const retired = rateCard(held, 'b3', 'good', 1)
    expect(retired.deck.map(left => left.question.id)).toEqual(['b1', 'b2', 'ahead'])
    expect(retired.mastered).toEqual(['old', 'topic b3'])
    // Not due: no cramming to mastery, only the save time moves.
    const ahead = rateCard(held, 'ahead', 'good', 42)
    expect(ahead).toEqual({ ...held, updatedAt: 42 })
    // Rounds are not counted by flashcards.
    expect(retired.rounds).toBe(5)
    // A full mastered list keeps its newest.
    const full = project({ rounds: 1, mastered: Array.from({ length: MAX_MASTERED }, (_, index) => `m${index}`), deck: [card('z', 3, 0)] })
    expect(rateCard(full, 'z', 'good', 1).mastered.at(-1)).toBe('topic z')
    expect(rateCard(full, 'z', 'good', 1).mastered).toHaveLength(MAX_MASTERED)
  })

  test('rateCard leaves the project alone for a card no longer in the deck', async () => {
    const held = project({ rounds: 1, deck: [card('a', 1, 0)] })
    expect(rateCard(held, 'gone', 'again', 9)).toBe(held)
  })

  test('XP: one per good on a due card, within what the conversation has left', async () => {
    expect(flashXpLeft(session(0))).toBe(FLASH_XP_CAP)
    expect(flashXpLeft(session(7))).toBe(3)
    expect(flashXpLeft(session(FLASH_XP_CAP + 4))).toBe(0)
    const ratings = [
      { id: 'a', rating: 'good', wasDue: true },
      { id: 'b', rating: 'good', wasDue: false },
      { id: 'c', rating: 'hard', wasDue: true },
      { id: 'd', rating: 'good', wasDue: true },
      { id: 'e', rating: 'good', wasDue: true },
    ] as const
    expect(flashXpOf(flash({ ratings }))).toBe(3)
    // The cap is reached mid-session: the rest of the goods earn nothing.
    expect(flashXpOf(flash({ ratings, xpLeft: 2 }))).toBe(2)
    expect(flashXpOf(flash({ ratings, xpLeft: 0 }))).toBe(0)
  })

  test('XP: per-rating grants add up to the done screen and the cap holds across sessions', async () => {
    const ids = Array.from({ length: 8 }, (_, index) => `g${index}`)
    let spent = 6
    const playSession = (): number => {
      let state = applyTutor(HOME, open(ids, flashXpLeft(session(spent))))
      let granted = 0
      for (const id of ids) {
        const before = flashOf(state)
        state = apply(state, { kind: 'flip' }, { kind: 'rate', id, rating: 'good', wasDue: true })
        const grant = flashXpOf(flashOf(state)) - flashXpOf(before)
        granted += grant
        spent += grant
      }
      if (state.phase !== 'cards-done') throw new Error('not done')
      expect(state.xp).toBe(granted)
      return granted
    }
    expect(playSession()).toBe(4)
    // A second session in the same conversation gets only what is left.
    expect(playSession()).toBe(0)
    expect(spent).toBe(FLASH_XP_CAP)
  })

  test('goodStreak counts the goods at the end', async () => {
    expect(goodStreak(flash())).toBe(0)
    const rate = (rating: 'again' | 'hard' | 'good') => ({ id: 'a', rating, wasDue: true })
    expect(goodStreak(flash({ ratings: [rate('good'), rate('good'), rate('good')] }))).toBe(3)
    expect(goodStreak(flash({ ratings: [rate('good'), rate('again'), rate('good'), rate('good')] }))).toBe(2)
    expect(goodStreak(flash({ ratings: [rate('good'), rate('hard')] }))).toBe(0)
  })

  test('keepCard adds a question at box 1 due after one more round, once', async () => {
    const held = project({ rounds: 3, deck: [card('a', 2, 9)] })
    const question = choice('new')
    expect(canKeepCard(held, question)).toBe(true)
    const kept = keepCard(held, question, 50)
    expect(kept.deck).toContainEqual({ question, box: 1, dueRound: 4 })
    expect(kept.updatedAt).toBe(50)
    expect(canKeepCard(kept, question)).toBe(false)
    expect(keepCard(kept, question, 60)).toBe(kept)
    // A replayed card is the deck's own; the replay marker would never be stored anyway.
    const replay = { ...choice('a'), isReview: true as const }
    expect(canKeepCard(held, replay)).toBe(false)
    expect(keepCard(held, replay, 1)).toBe(held)
    expect(canKeepCard(held, { ...choice('other'), isReview: true as const })).toBe(false)
  })

  test('keepCard on a full deck drops the highest box, never the card just kept', async () => {
    const deck = Array.from({ length: MAX_DECK }, (_, index) => card(`d${index}`, index === 4 ? 3 : 1, 0))
    const kept = keepCard(project({ rounds: 0, deck }), choice('mine'), 1)
    expect(kept.deck).toHaveLength(MAX_DECK)
    expect(kept.deck.some(left => left.question.id === 'mine')).toBe(true)
    expect(kept.deck.some(left => left.question.id === 'd4')).toBe(false)
    // Even a deck of box-1 cards loses an older card, not the kept one.
    const flat = Array.from({ length: MAX_DECK }, (_, index) => card(`f${index}`, 1, 5))
    const keptFlat = keepCard(project({ rounds: 0, deck: flat }), choice('mine'), 1)
    expect(keptFlat.deck.some(left => left.question.id === 'mine')).toBe(true)
    expect(keptFlat.deck).toHaveLength(MAX_DECK)
  })

  test('the command replies stay neutral', async () => {
    expect(FLASH_REPLIES.opened).toBe('Flashcards open in the Tutor tab.')
    expect(FLASH_REPLIES.empty).toBe('No flashcards yet: play a round first, or press k on an answer to keep it.')
  })
})
