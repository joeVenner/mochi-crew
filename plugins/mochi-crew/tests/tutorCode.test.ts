import { describe, expect, test } from 'claude-code/testing'

import { CODE_LINE_MAX, CODE_MAX_CHARS, CODE_WINDOW, NO_CODE, codeLine, codeNumbers, codeWindow, findQuote, isCodeDiff, lineCode, parseHunks, quoteCode, shownNumber } from '../hooks/tutorCode'
import type { Hunk } from '../hooks/tutorCode'

const EXCERPT = [
  '@@ -10,4 +10,5 @@ export const a = 1',
  ' const keep = 1',
  '-const old = 2',
  '+const fresh = 2',
  '+const extra = 3',
  ' const tail = 4',
  ' const end = 5',
  '@@ -40,2 +41,2 @@',
  ' const keep = 1',
  '-  return   old',
  '+  return fresh',
  '… (cut)',
].join('\n')

const only = (hunks: readonly Hunk[]): Hunk => {
  const [hunk] = hunks
  if (hunks.length !== 1 || hunk === undefined) throw new Error(`expected one hunk, got ${hunks.length}`)
  return hunk
}

/** A hunk of `count` context lines numbered from `start`, each `width` characters wide. */
const contextHunk = (count: number, start = 1, width = 10): Hunk =>
  only(parseHunks([`@@ -${start},${count} +${start},${count} @@`, ...Array.from({ length: count }, (_, i) => ` ${`line${i}`.padEnd(width, '.')}`)].join('\n')))

