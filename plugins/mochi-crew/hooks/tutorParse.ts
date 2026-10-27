import type { ChoiceQuestion, ExplainQuestion, TutorFailure, TutorQuestion, TutorTag } from '../types'
import { safeText } from './fileTree'
import { redactSecrets } from './redact'

/** A reply longer than this is refused unread: a real round is a few thousand characters. */
export const MAX_REPLY_CHARS = 20_000
/** A round needs at least this many valid questions to be worth playing. */
export const MIN_VALID = 3
/** Questions examined per reply; a model that writes more is not rewarded for it. */
export const MAX_EXAMINED = 8

/** Length caps, in characters after cleaning. A field over its cap drops the question; nothing is cut. */
export const QUIZ_CAPS: Readonly<{ topic: 32; prompt: 280; option: 120; why: 220; hint: 140; reference: 320; keyPoint: 90; keyPoints: 4; symbol: 60; file: 200 }> = {
  topic: 32,
  prompt: 280,
  option: 120,
  why: 220,
  hint: 140,
  reference: 320,
  keyPoint: 90,
  keyPoints: 4,
  symbol: 60,
  file: 200,
}

/** The shortest question stem that can still ask something. */
export const MIN_PROMPT = 8
/** Fewest options a choice question may offer. */
export const MIN_OPTIONS = 2
/** Most options a choice question may offer; option hotkeys are 1-4. */
export const MAX_OPTIONS = 4
/** A grade's note is display text from a paid call, so a long one is cut rather than wasting the grade. */
const MAX_NOTE = 200
/** Every question tag, easiest first. */
export const TUTOR_TAGS: readonly TutorTag[] = ['what', 'how', 'why', 'what-if']
/** The B.2 shape a question's `symbol` must have; anything else is dropped. */
export const SYMBOL_SHAPE = /^[\w.$#:<>\-/ ]+$/

/** Why a reply could not become a round. */
type BadReplyWhy = Extract<TutorFailure, { kind: 'bad-reply' }>['why']

/**
 * The parsed round, or why the reply was refused. `dropped` counts examined questions that broke a
 * rule; on `too-few`, `valid` and `dropped` feed the debug line (E) without logging model text.
 */
export type ParseOutcome =
  | { readonly isValid: true; readonly questions: readonly TutorQuestion[]; readonly dropped: number }
  | { readonly isValid: false; readonly why: BadReplyWhy; readonly valid?: number; readonly dropped?: number }

type JsonRecord = Readonly<Record<string, unknown>>

/** Whether a value is one of the four question tags. */
export const isTutorTag = (value: unknown): value is TutorTag => TUTOR_TAGS.some(tag => tag === value)

const isRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Spaces a tab becomes: models indent code with tabs, which safeText would turn into `?`. */
const TAB_SPACES = '  '

/**
 * Model text made safe to keep and draw: secrets masked first (so a cut never leaves half a
 * token), then tabs expanded and every other control character replaced per line, keeping the
 * line breaks, then trimmed. Expanding before the trim lets a tab-only reply count as blank.
 */
export const cleanModelText = (text: string): string =>
  redactSecrets(text)
    .split(/\r?\n/)
    .map(line => safeText(line.replaceAll('\t', TAB_SPACES)))
    .join('\n')
    .trim()

// Models wrap JSON in a ```json fence despite being told not to, sometimes after a code fence
// of their own; each fence body is tried in turn, then the whole reply.
const FENCE = /```[a-zA-Z]*[^\S\n]*\n?([\s\S]*?)```/g

/** The balanced object opening at the first `{` at or after `from`, scanning at most MAX_REPLY_CHARS. */
const scanObject = (text: string, from = 0): string | null => {
  const source = text.slice(0, MAX_REPLY_CHARS)
  const start = source.indexOf('{', from)
  if (start < 0) return null
  let depth = 0
  let isInString = false
  let isEscaped = false
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (isInString) {
      if (isEscaped) isEscaped = false
      else if (char === '\\') isEscaped = true
      else if (char === '"') isInString = false
      continue
    }
    if (char === '"') isInString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

const VERSIONED_START = /\{\s*"v"\s*:/

/** Whether a scanned object looks like a versioned reply rather than a stray `{}` in example code. */
const isVersioned = (json: string): boolean => json.search(VERSIONED_START) === 0

/**
 * The first balanced `{…}` in a reply, fences stripped. The scan knows JSON strings and their
 * escapes, so a brace inside a string never ends the object. A fence whose object starts with
 * `"v"` wins; then an object starting `{"v":` anywhere in the reply; then the first balanced
 * object. Only the first MAX_REPLY_CHARS are read; null when no object closes within them.
 */
export const extractJsonObject = (text: string): string | null => {
  // Cut first so an unclosed fence or brace can never make the scans walk a huge reply.
  const source = text.slice(0, MAX_REPLY_CHARS)
  for (const match of source.matchAll(FENCE)) {
    const json = scanObject(match[1] ?? '')
    if (json !== null && isVersioned(json)) return json
  }
  // Prose before the reply may hold a stray `{` (or a fence the reply's own strings broke), so
  // the versioned object is looked for by its opening before falling back to the first brace.
  const versionedAt = source.search(VERSIONED_START)
  const versioned = versionedAt < 0 ? null : scanObject(source, versionedAt)
  return versioned ?? scanObject(source)
}

const parseJson = (text: string): { readonly isParsed: true; readonly value: unknown } | { readonly isParsed: false } => {
  try {
    return { isParsed: true, value: JSON.parse(text) }
  } catch {
    // The caller reports `bad-json`; the model's text is never logged.
    return { isParsed: false }
  }
}

/** Two options that differ only in case or spacing are the same option. */
const normalized = (text: string): string => text.toLowerCase().replace(/\s+/g, ' ').trim()

/** A cleaned string within `[min, max]` characters, or null when missing, mistyped or out of range. */
const boundedText = (value: unknown, min: number, max: number): string | null => {
  if (typeof value !== 'string') return null
  const cleaned = cleanModelText(value)
  return cleaned.length >= min && cleaned.length <= max ? cleaned : null
}

/** A list of `min`-`max` cleaned strings, each within `[1, itemMax]`, or null if any breaks a rule. */
const boundedList = (value: unknown, min: number, max: number, itemMax: number): readonly string[] | null => {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null
  const items = value.map(item => boundedText(item, 1, itemMax))
  return items.every((item): item is string => item !== null) ? items : null
}

/** An optional hint: absent or empty is fine, over its cap drops the question (undefined vs null). */
const optionalHint = (value: unknown): string | undefined | null => {
  if (typeof value !== 'string') return undefined
  const cleaned = cleanModelText(value)
  if (cleaned === '') return undefined
  return cleaned.length <= QUIZ_CAPS.hint ? cleaned : null
}

const optionalFile = (value: unknown, allowedFiles: ReadonlySet<string>): string | undefined => {
  if (typeof value !== 'string' || value.length > QUIZ_CAPS.file) return undefined
  // Exact match against what the tutor was given: the open action trusts this path.
  return allowedFiles.has(value) ? value : undefined
}

const optionalSymbol = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const cleaned = cleanModelText(value)
  return cleaned.length <= QUIZ_CAPS.symbol && SYMBOL_SHAPE.test(cleaned) ? cleaned : undefined
}

type Base = Omit<ChoiceQuestion, 'kind' | 'options' | 'answer' | 'why'>

const parseChoice = (raw: JsonRecord, base: Base): ChoiceQuestion | null => {
  const options = boundedList(raw.options, MIN_OPTIONS, MAX_OPTIONS, QUIZ_CAPS.option)
  if (options === null) return null
  if (new Set(options.map(normalized)).size !== options.length) return null
  const answer = raw.answer
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer >= options.length) return null
  const why = boundedList(raw.why, options.length, options.length, QUIZ_CAPS.why)
  if (why === null) return null
  const { hint, ...rest } = base
  // A hint that names the right option gives the question away; the question itself is still good.
  const isGiveaway = hint !== undefined && normalized(hint).includes(normalized(options[answer] ?? ''))
  return { ...rest, ...(hint === undefined || isGiveaway ? {} : { hint }), kind: 'choice', options, answer, why }
}

const parseExplain = (raw: JsonRecord, base: Base): ExplainQuestion | null => {
  const reference = boundedText(raw.reference, 1, QUIZ_CAPS.reference)
  if (reference === null) return null
  const keyPoints = boundedList(raw.keyPoints, 1, QUIZ_CAPS.keyPoints, QUIZ_CAPS.keyPoint)
  if (keyPoints === null) return null
  return { ...base, kind: 'explain', reference, keyPoints }
}

/** One question from the reply under the B.2 rules, or null when it breaks one that drops it. */
const parseQuestion = (raw: unknown, id: string, allowedFiles: ReadonlySet<string>): TutorQuestion | null => {
  if (!isRecord(raw)) return null
  if (raw.kind !== 'choice' && raw.kind !== 'explain') return null
  const topic = boundedText(raw.topic, 1, QUIZ_CAPS.topic)
  if (topic === null) return null
  const prompt = boundedText(raw.prompt, MIN_PROMPT, QUIZ_CAPS.prompt)
  if (prompt === null) return null
  const hint = optionalHint(raw.hint)
  if (hint === null) return null
  // An odd tag only changes a label, so it is coerced rather than costing the question.
  const tag: TutorTag = isTutorTag(raw.tag) ? raw.tag : 'how'
  const file = optionalFile(raw.file, allowedFiles)
  const symbol = optionalSymbol(raw.symbol)
  const base: Base = {
    id,
    tag,
    topic,
    prompt,
    ...(hint === undefined ? {} : { hint }),
    ...(file === undefined ? {} : { file }),
    ...(symbol === undefined ? {} : { symbol }),
  }
  return raw.kind === 'choice' ? parseChoice(raw, base) : parseExplain(raw, base)
}

/** mulberry32: a tiny seeded generator, so a round's shuffle can be replayed and tested. */
const mulberry32 = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

/**
 * The question with its options in a seeded order (Fisher-Yates over mulberry32). `answer` and
 * `why` move with their options, so the model's habit of putting the answer first is undone
 * without breaking any reason. Same seed, same order.
 */
export const shuffleChoice = (question: ChoiceQuestion, seed: number): ChoiceQuestion => {
  const random = mulberry32(seed)
  const order = question.options.map((_option, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const held = order[index] ?? index
    order[index] = order[swap] ?? swap
    order[swap] = held
  }
  return {
    ...question,
    options: order.map(from => question.options[from] ?? ''),
    why: order.map(from => question.why[from] ?? ''),
    answer: order.indexOf(question.answer),
  }
}

/**
 * A round from the model's reply (B.2). A broken question is dropped, not the round; the round
 * fails only on the reply-level reasons or with fewer than MIN_VALID valid questions. The first
 * MAX_EXAMINED questions are examined and at most `want` kept. Ids are `${roundId}:${i}` and
 * choice question `i` is shuffled with `seed * 31 + i`; pass the loading epoch as `seed`.
 */
export const parseRound = (text: string, roundId: string, allowedFiles: ReadonlySet<string>, want: number, seed: number): ParseOutcome => {
  if (text.length > MAX_REPLY_CHARS) return { isValid: false, why: 'too-long' }
  const json = extractJsonObject(text)
  if (json === null) return { isValid: false, why: 'no-json' }
  const parsed = parseJson(json)
  if (!parsed.isParsed) return { isValid: false, why: 'bad-json' }
  const reply = parsed.value
  if (!isRecord(reply) || reply.v !== 1) return { isValid: false, why: 'bad-version' }
  if (!Array.isArray(reply.questions)) return { isValid: false, why: 'bad-shape' }

  const questions: TutorQuestion[] = []
  let dropped = 0
  for (const raw of reply.questions.slice(0, MAX_EXAMINED)) {
    if (questions.length >= want) break
    const index = questions.length
    const question = parseQuestion(raw, `${roundId}:${index}`, allowedFiles)
    if (question === null) {
      dropped += 1
      continue
    }
    questions.push(question.kind === 'choice' ? shuffleChoice(question, seed * 31 + index) : question)
  }
  if (questions.length < MIN_VALID) return { isValid: false, why: 'too-few', valid: questions.length, dropped }
  return { isValid: true, questions, dropped }
}

/**
 * The grader's verdict on one explain answer (GRADE_SYSTEM's reply): one boolean per key point,
 * in order, and a short cleaned note. Null when the reply is not that object or the count is
 * wrong, and the caller falls back to self-grading.
 */
export const parseGrade = (text: string, keyPointCount: number): { readonly points: readonly boolean[]; readonly note: string } | null => {
  if (keyPointCount < 1 || text.length > MAX_REPLY_CHARS) return null
  const json = extractJsonObject(text)
  if (json === null) return null
  const parsed = parseJson(json)
  if (!parsed.isParsed || !isRecord(parsed.value) || parsed.value.v !== 1) return null
  const { points, note } = parsed.value
  if (!Array.isArray(points) || points.length !== keyPointCount) return null
  if (!points.every((point): point is boolean => typeof point === 'boolean')) return null
  return { points, note: typeof note === 'string' ? cleanModelText(note).slice(0, MAX_NOTE) : '' }
}
