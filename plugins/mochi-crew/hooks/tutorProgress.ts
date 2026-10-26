import type { ChoiceQuestion, ExplainQuestion, TutorAnswer, TutorCard, TutorLevel, TutorProgressStore, TutorProject, TutorQuestion, TutorRound } from '../types'
import { safeText } from './fileTree'
import { isTutorTag, MAX_OPTIONS, MIN_OPTIONS, MIN_PROMPT, QUIZ_CAPS, SYMBOL_SHAPE } from './tutorParse'
import { scoreRound } from './tutorRound'

/** Projects kept in the store; the least recently quizzed one goes first. */
export const MAX_PROJECTS = 12
/** Review cards kept per project; the lowest `dueRound` goes first. */
export const MAX_DECK = 20
/** Retired topics kept per project, for the prompt's "do not re-ask" line. */
export const MAX_MASTERED = 20
/** Recently missed topics kept per project, for the prompt. */
export const MAX_MISSES = 8
/**
 * Serialized size the tutor store is held under. The store's 4 MiB is shared with every other
 * key, and a deck of maximal choice cards outgrows this on the count caps alone, so `withProject`
 * also drops whole least-recent projects until the store fits.
 */
export const MAX_STORE_BYTES = 450_000

/** A project the tutor has never seen: level 1, nothing played, nothing due. */
export const FRESH_PROJECT: TutorProject = { level: 1, rounds: 0, streak: 0, deck: [], mastered: [], recentMisses: [], updatedAt: 0 }

const EMPTY_STORE: TutorProgressStore = { v: 1, projects: {} }

/** Rounds until a card in each box comes back after a clean answer moved it there. */
const BOX_INTERVAL: Readonly<Record<2 | 3, number>> = { 2: 3, 3: 6 }
/** Score at or above which a round counts toward going up a level. */
const LEVEL_UP_SCORE = 0.8
/** Score at or below which a round drops a level. */
const LEVEL_DOWN_SCORE = 0.4
/** Qualifying rounds in a row that raise the level. */
const LEVEL_UP_STREAK = 2
/** Hints a round may use and still qualify for going up. */
const LEVEL_UP_MAX_HINTS = 1
/** Questions a round needs before it can raise the level; a two-question review proves little. */
const LEVEL_UP_MIN_QUESTIONS = 4

/**
 * String bounds for stored questions: the parser's own B.2 caps plus an id bound, so a hand-edited
 * or stale store cannot smuggle in a question the parser would never have produced.
 */
const STORED_CAPS = { id: 120, ...QUIZ_CAPS } as const

type Fields = { readonly [key: string]: unknown }

const isFields = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
// `cleanModelText` keeps line breaks but leaves no other control character on any line, so a
// stored string holding one was hand-edited; topics from here go straight back into the prompt.
const isCleanText = (text: string): boolean => text.split('\n').every(line => safeText(line) === line)
const isBounded = (value: unknown, min: number, max: number): value is string =>
  typeof value === 'string' && value.length >= min && value.length <= max && isCleanText(value)
const isLevel = (value: unknown): value is TutorLevel => value === 1 || value === 2 || value === 3
const isBox = (value: unknown): value is TutorCard['box'] => value === 1 || value === 2 || value === 3

const boundedStrings = (value: unknown, minCount: number, maxCount: number, maxLength: number): readonly string[] | null => {
  if (!Array.isArray(value) || value.length < minCount || value.length > maxCount) return null
  const strings = value.filter((item): item is string => isBounded(item, 1, maxLength))
  return strings.length === value.length ? strings : null
}

/** Optional string fields: absent is fine, present must fit; `undefined` marks a bad one. */
const optionalField = (raw: Fields, key: 'hint' | 'file' | 'symbol'): { readonly value?: string } | undefined => {
  const value = raw[key]
  if (value === undefined) return {}
  return isBounded(value, 1, STORED_CAPS[key]) ? { value } : undefined
}

const parseQuestion = (raw: unknown): TutorQuestion | null => {
  if (!isFields(raw)) return null
  const { id, tag, topic, prompt } = raw
  if (!isBounded(id, 1, STORED_CAPS.id) || !isTutorTag(tag) || !isBounded(topic, 1, STORED_CAPS.topic) || !isBounded(prompt, MIN_PROMPT, STORED_CAPS.prompt)) return null
  const hint = optionalField(raw, 'hint')
  const file = optionalField(raw, 'file')
  const symbol = optionalField(raw, 'symbol')
  if (hint === undefined || file === undefined || symbol === undefined) return null
  if (symbol.value !== undefined && !SYMBOL_SHAPE.test(symbol.value)) return null
  // `isReview` is not kept: it is stamped on when a card is replayed, not part of the card.
  const base = {
    id,
    tag,
    topic,
    prompt,
    ...(hint.value === undefined ? {} : { hint: hint.value }),
    ...(file.value === undefined ? {} : { file: file.value }),
    ...(symbol.value === undefined ? {} : { symbol: symbol.value }),
  }
  if (raw.kind === 'choice') {
    const options = boundedStrings(raw.options, MIN_OPTIONS, MAX_OPTIONS, STORED_CAPS.option)
    if (options === null) return null
    const why = boundedStrings(raw.why, options.length, options.length, STORED_CAPS.why)
    const { answer } = raw
    if (why === null || !isCount(answer) || answer >= options.length) return null
    const question: ChoiceQuestion = { ...base, kind: 'choice', options, answer, why }
    return question
  }
  if (raw.kind === 'explain') {
    const { reference } = raw
    const keyPoints = boundedStrings(raw.keyPoints, 1, STORED_CAPS.keyPoints, STORED_CAPS.keyPoint)
    if (!isBounded(reference, 1, STORED_CAPS.reference) || keyPoints === null) return null
    const question: ExplainQuestion = { ...base, kind: 'explain', reference, keyPoints }
    return question
  }
  return null
}

