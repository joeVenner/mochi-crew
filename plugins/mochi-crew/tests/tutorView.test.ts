import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, ExplainQuestion, TutorAnswer, TutorProject, TutorRound, TutorState } from '../types'
import { FRESH_PROJECT } from '../hooks/tutorProgress'
import { EMPTY_USAGE } from '../hooks/tutorRound'
import { choiceLines, progressPips, tutorFold, tutorHudLabel, tutorScreen } from '../hooks/tutorView'
import type { TutorRow, TutorScreen, TutorViewContext } from '../hooks/tutorView'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

const choice = (over: Partial<ChoiceQuestion> = {}): ChoiceQuestion => ({
  id: 'r1:0',
  kind: 'choice',
  tag: 'why',
  topic: 'worktree locks',
  prompt: 'Why does gitOutput pass --no-optional-locks to every git call?',
  options: ['So a background refresh never holds index.lock against your own git', 'It makes git status faster', 'Worktrees require it', 'To skip untracked files'],
  answer: 0,
  why: ['A refresh runs every few seconds.', 'Speed is a side effect, not the reason.', 'They do not.', 'That is a different flag.'],
  hint: 'Think about what else runs git.',
  file: 'hooks/register.tsx',
  symbol: 'gitOutput',
  ...over,
})

const explain = (over: Partial<ExplainQuestion> = {}): ExplainQuestion => ({
  id: 'r1:1',
  kind: 'explain',
  tag: 'how',
  topic: 'worktree tree',
  prompt: 'In your own words: how does the file tree decide which worktree a touched file belongs to?',
  reference: 'It matches the longest worktree root that contains the path.',
  keyPoints: ['longest matching root', 'falls back to the main root'],
  hint: 'Roots can nest.',
  file: 'hooks/fileTree.ts',
  ...over,
})

const round = (over: Partial<TutorRound> = {}): TutorRound => ({
  id: 'r1',
  epoch: 1,
  focus: 'recent',
  source: 'fork',
  startedAt: 0,
  questions: [choice(), explain(), choice({ id: 'r1:2', topic: 'badge ending' }), choice({ id: 'r1:3', topic: 'meter ttl' }), choice({ id: 'r1:4', topic: 'tree budget' })],
  index: 0,
  answers: [],
  isHintShown: false,
  isRetry: false,
  chat: [],
  followUpsUsed: 0,
  usage: EMPTY_USAGE,
  ...over,
})

const ctx = (over: Partial<TutorViewContext> = {}): TutorViewContext => ({
  surface: 'terminal',
  columns: 44,
  bodyRows: 30,
  now: 12_000,
  plan: { source: 'fork', why: 'warm', idleMs: 120_000, isMaybeCold: false, contextTokens: 148_000 },
  planText: { text: 'session · warm (2m idle)', isWarning: false },
  project: FRESH_PROJECT,
  session: { rounds: 0, usage: EMPTY_USAGE, isForkSuspect: false },
  hasContent: true,
  canOpenFile: () => false,
  model: 'haiku',
  ...over,
})

const right: TutorAnswer = { questionId: 'r1:0', outcome: 'right', hasUsedHint: false, picked: 0 }

