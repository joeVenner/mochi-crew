import type {
  ChoiceQuestion,
  ExplainQuestion,
  TutorAnswer,
  TutorFocus,
  TutorOutcome,
  TutorProject,
  TutorQuestion,
  TutorRound,
  TutorSession,
  TutorState,
  TutorTag,
  TutorUsage,
} from '../types'
import { safeText } from './fileTree'
import { gutter, ruleFor } from './hud'
import { formatTokens } from './meter'
import type { TutorPlan } from './tutorPlan'
import { dueCards } from './tutorProgress'
import { currentAnswer, currentQuestion, describeTutorFailure, followUpsLeft, isAwaitingSelfGrade, isLastQuestion, scoreRound, xpForAnswer } from './tutorRound'

/** How a piece of a tutor row is drawn: the meter's tones plus `good` for a right answer. */
export type TutorTone = 'label' | 'dim' | 'value' | 'strong' | 'accent' | 'track' | 'alert' | 'good'

/** One run of text in one tone. */
export type TutorCell = { readonly text: string; readonly tone: TutorTone }

/** One line of the tutor tab; `isWrapped` rows (question text, reasons, replies) may wrap, the rest truncate. */
export type TutorRow = { readonly key: string; readonly cells: readonly TutorCell[]; readonly isWrapped: boolean }

/** One pressable control; `key` is its address and focus target, `hotkey` unique on its screen. */
export type TutorControl = { readonly key: string; readonly label: string; readonly hotkey?: string; readonly action: TutorAction }

/** What pressing a control asks the handlers to do. */
export type TutorAction =
  | { kind: 'consent' } | { kind: 'decline' } | { kind: 'start'; focus: TutorFocus } | { kind: 'review' } | { kind: 'toggle-digest' }
  | { kind: 'choose'; index: number } | { kind: 'hint' } | { kind: 'skip' } | { kind: 'reveal' } | { kind: 'self-grade'; outcome: 'right' | 'partial' | 'wrong' }
  | { kind: 'next' } | { kind: 'open-file' } | { kind: 'retry-missed' } | { kind: 'retry' } | { kind: 'try-digest' } | { kind: 'cancel' } | { kind: 'close' }

/** The one text field a screen may hold: the typed answer or a follow-up. Drawn with no `value`. */
export type TutorInputRow = { readonly key: string; readonly label: string; readonly placeholder: string; readonly submitLabel: string; readonly purpose: 'answer' | 'ask' }

/** A whole tutor screen as data: the renderer draws header, body, input, then the controls last. */
export type TutorScreen = {
  readonly header: readonly TutorRow[]
  readonly body: readonly TutorRow[]
  readonly input?: TutorInputRow
  readonly controls: readonly TutorControl[]
  readonly focusKey?: string
}

/** Everything a screen needs besides the state, already read by the render hook. */
export type TutorViewContext = {
  readonly surface: 'terminal' | 'desktop' | 'vscode' | 'mobile'
  readonly columns: number
  readonly bodyRows: number
  readonly now: number
  readonly plan: TutorPlan
  /**
   * Whether the plan would fork without the learner's `g`: `choosePlan` with `isDigestOnly: false`.
   * `plan` cannot say, since a chosen digest wins over every other rule, and the toggle is only
   * worth drawing when switching back would change the source.
   */
  readonly canFork: boolean
  readonly planText: { text: string; isWarning: boolean }
  readonly project: TutorProject
  readonly session: TutorSession
  readonly hasContent: boolean
  readonly canOpenFile: (file: string) => boolean
  readonly model: string
}

/** Follow-up exchanges kept on screen above the field. */
const SHOWN_EXCHANGES = 2
/** At most this many `file · symbol` pairs under "go read". */
const GO_READ_MAX = 3
/** Width of the `1: ` prefix, and so of a choice's hanging indent. */
const CHOICE_INDENT = 3
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

const TAG_LABELS: Readonly<Record<TutorTag, string>> = { what: 'WHAT', how: 'HOW', why: 'WHY', 'what-if': 'WHAT IF' }

const FOCUS_CHOICES: readonly { readonly focus: TutorFocus; readonly hotkey: string; readonly title: string; readonly note: string }[] = [
  { focus: 'recent', hotkey: '1', title: 'recent changes', note: 'the diff + commits' },
  { focus: 'turn', hotkey: '2', title: 'last turn', note: 'why Claude did it' },
  { focus: 'project', hotkey: '3', title: 'big picture', note: 'how the parts fit' },
]

const FOCUS_TITLES: Readonly<Record<TutorFocus, string>> = { recent: 'recent changes', turn: 'last turn', project: 'big picture' }

const PIPS: Readonly<Record<TutorOutcome, TutorCell>> = {
  right: { text: '●', tone: 'good' },
  wrong: { text: '✕', tone: 'alert' },
  // A skip is not a pass: drawn as a miss so the strip reads honestly.
  skipped: { text: '✕', tone: 'alert' },
  partial: { text: '◐', tone: 'value' },
}

