import type { TutorCode } from '../types'
import { safeText } from './fileTree'

/** Lines a code card shows at most. */
export const CODE_WINDOW = 16
/** Characters a code card's diff holds at most, its `@@` header included. */
export const CODE_MAX_CHARS = 1_600
/** Characters one diff line holds at most, its marker included; the digest masks lines to this too. */
export const CODE_LINE_MAX = 300

/** A hunk line's marker: context, added or removed. */
export type HunkMarker = ' ' | '+' | '-'

/**
 * One line of a hunk. `oldAt` and `newAt` are the line's number on each side, or for the side
 * it is not on, the number the next line there has; so a window can rebuild its own header.
 */
export type HunkLine = { readonly marker: HunkMarker; readonly text: string; readonly oldAt: number; readonly newAt: number }

/** One `@@` hunk's lines, as far as the text held them. */
export type Hunk = { readonly lines: readonly HunkLine[] }

/** A line a quote matched: its hunk, its index in that hunk and its number as shown. */
export type QuoteMatch = { readonly hunk: number; readonly line: number; readonly number: number }

/** The hunks the round may draw from for a file; empty when there are none. */
export type CodeLookup = (file: string) => readonly Hunk[]

/** A lookup with nothing in it: every anchor is unresolvable. */
export const NO_CODE: CodeLookup = () => []

// Nine digits keep every number a safe integer; a real file never has a billion lines.
const HUNK_HEADER = /^@@ -(\d{1,9})(?:,(\d{1,9}))? \+(\d{1,9})(?:,(\d{1,9}))? @@/

const countOf = (text: string | undefined): number => (text === undefined ? 1 : Number(text))

/**
 * The hunks in a unified diff, or in one file's body of it. A hunk takes lines while its header's
 * counts allow, so whatever follows it (a `… (cut)` mark, the next file's header) is not read as
 * code; a hunk the text cut short keeps the lines it has. `\ No newline` lines are skipped and an
 * empty line counts as empty context, as some tools strip the space. Text that is no diff (a new
 * file's plain excerpt) has no hunks.
 */
export const parseHunks = (text: string): readonly Hunk[] => {
  const hunks: Hunk[] = []
  let lines: HunkLine[] | null = null
  let oldLeft = 0
  let newLeft = 0
  let oldNext = 0
  let newNext = 0
  const close = (): void => {
    if (lines !== null && lines.length > 0) hunks.push({ lines })
    lines = null
  }
  for (const raw of text.split(/\r?\n/)) {
    const header = HUNK_HEADER.exec(raw)
    if (header !== null) {
      close()
      const oldCount = countOf(header[2])
      const newCount = countOf(header[4])
      // A side with no lines names the line before the change, so its next line is one on.
      oldNext = Number(header[1]) + (oldCount === 0 ? 1 : 0)
      newNext = Number(header[3]) + (newCount === 0 ? 1 : 0)
      oldLeft = oldCount
      newLeft = newCount
      lines = []
      continue
    }
    if (lines === null) continue
    if (raw.startsWith('\\')) continue
    const marker = raw === '' ? ' ' : raw.charAt(0)
    const isOld = marker === ' ' || marker === '-'
    const isNew = marker === ' ' || marker === '+'
    if ((!isOld && !isNew) || (isOld && oldLeft === 0) || (isNew && newLeft === 0)) {
      close()
      continue
    }
    lines.push({ marker: marker === ' ' ? ' ' : marker === '+' ? '+' : '-', text: raw.slice(1), oldAt: oldNext, newAt: newNext })
    if (isOld) {
      oldNext += 1
      oldLeft -= 1
    }
    if (isNew) {
      newNext += 1
      newLeft -= 1
    }
    if (oldLeft === 0 && newLeft === 0) close()
  }
  close()
  return hunks
}

/** A line's number as a reader sees it: the new side's, or the old side's for a removed line. */
export const shownNumber = (line: HunkLine): number => (line.marker === '-' ? line.oldAt : line.newAt)

/** Code compared loosely: runs of whitespace are one space, ends trimmed. */
const normalized = (text: string): string => text.replace(/\s+/g, ' ').trim()

const matchIn = (hunks: readonly Hunk[], wanted: string): QuoteMatch | null => {
  for (const [hunkIndex, hunk] of hunks.entries()) {
    const line = hunk.lines.findIndex(held => normalized(held.text) === wanted)
    const found = hunk.lines[line]
    if (found !== undefined) return { hunk: hunkIndex, line, number: shownNumber(found) }
  }
  return null
}

/**
 * The first line whose text, without its marker, equals the quote once whitespace is collapsed
 * on both; a repeated line resolves to its first copy. Removed lines match too. A quote the
 * model wrote with its `+`/`-` marker still finds its line when the marked text matches nothing.
 */
export const findQuote = (hunks: readonly Hunk[], quote: string): QuoteMatch | null => {
  const wanted = normalized(quote)
  if (wanted === '') return null
  const exact = matchIn(hunks, wanted)
  if (exact !== null) return exact
  const unmarked = /^[+-]\s*\S/.test(wanted) ? normalized(wanted.slice(1)) : ''
  return unmarked === '' ? null : matchIn(hunks, unmarked)
}

/** Cuts to `max` UTF-16 units without splitting a surrogate pair. */
const cut = (text: string, max: number): string => {
  if (text.length <= max) return text
  const end = /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? max - 1 : max
  return text.slice(0, end)
}

