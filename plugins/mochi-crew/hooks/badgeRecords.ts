/**
 * What the badge remembers per session in the plugin's store, so a resume or a reload
 * keeps the same color and title. Claude Code's topic is not kept: it is read from the
 * transcript each time. The oldest records are pruned.
 */

import type { EngineInterface } from 'claude-code'

import type { TintId } from '../types'
import { findTint } from './badgePalette'
import { MAX_RENAME_LENGTH, sanitizeLabel } from './badgeTitle'

export type BadgeRecord = {
  readonly tint: TintId
  /** The last few titles Mochi set, newest last. */
  readonly recentSet: readonly string[]
  readonly pinned?: string
}

const KEY_PREFIX = 'badge:session:'
const MAX_RECORDS = 300
const MAX_RECENT_SET = 3
/** Room for a palette emoji and a space in front of a full-length name. */
const MAX_STORED_TITLE = MAX_RENAME_LENGTH + 4

export const newRecord = (tint: TintId): BadgeRecord => ({ tint, recentSet: [] })

/** Notes a title Mochi just set, keeping the last few. */
export const rememberSet = (record: BadgeRecord, title: string): BadgeRecord => ({
  ...record,
  recentSet: [...record.recentSet.filter(one => one !== title), title].slice(-MAX_RECENT_SET),
})

export const withoutPinned = (record: BadgeRecord): BadgeRecord => ({ tint: record.tint, recentSet: record.recentSet })

const readField = (value: object, name: string): unknown => Object.getOwnPropertyDescriptor(value, name)?.value

const storedTitle = (value: unknown): string | undefined => (typeof value === 'string' ? sanitizeLabel(value, MAX_STORED_TITLE) : undefined)

/**
 * Accepts only a well-formed record and cleans every title in it again: the store is a
 * JSON file another version, or a hand edit, may have written.
 */
export const parseRecord = (value: unknown): BadgeRecord | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const tintName = readField(value, 'tint')
  const tint = typeof tintName === 'string' ? findTint(tintName) : undefined
  if (!tint) return undefined
  const recent = readField(value, 'recentSet')
  return {
    tint: tint.id,
    recentSet: Array.isArray(recent) ? recent.map(storedTitle).filter((title): title is string => title !== undefined).slice(-MAX_RECENT_SET) : [],
    pinned: storedTitle(readField(value, 'pinned')),
  }
}

export async function loadRecord($: EngineInterface, sessionId: string): Promise<BadgeRecord | undefined> {
  return parseRecord(await $.store.get(`${KEY_PREFIX}${sessionId}`))
}

/**
 * Saves the record; a new session's first save prunes the oldest records past MAX_RECORDS,
 * oldest by creation. A session open while 300 newer ones start loses its record: its title
 * survives (a badge title reads as Mochi's own) and its tab keeps the color it wears.
 */
export async function saveRecord($: EngineInterface, sessionId: string, record: BadgeRecord): Promise<void> {
  const key = `${KEY_PREFIX}${sessionId}`
  const isNew = (await $.store.get(key)) === undefined
  await $.store.set(key, record)
  if (!isNew) return
  const keys = (await $.store.keys()).filter(name => name.startsWith(KEY_PREFIX))
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_RECORDS))) await $.store.delete(stale)
}