// ── small text helpers ─────────────────────────────────────────────────────

/** Model or stored text made safe for a cell; parse already cleaned it, but a stored card may predate that. */
// Whitespace collapses first: safeText would turn a newline into `?` before it could become a space.
const clean = (text: string): string => safeText(text.replace(/\s+/g, ' ')).trim()

const cell = (text: string, tone: TutorTone): TutorCell => ({ text, tone })
const row = (key: string, cells: readonly TutorCell[], isWrapped = false): TutorRow => ({ key, cells, isWrapped })
const textRow = (key: string, text: string, tone: TutorTone, isWrapped = true): TutorRow => row(key, [cell(text, tone)], isWrapped)
/** A labelled row: the label in the HUD's gutter, the value wrapping after it. */
const labelled = (key: string, label: string, value: string, tone: TutorTone = 'value'): TutorRow =>
  row(key, [cell(gutter(label), 'label'), cell(value, tone)], true)

/** Room for text on one line; the pane keeps a cell of margin on each side. */
const lineWidth = (columns: number): number => Math.max(12, columns - 2)

/** Greedy word wrap; a word longer than the line is hard-cut so nothing overflows. */
const wrapWords = (text: string, width: number): readonly string[] => {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ').filter(part => part !== '')) {
    let rest = word
    while (rest.length > width) {
      if (line !== '') { lines.push(line); line = '' }
      lines.push(rest.slice(0, width))
      rest = rest.slice(width)
    }
    if (rest === '') continue
    if (line === '') line = rest
    else if (line.length + 1 + rest.length <= width) line = `${line} ${rest}`
    else { lines.push(line); line = rest }
  }
  if (line !== '') lines.push(line)
  return lines
}

/** A line cut to `width` with a trailing ellipsis, so a cut is visible. */
const withEllipsis = (line: string, width: number): string =>
  `${line.length >= width ? line.slice(0, Math.max(0, width - 1)).trimEnd() : line}…`

/** At most `maxLines` wrapped lines joined back, ellipsised when more was there. */
const cutToLines = (text: string, width: number, maxLines: number): string => {
  const lines = wrapWords(clean(text), width)
  if (lines.length <= maxLines) return lines.join(' ')
  const kept = lines.slice(0, maxLines)
  return [...kept.slice(0, -1), withEllipsis(kept[kept.length - 1] ?? '', width)].join(' ')
}

/** Left cells, then right cells pushed to the far edge with at least two spaces between. */
const spread = (key: string, left: readonly TutorCell[], right: readonly TutorCell[], columns: number): TutorRow => {
  if (right.length === 0) return row(key, left)
  const used = [...left, ...right].reduce((sum, part) => sum + part.text.length, 0)
  const gap = Math.max(2, lineWidth(columns) - used)
  return row(key, [...left, cell(' '.repeat(gap), 'dim'), ...right])
}

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

// ── exported pieces ───────────────────────────────────────────────────────

/**
 * How much a screen may draw for the rows it has: everything from 12, rules and the
 * secondary lines ("see", "not") dropped from 8 to 11, and the footer help folded below 8.
 * The stem and the controls are never dropped.
 */
export const tutorFold = (bodyRows: number): 'full' | 'tight' | 'folded' => {
  if (bodyRows >= 12) return 'full'
  if (bodyRows >= 8) return 'tight'
  return 'folded'
}

/**
 * The round's progress strip, one cell per question: `●` right, `✕` wrong or skipped, `◐`
 * partial, `◉` the current one while the round runs, `○` to come.
 */
export const progressPips = (round: TutorRound): readonly TutorCell[] => {
  // A typed answer held while it is graded is not a result yet, so the marker stays on it.
  const isComplete = round.answers.length >= round.questions.length && !isAwaitingSelfGrade(round)
  return pipsOf(round, !isComplete)
}

/** Pips with or without the current-question marker; a finished round shows results only. */
const pipsOf = (round: TutorRound, isLive: boolean): readonly TutorCell[] =>
  round.questions.map((question, index) => {
    // The current question keeps its marker through its feedback, as the strip reads "where am I".
    if (isLive && index === round.index) return cell('◉', 'accent')
    const answer = round.answers.find(given => given.questionId === question.id)
    return answer === undefined ? cell('○', 'track') : PIPS[answer.outcome]
  })

/**
 * One option as at most two lines: `1: text` then a hanging indent of three under it, the
 * second line ending in `…` when the text runs longer.
 */