/**
 * One diff line made fit for `<Code>`: tab is the only control character kept (Code draws it,
 * where Text would not), every other one is replaced, and the line is cut to CODE_LINE_MAX.
 */
export const codeLine = (line: string): string => cut(line.split('\t').map(safeText).join('\t'), CODE_LINE_MAX)

const headerOf = (lines: readonly HunkLine[]): string => {
  const first = lines[0]
  if (first === undefined) return ''
  const oldCount = lines.filter(line => line.marker !== '+').length
  const newCount = lines.filter(line => line.marker !== '-').length
  // The inverse of parseHunks: a side with no lines names the line before.
  const oldStart = first.oldAt - (oldCount === 0 ? 1 : 0)
  const newStart = first.newAt - (newCount === 0 ? 1 : 0)
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`
}

const render = (lines: readonly HunkLine[]): string => [headerOf(lines), ...lines.map(line => codeLine(`${line.marker}${line.text}`))].join('\n')

/**
 * A window of a hunk around the lines at `indices`, as a diff with its own `@@` header so `<Code>`
 * parses it. It holds every index (null when they span more than `maxLines`, or one is out of
 * range), is centred on them, and shrinks until it fits CODE_MAX_CHARS; lines are never cut out
 * of the middle, since a hunk missing a line no longer parses.
 */
export const codeWindow = (hunk: Hunk, indices: readonly number[], maxLines: number = CODE_WINDOW): string | null => {
  const count = hunk.lines.length
  if (indices.length === 0 || indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)) return null
  const low = Math.min(...indices)
  const high = Math.max(...indices)
  const span = high - low + 1
  for (let size = Math.min(maxLines, count); size >= span; size -= 1) {
    const before = Math.floor((size - span) / 2)
    const start = Math.max(0, Math.min(low - before, count - size))
    const diff = render(hunk.lines.slice(start, start + size))
    if (diff.length <= CODE_MAX_CHARS) return diff
  }
  return null
}

/** The code card for a quoted line: the window around its first match, or null when it matches nothing. */
export const quoteCode = (file: string, hunks: readonly Hunk[], quote: string): TutorCode | null => {
  const match = findQuote(hunks, quote)
  const hunk = match === null ? undefined : hunks[match.hunk]
  if (match === null || hunk === undefined) return null
  const diff = codeWindow(hunk, [match.line])
  return diff === null ? null : { file, diff, focusLine: match.number }
}

/** A hunk line's text as its window draws it: cut with its marker, so it is always a line of the card. */
const drawnText = (line: HunkLine | undefined): string => (line === undefined ? '' : codeLine(`${line.marker}${line.text}`).slice(1))

/** One option of a line question as its hunk holds it: where the option was, its line's text, its shown number. */
export type LinePick = { readonly from: number; readonly text: string; readonly number: number }

/**
 * A line question's card: one window holding every option's line, and each option's line in the
 * order the hunk shows them, so the card and the buttons read top to bottom alike.
 */
export type LineCode = { readonly code: TutorCode; readonly lineNumbers: readonly number[]; readonly picks: readonly LinePick[] }

/**
 * The card for a line question: the first hunk that holds every option as a distinct line, cut
 * to a window holding them all. Null when no hunk does or the lines span too far. `lineNumbers`
 * follows the options' order and `picks` the hunk's; each pick's text is the hunk's own line,
 * exactly as the window draws it minus the marker, so what is drawn never comes from the model.
 * `focusLine` is the first option line in file order, so opening the file there gives no answer away.
 */
export const lineCode = (file: string, hunks: readonly Hunk[], options: readonly string[]): LineCode | null => {
  for (const hunk of hunks) {
    const matches = options.map(option => findQuote([hunk], option))
    if (!matches.every((match): match is QuoteMatch => match !== null)) continue
    const indices = matches.map(match => match.line)
    if (new Set(indices).size !== indices.length) continue
    const diff = codeWindow(hunk, indices)
    if (diff === null) continue
    const lineNumbers = matches.map(match => match.number)
    const picks = matches
      .map((match, from) => ({ from, at: match.line, text: drawnText(hunk.lines[match.line]), number: match.number }))
      .sort((a, b) => a.at - b.at)
      .map(({ from, text, number }) => ({ from, text, number }))
    return { code: { file, diff, focusLine: Math.min(...lineNumbers) }, lineNumbers, picks }
  }
  return null
}

/**
 * Whether stored text is a diff this module could have made: one hunk whose header parses and
 * whose counts cover every line after it, at most CODE_WINDOW lines and CODE_MAX_CHARS, each
 * line already as `codeLine` leaves it. Anything else was hand-edited and is not drawn.
 */
export const isCodeDiff = (diff: string): boolean => {
  if (diff.length > CODE_MAX_CHARS) return false
  const lines = diff.split('\n')
  const body = lines.slice(1)
  if (!HUNK_HEADER.test(lines[0] ?? '') || body.length === 0 || body.length > CODE_WINDOW) return false
  if (!body.every(line => line !== '' && codeLine(line) === line)) return false
  const hunks = parseHunks(diff)
  return hunks.length === 1 && hunks[0]?.lines.length === body.length && headerOf(hunks[0].lines) === lines[0]
}

/** The numbers a stored diff shows, line by line; empty when it is not one hunk. */
export const codeNumbers = (diff: string): readonly number[] => {
  const hunks = parseHunks(diff)
  return hunks.length === 1 ? (hunks[0]?.lines ?? []).map(shownNumber) : []
}
