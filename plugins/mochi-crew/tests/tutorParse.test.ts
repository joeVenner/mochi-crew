import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, TutorQuestion } from '../types'
import { MASK } from '../hooks/redact'
import { MAX_REPLY_CHARS, QUIZ_CAPS, extractJsonObject, parseGrade, parseRound, shuffleChoice } from '../hooks/tutorParse'
import type { ParseOutcome } from '../hooks/tutorParse'

type RawQuestion = Readonly<Record<string, unknown>>

const ALLOWED: ReadonlySet<string> = new Set(['hooks/register.tsx', 'hooks/fileTree.ts'])

const choice = (over: RawQuestion = {}): RawQuestion => ({
  kind: 'choice',
  tag: 'why',
  topic: 'worktree locks',
  file: 'hooks/register.tsx',
  symbol: 'gitOutput',
  prompt: 'Why does gitOutput pass --no-optional-locks?',
  options: ['So a read never takes the index lock', 'To speed up the diff', 'To skip hooks', 'To follow symlinks'],
  answer: 0,
  why: ['Right: a lock would block your own git.', 'Wrong: speed is unchanged.', 'Wrong: no hooks run here.', 'Wrong: unrelated.'],
  hint: 'Think about two git processes at once.',
  ...over,
})

const explain = (over: RawQuestion = {}): RawQuestion => ({
  kind: 'explain',
  tag: 'how',
  topic: 'worktree tree',
  file: 'hooks/fileTree.ts',
  symbol: 'placeFile',
  prompt: 'In your own words: how does placeFile choose a section?',
  reference: 'It matches the path against each linked worktree root, longest first.',
  keyPoints: ['matches worktree roots', 'longest root wins'],
  hint: 'Look at the sort.',
  ...over,
})

const reply = (questions: readonly unknown[], over: RawQuestion = {}): string => JSON.stringify({ v: 1, questions, ...over })
const fiveQuestions = (): readonly RawQuestion[] => [choice(), choice(), explain(), choice(), choice()]

const parse = (text: string, want = 5, seed = 0): ParseOutcome => parseRound(text, 'r7', ALLOWED, want, seed)

const questionsOf = (outcome: ParseOutcome): readonly TutorQuestion[] => {
  if (!outcome.isValid) throw new Error(`expected a valid round, got ${outcome.why}`)
  return outcome.questions
}

const whyOf = (outcome: ParseOutcome): string => (outcome.isValid ? 'valid' : outcome.why)

/** Three good questions plus one under test, so the round stays valid and the fourth can be inspected. */
const withFourth = (fourth: RawQuestion): ParseOutcome => parse(reply([explain(), explain(), explain(), fourth]))

const asChoice = (question: TutorQuestion | undefined): ChoiceQuestion => {
  if (question?.kind !== 'choice') throw new Error('expected a choice question')
  return question
}

