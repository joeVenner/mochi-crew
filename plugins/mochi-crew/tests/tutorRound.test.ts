import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, ExplainQuestion, TutorAnswer, TutorQuestion, TutorRound, TutorState } from '../types'
import {
  EMPTY_USAGE,
  FOLLOW_UPS_PER_QUESTION,
  FOLLOW_UPS_PER_ROUND,
  MAX_ANSWER_CHARS,
  addTutorUsage,
  applyTutor,
  closeOutRound,
  currentAnswer,
  describeTutorFailure,
  followUpsLeft,
  gradeChoice,
  isAwaitingSelfGrade,
  isLastQuestion,
  roundXp,
  scoreRound,
  verdictOf,
  xpForAnswer,
} from '../hooks/tutorRound'
import type { TutorEvent } from '../hooks/tutorRound'

const choice = (id: string, over: Partial<ChoiceQuestion> = {}): ChoiceQuestion => ({
  id,
  kind: 'choice',
  tag: 'why',
  topic: `topic ${id}`,
  prompt: 'Why does gitOutput pass --no-optional-locks?',
  options: ['never hold index.lock', 'speed', 'worktrees need it', 'skip untracked'],
  answer: 0,
  why: ['right because', 'not speed', 'not worktrees', 'not untracked'],
  hint: 'Think about what else runs git.',
  ...over,
})

const explain = (id: string, over: Partial<ExplainQuestion> = {}): ExplainQuestion => ({
  id,
  kind: 'explain',
  tag: 'how',
  topic: `topic ${id}`,
  prompt: 'In your own words: how does the tree place a file?',
  reference: 'By the longest matching worktree root.',
  keyPoints: ['longest root wins', 'main root otherwise'],
  hint: 'Think about nesting.',
  ...over,
})

const round = (questions: readonly TutorQuestion[], over: Partial<TutorRound> = {}): TutorRound => ({
  id: 'r1',
  epoch: 1,
  focus: 'recent',
  source: 'digest',
  startedAt: 0,
  questions,
  index: 0,
  answers: [],
  isHintShown: false,
  isRetry: false,
  chat: [],
  followUpsUsed: 0,
  usage: EMPTY_USAGE,
  ...over,
})

const FIVE: readonly TutorQuestion[] = [choice('r1:0'), choice('r1:1'), explain('r1:2'), choice('r1:3'), choice('r1:4')]

const answer = (questionId: string, outcome: TutorAnswer['outcome'], hasUsedHint = false): TutorAnswer => ({ questionId, outcome, hasUsedHint })

const apply = (state: TutorState, ...events: readonly TutorEvent[]): TutorState => events.reduce(applyTutor, state)

const roundOf = (state: TutorState): TutorRound => {
  if (!('round' in state)) throw new Error(`no round in ${state.phase}`)
  return state.round
}

const usage = (input: number, cacheRead: number, cacheWrite: number, output: number) => ({
  input_tokens: input,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
  output_tokens: output,
})

const finishedEvent: TutorEvent = { kind: 'finished', xp: 25, levelBefore: 2, levelAfter: 2, wasForkMiss: false }

const STATES: Readonly<Record<TutorState['phase'], TutorState>> = {
  closed: { phase: 'closed' },
  consent: { phase: 'consent' },
  home: { phase: 'home', focus: 'recent', isDigestOnly: false },
  loading: { phase: 'loading', epoch: 3, focus: 'turn', source: 'fork', since: 10 },
  question: { phase: 'question', round: round(FIVE) },
  feedback: { phase: 'feedback', round: round(FIVE, { answers: [answer('r1:0', 'right')] }) },
  grading: { phase: 'grading', round: round(FIVE, { index: 2 }), epoch: 4, since: 0 },
  asking: { phase: 'asking', round: round(FIVE, { answers: [answer('r1:0', 'right')] }), epoch: 4, since: 0 },
  summary: { phase: 'summary', round: round(FIVE, { answers: FIVE.map(q => answer(q.id, 'right')) }), xp: 35, levelBefore: 2, levelAfter: 2, wasForkMiss: false },
  error: { phase: 'error', failure: { kind: 'timeout' }, focus: 'recent', canTryDigest: true },
}

