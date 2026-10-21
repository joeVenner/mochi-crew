/**
 * The session title: the tint's emoji in front of a topic. The topic is one the person
 * pinned (a /rename or `/mochi badge title`), else the topic Claude Code generated from
 * the first message.
 */

import { PALETTE } from './badgePalette'
import type { Tint } from './badgePalette'

export const MAX_TITLE_LENGTH = 50
/** A name the person gave keeps more room than a generated topic. */
export const MAX_RENAME_LENGTH = 80
/** Longest raw text looked at: every regex below then runs on bounded input. */
const MAX_RAW_LENGTH = 256

// Controls, format characters (bidi, zero-width), private-use, unassigned and lone
// surrogates, plus the blank-looking letters that pass for text.
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}͏ᅟᅠ឴឵⠀ㅤ︀-️ﾠ]/gu
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * Makes untrusted text safe to show in a terminal title: no escape sequences, no bidi
 * tricks, no blank look-alikes, one line, at most `maxLength` characters. Undefined when
 * no letter or digit is left.
 */
export const sanitizeLabel = (raw: string | undefined, maxLength: number): string | undefined => {
  if (!raw) return undefined
  const cleaned = raw
    .slice(0, MAX_RAW_LENGTH)
    // A zero-width joiner holds compound emoji together and moves no cursor, so it stays.
    .replace(INVISIBLE, character => (character === '‍' ? character : ' '))
    .replace(/\s+/g, ' ')
    .trim()
  if (!HAS_LETTER_OR_DIGIT.test(cleaned)) return undefined
  const characters = Array.from(cleaned)
  return characters.length > maxLength ? `${characters.slice(0, maxLength - 1).join('').trimEnd()}…` : cleaned
}

/** A generated title: a label with surrounding quotes and a closing period removed. */
export const sanitizeTitle = (raw: string | undefined): string | undefined => {
  const unquoted = raw?.slice(0, MAX_RAW_LENGTH).trim().replace(/^["'`]+/, '').replace(/["'`.]+$/, '')
  return sanitizeLabel(unquoted, MAX_TITLE_LENGTH)
}

/** Drops a leading palette emoji, so a title Mochi composed reads as its topic again. */
export const stripBadge = (title: string): string => {
  for (const tint of PALETTE) {
    if (title.startsWith(`${tint.emoji} `)) return title.slice(tint.emoji.length + 1)
  }
  return title
}

/**
 * Claude Code's topic, from transcript lines holding `{"type":"ai-title","aiTitle":"..."}`;
 * the latest one wins. Lines that are not JSON are skipped.
 */
export const latestAiTitle = (lines: string): string | undefined => {
  const rows = lines.split('\n')
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]?.trim()
    if (!row || !row.includes('"ai-title"')) continue
    try {
      const parsed: unknown = JSON.parse(row)
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'ai-title' && 'aiTitle' in parsed && typeof parsed.aiTitle === 'string') {
        const title = sanitizeTitle(parsed.aiTitle)
        if (title) return title
      }
    } catch {
      // A torn line from a write in progress: the earlier rows still answer.
      continue
    }
  }
  return undefined
}

export type TitleInput = {
  /** The session's custom title as Claude Code holds it now (`session_title`). */
  readonly current: string | undefined
  /** The titles Mochi set lately, newest last: one among them is Mochi's own even if Claude Code dropped the newest write. */
  readonly recentSet: readonly string[]
  readonly pinned: string | undefined
  readonly aiTitle: string | undefined
  readonly tint: Tint | undefined
  readonly isOff: boolean
}

export type TitleDecision = {
  /** The title to set now; absent when the current one stands. */
  readonly title?: string
  /** The pinned topic after this prompt: a /rename pins what it named. */
  readonly pinned: string | undefined
}

/**
 * Decides the title for this prompt. A custom title Mochi did not write is a /rename: it
 * becomes the pinned topic, and only the emoji is added to it.
 */
export const decideTitle = (input: TitleInput): TitleDecision => {
  const current = sanitizeLabel(input.current, MAX_RENAME_LENGTH + 4)
  const isOwnWrite = current !== undefined && input.recentSet.some(title => sanitizeLabel(title, MAX_RENAME_LENGTH + 4) === current)
  // A badge title with no memory of writing it (a pruned record) is still Mochi's own.
  const isUnrememberedBadge = current !== undefined && input.recentSet.length === 0 && stripBadge(current) !== current
  const isRenamed = current !== undefined && !isOwnWrite && !isUnrememberedBadge
  const pinned = (isRenamed ? sanitizeLabel(stripBadge(current), MAX_RENAME_LENGTH) : undefined) ?? input.pinned

  if (input.isOff || !input.tint) {
    // Off: take the emoji back out of a title Mochi wrote, and leave any other alone.
    const bare = current ? stripBadge(current) : undefined
    return !isRenamed && current && bare !== current ? { title: bare, pinned } : { pinned }
  }

  const topic = pinned ?? input.aiTitle
  if (!topic) return { pinned }
  const clean = topic === pinned ? sanitizeLabel(topic, MAX_RENAME_LENGTH) : sanitizeTitle(topic)
  const title = clean ? `${input.tint.emoji} ${clean}` : undefined
  return !title || title === input.current ? { pinned } : { title, pinned }
}