/** One of every phase and sub-screen, so the guarantees are checked everywhere. */
const everyState = (): readonly TutorState[] => [
  { phase: 'closed' },
  { phase: 'consent' },
  { phase: 'home', focus: 'recent', isDigestOnly: false },
  { phase: 'home', focus: 'turn', isDigestOnly: true, note: 'cancelled' },
  { phase: 'loading', epoch: 1, focus: 'recent', source: 'fork', since: 0 },
  { phase: 'loading', epoch: 1, focus: 'recent', source: 'digest', since: 0, note: 'session unavailable, using the digest…' },
  { phase: 'question', round: round() },
  { phase: 'question', round: round({ index: 1, answers: [right] }) },
  { phase: 'question', round: round({ index: 1, answers: [right], isHintShown: true }) },
  { phase: 'feedback', round: round({ answers: [right] }) },
  { phase: 'feedback', round: round({ answers: [{ ...right, outcome: 'wrong', picked: 2 }] }) },
  { phase: 'feedback', round: round({ index: 1, answers: [right] }) },
  { phase: 'feedback', round: round({ index: 1, answers: [right, { questionId: 'r1:1', outcome: 'partial', hasUsedHint: false, given: 'longest root', points: [true, false], note: 'Close.' }] }) },
  { phase: 'grading', round: round({ index: 1, answers: [right, { questionId: 'r1:1', outcome: 'skipped', hasUsedHint: false, given: 'longest root' }] }), epoch: 1, since: 0 },
  { phase: 'asking', round: round({ answers: [right] }), epoch: 1, since: 0 },
  {
    phase: 'summary',
    round: round({ index: 4, answers: ['r1:0', 'r1:1', 'r1:2', 'r1:3', 'r1:4'].map((id, at) => ({ questionId: id, outcome: at === 2 ? 'wrong' : 'right', hasUsedHint: false })) }),
    xp: 25,
    levelBefore: 2,
    levelAfter: 2,
    wasForkMiss: true,
  },
  { phase: 'error', failure: { kind: 'timeout' }, focus: 'recent', canTryDigest: true },
  { phase: 'error', failure: { kind: 'bad-reply', why: 'too-few' }, focus: 'recent', canTryDigest: false },
]

const textOf = (row: TutorRow | undefined): string => row?.cells.map(part => part.text).join('') ?? ''
const allRows = (screen: TutorScreen): readonly TutorRow[] => [...screen.header, ...screen.body]
const allText = (screen: TutorScreen): string => allRows(screen).map(textOf).join('\n')
const rowKeyed = (screen: TutorScreen, key: string): TutorRow | undefined => allRows(screen).find(row => row.key === key)
const hotkeys = (screen: TutorScreen): readonly string[] => screen.controls.flatMap(control => (control.hotkey === undefined ? [] : [control.hotkey]))