export const choiceLines = (index: number, text: string, columns: number): readonly string[] => {
  const width = Math.max(4, lineWidth(columns) - CHOICE_INDENT)
  const prefix = `${index + 1}: `.padEnd(CHOICE_INDENT)
  const lines = wrapWords(clean(text), width)
  const first = lines[0] ?? ''
  if (lines.length <= 1) return [`${prefix}${first}`]
  const second = lines.length > 2 ? withEllipsis(lines[1] ?? '', width) : lines[1] ?? ''
  return [`${prefix}${first}`, `${' '.repeat(CHOICE_INDENT)}${second}`]
}

/** The main HUD's line while a round is on screen: `quizzing you · q 2/5`; null otherwise. */
export const tutorHudLabel = (state: TutorState): string | null => {
  // `asking` sits inside feedback; leaving it out would blank the label mid-question.
  if (state.phase !== 'question' && state.phase !== 'feedback' && state.phase !== 'grading' && state.phase !== 'asking') return null
  const { round } = state
  if (round.questions.length === 0) return null
  return `quizzing you · q ${Math.min(round.index + 1, round.questions.length)}/${round.questions.length}`
}

// ── shared screen parts ────────────────────────────────────────────────────

type Fold = ReturnType<typeof tutorFold>

/** The phases that wait on a call while a round is on screen. */
type WaitState = Extract<TutorState, { readonly since: number; readonly round: TutorRound }>

const isTouch = (ctx: TutorViewContext): boolean => ctx.surface === 'mobile'

const titleCells = (title: string): readonly TutorCell[] => [cell('▍ ', 'accent'), cell(title, 'strong')]

const ruleRow = (key: string, ctx: TutorViewContext): TutorRow => row(key, [cell(ruleFor(ctx.columns), 'track')])

/** The header, then a rule unless the screen is tight on rows. */
const headerOf = (first: TutorRow, ctx: TutorViewContext, fold: Fold): readonly TutorRow[] =>
  fold === 'full' ? [first, ruleRow('rule-top', ctx)] : [first]

/** The body, then a closing rule above the controls unless the screen is tight on rows. */
const bodyOf = (rows: readonly TutorRow[], ctx: TutorViewContext, fold: Fold): readonly TutorRow[] =>
  fold === 'full' ? [...rows, ruleRow('rule-bottom', ctx)] : rows

const spinnerFrame = (now: number): string => SPINNER[Math.floor(now / 100) % SPINNER.length] ?? SPINNER[0] ?? ''

const secondsSince = (now: number, since: number): string => `${Math.max(0, Math.floor((now - since) / 1000))}s`

const answerOf = (round: TutorRound, question: TutorQuestion): TutorAnswer | undefined =>
  round.answers.find(given => given.questionId === question.id)

/** `q 2/5 ●◉○○○` then whatever the screen puts after it. */
const questionHeader = (round: TutorRound, tail: readonly TutorCell[]): TutorRow => row('header', [
  cell('▍ ', 'accent'),
  cell(`q ${Math.min(round.index + 1, round.questions.length)}/${round.questions.length} `, 'strong'),
  ...progressPips(round),
  ...tail,
])

const tagTail = (question: TutorQuestion): readonly TutorCell[] =>
  [cell(`  ${TAG_LABELS[question.tag]}`, 'accent'), cell(` · ${clean(question.topic)}`, 'dim')]

const placeText = (question: TutorQuestion): string | null => {
  if (question.file === undefined) return null
  const file = clean(question.file)
  return question.symbol === undefined ? file : `${file} · ${clean(question.symbol)}`
}

const endControl: TutorControl = { key: 'end', label: 'end', hotkey: 'x', action: { kind: 'cancel' } }
const cancelControl: TutorControl = { key: 'cancel', label: 'cancel', hotkey: 'x', action: { kind: 'cancel' } }
const closeControl = (label: string): TutorControl => ({ key: 'close', label, hotkey: 'x', action: { kind: 'close' } })

/** The rows above the stem every question screen shares: where in the code, and a review warning. */
const questionPreamble = (question: TutorQuestion): readonly TutorRow[] => {
  const place = placeText(question)
  return [
    ...(place === null ? [] : [textRow('file', place, 'dim', false)]),
    ...(question.isReview === true ? [textRow('review-note', 'from an earlier round · the code may have changed', 'dim')] : []),
  ]
}

/** The stem, with the hint under it, or inline when the screen has folded. */
const stemRows = (question: TutorQuestion, round: TutorRound, fold: Fold): readonly TutorRow[] => {
  const hint = round.isHintShown && question.hint !== undefined ? clean(question.hint) : null
  const stem = cell(clean(question.prompt), 'value')
  if (hint === null) return [row('stem', [stem], true)]
  if (fold === 'folded') return [row('stem', [stem, cell(`  hint  ${hint}`, 'dim')], true)]
  return [row('stem', [stem], true), row('hint', [cell('hint  ', 'label'), cell(hint, 'dim')], true)]
}

