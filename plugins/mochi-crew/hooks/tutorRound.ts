import type { ModelUsage } from 'claude-code'

import type { ChoiceQuestion, TutorAnswer, TutorFailure, TutorFocus, TutorLevel, TutorOutcome, TutorQuestion, TutorRound, TutorState, TutorUsage } from '../types'
import { cleanModelText, shuffleChoice } from './tutorParse'

/** Follow-ups allowed on one question (B.6). */
export const FOLLOW_UPS_PER_QUESTION = 2
/** Follow-ups allowed over a whole round (B.6). */
export const FOLLOW_UPS_PER_ROUND = 6
/** A typed explain answer is cut to this many characters (A.2 S3b). */
export const MAX_ANSWER_CHARS = 600
/** A follow-up question is cut to this many characters (B.6). */
export const MAX_ASK_CHARS = 400
/** Mochi's follow-up reply is cut to this many characters (B.6). */
export const MAX_ASK_REPLY_CHARS = 700
/** Fewer non-space characters than this is not an answer worth a grading call. */
export const MIN_ANSWER_CHARS = 3
/** Bonus XP for a perfect round (B.7). */
export const PERFECT_ROUND_XP = 10
/** The most XP one round can earn (B.7). */
export const MAX_ROUND_XP = 35
/** A perfect round needs at least this many questions, so a short round can't farm the bonus. */
export const PERFECT_MIN_QUESTIONS = 4

/** Something that happened in the tutor tab; `applyTutor` turns it into the next screen. */
export type TutorEvent =
  /** `pending` carries a round asked for before consent, so accepting starts it (A.2 S0). */
  | { kind: 'open'; hasConsent: boolean; pending?: { readonly focus: TutorFocus; readonly isDigestOnly: boolean } }
  | { kind: 'consented' }
  | { kind: 'declined' }
  | { kind: 'pick-focus'; focus: TutorFocus }
  | { kind: 'toggle-digest' }
  | { kind: 'loading'; epoch: number; focus: TutorFocus; source: 'fork' | 'digest'; at: number; note?: string }
  | { kind: 'loaded'; round: TutorRound }
  | { kind: 'failed'; failure: TutorFailure; canTryDigest: boolean }
  | { kind: 'hint' }
  | { kind: 'chose'; index: number }
  | { kind: 'skip' }
  | { kind: 'reveal' }
  | { kind: 'grading'; epoch: number; given: string; at: number }
  /** `usage` on the four call results is that call's spend, added to the round's (C.7). */
  | { kind: 'graded'; points: readonly boolean[]; note: string; usage?: ModelUsage }
  | { kind: 'grade-failed'; usage?: ModelUsage }
  | { kind: 'self-graded'; outcome: 'right' | 'partial' | 'wrong' }
  | { kind: 'asking'; epoch: number; at: number }
  | { kind: 'answered-ask'; ask: string; reply: string; usage?: ModelUsage }
  | { kind: 'ask-failed'; usage?: ModelUsage }
  | { kind: 'next' }
  | { kind: 'finished'; xp: number; levelBefore: TutorLevel; levelAfter: TutorLevel; wasForkMiss: boolean }
  | { kind: 'retry-missed'; epoch: number; at: number }
  | { kind: 'cancel' }
  | { kind: 'closed' }

/** Questions in a new round, a spliced review card included (B.1). */
export const ROUND_SIZE = 5
// Where a due card goes in a new round: after two fresh questions, so the round opens on new work.
const REVIEW_SLOT = 2

