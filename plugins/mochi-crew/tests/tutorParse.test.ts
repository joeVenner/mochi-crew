import { describe, expect, test } from 'claude-code/testing'

import type { ChoiceQuestion, LineQuestion, TutorQuestion } from '../types'
import { afterRound, FRESH_PROJECT, parseProgress, projectOf, withProject } from '../hooks/tutorProgress'
import { MASK } from '../hooks/redact'
import { CODE_LINE_MAX, isCodeDiff, parseHunks } from '../hooks/tutorCode'
import type { CodeLookup } from '../hooks/tutorCode'
import { MAX_REPLY_CHARS, QUIZ_CAPS, anchoredFiles, cleanModelText, extractJsonObject, parseGrade, parseRound, shuffleChoice } from '../hooks/tutorParse'
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
    expect(whyOf(parse(reply(fiveQuestions(), { v: 3 })))).toBe('bad-version')
    expect(whyOf(parse(reply(fiveQuestions(), { v: '2' })))).toBe('bad-version')
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

  test('cleanModelText expands tabs instead of masking them', async () => {
    expect(cleanModelText('if (ok) {\n\treturn 1\n}')).toBe('if (ok) {\n  return 1\n}')
    expect(cleanModelText('a\t\tb')).toBe('a    b')
    // A reply of only tabs and spaces is blank, so the caller treats it as no reply.
    expect(cleanModelText(' \t\n\t\t ')).toBe('')
    // Other control characters are still replaced next to an expanded tab.
    expect(cleanModelText('\t\u0007bell')).toBe('?bell')
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

  describe('code cards (v2)', () => {
    const HUNK = [
      '@@ -10,4 +10,6 @@ export const gitOutput = () => {',
      ' const run = makeRunner()',
      "-const args = ['status']",
      "+const args = ['--no-optional-locks', 'status']",
      '+\tconst timeout = GIT_MS',
      ' return run(args, timeout)',
      ' }',
      '+export const done = true',
    ].join('\n')
    const LOOKUP: CodeLookup = file => (file === 'hooks/register.tsx' ? parseHunks(HUNK) : [])
    const v2 = (questions: readonly unknown[]): string => reply(questions, { v: 2 })
    const parseV2 = (text: string, lookup: CodeLookup = LOOKUP): ParseOutcome => parseRound(text, 'r7', ALLOWED, 5, 0, lookup)
    const fourthOf = (fourth: RawQuestion, lookup: CodeLookup = LOOKUP, v = 2): TutorQuestion | undefined =>
      questionsOf(parseRound(reply([explain(), explain(), explain(), fourth], { v }), 'r7', ALLOWED, 5, 0, lookup))[3]
    const line = (over: RawQuestion = {}): RawQuestion => ({
      kind: 'line',
      tag: 'how',
      topic: 'git locks',
      prompt: 'Which line keeps git from taking the index lock?',
      at: { file: 'hooks/register.tsx' },
      // The answer is first here but last in the file: the parser puts them in file order.
      options: ["const args = ['--no-optional-locks', 'status']", 'const run = makeRunner()', 'return run(args, timeout)'],
      answer: 0,
      why: ['Right: the flag is set here.', 'Wrong: this only builds the runner.', 'Wrong: this only runs it.'],
      hint: 'Look for a flag.',
      ...over,
    })
    const asLine = (question: TutorQuestion | undefined): LineQuestion => {
      if (question?.kind !== 'line') throw new Error('expected a line question')
      return question
    }

    test('v1 and v2 replies are both read; v1 ignores anchors and line questions', async () => {
      expect(questionsOf(parseV2(v2(fiveQuestions())))).toHaveLength(5)
      const anchored = choice({ at: { file: 'hooks/register.tsx', quote: 'const run = makeRunner()' } })
      expect(fourthOf(anchored, LOOKUP, 1)?.code).toBeUndefined()
      expect(fourthOf(anchored, LOOKUP, 2)?.code).toBeDefined()
      const old = parseRound(reply([explain(), explain(), explain(), line()]), 'r7', ALLOWED, 5, 0, LOOKUP)
      expect(questionsOf(old)).toHaveLength(3)
      expect(old.isValid && old.dropped).toBe(1)
    })

    test('a choice or explain anchor becomes a card drawn from the hunk', async () => {
      const question = fourthOf(choice({ file: undefined, at: { file: 'hooks/register.tsx', quote: '  return   run(args, timeout) ' } }))
      expect(question?.code?.file).toBe('hooks/register.tsx')
      expect(question?.code?.focusLine).toBe(13)
      expect(isCodeDiff(question?.code?.diff ?? '')).toBe(true)
      expect(question?.code?.diff).toContain('\tconst timeout = GIT_MS')
      // The card names its file, so the open action can follow it.
      expect(question?.file).toBe('hooks/register.tsx')
      // A removed line matches too, numbered on the old side.
      expect(fourthOf(explain({ at: { file: 'hooks/register.tsx', quote: "const args = ['status']" } }))?.code?.focusLine).toBe(11)
    })

    test('a bad anchor drops only the card', async () => {
      const bad: readonly unknown[] = [
        { file: 'hooks/register.tsx', quote: 'nowhere in the diff' },
        { file: 'hooks/fileTree.ts', quote: 'const run = makeRunner()' },
        { file: 'secret/other.ts', quote: 'const run = makeRunner()' },
        { file: 'hooks/register.tsx', quote: 'x'.repeat(CODE_LINE_MAX + 1) },
        { file: 'hooks/register.tsx', quote: 42 },
        { file: 'hooks/register.tsx' },
        'hooks/register.tsx',
        null,
      ]
      for (const at of bad) {
        const question = fourthOf(choice({ at }))
        expect(question?.kind).toBe('choice')
        expect(question?.code).toBeUndefined()
      }
      expect(fourthOf(choice({ at: { file: 'hooks/register.tsx', quote: 'const run = makeRunner()' } }), () => [])?.code).toBeUndefined()
    })

    test('the lookup is only asked about allowed files', async () => {
      const asked: string[] = []
      const spy: CodeLookup = file => {
        asked.push(file)
        return LOOKUP(file)
      }
      parseV2(v2([choice({ at: { file: '../../etc/passwd', quote: 'root' } }), line({ at: { file: 'secret/other.ts' } }), choice(), explain()]), spy)
      expect(asked).toEqual([])
    })

    test('a line question takes the hunk lines in file order, answer and why moved along', async () => {
      const question = asLine(fourthOf(line()))
      expect(question.options).toEqual(['const run = makeRunner()', "const args = ['--no-optional-locks', 'status']", 'return run(args, timeout)'])
      expect(question.options[question.answer]).toBe("const args = ['--no-optional-locks', 'status']")
      expect(question.why[question.answer]).toBe('Right: the flag is set here.')
      expect(question.why[0]).toBe('Wrong: this only builds the runner.')
      expect(question.lineNumbers).toEqual([10, 11, 13])
      expect(question.code.focusLine).toBe(10)
      expect(question.file).toBe('hooks/register.tsx')
      expect(question.hint).toBe('Look for a flag.')
      expect(isCodeDiff(question.code.diff)).toBe(true)
    })

    test('a line option is the diff text, never the model text', async () => {
      const question = asLine(fourthOf(line({ options: ['  const   run = makeRunner()  ', 'const timeout = GIT_MS'], answer: 1, why: ['Wrong.', 'Right.'] })))
      expect(question.options).toEqual(['const run = makeRunner()', 'const timeout = GIT_MS'])
      expect(question.answer).toBe(1)
      // A hint that quotes the answer line gives it away and is dropped.
      expect(fourthOf(line({ hint: "It is const args = ['--no-optional-locks', 'status']" }))?.hint).toBeUndefined()
    })

    test('a broken line question is dropped whole', async () => {
      const broken: readonly RawQuestion[] = [
        line({ answer: 3 }),
        line({ answer: -1 }),
        line({ answer: 0.5 }),
        line({ options: ['const run = makeRunner()'], why: ['x'] }),
        line({ options: ['a', 'b', 'c', 'd', 'e'], why: ['1', '2', '3', '4', '5'] }),
        line({ why: ['only one'] }),
        line({ options: ['const run = makeRunner()', 'export const done = true', 'nowhere'] }),
        line({ options: ['const run = makeRunner()', 'const  run = makeRunner()'], answer: 0, why: ['a', 'b'] }),
        line({ at: { file: 'hooks/fileTree.ts' } }),
        line({ at: { file: 'secret/other.ts' } }),
        line({ at: undefined }),
        line({ options: ['const run = makeRunner()', 'x'.repeat(CODE_LINE_MAX + 1)], answer: 0, why: ['a', 'b'] }),
      ]
      for (const question of broken) {
        const outcome = parseV2(v2([explain(), explain(), explain(), question]))
        expect(questionsOf(outcome)).toHaveLength(3)
        expect(outcome.isValid && outcome.dropped).toBe(1)
      }
      // Each option is in the diff, but in two different hunks: there is no one card to draw.
      const split: CodeLookup = () => parseHunks(`${HUNK}\n@@ -90,1 +92,1 @@\n-old tail\n+const tail = 1`)
      expect(questionsOf(parseV2(v2([explain(), explain(), explain(), line({ options: ['const run = makeRunner()', 'const tail = 1'], why: ['a', 'b'] })]), split))).toHaveLength(3)
      // With no hunks to resolve against, a line question cannot stand.
      expect(questionsOf(parseV2(v2([explain(), explain(), explain(), line()]), () => []))).toHaveLength(3)
    })

    test('dropped line questions can leave too few', async () => {
      const outcome = parseV2(v2([line(), line(), line({ answer: 9 }), choice()]), () => [])
      expect(whyOf(outcome)).toBe('too-few')
      expect(outcome.isValid ? -1 : outcome.dropped).toBe(3)
    })

    test('parsed code cards reload from the saved deck unchanged', async () => {
      const long = `const longName = ${'v'.repeat(CODE_LINE_MAX - 'const longName = '.length)}`
      // 296 characters with six tabs inside: 302 once each tab is two spaces.
      const tabbed = `const padded =\t\t\t\t\t${'w'.repeat(CODE_LINE_MAX - 4 - 'const padded ='.length - 5 - 2)}\t;`
      const hunk = ['@@ -1,1 +1,5 @@', ' const run = makeRunner()', `+${long}`, `+${tabbed}`, '+const short = 1', '+const other = 2'].join('\n')
      const lookup: CodeLookup = file => (file === 'hooks/register.tsx' ? parseHunks(hunk) : [])
      const outcome = parseRound(v2([
        choice({ at: { file: 'hooks/register.tsx', quote: 'const short = 1' } }),
        // A quote of a full 300-character line: the card draws it one short, marker included, and so does the option.
        line({ options: ['const run = makeRunner()', long], answer: 1, why: ['a', 'b'] }),
        // Quoted with spaces, it fits; expanded for the button, it would not: dropped, not cut.
        line({ options: ['const short = 1', tabbed.replaceAll('\t', ' ')], answer: 0, why: ['a', 'b'] }),
        line({ options: ['const short = 1', 'const other = 2'], answer: 0, why: ['a', 'b'] }),
        explain(),
      ]), 'r7', ALLOWED, 5, 0, lookup)
      expect(tabbed.length).toBe(296)
      const questions = questionsOf(outcome)
      expect(outcome.isValid && outcome.dropped).toBe(1)
      expect(questions.map(question => question.kind)).toEqual(['choice', 'line', 'line', 'explain'])
      expect(asLine(questions[1]).options[1]).toBe(long.slice(0, CODE_LINE_MAX - 1))
      expect(asLine(questions[1]).code.diff).toContain(`+${long.slice(0, CODE_LINE_MAX - 1)}\n`)
      const missed = afterRound(FRESH_PROJECT, {
        id: 'r7', epoch: 1, focus: 'recent', source: 'digest', startedAt: 0, questions, index: 0,
        answers: questions.map(question => ({ questionId: question.id, outcome: 'wrong', hasUsedHint: false })),
        isHintShown: false, isRetry: false, chat: [], followUpsUsed: 0, usage: { calls: 1, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 },
      }, 1)
      const store = withProject({ v: 1, projects: {} }, '/repo', missed)
      const back = projectOf(parseProgress(JSON.parse(JSON.stringify(store))), '/repo')
      expect(back.deck.map(held => held.question)).toEqual(questions)
    })

    test('anchoredFiles lists allowed anchors once, capped, and nothing for v1', async () => {
      const files = anchoredFiles(v2([
        line(),
        choice({ at: { file: 'hooks/register.tsx', quote: 'x' } }),
        choice({ at: { file: 'secret/other.ts', quote: 'x' } }),
        explain({ at: { file: 'hooks/fileTree.ts', quote: 'x' } }),
        choice(),
      ]), ALLOWED)
      expect(files).toEqual(['hooks/register.tsx', 'hooks/fileTree.ts'])
      const many = new Set(Array.from({ length: 8 }, (_, i) => `src/f${i}.ts`))
      expect(anchoredFiles(v2([...many].map(file => choice({ at: { file, quote: 'x' } }))), many)).toHaveLength(5)
      expect(anchoredFiles(reply([line()]), ALLOWED)).toEqual([])
      expect(anchoredFiles('not json', ALLOWED)).toEqual([])
    })
  })
})