const hintControl = (question: TutorQuestion, round: TutorRound): readonly TutorControl[] =>
  question.hint === undefined || round.isHintShown ? [] : [{ key: 'hint', label: 'hint', hotkey: 'h', action: { kind: 'hint' } }]

const skipControl: TutorControl = { key: 'skip', label: 'skip', hotkey: 's', action: { kind: 'skip' } }

// ── screens ────────────────────────────────────────────────────────────────

const closedScreen = (ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  return {
    header: headerOf(row('header', titleCells('Mochi Tutor')), ctx, fold),
    body: bodyOf([textRow('closed', 'The tutor is closed.', 'dim')], ctx, fold),
    controls: [closeControl('close')],
    focusKey: 'close',
  }
}

/** S0: what leaves the machine, and only when the learner presses. */
const consentScreen = (ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const model = clean(ctx.model)
  return {
    header: headerOf(row('header', titleCells('Mochi Tutor')), ctx, fold),
    body: bodyOf([
      textRow('intro', 'Mochi quizzes you on this project and on what Claude changed, so you understand the code you are shipping.', 'value'),
      textRow('calls', 'Model calls happen only when you press:', 'label'),
      textRow('warm', "· warm: this chat is asked one question, reused from Claude's prompt cache", 'dim'),
      textRow('digest', `· else: a digest (≤16k chars) to ${model}: commit subjects, the diff of touched files, short chat excerpts. Secrets masked; .env, keys, certs left out.`, 'dim'),
      textRow('answers', '· your typed answers, for grading', 'dim'),
    ], ctx, fold),
    controls: [
      { key: 'consent', label: 'got it', hotkey: 'y', action: { kind: 'consent' } },
      { key: 'decline', label: 'not now', hotkey: 'n', action: { kind: 'decline' } },
    ],
    focusKey: 'consent',
  }
}

const usageWords = (usage: TutorUsage): string =>
  `${formatTokens(usage.input + usage.cacheWrite)} in · ${formatTokens(usage.cacheRead)} cached · ${formatTokens(usage.output)} out`

/** S1: pick a focus, see where the questions would come from and what this session spent. */
const homeScreen = (state: Extract<TutorState, { phase: 'home' }>, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const due = dueCards(ctx.project, ctx.project.deck.length).length
  const header = spread('header', titleCells('Mochi Tutor'), [cell(`LV ${ctx.project.level} · ${plural(ctx.project.rounds, 'round')}`, 'dim')], ctx.columns)
  const hasSpent = ctx.session.rounds > 0 || ctx.session.usage.calls > 0
  const body: readonly TutorRow[] = [
    ...(state.note === undefined ? [] : [textRow('note', clean(state.note), 'dim', false)]),
    ctx.hasContent
      ? textRow('ask', 'What should I quiz you on?', 'value')
      : textRow('empty', 'Nothing to quiz yet. Ask Claude to change something first.', 'value'),
    labelled('ctx', 'ctx', clean(ctx.planText.text), ctx.planText.isWarning ? 'alert' : 'dim'),
    ...(hasSpent
      ? [row('spent', [cell('this session  ', 'label'), cell(`${plural(ctx.session.rounds, 'round')} · ${usageWords(ctx.session.usage)}`, 'dim')], true)]
      : []),
  ]
  const starts: readonly TutorControl[] = ctx.hasContent
    ? FOCUS_CHOICES.map(choice => ({
        key: `start:${choice.focus}`,
        label: fold === 'folded' ? choice.title : `${choice.title.padEnd(16)}${choice.note}`,
        hotkey: choice.hotkey,
        action: { kind: 'start', focus: choice.focus },
      }))
    : []
  const controls: readonly TutorControl[] = [
    ...starts,
    ...(due > 0 ? [{ key: 'review', label: `review ${due} missed  no model call`, hotkey: 'r', action: { kind: 'review' } } satisfies TutorControl] : []),
    ...(ctx.canFork
      ? [{ key: 'toggle-digest', label: state.isDigestOnly ? 'use session again' : 'use digest instead', hotkey: 'g', action: { kind: 'toggle-digest' } } satisfies TutorControl]
      : []),
    closeControl('close'),
  ]
  const preferred = `start:${state.focus}`
  return {
    header: headerOf(header, ctx, fold),
    body: bodyOf(body, ctx, fold),
    controls,
    focusKey: controls.some(control => control.key === preferred) ? preferred : controls[0]?.key,
  }
}