const EVENTS: readonly TutorEvent[] = [
  { kind: 'open', hasConsent: true },
  { kind: 'consented' },
  { kind: 'declined' },
  { kind: 'pick-focus', focus: 'project' },
  { kind: 'toggle-digest' },
  { kind: 'loading', epoch: 9, focus: 'recent', source: 'digest', at: 0 },
  { kind: 'loaded', round: round(FIVE, { epoch: 3 }) },
  { kind: 'failed', failure: { kind: 'timeout' }, canTryDigest: false },
  { kind: 'hint' },
  { kind: 'chose', index: 0 },
  { kind: 'skip' },
  { kind: 'reveal' },
  { kind: 'grading', epoch: 5, given: 'longest root wins', at: 0 },
  { kind: 'graded', points: [true, true], note: 'good' },
  { kind: 'grade-failed' },
  { kind: 'self-graded', outcome: 'right' },
  { kind: 'asking', epoch: 5, at: 0 },
  { kind: 'answered-ask', ask: 'why?', reply: 'because' },
  { kind: 'ask-failed' },
  { kind: 'next' },
  finishedEvent,
  { kind: 'retry-missed', epoch: 6, at: 0 },
  { kind: 'cancel' },
  { kind: 'closed' },
]

/** Which events each phase acts on; every other pairing must hand back the same object. */
const FITS: Readonly<Record<TutorState['phase'], ReadonlySet<TutorEvent['kind']>>> = {
  closed: new Set(['open']),
  consent: new Set(['open', 'consented', 'declined', 'closed']),
  home: new Set(['pick-focus', 'toggle-digest', 'loading', 'failed', 'closed']),
  loading: new Set(['loading', 'loaded', 'failed', 'cancel', 'closed']),
  question: new Set(['hint', 'chose', 'skip', 'finished', 'closed']),
  feedback: new Set(['asking', 'next', 'finished', 'closed']),
  grading: new Set(['graded', 'grade-failed', 'cancel', 'closed']),
  asking: new Set(['answered-ask', 'ask-failed', 'cancel', 'closed']),
  summary: new Set(['next', 'pick-focus', 'loading', 'closed']),
  error: new Set(['loading', 'pick-focus', 'closed']),
}