describe('tutor parse', () => {
  test('parses a valid five-question round with local ids', async () => {
    const outcome = parse(reply(fiveQuestions()))
    const questions = questionsOf(outcome)
    expect(questions.map(question => question.id)).toEqual(['r7:0', 'r7:1', 'r7:2', 'r7:3', 'r7:4'])
    expect(questions.map(question => question.kind)).toEqual(['choice', 'choice', 'explain', 'choice', 'choice'])
    expect(outcome.isValid && outcome.dropped).toBe(0)
    const first = asChoice(questions[0])
    expect(first.topic).toBe('worktree locks')
    expect(first.file).toBe('hooks/register.tsx')
    expect(first.symbol).toBe('gitOutput')
    expect(first.options[first.answer]).toBe('So a read never takes the index lock')
    expect(first.why[first.answer]).toBe('Right: a lock would block your own git.')
    const third = questions[2]
    expect(third?.kind === 'explain' ? third.keyPoints : []).toEqual(['matches worktree roots', 'longest root wins'])
  })

  test('extracts JSON from a fence with prose around it', async () => {
    const body = reply(fiveQuestions())
    const text = `Here is your quiz {as asked}:\n\`\`\`json\n${body}\n\`\`\`\nGood luck.`
    expect(extractJsonObject(text)).toBe(body)
    expect(questionsOf(parse(text))).toHaveLength(5)
    expect(extractJsonObject(`Sure. ${body} Done.`)).toBe(body)
    const codeFirst = `Context:\n\`\`\`ts\nconst run = () => {}\n\`\`\`\nQuiz:\n\`\`\`json\n${body}\n\`\`\``
    expect(extractJsonObject(codeFirst)).toBe(body)
    // A stray unclosed brace in the prose must not hide the reply behind it.
    expect(extractJsonObject(`Using the { pattern from before:\n${body}`)).toBe(body)
    // A reply whose own string holds a fence still comes out whole.
    const fenced = reply([choice({ prompt: 'What does ``` start in markdown?' }), choice(), choice()])
    expect(extractJsonObject(`\`\`\`json\n${fenced}\n\`\`\``)).toBe(fenced)
    // Only the first MAX_REPLY_CHARS are read, so a huge unclosed reply gives up.
    expect(extractJsonObject(`\`\`\`json\n{"v":1,"a":"${'x'.repeat(MAX_REPLY_CHARS * 5)}"}`)).toBeNull()
  })

  test('a brace inside a string does not end the object', async () => {
    const tricky = choice({ prompt: 'Why is "}" with \\"{ quotes\\" safe here?' })
    const body = reply([tricky, choice(), choice()])
    expect(extractJsonObject(`${body} trailing }`)).toBe(body)
    expect(questionsOf(parse(body))[0]?.prompt).toBe('Why is "}" with \\"{ quotes\\" safe here?')
    expect(extractJsonObject('{"a":"\\\\"}')).toBe('{"a":"\\\\"}')
    expect(extractJsonObject('{"a": "unclosed }')).toBeNull()
  })

  test('no-json, bad-json, too-long, bad-version, bad-shape and too-few', async () => {
    expect(whyOf(parse('I cannot write a quiz today.'))).toBe('no-json')
    expect(whyOf(parse('{"v":1, questions: []}'))).toBe('bad-json')
    expect(whyOf(parse(`${reply(fiveQuestions())}${' '.repeat(MAX_REPLY_CHARS)}`))).toBe('too-long')
    expect(whyOf(parse(reply(fiveQuestions(), { v: 2 })))).toBe('bad-version')
    expect(whyOf(parse('{"questions":[]}'))).toBe('bad-version')
    expect(whyOf(parse('{"v":1,"questions":{}}'))).toBe('bad-shape')
    expect(whyOf(parse(reply([choice(), choice(), choice({ answer: 9 }), 'junk', null])))).toBe('too-few')
    expect(parse(reply([choice(), choice({ answer: 9 }), 'junk', null]))).toEqual({ isValid: false, why: 'too-few', valid: 1, dropped: 3 })
  })

  test('drops a question with a field over its cap', async () => {
    const overs: readonly RawQuestion[] = [
      choice({ topic: 'x'.repeat(QUIZ_CAPS.topic + 1) }),
      choice({ prompt: 'x'.repeat(QUIZ_CAPS.prompt + 1) }),
      choice({ prompt: 'short' }),
      choice({ options: ['a'.repeat(QUIZ_CAPS.option + 1), 'b', 'c', 'd'] }),
      choice({ why: ['w'.repeat(QUIZ_CAPS.why + 1), 'x', 'y', 'z'] }),
      choice({ hint: 'h'.repeat(QUIZ_CAPS.hint + 1) }),
      explain({ reference: 'r'.repeat(QUIZ_CAPS.reference + 1) }),
      explain({ keyPoints: ['k'.repeat(QUIZ_CAPS.keyPoint + 1)] }),
      explain({ keyPoints: ['a', 'b', 'c', 'd', 'e'] }),
      explain({ keyPoints: [] }),
      choice({ topic: '   ' }),
    ]
    for (const over of overs) {
      const outcome = withFourth(over)
      expect(questionsOf(outcome)).toHaveLength(3)
      expect(outcome.isValid && outcome.dropped).toBe(1)
    }
    expect(questionsOf(withFourth(choice({ topic: 'x'.repeat(QUIZ_CAPS.topic) })))).toHaveLength(4)
  })

  test('drops out-of-range answer, duplicate options and why-length mismatch', async () => {
    const broken: readonly RawQuestion[] = [
      choice({ answer: 4 }),
      choice({ answer: -1 }),
      choice({ answer: 1.5 }),
      choice({ answer: '0' }),
      choice({ options: ['Same thing', 'same  THING', 'c', 'd'] }),
      choice({ options: ['only one'], why: ['x'] }),
      choice({ options: ['a', 'b', 'c', 'd', 'e'], why: ['1', '2', '3', '4', '5'] }),
      choice({ why: ['one', 'two', 'three'] }),
      choice({ kind: 'essay' }),
    ]
    for (const over of broken) expect(questionsOf(withFourth(over))).toHaveLength(3)
    const trueFalse = asChoice(questionsOf(withFourth(choice({ options: ['True', 'False'], answer: 1, why: ['no', 'yes'] })))[3])
    expect(trueFalse.options[trueFalse.answer]).toBe('False')
  })

  test('coerces an unknown tag to how', async () => {
    const questions = questionsOf(withFourth(choice({ tag: 'trivia' })))
    expect(questions[3]?.tag).toBe('how')
    expect(questionsOf(withFourth(choice({ tag: 'what-if' })))[3]?.tag).toBe('what-if')
  })

  test('removes a hint that gives the answer away, keeps the question', async () => {
    const giveaway = questionsOf(withFourth(choice({ hint: 'Remember: so a read never  takes the INDEX lock.' })))
    expect(giveaway).toHaveLength(4)
    expect(giveaway[3]?.hint).toBeUndefined()
    expect(questionsOf(withFourth(choice()))[3]?.hint).toBe('Think about two git processes at once.')
  })

  test('removes a file outside the allowlist, keeps the question', async () => {
    const questions = questionsOf(withFourth(choice({ file: '../../etc/passwd', symbol: 'rm -rf; $(x)' })))
    expect(questions).toHaveLength(4)
    expect(questions[3]?.file).toBeUndefined()
    expect(questions[3]?.symbol).toBeUndefined()
    expect(questionsOf(withFourth(choice({ file: 'hooks/Register.tsx' })))[3]?.file).toBeUndefined()
    expect(questionsOf(withFourth(choice({ symbol: 's'.repeat(QUIZ_CAPS.symbol + 1) })))[3]?.symbol).toBeUndefined()
    expect(questionsOf(withFourth(choice({ symbol: 'Tree<T>#placeFile' })))[3]?.symbol).toBe('Tree<T>#placeFile')
  })

  test('strips control characters and masks echoed secrets', async () => {
    const question = questionsOf(
      withFourth(choice({ prompt: '  Why \u001b[31mred\u0007 and\nnext line?  ', topic: 'key sk-test-123456789abcdefgh' })),
    )[3]
    expect(question?.prompt).toBe('Why ?[31mred? and\nnext line?')
    const bidi = questionsOf(withFourth(choice({ prompt: 'Why \u202eevil\u202c and\r\nthis\u2028one?' })))[3]
    expect(bidi?.prompt).toBe('Why ?evil? and\nthis?one?')
    expect(question?.topic).toBe(`key ${MASK}`)
    expect(question?.topic.includes('sk-test')).toBe(false)
  })

  test('keeps only the wanted number', async () => {
    const seven = [choice(), choice(), choice(), choice(), choice(), choice(), choice()]
    const outcome = parse(reply(seven), 4)
    expect(questionsOf(outcome).map(question => question.id)).toEqual(['r7:0', 'r7:1', 'r7:2', 'r7:3'])
    // Only the first eight are examined: five broken, then good ones past the eighth do not count.
    const late = [...Array.from({ length: 6 }, () => choice({ answer: 9 })), choice(), choice(), choice(), choice()]
    expect(whyOf(parse(reply(late)))).toBe('too-few')
  })

  test('shuffleChoice is seeded and remaps answer and why together', async () => {
    const question = asChoice(questionsOf(parse(reply([choice(), choice(), choice()]), 3))[0])
    const orders = new Set<string>()
    for (let seed = 0; seed < 40; seed += 1) {
      const shuffled = shuffleChoice(question, seed)
      expect(shuffleChoice(question, seed)).toEqual(shuffled)
      expect([...shuffled.options].sort()).toEqual([...question.options].sort())
      expect(shuffled.options[shuffled.answer]).toBe(question.options[question.answer])
      for (const [index, option] of shuffled.options.entries()) {
        expect(shuffled.why[index]).toBe(question.why[question.options.indexOf(option)])
      }
      orders.add(shuffled.options.join('|'))
    }
    expect(orders.size).toBeGreaterThan(5)
    // parseRound shuffles question i with seed * 31 + i, so the same reply and seed replay identically.
    expect(parse(reply(fiveQuestions()), 5, 62)).toEqual(parse(reply(fiveQuestions()), 5, 62))
  })

  test('parseGrade accepts matching points, rejects a count mismatch and garbage', async () => {
    expect(parseGrade('{"v":1,"points":[true,false],"note":"Close: the longest root wins."}', 2)).toEqual({
      points: [true, false],
      note: 'Close: the longest root wins.',
    })
    expect(parseGrade('```json\n{"v":1,"points":[true],"note":"Good."}\n```', 1)).toEqual({ points: [true], note: 'Good.' })
    expect(parseGrade('{"v":1,"points":[true]}', 1)).toEqual({ points: [true], note: '' })
    expect(parseGrade(`{"v":1,"points":[true],"note":"${'n'.repeat(500)}"}`, 1)?.note).toHaveLength(200)
    expect(parseGrade('{"v":1,"points":[true],"note":"\\u001b[2J token ghp_dummyDummyDummyDummy1234"}', 1)?.note).toBe(`?[2J token ${MASK}`)
    expect(parseGrade('{"v":1,"points":[true,true,true],"note":"x"}', 2)).toBeNull()
    expect(parseGrade('{"v":1,"points":[true,"yes"],"note":"x"}', 2)).toBeNull()
    expect(parseGrade('{"v":2,"points":[true],"note":"x"}', 1)).toBeNull()
    expect(parseGrade('{"v":1,"points":true}', 1)).toBeNull()
    expect(parseGrade('All good, well done.', 1)).toBeNull()
    expect(parseGrade('{"v":1,"points":[true,}', 1)).toBeNull()
    expect(parseGrade('{"v":1,"points":[],"note":"x"}', 0)).toBeNull()
  })
})