describe('tutor code', () => {
  test('parseHunks numbers both sides and stops at each header count', async () => {
    const hunks = parseHunks(EXCERPT)
    expect(hunks).toHaveLength(2)
    const [first, second] = hunks
    expect(first?.lines.map(line => [line.marker, line.text, shownNumber(line)])).toEqual([
      [' ', 'const keep = 1', 10],
      ['-', 'const old = 2', 11],
      ['+', 'const fresh = 2', 11],
      ['+', 'const extra = 3', 12],
      [' ', 'const tail = 4', 13],
      [' ', 'const end = 5', 14],
    ])
    // The cut mark after the last hunk's counts is not code.
    expect(second?.lines.map(line => line.text)).toEqual(['const keep = 1', '  return   old', '  return fresh'])
    expect(second?.lines.map(shownNumber)).toEqual([41, 41, 42])
  })

  test('parseHunks reads a new file, no-count headers and a hunk cut short', async () => {
    const added = only(parseHunks('@@ -0,0 +1,3 @@\n+one\n+two\n+three'))
    expect(added.lines.map(shownNumber)).toEqual([1, 2, 3])
    expect(added.lines.map(line => line.oldAt)).toEqual([1, 1, 1])
    const single = only(parseHunks('@@ -5 +5 @@\n-was\n+now'))
    expect(single.lines.map(line => [line.marker, shownNumber(line)])).toEqual([['-', 5], ['+', 5]])
    const deleted = only(parseHunks('@@ -1,2 +0,0 @@\n-gone\n-also gone'))
    expect(deleted.lines.map(shownNumber)).toEqual([1, 2])
    // Masking cut the text mid-hunk: the lines that arrived are kept.
    expect(only(parseHunks('@@ -1,9 +1,9 @@\n a\n b')).lines).toHaveLength(2)
    expect(only(parseHunks('@@ -1,2 +1,2 @@\n-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file')).lines.map(line => line.text)).toEqual(['x', 'y'])
    expect(only(parseHunks('@@ -1,3 +1,3 @@\n a\n\n c')).lines.map(line => [line.marker, line.text])).toEqual([[' ', 'a'], [' ', ''], [' ', 'c']])
  })

  test('parseHunks finds nothing in text that is not a diff', async () => {
    expect(parseHunks('')).toEqual([])
    expect(parseHunks('file: src/new.ts (new)\nexport const a = 1')).toEqual([])
    expect(parseHunks('@@ not a header @@\n+x')).toEqual([])
    expect(parseHunks('@@ -1,1 +1,1 @@')).toEqual([])
    // A line with no valid marker ends the hunk; what follows is not read as code.
    expect(only(parseHunks('@@ -1,3 +1,3 @@\n a\n?junk\n b')).lines.map(line => line.text)).toEqual(['a'])
    // A side already used up ends the hunk too.
    expect(only(parseHunks('@@ -1,1 +1,2 @@\n-x\n-y\n+z')).lines.map(line => line.text)).toEqual(['x'])
    expect(parseHunks('@@ -9999999999,1 +1,1 @@\n a')).toEqual([])
  })

  test('findQuote matches loosely on whitespace, removed lines and a stray marker', async () => {
    const hunks = parseHunks(EXCERPT)
    expect(findQuote(hunks, 'const fresh = 2')).toEqual({ hunk: 0, line: 2, number: 11 })
    expect(findQuote(hunks, '  const    extra =  3 ')).toEqual({ hunk: 0, line: 3, number: 12 })
    // A removed line reports its old-side number.
    expect(findQuote(hunks, 'return old')).toEqual({ hunk: 1, line: 1, number: 41 })
    expect(findQuote(hunks, '+const extra = 3')).toEqual({ hunk: 0, line: 3, number: 12 })
    // Ambiguous: the first copy wins.
    expect(findQuote(hunks, 'const keep = 1')).toEqual({ hunk: 0, line: 0, number: 10 })
  })

  test('findQuote refuses blanks, partial lines and missing text', async () => {
    const hunks = parseHunks(EXCERPT)
    expect(findQuote(hunks, '')).toBeNull()
    expect(findQuote(hunks, '   ')).toBeNull()
    expect(findQuote(hunks, 'const fresh')).toBeNull()
    expect(findQuote(hunks, 'const Fresh = 2')).toBeNull()
    expect(findQuote([], 'const fresh = 2')).toBeNull()
    expect(findQuote(hunks, '+')).toBeNull()
  })

  test('codeWindow rebuilds a header that parses back to the same lines', async () => {
    const [first, second] = parseHunks(EXCERPT)
    if (first === undefined || second === undefined) throw new Error('expected two hunks')
    const whole = codeWindow(first, [2])
    expect(whole?.split('\n')[0]).toBe('@@ -10,4 +10,5 @@')
    expect(only(parseHunks(whole ?? '')).lines).toEqual(first.lines)
    // A two-line window from the middle: one removed and one added line.
    const middle = codeWindow(first, [1, 2], 2)
    expect(middle).toBe('@@ -11,1 +11,1 @@\n-const old = 2\n+const fresh = 2')
    // Added lines only: the old side is empty and names the line before.
    const addedOnly = codeWindow(first, [2, 3], 2)
    expect(addedOnly).toBe('@@ -11,0 +11,2 @@\n+const fresh = 2\n+const extra = 3')
    expect(only(parseHunks(addedOnly ?? '')).lines).toEqual(first.lines.slice(2, 4))
    const tail = codeWindow(second, [2], 1)
    expect(only(parseHunks(tail ?? '')).lines).toEqual(second.lines.slice(2))
    for (const diff of [whole, middle, addedOnly, tail]) expect(isCodeDiff(diff ?? '')).toBe(true)
  })

  test('codeWindow centres on its lines and keeps them all, or gives up', async () => {
    const hunk = contextHunk(40)
    const centred = codeWindow(hunk, [20])
    const numbers = codeNumbers(centred ?? '')
    expect(numbers).toHaveLength(CODE_WINDOW)
    expect(numbers[0]).toBe(14)
    expect(numbers.includes(21)).toBe(true)
    // At the edges the window slides inward rather than shrinking.
    expect(codeNumbers(codeWindow(hunk, [0]) ?? '')).toEqual(Array.from({ length: CODE_WINDOW }, (_, i) => i + 1))
    expect(codeNumbers(codeWindow(hunk, [39]) ?? '').at(-1)).toBe(40)
    expect(codeNumbers(codeWindow(hunk, [5, 20]) ?? '')).toEqual(Array.from({ length: CODE_WINDOW }, (_, i) => i + 6))
    expect(codeWindow(hunk, [0, CODE_WINDOW])).toBeNull()
    expect(codeWindow(hunk, [])).toBeNull()
    expect(codeWindow(hunk, [40])).toBeNull()
    expect(codeWindow(hunk, [-1])).toBeNull()
    expect(codeWindow(hunk, [1.5])).toBeNull()
  })

  test('codeWindow shrinks to fit the character cap and never cuts a needed line', async () => {
    // 16 lines of 200 characters is twice the cap: the window narrows around the line.
    const wide = contextHunk(30, 1, 200)
    const diff = codeWindow(wide, [15])
    expect((diff ?? '').length).toBeLessThanOrEqual(CODE_MAX_CHARS)
    expect(codeNumbers(diff ?? '').includes(16)).toBe(true)
    expect(isCodeDiff(diff ?? '')).toBe(true)
    // Lines over the per-line cap are cut, so the diff still parses.
    const long = only(parseHunks(`@@ -1,1 +1,1 @@\n+${'x'.repeat(500)}`))
    expect(codeWindow(long, [0])?.split('\n')[1]).toHaveLength(CODE_LINE_MAX)
    // Options too far apart for the cap: nothing.
    expect(codeWindow(wide, [0, 12])).toBeNull()
  })

  test('codeLine keeps tabs and replaces every other control character', async () => {
    expect(codeLine('+\tconst a = 1')).toBe('+\tconst a = 1')
    expect(codeLine('+a\u001b[31mb\u0007‮')).toBe('+a?[31mb??')
    expect(codeLine(`+${'😀'.repeat(200)}`).length).toBeLessThanOrEqual(CODE_LINE_MAX)
    expect(codeLine(`+${'😀'.repeat(200)}`)).not.toMatch(/[\uD800-\uDBFF]$/)
    const hunk = only(parseHunks('@@ -1,1 +1,1 @@\n+a\u0000b'))
    expect(codeWindow(hunk, [0])).toBe('@@ -0,0 +1,1 @@\n+a?b')
  })

  test('quoteCode cuts the window around the quote and names its line', async () => {
    const code = quoteCode('src/a.ts', parseHunks(EXCERPT), 'return old')
    expect(code?.file).toBe('src/a.ts')
    expect(code?.focusLine).toBe(41)
    expect(code?.diff.split('\n')[0]).toBe('@@ -40,2 +41,2 @@')
    expect(quoteCode('src/a.ts', parseHunks(EXCERPT), 'nowhere')).toBeNull()
    expect(quoteCode('src/a.ts', NO_CODE('src/a.ts'), 'return old')).toBeNull()
  })

  test('lineCode needs every option in one hunk, each on its own line', async () => {
    const hunks = parseHunks(EXCERPT)
    const found = lineCode('src/a.ts', hunks, ['const fresh = 2', 'const old = 2', 'const tail = 4'])
    expect(found?.lineNumbers).toEqual([11, 11, 13])
    expect(found?.code.focusLine).toBe(11)
    expect(codeNumbers(found?.code.diff ?? '')).toEqual([10, 11, 11, 12, 13, 14])
    // The second hunk holds both: the first hunk's `const keep` copy is not enough on its own.
    expect(lineCode('src/a.ts', hunks, ['const keep = 1', 'return fresh'])?.lineNumbers).toEqual([41, 42])
    // Split over two hunks, or missing, or two options on one line: no card.
    expect(lineCode('src/a.ts', hunks, ['const fresh = 2', 'return fresh'])).toBeNull()
    expect(lineCode('src/a.ts', hunks, ['const fresh = 2', 'nowhere'])).toBeNull()
    expect(lineCode('src/a.ts', hunks, ['const fresh = 2', 'const  fresh = 2'])).toBeNull()
    expect(lineCode('src/a.ts', [contextHunk(40)], ['line0.....', 'line30....'])).toBeNull()
  })

  test('isCodeDiff accepts only one well-formed capped hunk', async () => {
    expect(isCodeDiff('@@ -1,2 +1,2 @@\n-a\n+b\n c')).toBe(true)
    expect(isCodeDiff('@@ -0,0 +1,1 @@\n+\tindented')).toBe(true)
    expect(isCodeDiff('')).toBe(false)
    expect(isCodeDiff('@@ -1,2 +1,2 @@')).toBe(false)
    // Counts that do not cover the lines, two hunks, a header not in the rebuilt shape.
    expect(isCodeDiff('@@ -1,1 +1,1 @@\n-a\n+b\n c')).toBe(false)
    expect(isCodeDiff('@@ -1,1 +1,1 @@\n-a\n+b\n@@ -5,1 +5,1 @@\n c')).toBe(false)
    expect(isCodeDiff('@@ -1 +1 @@\n-a\n+b')).toBe(false)
    expect(isCodeDiff('@@ -1,1 +1,1 @@ fn\n-a\n+b')).toBe(false)
    // A control character or an over-long line was hand-edited in.
    expect(isCodeDiff('@@ -1,1 +1,1 @@\n-a\u001b\n+b')).toBe(false)
    expect(isCodeDiff(`@@ -0,0 +1,1 @@\n+${'x'.repeat(CODE_LINE_MAX)}`)).toBe(false)
    const lines = Array.from({ length: CODE_WINDOW + 1 }, (_, i) => ` l${i}`)
    expect(isCodeDiff([`@@ -1,${lines.length} +1,${lines.length} @@`, ...lines].join('\n'))).toBe(false)
    expect(isCodeDiff(`@@ -1,1 +1,1 @@\n ${'x'.repeat(CODE_MAX_CHARS)}`)).toBe(false)
  })

  test('codeNumbers is empty for anything but one hunk', async () => {
    expect(codeNumbers('nothing')).toEqual([])
    expect(codeNumbers('@@ -1,1 +1,1 @@\n a\n@@ -3,1 +3,1 @@\n b')).toEqual([])
    expect(codeNumbers('@@ -3,1 +3,2 @@\n-a\n+b\n+c')).toEqual([3, 3, 4])
  })
})