const parseCard = (raw: unknown): TutorCard | null => {
  if (!isFields(raw) || !isBox(raw.box) || !isCount(raw.dueRound)) return null
  const question = parseQuestion(raw.question)
  return question === null ? null : { question, box: raw.box, dueRound: raw.dueRound }
}

/** Topic lists keep their order; a bad entry is dropped rather than failing the project. */
const parseTopics = (value: unknown, max: number): readonly string[] => {
  if (!Array.isArray(value)) return []
  return keepLast(value.filter((item): item is string => isBounded(item, 1, STORED_CAPS.topic)), max)
}

const parseProject = (raw: unknown): TutorProject | null => {
  if (!isFields(raw)) return null
  const { level, rounds, streak, updatedAt } = raw
  if (!isLevel(level) || !isCount(rounds) || !isCount(streak) || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
  const deck = Array.isArray(raw.deck) ? raw.deck.map(parseCard).filter((card): card is TutorCard => card !== null) : []
  return {
    level,
    rounds,
    streak,
    deck: capDeck(uniqueCards(deck)),
    mastered: parseTopics(raw.mastered, MAX_MASTERED),
    recentMisses: parseTopics(raw.recentMisses, MAX_MISSES),
    updatedAt,
  }
}

/** Appends topics, moving a repeat to the end, and keeps the newest `max`. */
const keepLast = (topics: readonly string[], max: number): readonly string[] => {
  const unique = topics.filter((topic, index) => topics.lastIndexOf(topic) === index)
  return unique.slice(Math.max(0, unique.length - max))
}

/** A later card with the same question id replaces an earlier one. */
const uniqueCards = (deck: readonly TutorCard[]): readonly TutorCard[] =>
  deck.filter((card, index) => deck.findLastIndex(other => other.question.id === card.question.id) === index)

/** Oldest due first; the sort is stable, so among equal `dueRound`s the earlier card goes first. */
const byDueRound = (deck: readonly TutorCard[]): readonly TutorCard[] => [...deck].sort((a, b) => a.dueRound - b.dueRound)

const capDeck = (deck: readonly TutorCard[]): readonly TutorCard[] => {
  const sorted = byDueRound(deck)
  return sorted.slice(Math.max(0, sorted.length - MAX_DECK))
}

const byteLength = (store: TutorProgressStore): number => new TextEncoder().encode(JSON.stringify(store)).length

/** Drops projects, least recent first, until the store has `maxCount` and is under `MAX_STORE_BYTES`; `keep` always stays. */
const capProjects = (projects: Readonly<Record<string, TutorProject>>, keep: string | null, maxCount: number): TutorProgressStore => {
  const newestFirst = Object.entries(projects).sort(([rootA, a], [rootB, b]) => {
    if (rootA === keep) return -1
    if (rootB === keep) return 1
    return b.updatedAt - a.updatedAt
  })
  let kept = newestFirst.slice(0, maxCount)
  let store: TutorProgressStore = { v: 1, projects: Object.fromEntries(kept) }
  while (kept.length > 1 && byteLength(store) >= MAX_STORE_BYTES) {
    kept = kept.slice(0, -1)
    store = { v: 1, projects: Object.fromEntries(kept) }
  }
  return store
}

/**
 * The saved tutor progress from whatever the store held. Anything that is not a v1 store gives an
 * empty one; a project or card that fails any field check is dropped and the rest kept, so one bad
 * write never costs every project its progress. The result is already within every cap.
 */
export const parseProgress = (raw: unknown): TutorProgressStore => {
  if (!isFields(raw) || raw.v !== 1 || !isFields(raw.projects)) return EMPTY_STORE
  const projects = Object.entries(raw.projects).flatMap(([root, value]): readonly (readonly [string, TutorProject])[] => {
    const project = root === '' ? null : parseProject(value)
    return project === null ? [] : [[root, project]]
  })
  // Object.fromEntries defines own keys, so a "__proto__" root cannot reach the prototype.
  return capProjects(Object.fromEntries(projects), null, MAX_PROJECTS)
}

/** One project's progress, or a fresh project when the store has none for this root. */
export const projectOf = (store: TutorProgressStore, root: string): TutorProject =>
  Object.hasOwn(store.projects, root) ? (store.projects[root] ?? FRESH_PROJECT) : FRESH_PROJECT

/**
 * The store with this project's progress saved. Projects beyond `MAX_PROJECTS`, or beyond the
 * byte budget, are dropped least recent (by `updatedAt`) first; the one just written always stays.
 */
export const withProject = (store: TutorProgressStore, root: string, project: TutorProject): TutorProgressStore =>
  capProjects({ ...store.projects, [root]: project }, root, MAX_PROJECTS)

/** Cards due by now (`dueRound` at or below the rounds played), oldest due first, at most `max`. */
export const dueCards = (project: TutorProject, max: number): readonly TutorCard[] => {
  if (max <= 0) return []
  return byDueRound(project.deck.filter(card => card.dueRound <= project.rounds)).slice(0, max)
}

/** An answer earns a card when it was anything but a clean right. */
const isMissed = (answer: TutorAnswer): boolean => answer.outcome !== 'right' || answer.hasUsedHint

/**
 * The level and streak after a round, review rounds included (B.7 names no exception). Two
 * qualifying rounds in a row (score at least 0.8, at most one hint, at least four questions) go
 * up; a round at 0.4 or below goes down; either resets the streak. A retry pass leaves both alone:
 * it replays the round just counted, so counting it again would score that round twice.
 */
export const nextLevel = (project: TutorProject, round: TutorRound): { readonly level: TutorLevel; readonly streak: number } => {
  if (round.isRetry) return { level: project.level, streak: project.streak }
  const total = round.questions.length
  if (total === 0) return { level: project.level, streak: project.streak }
  // Divided by the questions asked, not the answers given, so an unanswered question is not right.
  const { right, hints } = scoreRound(round)
  const score = right / total
  if (score <= LEVEL_DOWN_SCORE) return { level: clampLevel(project.level - 1), streak: 0 }
  const doesQualify = score >= LEVEL_UP_SCORE && hints <= LEVEL_UP_MAX_HINTS && total >= LEVEL_UP_MIN_QUESTIONS
  if (!doesQualify) return { level: project.level, streak: 0 }
  const streak = project.streak + 1
  if (streak < LEVEL_UP_STREAK) return { level: project.level, streak }
  return { level: clampLevel(project.level + 1), streak: 0 }
}

const clampLevel = (level: number): TutorLevel => (level <= 1 ? 1 : level >= 3 ? 3 : 2)

/** A question as stored on a card: the replay marker is dropped so the card stays canonical. */
const storedQuestion = (question: TutorQuestion): TutorQuestion => {
  if (question.isReview === undefined) return question
  const { isReview: _replayed, ...rest } = question
  return rest
}

/**
 * The project after a finished round: one more round played, the deck moved, the level and streak
 * updated and the missed topics noted. Due rounds count from the rounds played before this one, so
 * a card "due next round" is due as soon as this returns. A clean right moves a card up a box
 * (back in 3 rounds, then 6) and retires it into `mastered` from box 3; anything else puts it in
 * box 1. Only a replayed (`isReview`) question moves a card up; any miss replaces the card with the
 * same id. A retry pass earns nothing and changes nothing but `updatedAt`.
 */
export const afterRound = (project: TutorProject, round: TutorRound, now: number): TutorProject => {
  if (round.isRetry) return { ...project, updatedAt: now }
  const questions = new Map(round.questions.map(question => [question.id, question]))
  let deck: readonly TutorCard[] = project.deck
  const retired: string[] = []
  const missed: string[] = []
  for (const answer of round.answers) {
    const question = questions.get(answer.questionId)
    if (question === undefined) continue
    const card = deck.find(held => held.question.id === question.id)
    const others = deck.filter(held => held.question.id !== question.id)
    if (isMissed(answer)) {
      missed.push(question.topic)
      deck = [...others, { question: storedQuestion(question), box: 1, dueRound: project.rounds + 1 }]
      continue
    }
    // Only a replayed card moves up: round ids restart with each session, so a fresh question can
    // share an id with an old card it never asked, and a clean right on it must not promote that card.
    if (card === undefined || question.isReview !== true) continue
    if (card.box === 3) {
      retired.push(card.question.topic)
      deck = others
      continue
    }
    const box = card.box === 1 ? 2 : 3
    deck = [...others, { ...card, box, dueRound: project.rounds + BOX_INTERVAL[box] }]
  }
  const { level, streak } = nextLevel(project, round)
  return {
    level,
    rounds: project.rounds + 1,
    streak,
    deck: capDeck(deck),
    mastered: keepLast([...project.mastered, ...retired], MAX_MASTERED),
    recentMisses: keepLast([...project.recentMisses, ...missed], MAX_MISSES),
    updatedAt: now,
  }
}