/** S2: a spinner, and the honest truth about whether stopping saves anything. */
const loadingScreen = (state: Extract<TutorState, { phase: 'loading' }>, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const isFork = state.source === 'fork'
  const reading = isFork ? 'Mochi is reading the chat…' : 'Mochi is reading the diff…'
  const detail = isFork
    ? 'session fork · cannot be cut short; stopping only hides the reply'
    : `digest · ${clean(ctx.model)} · ≤45s`
  const header = spread('header', titleCells('Mochi Tutor'), [cell(FOCUS_TITLES[state.focus], 'dim')], ctx.columns)
  return {
    header: headerOf(header, ctx, fold),
    body: bodyOf([
      ...(state.note === undefined ? [] : [textRow('note', clean(state.note), 'dim')]),
      row('spinner', [cell(`${spinnerFrame(ctx.now)} `, 'accent'), cell(reading, 'value'), cell(`   ${secondsSince(ctx.now, state.since)}`, 'dim')]),
      textRow('detail', detail, 'dim'),
    ], ctx, fold),
    // A fork cannot be aborted (it has no signal), so its control only stops waiting.
    controls: [isFork ? { key: 'cancel', label: 'stop waiting', hotkey: 'x', action: { kind: 'cancel' } } : cancelControl],
    focusKey: 'cancel',
  }
}

/** S3a: a choice question. No input on screen, so the digit hotkeys stay live. */
const choiceScreen = (round: TutorRound, question: ChoiceQuestion, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const options: readonly TutorControl[] = question.options.map((option, index) => ({
    key: `opt:${question.id}:${index}`,
    // A plain Button draws `1: ` itself; wrapping its label is the renderer's job.
    label: clean(option),
    hotkey: String(index + 1),
    action: { kind: 'choose', index },
  }))
  return {
    header: headerOf(questionHeader(round, tagTail(question)), ctx, fold),
    body: bodyOf([
      ...questionPreamble(question),
      ...stemRows(question, round, fold),
      ...(fold === 'folded' ? [] : [textRow('help', `1-${question.options.length} answer`, 'dim', false)]),
    ], ctx, fold),
    controls: [...options, ...hintControl(question, round), skipControl, endControl],
    focusKey: options[0]?.key,
  }
}

/** S3b and S3c: an explain question; mobile has no Input, so it reveals and self-grades. */
const explainScreen = (round: TutorRound, question: ExplainQuestion, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const isMobile = isTouch(ctx)
  const answerKey = `answer:${question.id}`
  const reveal: TutorControl = { key: 'reveal', label: 'show answer', hotkey: 'r', action: { kind: 'reveal' } }
  // On mobile revealing is the way to answer, so it leads (S3c); with a field it follows the hint (S3b).
  const controls: readonly TutorControl[] = isMobile
    ? [reveal, ...hintControl(question, round), skipControl, endControl]
    : [...hintControl(question, round), reveal, skipControl, endControl]
  return {
    header: headerOf(questionHeader(round, tagTail(question)), ctx, fold),
    body: bodyOf([
      ...questionPreamble(question),
      ...stemRows(question, round, fold),
      ...(isMobile || fold === 'folded' ? [] : [textRow('help', 'Enter checks · Tab moves to the buttons', 'dim', false)]),
    ], ctx, fold),
    ...(isMobile ? {} : { input: { key: answerKey, label: 'answer', placeholder: 'type, then Enter', submitLabel: 'check', purpose: 'answer' as const } }),
    controls,
    focusKey: isMobile ? 'reveal' : answerKey,
  }
}

/** S5: the explain header while the grader reads the answer. */
const gradingScreen = (state: WaitState, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const question = currentQuestion(state.round)
  const tail = question === undefined ? [] : tagTail(question)
  return {
    header: headerOf(questionHeader(state.round, tail), ctx, fold),
    body: bodyOf([
      ...(question === undefined ? [] : [row('stem', [cell(clean(question.prompt), 'value')], true)]),
      row('spinner', [cell(`${spinnerFrame(ctx.now)} `, 'accent'), cell('checking your answer…', 'value'), cell(`   ${secondsSince(ctx.now, state.since)}`, 'dim')]),
    ], ctx, fold),
    controls: [cancelControl],
    focusKey: 'cancel',
  }
}

const VERDICTS: Readonly<Record<'choice' | 'explain', Readonly<Record<TutorOutcome, TutorCell>>>> = {
  choice: {
    right: { text: '✓ right', tone: 'good' },
    partial: { text: '◐ partly', tone: 'value' },
    wrong: { text: '✕ not quite', tone: 'alert' },
    skipped: { text: '– skipped', tone: 'dim' },
  },
  explain: {
    right: { text: '✓ solid', tone: 'good' },
    partial: { text: '◐ partly', tone: 'value' },
    wrong: { text: '✕ missed', tone: 'alert' },
    skipped: { text: '– skipped', tone: 'dim' },
  },
}

/** An option's first line for an echo, ellipsised when it would wrap. */
const optionEcho = (index: number, text: string, columns: number): string => {
  const lines = choiceLines(index, text, columns)
  const first = lines[0] ?? ''
  return lines.length > 1 ? withEllipsis(first, lineWidth(columns)) : first
}

