import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, ExplainQuestion, TutorAnswer, TutorCard, TutorOutcome, TutorProgressStore, TutorProject, TutorQuestion, TutorRound } from '../types'
import { FRESH_PROJECT, MAX_DECK, MAX_MASTERED, MAX_MISSES, MAX_PROJECTS, MAX_STORE_BYTES, afterRound, dueCards, nextLevel, parseProgress, projectOf, withProject } from '../hooks/tutorProgress'

const choice = (id: string, topic = `topic ${id}`): ChoiceQuestion => ({
  id,
  kind: 'choice',
  tag: 'why',
  topic,
  prompt: 'Why does the tree read worktrees?',
  options: ['because a', 'because b'],
  answer: 0,
  why: ['right because a', 'wrong because b'],
})

const explain = (id: string): ExplainQuestion => ({
  id,
  kind: 'explain',
  tag: 'how',
  topic: `topic ${id}`,
  prompt: 'In your own words: how does it work?',
  reference: 'It reads them.',
  keyPoints: ['reads', 'merges'],
})

const card = (question: TutorQuestion, box: TutorCard['box'], dueRound: number): TutorCard => ({ question, box, dueRound })

const answer = (questionId: string, outcome: TutorOutcome, hasUsedHint = false): TutorAnswer => ({ questionId, outcome, hasUsedHint })