describe('tutor round', () => {
  test('events that do not fit the phase return the same object', async () => {
    for (const [phase, state] of Object.entries(STATES) as [TutorState['phase'], TutorState][]) {
      for (const event of EVENTS) {
        const next = applyTutor(state, event)
        if (FITS[phase].has(event.kind)) expect(next === state ? `${phase} ignored ${event.kind}` : 'changed').toBe('changed')
        else expect(next === state ? 'same' : `${phase} took ${event.kind}`).toBe('same')
      }
    }
    // Guards inside a fitting event also hand back the same object.
    const question = STATES.question
    expect(applyTutor(question, { kind: 'chose', index: 4 })).toBe(question)
    expect(applyTutor(question, { kind: 'chose', index: -1 })).toBe(question)
    const hinted = applyTutor(question, { kind: 'hint' })
    expect(applyTutor(hinted, { kind: 'hint' })).toBe(hinted)
    const noHint: TutorState = { phase: 'question', round: round([choice('a', { hint: undefined })]) }
    expect(applyTutor(noHint, { kind: 'hint' })).toBe(noHint)
    const last: TutorState = { phase: 'feedback', round: round(FIVE, { index: 4, answers: FIVE.map(q => answer(q.id, 'right')) }) }
    expect(applyTutor(last, { kind: 'next' })).toBe(last)
    expect(applyTutor(STATES.loading, { kind: 'loaded', round: round(FIVE, { epoch: 2 }) })).toBe(STATES.loading)
    const home = STATES.home
    expect(applyTutor(home, { kind: 'pick-focus', focus: 'recent' })).toBe(home)
    // An explain question takes reveal and grading instead of chose.
    const onExplain: TutorState = { phase: 'question', round: round(FIVE, { index: 2 }) }
    const explainFits = new Set<TutorEvent['kind']>(['hint', 'skip', 'reveal', 'grading', 'finished', 'closed'])
    for (const event of EVENTS) {
      const next = applyTutor(onExplain, event)
      if (explainFits.has(event.kind)) expect(next === onExplain ? `explain ignored ${event.kind}` : 'changed').toBe('changed')
      else expect(next === onExplain ? 'same' : `explain took ${event.kind}`).toBe('same')
    }
    // Reveal and grading do nothing on a choice question.
    expect(applyTutor(question, { kind: 'reveal' })).toBe(question)
    expect(applyTutor(question, { kind: 'grading', epoch: 5, given: 'longest root wins', at: 0 })).toBe(question)
  })

  test('consent then home', async () => {
    const consent = applyTutor({ phase: 'closed' }, { kind: 'open', hasConsent: false })
    expect(consent).toEqual({ phase: 'consent' })
    expect(applyTutor(consent, { kind: 'consented' })).toEqual({ phase: 'home', focus: 'recent', isDigestOnly: false })
    // A round asked for before consent comes back as the home focus, ready to start.
    const pending = applyTutor({ phase: 'closed' }, { kind: 'open', hasConsent: false, pending: { focus: 'project', isDigestOnly: true } })
    expect(applyTutor(pending, { kind: 'consented' })).toEqual({ phase: 'home', focus: 'project', isDigestOnly: true })
    expect(applyTutor({ phase: 'closed' }, { kind: 'open', hasConsent: true })).toEqual({ phase: 'home', focus: 'recent', isDigestOnly: false })
  })

  test('decline closes', async () => {
    expect(applyTutor({ phase: 'consent' }, { kind: 'declined' })).toEqual({ phase: 'closed' })
    expect(applyTutor({ phase: 'consent', pending: { focus: 'turn', isDigestOnly: false } }, { kind: 'closed' })).toEqual({ phase: 'closed' })
  })

  test('loading then loaded shows question 0', async () => {
    const loading = apply(STATES.home, { kind: 'loading', epoch: 7, focus: 'turn', source: 'fork', at: 100, note: 'session unavailable, using the digest…' })
    expect(loading).toEqual({ phase: 'loading', epoch: 7, focus: 'turn', source: 'fork', since: 100, note: 'session unavailable, using the digest…' })
    const fresh = round(FIVE, { epoch: 7 })
    const shown = applyTutor(loading, { kind: 'loaded', round: fresh })
    expect(shown.phase).toBe('question')
    expect(roundOf(shown).index).toBe(0)
    expect(roundOf(shown)).toBe(fresh)
    expect(apply(STATES.home, { kind: 'loading', epoch: 7, focus: 'turn', source: 'digest', at: 0 }, { kind: 'failed', failure: { kind: 'nothing-to-quiz' }, canTryDigest: false }))
      .toEqual({ phase: 'error', failure: { kind: 'nothing-to-quiz' }, focus: 'turn', canTryDigest: false })
  })

  test('choose on a choice records the outcome and shows feedback', async () => {
    const right = applyTutor(STATES.question, { kind: 'chose', index: 0 })
    expect(right.phase).toBe('feedback')
    expect(roundOf(right).answers).toEqual([{ questionId: 'r1:0', outcome: 'right', hasUsedHint: false, picked: 0 }])
    const wrong = applyTutor(STATES.question, { kind: 'chose', index: 2 })
    expect(roundOf(wrong).answers[0]?.outcome).toBe('wrong')
    expect(gradeChoice(choice('x', { answer: 3 }), 3)).toBe('right')
    expect(gradeChoice(choice('x', { answer: 3 }), 1)).toBe('wrong')
  })

  test('choose on an explain question is ignored', async () => {
    const state: TutorState = { phase: 'question', round: round(FIVE, { index: 2 }) }
    expect(applyTutor(state, { kind: 'chose', index: 0 })).toBe(state)
  })

  test('hint then right records the hint and earns 2', async () => {
    const state = apply(STATES.question, { kind: 'hint' }, { kind: 'chose', index: 0 })
    const recorded = roundOf(state).answers[0]
    expect(recorded?.hasUsedHint).toBe(true)
    expect(recorded === undefined ? -1 : xpForAnswer(recorded, false)).toBe(2)
    // The next question starts with the hint hidden.
    expect(roundOf(applyTutor(state, { kind: 'next' })).isHintShown).toBe(false)
    expect(xpForAnswer(answer('a', 'right'), false)).toBe(5)
    expect(xpForAnswer(answer('a', 'partial'), false)).toBe(3)
    expect(xpForAnswer(answer('a', 'wrong'), false)).toBe(0)
  })

  test('skip counts as skipped with no XP', async () => {
    const state = applyTutor(STATES.question, { kind: 'skip' })
    expect(state.phase).toBe('feedback')
    const recorded = roundOf(state).answers[0]
    expect(recorded?.outcome).toBe('skipped')
    expect(recorded === undefined ? -1 : xpForAnswer(recorded, false)).toBe(0)
  })

  test('grading then graded computes the verdict from points', async () => {
    const onExplain: TutorState = { phase: 'question', round: round(FIVE, { index: 2 }) }
    // Too short to be worth a call: nothing changes.
    expect(applyTutor(onExplain, { kind: 'grading', epoch: 5, given: ' a b ', at: 0 })).toBe(onExplain)
    const grading = applyTutor(onExplain, { kind: 'grading', epoch: 5, given: 'longest root wins', at: 40 })
    expect(grading).toMatchObject({ phase: 'grading', epoch: 5, since: 40 })
    expect(isAwaitingSelfGrade(roundOf(grading))).toBe(true)
    const solid = applyTutor(grading, { kind: 'graded', points: [true, true], note: 'nailed it' })
    expect(solid.phase).toBe('feedback')
    expect(currentAnswer(roundOf(solid))).toEqual({ questionId: 'r1:2', outcome: 'right', hasUsedHint: false, given: 'longest root wins', points: [true, true], note: 'nailed it' })
    expect(roundOf(solid).answers.length).toBe(1)
    expect(currentAnswer(roundOf(applyTutor(grading, { kind: 'graded', points: [true, false], note: '' })))?.outcome).toBe('partial')
    expect(currentAnswer(roundOf(applyTutor(grading, { kind: 'graded', points: [false, false], note: '' })))?.outcome).toBe('wrong')
    expect(verdictOf([true, true, true])).toBe('right')
    expect(verdictOf([true, true, false, false])).toBe('partial')
    expect(verdictOf([true, false, false])).toBe('wrong')
    expect(verdictOf([])).toBe('wrong')
    // A long answer is cut and says so.
    const long = applyTutor(onExplain, { kind: 'grading', epoch: 5, given: 'x'.repeat(900), at: 0 })
    expect(currentAnswer(roundOf(long))?.given?.length).toBe(MAX_ANSWER_CHARS)
    expect(currentAnswer(roundOf(long))?.isCut).toBe(true)
    // The cut never leaves half of a surrogate pair, which would not encode for the API.
    const emoji = applyTutor(onExplain, { kind: 'grading', epoch: 5, given: `${'x'.repeat(MAX_ANSWER_CHARS - 1)}\u{1F600}tail`, at: 0 })
    expect(currentAnswer(roundOf(emoji))?.given).toBe('x'.repeat(MAX_ANSWER_CHARS - 1))
    expect(currentAnswer(roundOf(applyTutor(onExplain, { kind: 'grading', epoch: 5, given: 'x'.repeat(MAX_ANSWER_CHARS), at: 0 })))?.isCut).toBe(undefined)
  })

  test('grade-failed shows the self-grade path', async () => {
    const grading = applyTutor({ phase: 'question', round: round(FIVE, { index: 2 }) }, { kind: 'grading', epoch: 5, given: 'longest root wins', at: 0 })
    const failed = applyTutor(grading, { kind: 'grade-failed' })
    expect(failed.phase).toBe('feedback')
    expect(isAwaitingSelfGrade(roundOf(failed))).toBe(true)
    const graded = applyTutor(failed, { kind: 'self-graded', outcome: 'partial' })
    expect(currentAnswer(roundOf(graded))).toEqual({ questionId: 'r1:2', outcome: 'partial', hasUsedHint: false, given: 'longest root wins', isSelfGraded: true })
    expect(isAwaitingSelfGrade(roundOf(graded))).toBe(false)
    expect(applyTutor(graded, { kind: 'self-graded', outcome: 'right' })).toBe(graded)
    // A mismatched point count can't be trusted, so it falls back to the same path.
    expect(isAwaitingSelfGrade(roundOf(applyTutor(grading, { kind: 'graded', points: [true], note: '' })))).toBe(true)
    // Reveal records nothing until the learner grades themselves.
    const revealed = applyTutor({ phase: 'question', round: round(FIVE, { index: 2 }) }, { kind: 'reveal' })
    expect(roundOf(revealed).answers).toEqual([])
    expect(isAwaitingSelfGrade(roundOf(revealed))).toBe(true)
    expect(currentAnswer(roundOf(applyTutor(revealed, { kind: 'self-graded', outcome: 'right' })))).toEqual({ questionId: 'r1:2', outcome: 'right', hasUsedHint: false, isSelfGraded: true })
  })

  test('follow-ups stop at 2 per question and 6 per round', async () => {
    expect(FOLLOW_UPS_PER_QUESTION).toBe(2)
    expect(FOLLOW_UPS_PER_ROUND).toBe(6)
    const ask = (state: TutorState): TutorState => apply(state, { kind: 'asking', epoch: 5, at: 0 }, { kind: 'answered-ask', ask: 'why?', reply: 'r'.repeat(900) })
    const once = ask(STATES.feedback)
    expect(roundOf(once).chat.length).toBe(1)
    expect(roundOf(once).chat[0]?.reply.length).toBe(700)
    // The reply is model text: control characters and echoed secrets never reach the chat.
    const hostile = apply(STATES.feedback, { kind: 'asking', epoch: 5, at: 0 }, { kind: 'answered-ask', ask: 'q'.repeat(900), reply: '\u001b[31mred\u001b[0m key sk-test-123456789abcdefghij' })
    const exchange = roundOf(hostile).chat[0]
    expect(exchange?.ask.length).toBe(400)
    expect(exchange?.reply.includes('\u001b')).toBe(false)
    expect(exchange?.reply.includes('sk-test-123456789abcdefghij')).toBe(false)
    expect(followUpsLeft(roundOf(once))).toBe(1)
    const twice = ask(once)
    expect(followUpsLeft(roundOf(twice))).toBe(0)
    expect(applyTutor(twice, { kind: 'asking', epoch: 6, at: 0 })).toBe(twice)
    // A failed follow-up leaves the count alone.
    const failed = apply(STATES.feedback, { kind: 'asking', epoch: 5, at: 0 }, { kind: 'ask-failed' })
    expect(roundOf(failed).followUpsUsed).toBe(0)
    expect(roundOf(failed).chat).toEqual([])
    // The round cap holds even on a fresh question.
    const spent: TutorState = { phase: 'feedback', round: round(FIVE, { index: 3, answers: [answer('r1:3', 'right')], followUpsUsed: 6 }) }
    expect(applyTutor(spent, { kind: 'asking', epoch: 7, at: 0 })).toBe(spent)
    // Moving on clears the question's chat but keeps the round's count.
    const moved = applyTutor(twice, { kind: 'next' })
    expect(roundOf(moved).chat).toEqual([])
    expect(roundOf(moved).followUpsUsed).toBe(2)
  })

  test('cancel from loading goes home; from grading to ungraded feedback', async () => {
    expect(applyTutor(STATES.loading, { kind: 'cancel' })).toEqual({ phase: 'home', focus: 'turn', isDigestOnly: false, note: 'cancelled' })
    const grading = applyTutor({ phase: 'question', round: round(FIVE, { index: 2 }) }, { kind: 'grading', epoch: 5, given: 'longest root wins', at: 0 })
    const cancelled = applyTutor(grading, { kind: 'cancel' })
    expect(cancelled.phase).toBe('feedback')
    expect(isAwaitingSelfGrade(roundOf(cancelled))).toBe(true)
    expect(applyTutor(STATES.asking, { kind: 'cancel' })).toEqual({ phase: 'feedback', round: roundOf(STATES.asking) })
  })

  test('roundXp perfect bonus, cap 35, review half, retry zero', async () => {
    const allRight = round(FIVE, { answers: FIVE.map(q => answer(q.id, 'right')) })
    expect(scoreRound(allRight)).toEqual({ right: 5, total: 5, hints: 0, isPerfect: true })
    // 25 for the answers plus 10 for a perfect round, capped at 35.
    expect(roundXp(allRight)).toBe(35)
    const six = [...FIVE, choice('r1:5')]
    expect(roundXp(round(six, { answers: six.map(q => answer(q.id, 'right')) }))).toBe(35)
    const hinted = round(FIVE, { answers: FIVE.map((q, i) => answer(q.id, 'right', i === 0)) })
    expect(scoreRound(hinted).isPerfect).toBe(false)
    expect(roundXp(hinted)).toBe(22)
    const mixed = round(FIVE, { answers: [answer('r1:0', 'right'), answer('r1:1', 'wrong'), answer('r1:2', 'partial'), answer('r1:3', 'skipped'), answer('r1:4', 'right')] })
    expect(roundXp(mixed)).toBe(13)
    const three = [choice('a'), choice('b'), choice('c')]
    expect(scoreRound(round(three, { answers: three.map(q => answer(q.id, 'right')) })).isPerfect).toBe(false)
    // Ended early: scored on what was answered, never perfect.
    const early = round(FIVE, { answers: FIVE.slice(0, 4).map(q => answer(q.id, 'right')) })
    expect(scoreRound(early)).toEqual({ right: 4, total: 4, hints: 0, isPerfect: false })
    expect(roundXp({ ...allRight, source: 'review' })).toBe(12)
    expect(roundXp({ ...allRight, isRetry: true })).toBe(0)
    expect(xpForAnswer(answer('a', 'right'), true)).toBe(0)
  })

  test('addTutorUsage counts calls and sums failed calls', async () => {
    const first = addTutorUsage(EMPTY_USAGE, usage(1_100, 148_000, 0, 900))
    // A refused completion reports all zeros and still counts as a call.
    const second = addTutorUsage(first, usage(0, 0, 0, 0))
    expect(second).toEqual({ calls: 2, input: 1_100, cacheRead: 148_000, cacheWrite: 0, output: 900 })
    expect(addTutorUsage(second, usage(10, 0, 20, 5))).toEqual({ calls: 3, input: 1_110, cacheRead: 148_000, cacheWrite: 20, output: 905 })
    expect(addTutorUsage(EMPTY_USAGE, usage(Number.NaN, -4, 3, 1))).toEqual({ calls: 1, input: 0, cacheRead: 0, cacheWrite: 3, output: 1 })
    expect(EMPTY_USAGE).toEqual({ calls: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 })
  })

  test('describeFailure words every failure', async () => {
    expect(describeTutorFailure({ kind: 'bad-reply', why: 'too-few' })).toBe("the reply wasn't a quiz")
    expect(describeTutorFailure({ kind: 'api-error', status: 529, error: 'overloaded' })).toBe('model busy (529 overloaded). Try again in a bit.')
    expect(describeTutorFailure({ kind: 'api-error', status: 429, error: 'rate_limit' })).toBe('rate-limited (429). Try again in a bit.')
    expect(describeTutorFailure({ kind: 'api-error', status: 402, error: 'billing_error' })).toBe('the call was refused (billing_error).')
    expect(describeTutorFailure({ kind: 'api-error', status: null, error: 'rate_limit' })).toBe('rate-limited (429). Try again in a bit.')
    expect(describeTutorFailure({ kind: 'model-refused', model: 'opus' })).toBe('the tutor model "opus" isn\'t allowed here; pick another in /config.')
    expect(describeTutorFailure({ kind: 'timeout' })).toBe('took too long')
    expect(describeTutorFailure({ kind: 'nothing-to-quiz' })).toBe('nothing to quiz yet')
    expect(describeTutorFailure({ kind: 'empty-reply' })).toBe('the reply was empty')
  })

  test('next advances, the last question waits for finished, and finished closes out the round', async () => {
    const second = applyTutor(STATES.feedback, { kind: 'next' })
    expect(second.phase).toBe('question')
    expect(roundOf(second).index).toBe(1)
    const atLast = round(FIVE, { index: 4, answers: FIVE.slice(0, 4).map(q => answer(q.id, 'right')) })
    expect(isLastQuestion(atLast)).toBe(true)
    expect(isLastQuestion(round(FIVE))).toBe(false)
    // Ending on an unanswered question records it as skipped, the same as the handler's scoring.
    const summary = applyTutor({ phase: 'question', round: atLast }, finishedEvent)
    expect(summary).toMatchObject({ phase: 'summary', xp: 25, levelBefore: 2, levelAfter: 2, wasForkMiss: false })
    expect(roundOf(summary)).toEqual(closeOutRound(atLast))
    expect(roundOf(summary).answers[4]).toEqual({ questionId: 'r1:4', outcome: 'skipped', hasUsedHint: false })
    const closed = closeOutRound(atLast)
    expect(closeOutRound(closed)).toBe(closed)
    expect(applyTutor(summary, { kind: 'next' })).toEqual({ phase: 'home', focus: 'recent', isDigestOnly: false })
  })

  test('retry-missed replays the misses with options reshuffled and no XP', async () => {
    const played = round(FIVE, { answers: [answer('r1:0', 'wrong'), answer('r1:1', 'right'), answer('r1:2', 'partial'), answer('r1:3', 'right'), answer('r1:4', 'skipped')] })
    const summary: TutorState = { phase: 'summary', round: played, xp: 13, levelBefore: 2, levelAfter: 2, wasForkMiss: false }
    const retry = applyTutor(summary, { kind: 'retry-missed', epoch: 8, at: 500 })
    expect(retry.phase).toBe('question')
    const replay = roundOf(retry)
    expect(replay.questions.map(q => q.id)).toEqual(['r1:0', 'r1:2', 'r1:4'])
    expect(replay).toMatchObject({ epoch: 8, startedAt: 500, index: 0, answers: [], isRetry: true, usage: EMPTY_USAGE })
    for (const question of replay.questions) {
      if (question.kind !== 'choice') continue
      // Whatever the order, the right option and its reason travel together.
      expect(question.options[question.answer]).toBe('never hold index.lock')
      expect(question.why[question.answer]).toBe('right because')
    }
    const perfect = STATES.summary
    expect(applyTutor(perfect, { kind: 'retry-missed', epoch: 8, at: 0 })).toBe(perfect)
  })
})
