import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_JOURNAL, MAX_JOURNAL_FILES, journalLine, journalReport, record } from '../hooks/journal'
import { parseMascotCommand } from '../hooks/outfits'

describe('journal', () => {
  test('records turns, edits, commands, fixes and hires', async () => {
    const steps = [
      { kind: 'turn', durationMs: 30_000 },
      { kind: 'turn', durationMs: 35_000 },
      { kind: 'edit', file: '/r/a.ts', hasFailed: false },
      { kind: 'edit', file: '/r/b.ts', hasFailed: true },
      { kind: 'command', hasFailed: true },
      { kind: 'command', hasFailed: false },
      { kind: 'fix' },
      { kind: 'hire' },
      { kind: 'shipped' },
      { kind: 'green' },
    ] as const
    const journal = steps.reduce(record, EMPTY_JOURNAL)
    expect(journal).toEqual({
      turns: 2, shipped: 1, workingMs: 65_000, edits: 1, failedEdits: 1, commands: 2, failedCommands: 1, greenRuns: 1, fixes: 1, hires: 1, files: ['/r/a.ts'],
    })
  })

  test('a file edited again moves to the end once; the list is capped', async () => {
    let journal = EMPTY_JOURNAL
    for (const file of ['/a', '/b', '/a']) journal = record(journal, { kind: 'edit', file, hasFailed: false })
    expect(journal.files).toEqual(['/b', '/a'])
    expect(journal.edits).toBe(3)
    for (let i = 0; i < MAX_JOURNAL_FILES + 10; i += 1) journal = record(journal, { kind: 'edit', file: `/f${i}`, hasFailed: false })
    expect(journal.files.length).toBe(MAX_JOURNAL_FILES)
    expect(journal.files.at(-1)).toBe(`/f${MAX_JOURNAL_FILES + 9}`)
    expect(journalLine(journal)).toBe(`${MAX_JOURNAL_FILES}+ files`)
  })

  test('a negative turn length never subtracts time', async () => {
    expect(record(EMPTY_JOURNAL, { kind: 'turn', durationMs: -5 }).workingMs).toBe(0)
  })

  test('the HUD line appears once something happened', async () => {
    expect(journalLine(EMPTY_JOURNAL)).toBeNull()
    // Only non-zero parts: a lone command is not "0 files · 0 turns".
    expect(journalLine(record(EMPTY_JOURNAL, { kind: 'command', hasFailed: false }))).toBe('1 command')
    const journal = record(record(EMPTY_JOURNAL, { kind: 'turn', durationMs: 65_000 }), { kind: 'edit', file: '/x.ts', hasFailed: false })
    expect(journalLine(journal)).toBe('1 file · 1 turn · 1m 05s working')
  })

  test('the report lists counts and the latest file names only', async () => {
    expect(journalReport(EMPTY_JOURNAL)).toContain('nothing yet')
    let journal = record(EMPTY_JOURNAL, { kind: 'command', hasFailed: true })
    for (let i = 0; i < 10; i += 1) journal = record(journal, { kind: 'edit', file: `/deep/path/f${i}.ts`, hasFailed: false })
    const report = journalReport(journal)
    expect(report).toContain('Edits      10')
    expect(report).toContain('Commands   1 (1 failed, 0 fixed)')
    expect(report).toContain('f9.ts')
    expect(report).toContain('+2 more')
    expect(report).not.toContain('/deep/path')
  })

  test('/mascot journal parses; extra words are an error', async () => {
    expect(parseMascotCommand('journal')).toEqual({ kind: 'journal' })
    expect(parseMascotCommand('journal now').kind).toBe('error')
  })
})
