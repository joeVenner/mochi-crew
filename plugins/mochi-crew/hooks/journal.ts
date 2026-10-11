import type { Journal } from '../types'
import { fileName } from './mascot'
import { formatDuration } from './turn'

/** Distinct files the journal remembers; older ones fall off so a huge session stays small. */
export const MAX_JOURNAL_FILES = 50
/** Files the journal lists by name; the rest are summed up as "+N more". */
const LISTED_FILES = 8

export const EMPTY_JOURNAL: Journal = {
  turns: 0,
  shipped: 0,
  workingMs: 0,
  edits: 0,
  failedEdits: 0,
  commands: 0,
  failedCommands: 0,
  greenRuns: 0,
  fixes: 0,
  hires: 0,
  files: [],
}

/** Something that happened this session, as the journal records it. */
export type JournalEvent =
  | { kind: 'turn'; durationMs: number }
  | { kind: 'edit'; file: string; hasFailed: boolean }
  | { kind: 'command'; hasFailed: boolean }
  | { kind: 'shipped' }
  | { kind: 'green' }
  | { kind: 'fix' }
  | { kind: 'hire' }

/** Most recent last, each file once. */
const touch = (files: readonly string[], file: string): readonly string[] =>
  [...files.filter(known => known !== file), file].slice(-MAX_JOURNAL_FILES)

/** The journal with one more event written in. */
export const record = (journal: Journal, event: JournalEvent): Journal => {
  switch (event.kind) {
    case 'turn':
      return { ...journal, turns: journal.turns + 1, workingMs: journal.workingMs + Math.max(0, event.durationMs) }
    case 'edit':
      return event.hasFailed
        ? { ...journal, failedEdits: journal.failedEdits + 1 }
        : { ...journal, edits: journal.edits + 1, files: touch(journal.files, event.file) }
    case 'command':
      return {
        ...journal,
        commands: journal.commands + 1,
        failedCommands: journal.failedCommands + (event.hasFailed ? 1 : 0),
      }
    case 'shipped':
      return { ...journal, shipped: journal.shipped + 1 }
    case 'green':
      return { ...journal, greenRuns: journal.greenRuns + 1 }
    case 'fix':
      return { ...journal, fixes: journal.fixes + 1 }
    case 'hire':
      return { ...journal, hires: journal.hires + 1 }
  }
}

const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`

/** The distinct-file count; past the cap the journal no longer knows the exact number. */
const fileCount = (journal: Journal): string =>
  journal.files.length >= MAX_JOURNAL_FILES ? `${MAX_JOURNAL_FILES}+ files` : plural(journal.files.length, 'file')

/** One HUD line: what this session has amounted to so far; null until something happened. */
export const journalLine = (journal: Journal): string | null => {
  // Only what is non-zero: "0 files · 0 turns" says nothing.
  const parts = [
    journal.files.length > 0 ? fileCount(journal) : '',
    journal.turns > 0 ? plural(journal.turns, 'turn') : '',
    journal.workingMs > 0 ? `${formatDuration(journal.workingMs)} working` : '',
    journal.files.length === 0 && journal.commands > 0 ? plural(journal.commands, 'command') : '',
  ].filter(part => part !== '')
  return parts.length === 0 ? null : parts.join(' · ')
}

/** The `/mascot journal` report: this session's work, newest files last. */
export const journalReport = (journal: Journal): string => {
  if (journal.turns === 0 && journal.edits === 0 && journal.commands === 0 && journal.hires === 0) {
    return 'Session journal: nothing yet. Mochi is ready when you are.'
  }
  const listed = journal.files.slice(-LISTED_FILES).map(fileName)
  const more = journal.files.length - listed.length
  const lines = [
    'Session journal',
    `  Turns      ${journal.turns}${journal.shipped > 0 ? ` (${journal.shipped} shipped)` : ''}${journal.workingMs > 0 ? ` · ${formatDuration(journal.workingMs)} of Claude working` : ''}`,
    `  Edits      ${journal.edits}${journal.failedEdits > 0 ? ` (+${journal.failedEdits} failed)` : ''}`,
    `  Commands   ${journal.commands}${journal.failedCommands > 0 ? ` (${journal.failedCommands} failed, ${journal.fixes} fixed)` : ''}${journal.greenRuns > 0 ? ` · ${plural(journal.greenRuns, 'green test run')}` : ''}`,
    `  Subagents  ${journal.hires}`,
  ]
  if (listed.length > 0) lines.push(`  Files      ${listed.join(', ')}${more > 0 ? ` +${more} more` : ''}`)
  return lines.join('\n')
}