/** The lowest shuffled index that is not the answer: the distractor most worth explaining. */
const tempting = (question: ChoiceQuestion): number | undefined => {
  const index = question.options.findIndex((_option, at) => at !== question.answer)
  return index < 0 ? undefined : index
}

const choiceFeedbackRows = (question: ChoiceQuestion, answer: TutorAnswer, ctx: TutorViewContext, fold: Fold): readonly TutorRow[] => {
  const correct = question.options[question.answer] ?? ''
  const correctWhy = clean(question.why[question.answer] ?? '')
  const picked = answer.picked
  if (answer.outcome === 'right') {
    const other = tempting(question)
    return [
      textRow('echo', optionEcho(question.answer, correct, ctx.columns), 'good', false),
      labelled('why', 'why', correctWhy),
      ...(other === undefined || fold !== 'full' ? [] : [labelled('not', `not ${other + 1}`, clean(question.why[other] ?? ''), 'dim')]),
    ]
  }
  return [
    ...(picked === undefined
      ? []
      : [labelled('you', 'you', clean(question.options[picked] ?? ''), 'dim'), labelled('you-why', '', clean(question.why[picked] ?? ''), 'dim')]),
    labelled('answer', 'answer', clean(correct), 'good'),
    labelled('why', 'why', correctWhy),
  ]
}

const refRow = (question: ExplainQuestion): TutorRow => labelled('ref', 'ref', clean(question.reference))

const pointRows = (question: ExplainQuestion, points: readonly boolean[] | undefined): readonly TutorRow[] =>
  question.keyPoints.map((point, index) => {
    const isHit = points?.[index] === true
    return row(`point:${index}`, [cell(isHit ? '✓ ' : '· ', isHit ? 'good' : 'dim'), cell(clean(point), isHit ? 'value' : 'dim')], true)
  })

/** `you said "…"`, cut to two lines, noting when the answer was cut before grading. */
const saidRows = (answer: TutorAnswer, ctx: TutorViewContext): readonly TutorRow[] =>
  answer.given === undefined || answer.given.trim() === ''
    ? []
    : [row('said', [cell('you said ', 'label'), cell(`"${cutToLines(answer.given, lineWidth(ctx.columns), 2)}"`, 'dim'), ...(answer.isCut === true ? [cell(' (cut to 600)', 'dim')] : [])], true)]

const explainFeedbackRows = (question: ExplainQuestion, answer: TutorAnswer, ctx: TutorViewContext): readonly TutorRow[] => {
  return [
    ...saidRows(answer, ctx),
    ...pointRows(question, answer.points),
    ...(answer.note === undefined || answer.note.trim() === '' ? [] : [textRow('note', clean(answer.note), 'value')]),
    refRow(question),
  ]
}

const chatRows = (round: TutorRound): readonly TutorRow[] =>
  round.chat.slice(-SHOWN_EXCHANGES).flatMap((exchange, index) => [
    labelled(`chat:${index}:ask`, 'you', clean(exchange.ask), 'dim'),
    labelled(`chat:${index}:reply`, 'mochi', clean(exchange.reply)),
  ])

/** S4 for an answered question: the verdict, the reasons, follow-ups and next. */
const answeredFeedback = (round: TutorRound, question: TutorQuestion, answer: TutorAnswer, askingSince: number | null, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const isAsking = askingSince !== null
  // Review rounds earn half of the sum at the end, so a per-answer figure there would overstate it.
  const xp = round.source === 'review' ? 0 : xpForAnswer(answer, round.isRetry)
  const verdict = VERDICTS[question.kind][answer.outcome]
  const header = questionHeader(round, [cell('  ', 'dim'), verdict, ...(xp > 0 ? [cell(`  +${xp} XP`, 'accent')] : [])])
  const place = placeText(question)
  const left = followUpsLeft(round)
  const canAsk = !isTouch(ctx) && !isAsking && left > 0
  const askRows: readonly TutorRow[] = isTouch(ctx)
    ? []
    : askingSince !== null
      ? [row('thinking', [cell(`${spinnerFrame(ctx.now)} `, 'accent'), cell('Mochi is thinking…', 'value'), cell(`   ${secondsSince(ctx.now, askingSince)}`, 'dim')])]
      : left > 0
        ? [textRow('ask-left', `(${left} left)`, 'dim', false)]
        : [textRow('ask-out', 'out of follow-ups for this question', 'dim', false)]
  const canOpen = ctx.surface === 'terminal' && question.file !== undefined && ctx.canOpenFile(question.file)
  const controls: readonly TutorControl[] = isAsking
    ? [cancelControl]
    : [
        { key: 'next', label: isLastQuestion(round) ? 'finish' : 'next', hotkey: 'n', action: { kind: 'next' } },
        ...(canOpen ? [{ key: 'open-file', label: 'open file', hotkey: 'o', action: { kind: 'open-file' } } satisfies TutorControl] : []),
        endControl,
      ]
  return {
    header: headerOf(header, ctx, fold),
    body: bodyOf([
      ...(question.kind === 'choice' ? choiceFeedbackRows(question, answer, ctx, fold) : explainFeedbackRows(question, answer, ctx)),
      ...(place === null || fold !== 'full' ? [] : [labelled('see', 'see', place, 'dim')]),
      ...chatRows(round),
      ...askRows,
    ], ctx, fold),
    ...(canAsk ? { input: { key: `ask:${question.id}`, label: 'ask', placeholder: 'ask Mochi about this', submitLabel: 'ask', purpose: 'ask' as const } } : {}),
    controls,
    // The ask field is never focused, so `n` and the other hotkeys keep working.
    focusKey: isAsking ? 'cancel' : 'next',
  }
}