describe('tutor view', () => {
  test('every phase draws its controls on every surface', async () => {
    for (const surface of SURFACES) {
      for (const state of everyState()) {
        for (const bodyRows of [30, 10, 5]) {
          const screen = tutorScreen(state, ctx({ surface, bodyRows }))
          expect(screen.controls.length > 0).toBe(true)
          expect(screen.header.length > 0).toBe(true)
          if (screen.focusKey !== undefined && screen.input?.key !== screen.focusKey) {
            expect(screen.controls.some(control => control.key === screen.focusKey)).toBe(true)
          }
        }
      }
    }
  })

  test('mobile never gets an input row', async () => {
    for (const state of everyState()) {
      expect(tutorScreen(state, ctx({ surface: 'mobile' })).input).toBe(undefined)
    }
  })

  test('explain on mobile offers show answer', async () => {
    const state: TutorState = { phase: 'question', round: round({ index: 1, answers: [right] }) }
    const mobile = tutorScreen(state, ctx({ surface: 'mobile' }))
    expect(mobile.controls.find(control => control.hotkey === 'r')?.label).toBe('show answer')
    expect(mobile.focusKey).toBe('reveal')
    expect(mobile.controls.map(control => control.hotkey)).toEqual(['r', 'h', 's', 'x'])
    const terminal = tutorScreen(state, ctx())
    expect(terminal.input).toEqual({ key: 'answer:r1:1', label: 'answer', placeholder: 'type, then Enter', submitLabel: 'check', purpose: 'answer' })
    expect(terminal.focusKey).toBe('answer:r1:1')
  })

  test('a choice screen has hotkeys 1 to n and no input', async () => {
    for (const surface of SURFACES) {
      const screen = tutorScreen({ phase: 'question', round: round() }, ctx({ surface }))
      expect(screen.input).toBe(undefined)
      expect(hotkeys(screen)).toEqual(['1', '2', '3', '4', 'h', 's', 'x'])
      expect(screen.focusKey).toBe('opt:r1:0:0')
      expect(screen.controls[1]?.action).toEqual({ kind: 'choose', index: 1 })
      expect(screen.controls[1]?.label).toBe('It makes git status faster')
    }
    const twoOptions = round({ questions: [choice({ options: ['yes', 'no'], why: ['a', 'b'], hint: undefined })] })
    expect(hotkeys(tutorScreen({ phase: 'question', round: twoOptions }, ctx()))).toEqual(['1', '2', 's', 'x'])
  })

  test('hotkeys are unique per screen', async () => {
    for (const surface of SURFACES) {
      for (const state of everyState()) {
        for (const bodyRows of [30, 10, 5]) {
          const keys = hotkeys(tutorScreen(state, ctx({ surface, bodyRows, canOpenFile: () => true })))
          expect(new Set(keys).size).toBe(keys.length)
          for (const key of keys) expect(/^[0-9a-z]$/.test(key)).toBe(true)
        }
      }
    }
  })

  test('loading says stop waiting for a fork and cancel for a digest', async () => {
    const fork = tutorScreen({ phase: 'loading', epoch: 1, focus: 'recent', source: 'fork', since: 0 }, ctx())
    expect(fork.controls.map(control => control.label)).toEqual(['stop waiting'])
    expect(allText(fork)).toContain('⠋ Mochi is reading the chat…   12s')
    expect(allText(fork)).toContain('session fork · cannot be cut short; stopping only hides the reply')
    expect(textOf(fork.header[0])).toContain('recent changes')
    const digest = tutorScreen({ phase: 'loading', epoch: 1, focus: 'recent', source: 'digest', since: 0, note: 'session unavailable, using the digest…' }, ctx({ now: 100 }))
    expect(digest.controls.map(control => control.label)).toEqual(['cancel'])
    expect(allText(digest)).toContain('⠙ Mochi is reading the diff…')
    expect(allText(digest)).toContain('digest · haiku · ≤45s')
    expect(allText(digest)).toContain('session unavailable, using the digest…')
  })

  test('home without content shows nothing to quiz and no start rows', async () => {
    const home: TutorState = { phase: 'home', focus: 'recent', isDigestOnly: false }
    const full = tutorScreen(home, ctx())
    expect(full.controls.filter(control => control.action.kind === 'start').map(control => control.hotkey)).toEqual(['1', '2', '3'])
    expect(full.focusKey).toBe('start:recent')
    const empty = tutorScreen(home, ctx({ hasContent: false }))
    expect(allText(empty)).toContain('Nothing to quiz yet. Ask Claude to change something first.')
    expect(empty.controls.some(control => control.action.kind === 'start')).toBe(false)
    expect(empty.controls.some(control => control.hotkey === 'x')).toBe(true)
  })

  test('home draws review only with due cards', async () => {
    const home: TutorState = { phase: 'home', focus: 'recent', isDigestOnly: false }
    expect(tutorScreen(home, ctx()).controls.some(control => control.hotkey === 'r')).toBe(false)
    const project: TutorProject = {
      ...FRESH_PROJECT,
      rounds: 4,
      deck: [
        { question: choice({ id: 'old:0' }), box: 1, dueRound: 3 },
        { question: choice({ id: 'old:1' }), box: 1, dueRound: 4 },
        { question: choice({ id: 'old:2' }), box: 2, dueRound: 9 },
      ],
    }
    const review = tutorScreen(home, ctx({ project })).controls.find(control => control.hotkey === 'r')
    expect(review?.label).toBe('review 2 missed  no model call')
    expect(review?.action).toEqual({ kind: 'review' })
  })

  test('home toggles the digest only when the plan would fork', async () => {
    const home: TutorState = { phase: 'home', focus: 'recent', isDigestOnly: false }
    expect(tutorScreen(home, ctx()).controls.find(control => control.hotkey === 'g')?.label).toBe('use digest instead')
    const digestPlan = ctx({ plan: { source: 'digest', why: 'no-reply', idleMs: null }, planText: { text: 'digest · no reply yet', isWarning: false } })
    expect(tutorScreen(home, digestPlan).controls.some(control => control.hotkey === 'g')).toBe(false)
    const chosen = tutorScreen({ ...home, isDigestOnly: true }, ctx({ plan: { source: 'digest', why: 'chosen', idleMs: null } }))
    expect(chosen.controls.find(control => control.hotkey === 'g')?.label).toBe('use session again')
  })

  test('the maybe-cold plan line has the warning tone', async () => {
    const home: TutorState = { phase: 'home', focus: 'recent', isDigestOnly: false }
    const warm = rowKeyed(tutorScreen(home, ctx()), 'ctx')
    expect(warm?.cells.find(part => part.text.includes('warm'))?.tone).toBe('dim')
    const text = 'session · maybe warm (idle 12m): full price if the cache lapsed'
    const cold = rowKeyed(tutorScreen(home, ctx({ planText: { text, isWarning: true } })), 'ctx')
    expect(cold?.cells.find(part => part.text === text)?.tone).toBe('alert')
  })

  test('home shows this session spend once anything was spent', async () => {
    const home: TutorState = { phase: 'home', focus: 'recent', isDigestOnly: false }
    expect(rowKeyed(tutorScreen(home, ctx()), 'spent')).toBe(undefined)
    const session = { rounds: 2, usage: { calls: 2, input: 9_000, cacheRead: 151_000, cacheWrite: 800, output: 2_100 }, isForkSuspect: false }
    expect(textOf(rowKeyed(tutorScreen(home, ctx({ session })), 'spent'))).toBe('this session  2 rounds · 9.8k in · 151k cached · 2.1k out')
  })

  test('right feedback shows the answer, its why and the most tempting distractor', async () => {
    const screen = tutorScreen({ phase: 'feedback', round: round({ answers: [right] }) }, ctx())
    const header = textOf(screen.header[0])
    expect(header).toContain('q 1/5 ◉○○○○')
    expect(header).toContain('✓ right  +5 XP')
    expect(textOf(rowKeyed(screen, 'why'))).toContain('A refresh runs every few seconds.')
    expect(textOf(rowKeyed(screen, 'not'))).toContain('not 2')
    expect(textOf(rowKeyed(screen, 'not'))).toContain('Speed is a side effect')
    expect(textOf(rowKeyed(screen, 'see'))).toContain('hooks/register.tsx · gitOutput')
    expect(screen.focusKey).toBe('next')
  })

  test('wrong feedback shows the pick and the right answer with their why', async () => {
    const screen = tutorScreen({ phase: 'feedback', round: round({ answers: [{ ...right, outcome: 'wrong', picked: 2 }] }) }, ctx())
    expect(textOf(screen.header[0])).toContain('✕ not quite')
    expect(textOf(screen.header[0])).not.toContain('XP')
    expect(textOf(rowKeyed(screen, 'you'))).toContain('Worktrees require it')
    expect(textOf(rowKeyed(screen, 'you-why'))).toContain('They do not.')
    const answer = rowKeyed(screen, 'answer')
    expect(textOf(answer)).toContain('So a background refresh')
    expect(answer?.cells.find(part => part.text.includes('So a background'))?.tone).toBe('good')
    expect(textOf(rowKeyed(screen, 'why'))).toContain('A refresh runs every few seconds.')
  })

  test('graded explain feedback marks each key point and quotes the answer', async () => {
    const answer: TutorAnswer = { questionId: 'r1:1', outcome: 'partial', hasUsedHint: false, given: 'the longest root wins', points: [true, false], note: 'Close.', isCut: true }
    const screen = tutorScreen({ phase: 'feedback', round: round({ index: 1, answers: [right, answer] }) }, ctx())
    expect(textOf(screen.header[0])).toContain('◐ partly')
    expect(textOf(rowKeyed(screen, 'said'))).toBe('you said "the longest root wins" (cut to 600)')
    expect(textOf(rowKeyed(screen, 'point:0'))).toBe('✓ longest matching root')
    expect(textOf(rowKeyed(screen, 'point:1'))).toBe('· falls back to the main root')
    expect(textOf(rowKeyed(screen, 'note'))).toBe('Close.')
    // S4 order: the answer, the key points, the grader's note, then the reference.
    const keys = screen.body.map(row => row.key).filter(key => key !== 'rule-bottom')
    expect(keys.slice(0, 5)).toEqual(['said', 'point:0', 'point:1', 'note', 'ref'])
  })

  test('a review round shows no per-answer XP, since it earns half at the end', async () => {
    const review = round({ source: 'review', answers: [right] })
    expect(textOf(tutorScreen({ phase: 'feedback', round: review }, ctx()).header[0])).not.toContain('XP')
  })

  test('a revealed or failed grade offers self-grading', async () => {
    const revealed = tutorScreen({ phase: 'feedback', round: round({ index: 1, answers: [right] }) }, ctx())
    expect(revealed.controls.map(control => control.hotkey)).toEqual(['1', '2', '3', 'x'])
    expect(revealed.controls[0]?.action).toEqual({ kind: 'self-grade', outcome: 'right' })
    expect(revealed.focusKey).toBe('self:right')
    expect(allText(revealed)).not.toContain("couldn't check")
    expect(revealed.input).toBe(undefined)
    const held: TutorAnswer = { questionId: 'r1:1', outcome: 'skipped', hasUsedHint: false, given: 'longest root' }
    const failed = tutorScreen({ phase: 'feedback', round: round({ index: 1, answers: [right, held] }) }, ctx())
    expect(allText(failed)).toContain("couldn't check automatically. How did you do?")
    expect(allText(failed)).toContain('you said "longest root"')
  })

  test('follow-ups show the field, the count left and hide it when spent', async () => {
    const open = tutorScreen({ phase: 'feedback', round: round({ answers: [right] }) }, ctx())
    expect(open.input?.key).toBe('ask:r1:0')
    expect(open.input?.purpose).toBe('ask')
    expect(allText(open)).toContain('(2 left)')
    const chat = [{ ask: 'why not a lock file?', reply: 'Git owns it.' }, { ask: 'and worktrees?', reply: 'Each has one.' }]
    const spent = tutorScreen({ phase: 'feedback', round: round({ answers: [right], chat, followUpsUsed: 2 }) }, ctx())
    expect(spent.input).toBe(undefined)
    expect(allText(spent)).toContain('out of follow-ups for this question')
    expect(allText(spent)).toContain('Each has one.')
    const asking = tutorScreen({ phase: 'asking', round: round({ answers: [right] }), epoch: 1, since: 0 }, ctx())
    expect(asking.input).toBe(undefined)
    expect(allText(asking)).toContain('Mochi is thinking…')
    expect(asking.controls.map(control => control.label)).toEqual(['cancel'])
  })

  test('open file only when canOpenFile says so', async () => {
    const state: TutorState = { phase: 'feedback', round: round({ answers: [right] }) }
    const hasOpen = (screen: TutorScreen): boolean => screen.controls.some(control => control.action.kind === 'open-file')
    expect(hasOpen(tutorScreen(state, ctx()))).toBe(false)
    expect(hasOpen(tutorScreen(state, ctx({ canOpenFile: file => file === 'hooks/register.tsx' })))).toBe(true)
    expect(hasOpen(tutorScreen(state, ctx({ canOpenFile: file => file === 'hooks/other.ts' })))).toBe(false)
    expect(hasOpen(tutorScreen(state, ctx({ surface: 'desktop', canOpenFile: () => true })))).toBe(false)
  })

  test('fold drops rules and see below 12 rows and folds the footer below 8', async () => {
    expect([30, 12, 11, 8, 7, 0].map(tutorFold)).toEqual(['full', 'full', 'tight', 'tight', 'folded', 'folded'])
    const feedback: TutorState = { phase: 'feedback', round: round({ answers: [right] }) }
    const hasRule = (screen: TutorScreen): boolean => allRows(screen).some(row => row.key.startsWith('rule'))
    const full = tutorScreen(feedback, ctx({ bodyRows: 12 }))
    expect(hasRule(full)).toBe(true)
    const tight = tutorScreen(feedback, ctx({ bodyRows: 11 }))
    expect(hasRule(tight)).toBe(false)
    expect(rowKeyed(tight, 'see')).toBe(undefined)
    expect(rowKeyed(tight, 'not')).toBe(undefined)
    expect(rowKeyed(tight, 'why')).not.toBe(undefined)
    const hinted: TutorState = { phase: 'question', round: round({ isHintShown: true }) }
    expect(rowKeyed(tutorScreen(hinted, ctx({ bodyRows: 11 })), 'hint')).not.toBe(undefined)
    expect(rowKeyed(tutorScreen(hinted, ctx({ bodyRows: 30 })), 'help')).not.toBe(undefined)
    const folded = tutorScreen(hinted, ctx({ bodyRows: 7 }))
    expect(rowKeyed(folded, 'hint')).toBe(undefined)
    expect(rowKeyed(folded, 'help')).toBe(undefined)
    expect(textOf(rowKeyed(folded, 'stem'))).toContain('hint  Think about what else runs git.')
    expect(folded.controls.length).toBe(6)
    // Only the footer folds: the help row stays when tight, the file line and review warning always.
    expect(rowKeyed(tutorScreen(hinted, ctx({ bodyRows: 10 })), 'help')).not.toBe(undefined)
    expect(rowKeyed(folded, 'file')).not.toBe(undefined)
    const reviewCard: TutorState = { phase: 'question', round: round({ source: 'review', questions: [choice({ isReview: true })] }) }
    expect(rowKeyed(tutorScreen(reviewCard, ctx({ bodyRows: 5 })), 'review-note')).not.toBe(undefined)
  })

  test('a summary after ending early shows results, not the current marker', async () => {
    const ended = round({ index: 2, answers: [right, { questionId: 'r1:1', outcome: 'right', hasUsedHint: false }, { questionId: 'r1:2', outcome: 'skipped', hasUsedHint: false }] })
    const screen = tutorScreen({ phase: 'summary', round: ended, xp: 10, levelBefore: 1, levelAfter: 1, wasForkMiss: false }, ctx())
    expect(textOf(rowKeyed(screen, 'pips'))).toBe('●●✕○○')
    expect(textOf(screen.header[0])).toContain('Round done · 2/3 · +10 XP')
    expect(allText(screen)).not.toContain('The cache had lapsed')
  })

  test('summary shows the score, what to read, the review count and the cost', async () => {
    const states = everyState()
    const summary = states.find(state => state.phase === 'summary')
    if (summary === undefined) throw new Error('fixture has no summary')
    const usage = { calls: 1, input: 1_000, cacheRead: 148_000, cacheWrite: 100, output: 900 }
    const screen = tutorScreen({ ...summary, round: { ...(summary.phase === 'summary' ? summary.round : round()), usage } }, ctx())
    expect(textOf(screen.header[0])).toContain('Round done · 4/5 · +25 XP')
    expect(textOf(screen.header[0])).toContain('LV 2 → 2')
    expect(textOf(rowKeyed(screen, 'pips'))).toBe('●●✕●●')
    expect(textOf(rowKeyed(screen, 'read:0'))).toBe('go read hooks/register.tsx · gitOutput')
    expect(textOf(rowKeyed(screen, 'review'))).toBe('review  1 card back next round')
    expect(textOf(rowKeyed(screen, 'cost'))).toBe('cost    1 call · fork · 148k cached · 1.1k new · 900 out')
    expect(allText(screen)).toContain('The cache had lapsed: this round re-read 1.1k tokens at full price.')
    expect(screen.controls.map(control => control.hotkey)).toEqual(['n', 'r', 'x'])
  })

  test('error names the cause and offers the digest only after a fork', async () => {
    const fork = tutorScreen({ phase: 'error', failure: { kind: 'timeout' }, focus: 'recent', canTryDigest: true }, ctx())
    expect(allText(fork)).toContain('took too long')
    expect(fork.controls.map(control => control.hotkey)).toEqual(['t', 'd', 'x'])
    const digest = tutorScreen({ phase: 'error', failure: { kind: 'timeout' }, focus: 'recent', canTryDigest: false }, ctx())
    expect(digest.controls.map(control => control.hotkey)).toEqual(['t', 'x'])
  })

  test('consent names the tutor model and offers y and n', async () => {
    const screen = tutorScreen({ phase: 'consent' }, ctx({ model: 'sonnet' }))
    expect(allText(screen)).toContain('to sonnet:')
    expect(screen.controls.map(control => [control.hotkey, control.label])).toEqual([['y', 'got it'], ['n', 'not now']])
  })

  test('model text is drawn without control characters', async () => {
    const hostile = round({ questions: [choice({ prompt: 'Why \u001b[31mred\u001b[0m\nnow?', options: ['a\u0007', 'b'], why: ['x', 'y'] })] })
    const screen = tutorScreen({ phase: 'question', round: hostile }, ctx())
    const texts = [...allRows(screen).flatMap(row => row.cells.map(part => part.text)), ...screen.controls.map(control => control.label)]
    for (const text of texts) expect(/[\u0000-\u001f\u007f]/.test(text)).toBe(false)
    expect(textOf(rowKeyed(screen, 'stem'))).toBe('Why ?[31mred?[0m now?')
  })

  test('progressPips marks right, wrong, partial, current and to come', async () => {
    const answers: readonly TutorAnswer[] = [
      { questionId: 'r1:0', outcome: 'right', hasUsedHint: false },
      { questionId: 'r1:1', outcome: 'partial', hasUsedHint: false },
      { questionId: 'r1:2', outcome: 'wrong', hasUsedHint: false },
    ]
    const pips = progressPips(round({ index: 3, answers }))
    expect(pips.map(pip => pip.text).join('')).toBe('●◐✕◉○')
    expect(pips.map(pip => pip.tone)).toEqual(['good', 'value', 'alert', 'accent', 'track'])
  })

  test('choiceLines wraps at most two lines with a hanging indent', async () => {
    expect(choiceLines(0, 'Short one', 44)).toEqual(['1: Short one'])
    const two = choiceLines(0, 'So a background refresh never holds index.lock against your own git', 44)
    expect(two).toEqual(['1: So a background refresh never holds', '   index.lock against your own git'])
    const long = choiceLines(2, 'word '.repeat(40), 30)
    expect(long.length).toBe(2)
    expect(long[0]?.startsWith('3: ')).toBe(true)
    expect(long[1]?.startsWith('   ')).toBe(true)
    expect(long[1]?.endsWith('…')).toBe(true)
    for (const line of long) expect(line.length <= 28).toBe(true)
    const unbroken = choiceLines(1, 'x'.repeat(200), 30)
    expect(unbroken.length).toBe(2)
    for (const line of unbroken) expect(line.length <= 28).toBe(true)
  })

  test('tutorHudLabel reads quizzing you q 2/5 during a round, null otherwise', async () => {
    const live = round({ index: 1, answers: [right] })
    expect(tutorHudLabel({ phase: 'question', round: live })).toBe('quizzing you · q 2/5')
    expect(tutorHudLabel({ phase: 'feedback', round: live })).toBe('quizzing you · q 2/5')
    expect(tutorHudLabel({ phase: 'grading', round: live, epoch: 1, since: 0 })).toBe('quizzing you · q 2/5')
    expect(tutorHudLabel({ phase: 'closed' })).toBe(null)
    expect(tutorHudLabel({ phase: 'home', focus: 'recent', isDigestOnly: false })).toBe(null)
    expect(tutorHudLabel({ phase: 'loading', epoch: 1, focus: 'recent', source: 'fork', since: 0 })).toBe(null)
    expect(tutorHudLabel({ phase: 'summary', round: live, xp: 5, levelBefore: 1, levelAfter: 1, wasForkMiss: false })).toBe(null)
  })
})