const round = (questions: readonly TutorQuestion[], answers: readonly TutorAnswer[], over: Partial<TutorRound> = {}): TutorRound => ({
  id: 'r1',
  epoch: 1,
  focus: 'recent',
  source: 'fork',
  startedAt: 0,
  questions,
  index: 0,
  answers,
  isHintShown: false,
  isRetry: false,
  chat: [],
  followUpsUsed: 0,
  usage: { calls: 1, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
  ...over,
})

/** A five-question round with the given outcomes, every answer hint-free unless marked. */
const scored = (outcomes: readonly TutorOutcome[], hints = 0): TutorRound => {
  const questions = outcomes.map((_, index) => choice(`s:${index}`))
  return round(questions, outcomes.map((outcome, index) => answer(`s:${index}`, outcome, index < hints)))
}

const project = (over: Partial<TutorProject> = {}): TutorProject => ({ ...FRESH_PROJECT, ...over })

describe('tutor progress', () => {
  test('parseProgress tolerates undefined, junk, a wrong v and bad cards', async () => {
    const empty: TutorProgressStore = { v: 1, projects: {} }
    for (const raw of [undefined, null, 'junk', 42, [], { v: 2, projects: {} }, { v: 1 }, { v: 1, projects: [] }]) {
      expect(parseProgress(raw)).toEqual(empty)
    }
    const good = card(choice('a:0'), 2, 4)
    const raw = {
      v: 1,
      projects: {
        '/repo': {
          level: 2,
          rounds: 3,
          streak: 1,
          updatedAt: 100,
          mastered: ['kept', 7, '', 'bell\u0007', 'rtl\u202e'],
          recentMisses: 'not a list',
          deck: [
            good,
            card(explain('a:1'), 1, 3),
            { ...good, box: 4 },
            { ...good, dueRound: -1 },
            { question: { ...choice('a:2'), answer: 2 }, box: 1, dueRound: 1 },
            { question: { ...choice('a:3'), why: ['only one'] }, box: 1, dueRound: 1 },
            { question: { ...choice('a:4'), tag: 'maybe' }, box: 1, dueRound: 1 },
            { question: { ...choice('a:5'), prompt: 'x'.repeat(281) }, box: 1, dueRound: 1 },
            { question: { ...explain('a:6'), keyPoints: [] }, box: 1, dueRound: 1 },
            { question: { ...choice('a:7'), hint: 3 }, box: 1, dueRound: 1 },
            { question: { ...choice('a:8'), symbol: 'rm -rf; $(x)' }, box: 1, dueRound: 1 },
            { question: { ...choice('a:9'), prompt: 'Why does \u001b[31m the tree read?' }, box: 1, dueRound: 1 },
            { question: { ...choice('b:0'), prompt: 'Why does the tree\nread worktrees?', symbol: 'Tree#place' }, box: 1, dueRound: 2 },
            'junk',
          ],
        },
        '/bad-level': { ...FRESH_PROJECT, level: 4 },
        '/bad-rounds': { ...FRESH_PROJECT, rounds: 1.5 },
        '/no-fields': 'junk',
        '': FRESH_PROJECT,
      },
    }
    const store = parseProgress(raw)
    expect(Object.keys(store.projects)).toEqual(['/repo'])
    const parsed = projectOf(store, '/repo')
    // A line break is something the parser keeps; an escape, a bad symbol or a bidi mark is not.
    expect(parsed.deck.map(held => held.question.id)).toEqual(['b:0', 'a:1', 'a:0'])
    expect(parsed.mastered).toEqual(['kept'])
    expect(parsed.recentMisses).toEqual([])
    expect(parsed.level).toBe(2)
    expect(projectOf(parseProgress(JSON.parse('{"v":1,"projects":{"__proto__":{"level":1}}}')), '__proto__')).toEqual(FRESH_PROJECT)
    expect(projectOf(store, '/elsewhere')).toEqual(FRESH_PROJECT)
  })

  test('missed answers enter box 1 due next round', async () => {
    const questions = [choice('r1:0'), choice('r1:1'), choice('r1:2'), explain('r1:3'), choice('r1:4')]
    const answers = [answer('r1:0', 'wrong'), answer('r1:1', 'skipped'), answer('r1:2', 'right'), answer('r1:3', 'partial'), answer('r1:4', 'right', true)]
    const before = project({ rounds: 5 })
    const after = afterRound(before, round(questions, answers), 9)
    expect(after.rounds).toBe(6)
    expect(after.updatedAt).toBe(9)
    expect(after.deck.map(held => [held.question.id, held.box, held.dueRound])).toEqual([
      ['r1:0', 1, 6],
      ['r1:1', 1, 6],
      ['r1:3', 1, 6],
      ['r1:4', 1, 6],
    ])
    expect(dueCards(after, 5).map(held => held.question.id)).toEqual(['r1:0', 'r1:1', 'r1:3', 'r1:4'])
    expect(after.recentMisses).toEqual(['topic r1:0', 'topic r1:1', 'topic r1:3', 'topic r1:4'])
    const crowded = afterRound(project({ recentMisses: ['topic r1:0', 'm1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7'] }), round(questions, answers), 9)
    expect(crowded.recentMisses).toHaveLength(MAX_MISSES)
    expect(crowded.recentMisses).toEqual(['m4', 'm5', 'm6', 'm7', 'topic r1:0', 'topic r1:1', 'topic r1:3', 'topic r1:4'])
  })

  test('right moves up a box with intervals 3 then 6', async () => {
    const question = { ...choice('old:0'), isReview: true as const }
    const once = afterRound(project({ rounds: 4, deck: [card(choice('old:0'), 1, 4)] }), round([question], [answer('old:0', 'right')]), 1)
    expect(once.deck).toEqual([card(choice('old:0'), 2, 7)])
    expect(dueCards(once, 5)).toEqual([])
    const twice = afterRound({ ...once, rounds: 7 }, round([question], [answer('old:0', 'right')]), 2)
    expect(twice.deck).toEqual([card(choice('old:0'), 3, 13)])
    // A fresh question that only shares the old card's id (ids restart per session) is not a replay.
    const fresh = afterRound(twice, round([choice('old:0')], [answer('old:0', 'right')]), 3)
    expect(fresh.deck).toEqual(twice.deck)
    expect(fresh.mastered).toEqual([])
  })

  test('right in box 3 retires the card into mastered', async () => {
    const start = project({ rounds: 10, deck: [card(choice('old:0', 'worktree locks'), 3, 10)], mastered: ['worktree locks', 'tree budget'] })
    const replay = { ...choice('old:0', 'worktree locks'), isReview: true as const }
    const after = afterRound(start, round([replay], [answer('old:0', 'right')], { source: 'review' }), 1)
    expect(after.deck).toEqual([])
    expect(after.mastered).toEqual(['tree budget', 'worktree locks'])
    const crowded = project({ rounds: 10, deck: [card(choice('old:0', 'worktree locks'), 3, 10)], mastered: Array.from({ length: MAX_MASTERED }, (_, slot) => `m${slot}`) })
    const full = afterRound(crowded, round([replay], [answer('old:0', 'right')], { source: 'review' }), 1).mastered
    expect(full).toHaveLength(MAX_MASTERED)
    expect([full[0], full.at(-1)]).toEqual(['m1', 'worktree locks'])
  })

  test('wrong on review returns to box 1', async () => {
    const start = project({ rounds: 10, deck: [card(choice('old:0'), 3, 10)] })
    const review = round([{ ...choice('old:0'), isReview: true }], [answer('old:0', 'wrong')], { source: 'review' })
    const after = afterRound(start, review, 1)
    expect(after.deck).toEqual([card(choice('old:0'), 1, 11)])
    expect(after.deck[0]?.question.isReview).toBeUndefined()
  })

  test('a hinted right stays in the deck', async () => {
    const start = project({ rounds: 2, deck: [card(choice('old:0'), 2, 2)] })
    const after = afterRound(start, round([choice('old:0'), choice('new:0')], [answer('old:0', 'right', true), answer('new:0', 'right', true)]), 1)
    expect(after.deck).toEqual([card(choice('old:0'), 1, 3), card(choice('new:0'), 1, 3)])
  })

  test('a full deck drops the highest box first and keeps new misses', async () => {
    // Box 2 at due 10..19 except two box-3 cards, so the box rule and the due tie-break both show.
    const deck = Array.from({ length: MAX_DECK }, (_, index) => card(choice(`old:${index}`), index === 4 || index === 9 ? 3 : 2, 10 + index))
    const after = afterRound(project({ rounds: 8, deck }), round([choice('new:0'), choice('new:1')], [answer('new:0', 'wrong'), answer('new:1', 'wrong')]), 1)
    expect(after.deck).toHaveLength(MAX_DECK)
    // The new cards are due at 9, below every held card, yet they stay: the box-3 cards go instead.
    expect(after.deck.slice(0, 2).map(held => held.question.id)).toEqual(['new:0', 'new:1'])
    expect(after.deck.some(held => held.question.id === 'old:4' || held.question.id === 'old:9')).toBe(false)
    const third = afterRound(project({ rounds: 8, deck }), round([choice('a:0'), choice('a:1'), choice('a:2')], ['a:0', 'a:1', 'a:2'].map(id => answer(id, 'wrong'))), 1)
    // Past the box-3 cards, the box-2 card due soonest goes next.
    expect(third.deck.map(held => held.question.id).filter(id => id.startsWith('old'))).not.toContain('old:0')
    expect(third.deck.filter(held => held.question.id.startsWith('a:'))).toHaveLength(3)
    // A miss on a held card replaces it in place rather than growing the deck.
    const again = afterRound(project({ rounds: 30, deck }), round([{ ...choice('old:9'), isReview: true }], [answer('old:9', 'wrong')]), 1)
    expect(again.deck).toHaveLength(MAX_DECK)
    expect(again.deck.find(held => held.question.id === 'old:9')).toEqual(card(choice('old:9'), 1, 31))
  })

  test('parsed decks over the cap drop the highest box first', async () => {
    const deck = Array.from({ length: MAX_DECK + 2 }, (_, index) => card(choice(`p:${index}`), index < 2 ? 1 : index === 20 ? 3 : 2, index))
    const parsed = projectOf(parseProgress({ v: 1, projects: { '/repo': { ...FRESH_PROJECT, deck } } }), '/repo')
    expect(parsed.deck).toHaveLength(MAX_DECK)
    expect(parsed.deck.map(held => held.question.id)).not.toContain('p:20')
    expect(parsed.deck.map(held => held.question.id)).not.toContain('p:2')
    expect(parsed.deck.slice(0, 2).map(held => held.question.id)).toEqual(['p:0', 'p:1'])
  })

  test('projects capped at 12 by least recent', async () => {
    let store: TutorProgressStore = { v: 1, projects: {} }
    for (let index = 0; index < MAX_PROJECTS + 2; index++) store = withProject(store, `/p${index}`, project({ updatedAt: 1000 - index }))
    expect(Object.keys(store.projects)).toHaveLength(MAX_PROJECTS)
    // The newest write stays even though its updatedAt is the lowest; the oldest others go.
    expect(projectOf(store, `/p${MAX_PROJECTS + 1}`).updatedAt).toBe(1000 - MAX_PROJECTS - 1)
    expect(Object.hasOwn(store.projects, '/p0')).toBe(true)
    expect(Object.hasOwn(store.projects, `/p${MAX_PROJECTS - 1}`)).toBe(false)
    expect(Object.hasOwn(store.projects, `/p${MAX_PROJECTS}`)).toBe(false)
    expect(Object.keys(parseProgress(JSON.parse(JSON.stringify({ v: 1, projects: { ...store.projects, '/extra': project({ updatedAt: 1 }) } }))).projects)).toHaveLength(MAX_PROJECTS)
  })

  test('level up after two strong rounds, down after a weak one, clamped', async () => {
    const strong = scored(['right', 'right', 'right', 'right', 'wrong'], 1)
    expect(nextLevel(project(), strong)).toEqual({ level: 1, streak: 1 })
    expect(nextLevel(project({ streak: 1 }), strong)).toEqual({ level: 2, streak: 0 })
    expect(nextLevel(project({ level: 3, streak: 1 }), strong)).toEqual({ level: 3, streak: 0 })
    // Two hints, or a partial counted as not right, break the streak.
    expect(nextLevel(project({ streak: 1 }), scored(['right', 'right', 'right', 'right', 'right'], 2))).toEqual({ level: 1, streak: 0 })
    expect(nextLevel(project({ streak: 1 }), scored(['right', 'right', 'right', 'partial', 'wrong']))).toEqual({ level: 1, streak: 0 })
    // Three right of three scores 1 but is too short to count.
    expect(nextLevel(project({ streak: 1 }), scored(['right', 'right', 'right']))).toEqual({ level: 1, streak: 0 })
    const weak = scored(['right', 'right', 'wrong', 'wrong', 'skipped'])
    expect(nextLevel(project({ level: 3, streak: 1 }), weak)).toEqual({ level: 2, streak: 0 })
    expect(nextLevel(project({ level: 1 }), weak)).toEqual({ level: 1, streak: 0 })
    // Review rounds follow the same rules; a short one cannot qualify. Only retry passes are skipped.
    expect(nextLevel(project({ level: 2, streak: 1 }), { ...weak, source: 'review' })).toEqual({ level: 1, streak: 0 })
    expect(nextLevel(project({ level: 2, streak: 1 }), { ...scored(['right', 'right']), source: 'review' })).toEqual({ level: 2, streak: 0 })
    expect(nextLevel(project({ level: 2, streak: 1 }), { ...strong, isRetry: true })).toEqual({ level: 2, streak: 1 })
    const leveled = afterRound(project({ streak: 1, rounds: 3 }), strong, 5)
    expect([leveled.level, leveled.streak, leveled.rounds]).toEqual([2, 0, 4])
    const retried = afterRound(project({ rounds: 3 }), { ...weak, isRetry: true }, 5)
    expect(retried).toEqual(project({ rounds: 3, updatedAt: 5 }))
  })

  test('dueCards oldest first and capped', async () => {
    const deck = [card(choice('c'), 1, 5), card(choice('a'), 1, 2), card(choice('late'), 2, 9), card(choice('b'), 1, 3)]
    const held = project({ rounds: 5, deck })
    expect(dueCards(held, 5).map(due => due.question.id)).toEqual(['a', 'b', 'c'])
    expect(dueCards(held, 2).map(due => due.question.id)).toEqual(['a', 'b'])
    expect(dueCards(held, 0)).toEqual([])
    expect(dueCards(FRESH_PROJECT, 5)).toEqual([])
  })

  test('a full store serializes under 450 KB', async () => {
    // Every string at its B.2 cap, so the bound is proved for the worst card, not a friendly one.
    const widest = (id: string): ChoiceQuestion => ({
      id,
      kind: 'choice',
      tag: 'what-if',
      topic: 't'.repeat(32),
      prompt: 'p'.repeat(280),
      options: ['a', 'b', 'c', 'd'].map(letter => letter.repeat(120)),
      answer: 3,
      why: ['a', 'b', 'c', 'd'].map(letter => letter.repeat(220)),
      hint: 'h'.repeat(140),
      file: 'f'.repeat(200),
      symbol: 's'.repeat(60),
    })
    const full = (index: number): TutorProject =>
      project({
        level: 3,
        rounds: 1_000_000,
        streak: 1,
        updatedAt: 1_700_000_000_000 + index,
        deck: Array.from({ length: MAX_DECK }, (_, slot) => card(widest(`round-${index}-${'x'.repeat(24)}:${slot}`), 3, 1_000_000 + slot)),
        mastered: Array.from({ length: 20 }, (_, slot) => `${slot}`.padEnd(32, 'm')),
        recentMisses: Array.from({ length: MAX_MISSES }, (_, slot) => `${slot}`.padEnd(32, 'r')),
      })
    let store: TutorProgressStore = { v: 1, projects: {} }
    for (let index = 0; index < MAX_PROJECTS; index++) store = withProject(store, `/Users/someone/projects/${'d'.repeat(60)}/${index}`, full(index))
    const bytesOf = (value: TutorProgressStore): number => new TextEncoder().encode(JSON.stringify(value)).length
    expect(bytesOf(store)).toBeLessThan(MAX_STORE_BYTES)
    expect(MAX_STORE_BYTES).toBeLessThanOrEqual(450_000)
    // Maximal cards are about 2.3 KB each, so nine projects fit and only the least recent three go.
    expect(Object.keys(store.projects)).toHaveLength(9)
    expect(bytesOf({ v: 1, projects: { ...store.projects, '/dropped': full(2) } })).toBeGreaterThanOrEqual(MAX_STORE_BYTES)
    // The latest project is never the one dropped to fit, and what is kept parses back unchanged.
    expect(projectOf(store, `/Users/someone/projects/${'d'.repeat(60)}/${MAX_PROJECTS - 1}`).deck).toHaveLength(MAX_DECK)
    expect(parseProgress(JSON.parse(JSON.stringify(store)))).toEqual(store)
  })
})