/** S4 for an explain question with no grade yet (revealed, on mobile, or the grader failed): self-grade. */
const ungradedFeedback = (round: TutorRound, question: ExplainQuestion, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const header = questionHeader(round, tagTail(question))
  // A held answer with typed text means the grade failed or was cancelled; a reveal holds nothing.
  const held = currentAnswer(round)
  const wasTyped = held?.given !== undefined
  return {
    header: headerOf(header, ctx, fold),
    body: bodyOf([
      ...(held === undefined ? [] : saidRows(held, ctx)),
      refRow(question),
      ...pointRows(question, undefined),
      textRow('self-ask', wasTyped ? "couldn't check automatically. How did you do?" : 'How did you do?', 'label'),
    ], ctx, fold),
    controls: [
      { key: 'self:right', label: 'I had it', hotkey: '1', action: { kind: 'self-grade', outcome: 'right' } },
      { key: 'self:partial', label: 'partly', hotkey: '2', action: { kind: 'self-grade', outcome: 'partial' } },
      { key: 'self:wrong', label: 'I missed it', hotkey: '3', action: { kind: 'self-grade', outcome: 'wrong' } },
      endControl,
    ],
    focusKey: 'self:right',
  }
}

const feedbackScreen = (round: TutorRound, askingSince: number | null, ctx: TutorViewContext): TutorScreen => {
  const question = currentQuestion(round)
  if (question === undefined) return emptyRoundScreen(ctx)
  if (question.kind === 'explain' && isAwaitingSelfGrade(round)) return ungradedFeedback(round, question, ctx)
  const answer = currentAnswer(round)
  if (answer !== undefined) return answeredFeedback(round, question, answer, askingSince, ctx)
  if (question.kind === 'explain') return ungradedFeedback(round, question, ctx)
  // A choice always records its answer before feedback; drawing the question again is the safe fallback.
  return choiceScreen(round, question, ctx)
}

/** A round with no question at its index: nothing to draw but a way out. */
const emptyRoundScreen = (ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  return {
    header: headerOf(row('header', titleCells('Mochi Tutor')), ctx, fold),
    body: bodyOf([textRow('empty', 'This round has no questions left.', 'dim')], ctx, fold),
    controls: [endControl],
    focusKey: 'end',
  }
}

const questionScreen = (round: TutorRound, ctx: TutorViewContext): TutorScreen => {
  const question = currentQuestion(round)
  if (question === undefined) return emptyRoundScreen(ctx)
  return question.kind === 'choice' ? choiceScreen(round, question, ctx) : explainScreen(round, question, ctx)
}

/** Questions worth another look: missed, partial, skipped, or right only with the hint. */
const isShaky = (answer: TutorAnswer): boolean => answer.outcome !== 'right' || answer.hasUsedHint

const goReadPlaces = (round: TutorRound): readonly string[] => {
  const places = round.questions
    .filter(question => {
      const answer = answerOf(round, question)
      return answer !== undefined && isShaky(answer)
    })
    .map(placeText)
    .filter((place): place is string => place !== null)
  return [...new Set(places)].slice(0, GO_READ_MAX)
}

const outcomeMark = (outcome: TutorOutcome): TutorCell => {
  if (outcome === 'right') return cell('✓ ', 'good')
  if (outcome === 'partial') return cell('◐ ', 'value')
  return cell('✕ ', 'alert')
}

/** Topics two to a row when they fit, else one per row. */
const topicRows = (round: TutorRound, ctx: TutorViewContext): readonly TutorRow[] => {
  const entries = round.questions.flatMap(question => {
    const answer = answerOf(round, question)
    return answer === undefined ? [] : [{ mark: outcomeMark(answer.outcome), topic: clean(question.topic) }]
  })
  const half = Math.floor(lineWidth(ctx.columns) / 2)
  const isPaired = entries.every(entry => entry.topic.length + 2 < half - 1)
  if (!isPaired) return entries.map((entry, index) => row(`topic:${index}`, [entry.mark, cell(entry.topic, 'value')]))
  const rows: TutorRow[] = []
  for (let index = 0; index < entries.length; index += 2) {
    const first = entries[index]
    const second = entries[index + 1]
    if (first === undefined) break
    rows.push(row(`topic:${index}`, [
      first.mark,
      cell(second === undefined ? first.topic : first.topic.padEnd(half - 2), 'value'),
      ...(second === undefined ? [] : [second.mark, cell(second.topic, 'value')]),
    ]))
  }
  return rows
}