/** Nothing spent yet. */
export const EMPTY_USAGE: TutorUsage = { calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

/** The question on screen, if the index is in range. */
export const currentQuestion = (round: TutorRound): TutorQuestion | undefined => round.questions[round.index]

/** The answer recorded for the question on screen, graded or still waiting on a grade. */
export const currentAnswer = (round: TutorRound): TutorAnswer | undefined => {
  const question = currentQuestion(round)
  if (question === undefined) return undefined
  return round.answers.find(answer => answer.questionId === question.id)
}

/**
 * Whether the explain question on screen still needs the learner to grade themselves: the answer
 * was revealed (nothing recorded yet), or a typed answer is held while its grade is pending or
 * after the grade failed. A pending answer is stored as `skipped` with `given` and no `points`,
 * because the grading screen has nowhere else to keep the typed text; ending the round there
 * therefore counts it as skipped.
 */
export const isAwaitingSelfGrade = (round: TutorRound): boolean => {
  const question = currentQuestion(round)
  if (question === undefined || question.kind !== 'explain') return false
  const answer = currentAnswer(round)
  if (answer === undefined) return true
  return answer.outcome === 'skipped' && answer.given !== undefined && answer.points === undefined && answer.isSelfGraded !== true
}

/** Whether this is the round's final question. */
export const isLastQuestion = (round: TutorRound): boolean => round.index >= round.questions.length - 1

/** Whether typed text is too thin to send for grading (A.2 S3b): fewer than three non-space characters. */
export const isAnswerTooShort = (text: string): boolean => text.replace(/\s/g, '').length < MIN_ANSWER_CHARS

/** Follow-ups still allowed on the question on screen: the smaller of the per-question and per-round caps. */
export const followUpsLeft = (round: TutorRound): number =>
  Math.max(0, Math.min(FOLLOW_UPS_PER_QUESTION - round.chat.length, FOLLOW_UPS_PER_ROUND - round.followUpsUsed))

/** Local grading for a choice: the shuffled answer index is the only right pick. */
export const gradeChoice = (question: ChoiceQuestion, picked: number): TutorOutcome => (picked === question.answer ? 'right' : 'wrong')

/** An explain verdict from the grader's per-key-point marks (B.4): all is right, at least half is partial. */
export const verdictOf = (points: readonly boolean[]): TutorOutcome => {
  // No marks means nothing was checked; never let a vacuous "all true" read as right.
  if (points.length === 0) return 'wrong'
  const hits = points.filter(point => point).length
  if (hits === points.length) return 'right'
  return hits * 2 >= points.length ? 'partial' : 'wrong'
}

/** XP for one answer (B.7); a retry-missed pass earns nothing, so replaying can't farm XP. */
export const xpForAnswer = (answer: TutorAnswer, isRetry: boolean): number => {
  if (isRetry) return 0
  if (answer.outcome === 'right') return answer.hasUsedHint ? 2 : 5
  return answer.outcome === 'partial' ? 3 : 0
}

/**
 * A round's tally. `total` counts the answers recorded, so a round ended early is scored on
 * what was answered; `isPerfect` also needs every question answered, all right, no hints and at
 * least PERFECT_MIN_QUESTIONS of them.
 */
export const scoreRound = (round: TutorRound): { readonly right: number; readonly total: number; readonly hints: number; readonly isPerfect: boolean } => {
  const right = round.answers.filter(answer => answer.outcome === 'right').length
  const hints = round.answers.filter(answer => answer.hasUsedHint).length
  const total = round.answers.length
  const isPerfect = total >= PERFECT_MIN_QUESTIONS && total === round.questions.length && right === total && hints === 0
  return { right, total, hints, isPerfect }
}

/** XP for a whole round (B.7): the answers plus the perfect bonus, capped; review rounds earn half and no bonus. */
export const roundXp = (round: TutorRound): number => {
  if (round.isRetry) return 0
  const sum = round.answers.reduce((total, answer) => total + xpForAnswer(answer, false), 0)
  if (round.source === 'review') return Math.min(MAX_ROUND_XP, Math.floor(sum / 2))
  const bonus = scoreRound(round).isPerfect ? PERFECT_ROUND_XP : 0
  return Math.min(MAX_ROUND_XP, sum + bonus)
}

const tokens = (count: number): number => (Number.isFinite(count) && count > 0 ? count : 0)

/** Toasts for a start or review that the screen on show turns away. */
export const TUTOR_REFUSALS: Readonly<{ writing: string; checking: string; mid: string }> = {
  writing: 'Mochi is already writing one.',
  checking: 'Mochi is checking your answer.',
  mid: 'Finish or end this round first.',
}

/**
 * Why a new round cannot start over `state`, as a toast, or undefined when it can. One call runs
 * at a time, and a round on screen is finished or ended first, so its answers are not lost.
 */
export const tutorStartRefusal = (state: TutorState): string | undefined => {
  switch (state.phase) {
    case 'loading':
      return TUTOR_REFUSALS.writing
    case 'grading':
    case 'asking':
      return TUTOR_REFUSALS.checking
    case 'question':
    case 'feedback':
      return TUTOR_REFUSALS.mid
    default:
      return undefined
  }
}

/** Adds one call's usage to a running total; failed and stale calls count too (C.7). */
export const addTutorUsage = (total: TutorUsage, usage: ModelUsage): TutorUsage => ({
  calls: total.calls + 1,
  input: total.input + tokens(usage.input_tokens),
  cacheRead: total.cacheRead + tokens(usage.cache_read_input_tokens),
  cacheWrite: total.cacheWrite + tokens(usage.cache_creation_input_tokens),
  output: total.output + tokens(usage.output_tokens),
})

/** The S7 line naming why a round failed. Only local values reach it: error kinds, statuses and the configured model. */
export const describeTutorFailure = (failure: TutorFailure): string => {
  switch (failure.kind) {
    case 'bad-reply':
      return "the reply wasn't a quiz"
    case 'empty-reply':
      return 'the reply was empty'
    case 'timeout':
      return 'took too long'
    case 'nothing-to-quiz':
      return 'nothing to quiz yet'
    case 'model-refused':
      return `the tutor model "${failure.model}" isn't allowed here; pick another in /config.`
    case 'api-error': {
      // The error kind is what Claude Code classified; the status is the fallback when it is vague.
      if (failure.error === 'overloaded' || (failure.error !== 'rate_limit' && failure.status === 529)) return `model busy (${failure.status ?? 529} overloaded). Try again in a bit.`
      if (failure.error === 'rate_limit' || failure.status === 429) return `rate-limited (${failure.status ?? 429}). Try again in a bit.`
      const cause = failure.error !== '' ? failure.error : failure.status === null ? 'no response' : String(failure.status)
      return `the call was refused (${cause}).`
    }
  }
}

/**
 * Records a skip for the question on screen if it has no answer yet, so the round the handler
 * scores and the round the summary shows are the same. Idempotent: a recorded answer is kept.
 */
export const closeOutRound = (round: TutorRound): TutorRound => {
  const question = currentQuestion(round)
  if (question === undefined || currentAnswer(round) !== undefined) return round
  return { ...round, answers: [...round.answers, { questionId: question.id, outcome: 'skipped', hasUsedHint: round.isHintShown }] }
}

/**
 * A saved card's question asked again: marked as a replay, keeping its own id (the deck finds
 * its card by it), with a choice's options reshuffled from `seed` so it is not answered by place.
 */
export const replayQuestion = (question: TutorQuestion, seed: number): TutorQuestion =>
  ({ ...(question.kind === 'choice' ? shuffleChoice(question, seed) : question), isReview: true as const })

/** A new round's questions with one due card replayed at index 2, or at the end of a shorter list. */
export const spliceReview = (questions: readonly TutorQuestion[], review: TutorQuestion | undefined, seed: number): readonly TutorQuestion[] => {
  if (review === undefined || questions.some(question => question.id === review.id)) return questions
  const at = Math.min(REVIEW_SLOT, questions.length)
  return [...questions.slice(0, at), replayQuestion(review, seed * 31 + at), ...questions.slice(at)]
}

const withAnswer = (round: TutorRound, answer: TutorAnswer): TutorRound => ({
  ...round,
  answers: [...round.answers.filter(held => held.questionId !== answer.questionId), answer],
})

/** The round with one more call's spend; a call that made no request (refused) has none. */
const withSpend = (round: TutorRound, usage: ModelUsage | undefined): TutorRound =>
  usage === undefined ? round : { ...round, usage: addTutorUsage(round.usage, usage) }

const isMissed = (answer: TutorAnswer): boolean => answer.outcome !== 'right'

/** The summary's missed questions as a fresh local round, options reshuffled from the event's epoch. */
const retryRound = (round: TutorRound, epoch: number, at: number): TutorRound | null => {
  const missedIds = new Set(round.answers.filter(isMissed).map(answer => answer.questionId))
  const questions = round.questions
    .filter(question => missedIds.has(question.id))
    .map((question, index): TutorQuestion => (question.kind === 'choice' ? shuffleChoice(question, epoch * 31 + index) : question))
  if (questions.length === 0) return null
  return {
    id: `${round.id}:retry${epoch}`,
    epoch,
    focus: round.focus,
    source: round.source,
    startedAt: at,
    questions,
    index: 0,
    answers: [],
    isHintShown: false,
    isRetry: true,
    chat: [],
    followUpsUsed: 0,
    usage: EMPTY_USAGE,
  }
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair, whose lone half would not encode for the API. */
const cut = (text: string, max: number): string => {
  if (text.length <= max) return text
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max
  return text.slice(0, end)
}

const HOME_FOCUS: TutorFocus = 'recent'

// The types share one member for each pair of phases, so the pairs are extracted together.
type AnswerState = Extract<TutorState, { phase: 'question' | 'feedback' }>
type WaitState = Extract<TutorState, { phase: 'grading' | 'asking' }>

const onClosed = (state: Extract<TutorState, { phase: 'closed' }>, event: TutorEvent): TutorState => {
  if (event.kind !== 'open') return state
  if (!event.hasConsent) return event.pending === undefined ? { phase: 'consent' } : { phase: 'consent', pending: event.pending }
  return { phase: 'home', focus: event.pending?.focus ?? HOME_FOCUS, isDigestOnly: event.pending?.isDigestOnly ?? false }
}

const onConsent = (state: Extract<TutorState, { phase: 'consent' }>, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'consented':
      // The handler starts a pending round from here with a `loading` event.
      return { phase: 'home', focus: state.pending?.focus ?? HOME_FOCUS, isDigestOnly: state.pending?.isDigestOnly ?? false }
    case 'declined':
    case 'closed':
      return { phase: 'closed' }
    case 'open':
      if (event.hasConsent) return { phase: 'home', focus: event.pending?.focus ?? state.pending?.focus ?? HOME_FOCUS, isDigestOnly: event.pending?.isDigestOnly ?? state.pending?.isDigestOnly ?? false }
      return event.pending === undefined ? state : { phase: 'consent', pending: event.pending }
    default:
      return state
  }
}

const startLoading = (event: Extract<TutorEvent, { kind: 'loading' }>): TutorState => ({
  phase: 'loading',
  epoch: event.epoch,
  focus: event.focus,
  source: event.source,
  since: event.at,
  ...(event.note === undefined ? {} : { note: event.note }),
})

const startRound = (round: TutorRound): TutorState => (round.questions.length === 0 ? { phase: 'home', focus: round.focus, isDigestOnly: false } : { phase: 'question', round })

const onHome = (state: Extract<TutorState, { phase: 'home' }>, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'pick-focus':
      return event.focus === state.focus && state.note === undefined ? state : { phase: 'home', focus: event.focus, isDigestOnly: state.isDigestOnly }
    case 'toggle-digest':
      return { phase: 'home', focus: state.focus, isDigestOnly: !state.isDigestOnly }
    case 'loading':
      return startLoading(event)
    case 'loaded':
      // Only a review round starts without a call, so only it may skip `loading`.
      return event.round.source === 'review' && event.round.questions.length > 0 ? { phase: 'question', round: event.round } : state
    case 'failed':
      return { phase: 'error', failure: event.failure, focus: state.focus, canTryDigest: event.canTryDigest }
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onLoading = (state: Extract<TutorState, { phase: 'loading' }>, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'loading':
      // The fork fell back to the digest under a new epoch.
      return startLoading(event)
    case 'loaded':
      // A reply from an earlier epoch is stale even if a handler forgot to check.
      return event.round.epoch === state.epoch && event.round.questions.length > 0 ? startRound(event.round) : state
    case 'failed':
      return { phase: 'error', failure: event.failure, focus: state.focus, canTryDigest: event.canTryDigest }
    case 'cancel':
      return { phase: 'home', focus: state.focus, isDigestOnly: false, note: 'cancelled' }
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const finish = (round: TutorRound, event: Extract<TutorEvent, { kind: 'finished' }>): TutorState => ({
  phase: 'summary',
  round: closeOutRound(round),
  xp: event.xp,
  levelBefore: event.levelBefore,
  levelAfter: event.levelAfter,
  wasForkMiss: event.wasForkMiss,
})

const onQuestion = (state: AnswerState, event: TutorEvent): TutorState => {
  const { round } = state
  const question = currentQuestion(round)
  if (question === undefined) return event.kind === 'closed' ? { phase: 'closed' } : state
  switch (event.kind) {
    case 'hint':
      if (round.isHintShown || question.hint === undefined) return state
      return { phase: 'question', round: { ...round, isHintShown: true } }
    case 'chose': {
      if (question.kind !== 'choice' || !Number.isInteger(event.index) || event.index < 0 || event.index >= question.options.length) return state
      const answer: TutorAnswer = { questionId: question.id, outcome: gradeChoice(question, event.index), hasUsedHint: round.isHintShown, picked: event.index }
      return { phase: 'feedback', round: withAnswer(round, answer) }
    }
    case 'skip':
      return { phase: 'feedback', round: withAnswer(round, { questionId: question.id, outcome: 'skipped', hasUsedHint: round.isHintShown }) }
    case 'reveal':
      // Nothing is recorded: the feedback screen then asks the learner to grade themselves.
      return question.kind === 'explain' ? { phase: 'feedback', round } : state
    case 'grading': {
      if (question.kind !== 'explain' || isAnswerTooShort(event.given)) return state
      const isCut = event.given.length > MAX_ANSWER_CHARS
      // Held as a skip until graded, so ending the round mid-grade scores it as skipped.
      const pending: TutorAnswer = {
        questionId: question.id,
        outcome: 'skipped',
        hasUsedHint: round.isHintShown,
        given: cut(event.given, MAX_ANSWER_CHARS),
        ...(isCut ? { isCut: true as const } : {}),
      }
      return { phase: 'grading', round: withAnswer(round, pending), epoch: event.epoch, since: event.at }
    }
    case 'finished':
      return finish(round, event)
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onGrading = (state: WaitState, event: TutorEvent): TutorState => {
  const { round } = state
  const question = currentQuestion(round)
  const held = currentAnswer(round)
  switch (event.kind) {
    case 'graded': {
      const spent = withSpend(round, event.usage)
      // A count mismatch can't be mapped onto the key points; let the learner grade instead.
      if (question?.kind !== 'explain' || held === undefined || event.points.length !== question.keyPoints.length) return { phase: 'feedback', round: spent }
      return { phase: 'feedback', round: withAnswer(spent, { ...held, outcome: verdictOf(event.points), points: event.points, note: event.note }) }
    }
    case 'grade-failed':
      return { phase: 'feedback', round: withSpend(round, event.usage) }
    case 'cancel':
      return { phase: 'feedback', round }
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onFeedback = (state: AnswerState, event: TutorEvent): TutorState => {
  const { round } = state
  const question = currentQuestion(round)
  if (question === undefined) return event.kind === 'closed' ? { phase: 'closed' } : state
  switch (event.kind) {
    case 'self-graded': {
      if (!isAwaitingSelfGrade(round)) return state
      const held = currentAnswer(round)
      const base: TutorAnswer = held ?? { questionId: question.id, outcome: event.outcome, hasUsedHint: round.isHintShown }
      return { phase: 'feedback', round: withAnswer(round, { ...base, outcome: event.outcome, isSelfGraded: true }) }
    }
    case 'asking':
      if (followUpsLeft(round) === 0) return state
      return { phase: 'asking', round, epoch: event.epoch, since: event.at }
    case 'next': {
      // The last question's `next` is the handler's cue to score the round and send `finished`.
      if (isLastQuestion(round)) return state
      const closed = closeOutRound(round)
      return { phase: 'question', round: { ...closed, index: round.index + 1, isHintShown: false, chat: [] } }
    }
    case 'finished':
      return finish(round, event)
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onAsking = (state: WaitState, event: TutorEvent): TutorState => {
  const { round } = state
  switch (event.kind) {
    case 'answered-ask': {
      // The reply is model text: cleaned here too, so a handler that forgot can't store raw escapes or echoed secrets.
      const exchange = { ask: cut(event.ask, MAX_ASK_CHARS), reply: cut(cleanModelText(event.reply), MAX_ASK_REPLY_CHARS) }
      const spent = withSpend(round, event.usage)
      return { phase: 'feedback', round: { ...spent, chat: [...spent.chat, exchange], followUpsUsed: spent.followUpsUsed + 1 } }
    }
    case 'ask-failed':
      // A failed or cancelled follow-up costs the learner nothing (its tokens still count).
      return { phase: 'feedback', round: withSpend(round, event.usage) }
    case 'cancel':
      return { phase: 'feedback', round }
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onSummary = (state: Extract<TutorState, { phase: 'summary' }>, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'next':
      return { phase: 'home', focus: state.round.focus, isDigestOnly: false }
    case 'pick-focus':
      return { phase: 'home', focus: event.focus, isDigestOnly: false }
    case 'retry-missed': {
      const retry = retryRound(state.round, event.epoch, event.at)
      return retry === null ? state : { phase: 'question', round: retry }
    }
    case 'loading':
      return startLoading(event)
    case 'loaded':
      return event.round.source === 'review' && event.round.questions.length > 0 ? { phase: 'question', round: event.round } : state
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

const onError = (state: Extract<TutorState, { phase: 'error' }>, event: TutorEvent): TutorState => {
  switch (event.kind) {
    case 'loading':
      return startLoading(event)
    case 'pick-focus':
      return { phase: 'home', focus: event.focus, isDigestOnly: false }
    case 'closed':
      return { phase: 'closed' }
    default:
      return state
  }
}

/**
 * The state after one event; an event that does not fit the phase returns the same object, so
 * a late or doubled press is a no-op. Pure: times, epochs and seeds come from the event.
 *
 * - `chose` and `skip` fit only `question`; `chose` is ignored on an explain question.
 * - `next` on the last question stays put: the handler scores the round and sends `finished`.
 * - `cancel` from `loading` goes home; from `grading` to the ungraded feedback; from `asking`
 *   back to feedback.
 */
export const applyTutor = (state: TutorState, event: TutorEvent): TutorState => {
  switch (state.phase) {
    case 'closed':
      return onClosed(state, event)
    case 'consent':
      return onConsent(state, event)
    case 'home':
      return onHome(state, event)
    case 'loading':
      return onLoading(state, event)
    case 'question':
      return onQuestion(state, event)
    case 'grading':
      return onGrading(state, event)
    case 'feedback':
      return onFeedback(state, event)
    case 'asking':
      return onAsking(state, event)
    case 'summary':
      return onSummary(state, event)
    case 'error':
      return onError(state, event)
  }
}