const costText = (round: TutorRound): string => {
  const usage = round.usage
  if (usage.calls === 0) return 'no model call'
  const calls = plural(usage.calls, 'call')
  if (round.source === 'fork') {
    // On a fork the cached share is the point: what was re-read cheaply versus billed anew.
    return `${calls} · fork · ${formatTokens(usage.cacheRead)} cached · ${formatTokens(usage.input + usage.cacheWrite)} new · ${formatTokens(usage.output)} out`
  }
  return `${calls} · ${round.source} · ${formatTokens(usage.input + usage.cacheWrite)} in · ${formatTokens(usage.output)} out`
}

/** S6: the score, what to read, what comes back for review, and what it cost. */
const summaryScreen = (state: Extract<TutorState, { phase: 'summary' }>, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  const { round } = state
  const score = scoreRound(round)
  const header = spread(
    'header',
    [...titleCells('Round done'), cell(` · ${score.right}/${score.total} · +${state.xp} XP`, 'value')],
    [cell(`LV ${state.levelBefore} → ${state.levelAfter}`, 'dim')],
    ctx.columns,
  )
  const places = goReadPlaces(round)
  const cards = round.isRetry ? 0 : round.answers.filter(isShaky).length
  const hasMissed = round.answers.some(answer => answer.outcome !== 'right')
  const reread = formatTokens(round.usage.input + round.usage.cacheWrite)
  return {
    header: headerOf(header, ctx, fold),
    body: bodyOf([
      // A round ended early still sits on its last index; the summary shows results, not a marker.
      row('pips', pipsOf(round, false)),
      ...topicRows(round, ctx),
      ...places.map((place, index) => labelled(`read:${index}`, index === 0 ? 'go read' : '', place, 'value')),
      ...(cards > 0 ? [labelled('review', 'review', `${plural(cards, 'card')} back next round`, 'dim')] : []),
      ...(state.wasForkMiss
        ? [textRow('fork-miss', `The cache had lapsed: this round re-read ${reread} tokens at full price. Next rounds use the digest until Claude responds again.`, 'alert')]
        : []),
      labelled('cost', 'cost', costText(round), 'dim'),
    ], ctx, fold),
    controls: [
      // `next` from the summary returns home with this round's focus preselected.
      { key: 'next', label: 'new round', hotkey: 'n', action: { kind: 'next' } },
      ...(hasMissed ? [{ key: 'retry-missed', label: 'retry missed', hotkey: 'r', action: { kind: 'retry-missed' } } satisfies TutorControl] : []),
      closeControl('done'),
    ],
    focusKey: 'next',
  }
}

/** S7: one line naming the cause, then the ways forward. */
const errorScreen = (state: Extract<TutorState, { phase: 'error' }>, ctx: TutorViewContext): TutorScreen => {
  const fold = tutorFold(ctx.bodyRows)
  return {
    header: headerOf(row('header', titleCells('Mochi Tutor')), ctx, fold),
    body: bodyOf([textRow('error', clean(describeTutorFailure(state.failure)), 'alert')], ctx, fold),
    controls: [
      { key: 'retry', label: 'try again', hotkey: 't', action: { kind: 'retry' } },
      ...(state.canTryDigest ? [{ key: 'try-digest', label: 'try the digest', hotkey: 'd', action: { kind: 'try-digest' } } satisfies TutorControl] : []),
      closeControl('close'),
    ],
    focusKey: 'retry',
  }
}

/**
 * The tutor tab for a state, as data: rows of toned cells, at most one input row, and the
 * controls (always present, hotkeys unique on the screen, drawn last). Choice questions have
 * no input so their digit hotkeys stay live; mobile never gets an input. Every model string
 * is cleaned here; register runs `safeText` again at draw time.
 */
export const tutorScreen = (state: TutorState, ctx: TutorViewContext): TutorScreen => {
  switch (state.phase) {
    case 'closed': return closedScreen(ctx)
    case 'consent': return consentScreen(ctx)
    case 'home': return homeScreen(state, ctx)
    case 'loading': return loadingScreen(state, ctx)
    case 'question': return questionScreen(state.round, ctx)
    case 'feedback': return feedbackScreen(state.round, null, ctx)
    case 'asking': return feedbackScreen(state.round, state.since, ctx)
    case 'grading': return gradingScreen(state, ctx)
    case 'summary': return summaryScreen(state, ctx)
    case 'error': return errorScreen(state, ctx)
  }
}
