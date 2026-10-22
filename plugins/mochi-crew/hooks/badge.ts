/**
 * The session badge: each session's Terminal.app tab wears its own dark tint, and the
 * matching color emoji leads its tab title, so you can tell sessions apart at a glance.
 * This file runs its lifecycle; the pure parts live in the other `badge*.ts` files.
 * Functions that take `$` and are imported elsewhere are `function` declarations: the
 * plugin validator follows `$` across an import only into those.
 */

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { BadgeTab } from '../types'
import { BADGE_USAGE, describeStatus, parseBadgeCommand } from './badgeCommand'
import { PALETTE, findTint, hexToRgb16, isSameRgb, pickTint } from './badgePalette'
import type { Rgb16, Tint } from './badgePalette'
import { loadRecord, newRecord, rememberSet, saveRecord, withoutPinned } from './badgeRecords'
import type { BadgeRecord } from './badgeRecords'
import { readTabs, restoreTab, tintTab } from './badgeTerminal'
import { MAX_RENAME_LENGTH, MAX_TOPIC_ROW_LENGTH, TOPIC_ROW_MARK, decideTitle, latestAiTitle, sanitizeLabel, topicFromTranscript } from './badgeTitle'
import { findControllingTty, parseProcessTable, processTableArgv } from './badgeTty'

// The values the session holds for the badge; they outlive a hot reload.
const badge = atom({ plugin: 'mochi-crew', key: 'badge' } as const, null)
const badgeTab = atom({ plugin: 'mochi-crew', key: 'badgeTab' } as const, null)
const badgeEnded = atom({ plugin: 'mochi-crew', key: 'badgeEnded' } as const, null)
const isBadgeOn = atom({ plugin: 'mochi-crew', key: 'isBadgeOn' } as const, true)
const badgePainted = atom({ plugin: 'mochi-crew', key: 'badgePainted' } as const, null)

/** The store key of the on/off switch, saved across sessions. */
const SWITCH_KEY = 'badgeOn'
/** Times one load of the module looks for its tab before giving up. */
const MAX_TAB_LOOKUPS = 3
/** How long after a fresh pick to look for another session that picked the same color. */
const COLLISION_CHECK_DELAY_MS = 2_500
/**
 * The longest a prompt or a command waits for a start still in flight. Well under the
 * engine's hook budget: a start held up by macOS's automation question means no title on
 * this prompt, and the next one tries again.
 */
const START_WAIT_MS = 2_000
/** The largest transcript read whole, where there is no grep (Windows). */
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024

/**
 * What this load of the module knows. A hot reload starts it over; what must outlive one
 * (the tab, the badge, how the last session ended) is in the session's state.
 */
const runtime: {
  /** `<session>:<tint>` this load already tried to paint, so a failing paint is not retried every prompt. */
  paintTriedFor: string | undefined
  /** Whether this load saw an interactive session start; a `-p` run never does, so it is never badged. */
  hasStarted: boolean
  /** Claude Code's topic per session id, once found: it never changes, so the transcript is read until then only. */
  topics: Map<string, string>
  isEnded: boolean
  hasWarnedAutomation: boolean
  tabLookups: number
  ready: Promise<void>
} = {
  paintTriedFor: undefined,
  hasStarted: false,
  topics: new Map(),
  isEnded: false,
  hasWarnedAutomation: false,
  tabLookups: 0,
  ready: Promise.resolve(),
}

const describeError = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Waits for `work` at most `ms`; true when it finished in time. */
async function within($: EngineInterface, work: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([work.then(() => true), $.clock.sleep(ms).then(() => false)])
}

function logDebug($: EngineInterface, text: string): void {
  return $.ui.log(`mochi-crew: badge: ${text}`, { to: 'debug' })
}

/** Says once, where the person sees it, why the tab could not be painted. */
function warnAutomation($: EngineInterface, error: unknown): void {
  logDebug($, `osascript failed: ${describeError(error)}`)
  if (runtime.hasWarnedAutomation) return
  runtime.hasWarnedAutomation = true
  $.ui.log('mochi-crew: could not reach Terminal.app to tint this tab. If macOS asked about automation, allow it in System Settings > Privacy & Security > Automation. The emoji title still works.')
}

/** Terminal.app on this Mac: an ssh session inherits TERM_PROGRAM but would tint the remote Mac's tabs. */
async function isAppleTerminal($: EngineInterface): Promise<boolean> {
  const [program, sshConnection, sshTty] = await Promise.all([$.env.get('TERM_PROGRAM'), $.env.get('SSH_CONNECTION'), $.env.get('SSH_TTY')])
  return program === 'Apple_Terminal' && !sshConnection && !sshTty
}

/** 32 random hex digits, so this lookup's own `ps` row cannot be mistaken for another's. */
const freshMarker = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')

/** Finds this session's tab and the colors every other tab wears. */
async function locateTab($: EngineInterface): Promise<{ target: BadgeTab | undefined; others: Rgb16[] }> {
  const marker = freshMarker()
  const table = await $.process.run(processTableArgv(marker), { timeoutMs: 5_000 })
  const { startPid, rows } = parseProcessTable(table.stdout, marker)
  const tty = findControllingTty(startPid, rows)
  const tabs = await readTabs($)
  const mine = tabs.find(one => one.tty === tty)
  return {
    target: tty && mine ? { tty, profile: mine.profile } : undefined,
    others: tabs.filter(one => one.tty !== tty).map(one => one.rgb),
  }
}

/** The tab, from the session's state or by looking (a few tries per load). */
async function ensureTab($: EngineInterface): Promise<{ target: BadgeTab | undefined; others: Rgb16[] }> {
  const known = await read($, badgeTab)
  if (known || runtime.tabLookups >= MAX_TAB_LOOKUPS || !(await isAppleTerminal($))) return { target: known ?? undefined, others: [] }
  runtime.tabLookups += 1
  try {
    const found = await locateTab($)
    const target = found.target
    if (target) await update($, badgeTab, () => target)
    return found
  } catch (error) {
    warnAutomation($, error)
    return { target: undefined, others: [] }
  }
}

/** The colors every tab but this session's wears, for a fresh pick. */
async function otherTabColors($: EngineInterface, target: BadgeTab | undefined): Promise<Rgb16[]> {
  if (!(await isAppleTerminal($))) return []
  try {
    return (await readTabs($)).filter(one => one.tty !== target?.tty).map(one => one.rgb)
  } catch (error) {
    warnAutomation($, error)
    return []
  }
}

/** Puts the tab back on its profile, if the badge painted it and it still wears that tint. */
async function unpaint($: EngineInterface): Promise<void> {
  const target = await read($, badgeTab)
  const painted = findTint((await read($, badgePainted)) ?? undefined)
  if (!target || !painted) return
  const outcome = await restoreTab($, target.tty, target.profile, hexToRgb16(painted.hex))
  await update($, badgePainted, () => null)
  if (outcome !== 'ok') logDebug($, `left the tab alone on restore: ${outcome}`)
}

/** Paints the tab; false when there is no tab, the session ended, or Terminal refused. */
async function paint($: EngineInterface, tint: Tint): Promise<boolean> {
  const { target } = await ensureTab($)
  if (!target || runtime.isEnded) return false
  let isPainted = false
  try {
    isPainted = await tintTab($, target.tty, hexToRgb16(tint.hex))
  } catch (error) {
    warnAutomation($, error)
  }
  if (isPainted) await update($, badgePainted, () => tint.id)
  // The session may have ended while osascript ran: take the tint straight back off.
  if (isPainted && runtime.isEnded) await unpaint($)
  return isPainted
}

async function showBadge($: EngineInterface, sessionId: string, record: BadgeRecord): Promise<void> {
  // Same values keep the same object, so readers of the state are not woken for nothing.
  await update($, badge, shown => (shown && shown.sessionId === sessionId && shown.tintId === record.tint ? shown : { sessionId, tintId: record.tint }))
}

/**
 * After a fresh pick, waits for sessions that started at the same moment to paint, then
 * lets the one on the higher tty pick again if two match.
 */
async function settleCollision($: EngineInterface, sessionId: string, tint: Tint): Promise<void> {
  await $.clock.sleep(COLLISION_CHECK_DELAY_MS)
  const target = await read($, badgeTab)
  if (!target || runtime.isEnded || !(await read($, isBadgeOn))) return
  const tabs = await readTabs($)
  const mine = hexToRgb16(tint.hex)
  const ttyNumber = (tty: string): number => Number(tty.replace(/\D/g, ''))
  const isLoser = tabs.some(one => one.tty !== target.tty && isSameRgb(one.rgb, mine) && ttyNumber(one.tty) < ttyNumber(target.tty))
  if (!isLoser) return
  const record = await loadRecord($, sessionId)
  if (!record || record.tint !== tint.id) return
  const repicked = pickTint(tabs.filter(one => one.tty !== target.tty).map(one => one.rgb), `${sessionId}:again`)
  const next = { ...record, tint: repicked.id }
  await saveRecord($, sessionId, next)
  await showBadge($, sessionId, next)
  await paint($, repicked)
}

/**
 * Makes `sessionId` the session the badge belongs to and answers its record: its own if
 * it has one (a resume, a reload), the previous session's color after a /clear, else a
 * fresh pick of the color fewest other tabs wear. Paints the tab while the badge is on.
 */
async function adoptSession($: EngineInterface, sessionId: string): Promise<BadgeRecord | undefined> {
  const saved = await loadRecord($, sessionId)
  // Off: no color is picked and nothing is saved until the badge is switched on.
  if (!(await read($, isBadgeOn))) return saved
  const current = await read($, badge)
  const isSameSession = current?.sessionId === sessionId
  const triedKey = saved ? `${sessionId}:${saved.tint}` : undefined
  const isSettled = saved !== undefined && isSameSession && ((await read($, badgePainted)) === saved.tint || runtime.paintTriedFor === triedKey)
  if (saved && isSettled) return saved

  const lastEnding = await read($, badgeEnded)
  const isClearedHere = current !== null && !isSameSession && lastEnding?.reason === 'clear' && lastEnding.sessionId === current.sessionId
  const { target, others: foundOthers } = await ensureTab($)

  let record: BadgeRecord
  let isFreshPick = false
  if (saved) {
    record = saved
  } else if (current && (isSameSession || isClearedHere)) {
    // A reload whose record went missing, or a /clear: the tab keeps the color it wears.
    record = newRecord(current.tintId)
  } else {
    const others = foundOthers.length > 0 ? foundOthers : await otherTabColors($, target)
    record = newRecord(pickTint(others, sessionId).id)
    isFreshPick = true
  }

  if (!saved) await saveRecord($, sessionId, record)
  await showBadge($, sessionId, record)
  if (!isSameSession) runtime.isEnded = false

  const tint = findTint(record.tint)
  if (tint) {
    runtime.paintTriedFor = `${sessionId}:${tint.id}`
    // The title needs only the record: the paint runs behind it.
    void paint($, tint)
      .then(() => (isFreshPick ? settleCollision($, sessionId, tint) : undefined))
      .catch(error => logDebug($, `paint failed: ${describeError(error)}`))
  }
  return record
}

/** Runs at session start: reads the saved switch, adopts the session and paints its tab, off the start-up path. */
export function startBadge($: EngineInterface, sessionId: string): void {
  // The saved switch seeds the state once per load; after that the state is the truth, so a /clear keeps it.
  const isFirstStart = !runtime.hasStarted
  runtime.hasStarted = true
  runtime.ready = (async () => {
    if (isFirstStart) {
      const saved = await $.store.get(SWITCH_KEY).catch(() => undefined)
      await update($, isBadgeOn, () => saved !== false)
    }
    await adoptSession($, sessionId)
  })().catch(error => logDebug($, `start failed: ${describeError(error)}`))
}

export async function endBadge($: EngineInterface, sessionId: string, reason: string): Promise<void> {
  await update($, badgeEnded, () => ({ sessionId, reason }))
  // A /clear or an in-process /resume goes on in the same tab: the next prompt adopts the new session.
  if (reason === 'clear' || reason === 'resume') return
  runtime.isEnded = true
  await unpaint($)
}

const isWindowsPath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path)

/**
 * True for a transcript path of the shape Claude Code writes, on macOS and Linux
 * (`/…/projects/<project>/<session>.jsonl`) or Windows (`C:\…\projects\<project>\<session>.jsonl`).
 */
export const isTranscriptPath = (path: string): boolean =>
  (path.startsWith('/') || isWindowsPath(path)) &&
  !path.split(/[\\/]/).includes('..') &&
  /[\\/]projects[\\/][^\\/]+[\\/][^\\/]+\.jsonl$/.test(path)

/** Reads the whole transcript, bounded in size, for where grep is missing. */
async function readTopicFromFile($: EngineInterface, path: string): Promise<string | undefined> {
  const stat = await $.fs.stat(path)
  if (stat.kind !== 'file' || stat.size > MAX_TRANSCRIPT_BYTES) return undefined
  const text = await $.fs.read(path)
  return typeof text === 'string' ? topicFromTranscript(text) : undefined
}

/**
 * Reads Claude Code's topic from the transcript. Claude Code generates it once, from the
 * first message, and repeats that same row later, so grep stops at the first one. Windows
 * has no grep, so there the file is read instead; once found, the topic is kept for the
 * rest of this load.
 */
async function readAiTitle($: EngineInterface, sessionId: string, transcriptPath: string): Promise<string | undefined> {
  const known = runtime.topics.get(sessionId)
  if (known) return known
  if (!isTranscriptPath(transcriptPath)) return undefined
  let topic: string | undefined
  if (isWindowsPath(transcriptPath)) {
    topic = await readTopicFromFile($, transcriptPath)
  } else {
    const ran = await $.process.run(['/usr/bin/grep', '-F', '-m', '1', TOPIC_ROW_MARK, '--', transcriptPath], { timeoutMs: 5_000 }).catch(() => undefined)
    // grep exits 1 when nothing matched (no topic yet), and above 1 when it could not read.
    if (ran === undefined || ran.exitCode > 1) topic = await readTopicFromFile($, transcriptPath)
    else if (ran.exitCode === 0 && ran.stdout.length <= MAX_TOPIC_ROW_LENGTH) topic = latestAiTitle(ran.stdout)
  }
  if (topic) runtime.topics.set(sessionId, topic)
  return topic
}

export type PromptInput = {
  readonly sessionId: string
  readonly transcriptPath: string
  readonly sessionTitle: string | undefined
}

/** Decides this prompt's title, or undefined to leave Claude Code's as it is. */
export async function badgeTitleFor($: EngineInterface, input: PromptInput): Promise<string | undefined> {
  if (!runtime.hasStarted || !(await within($, runtime.ready, START_WAIT_MS))) return undefined
  if (!(await read($, isBadgeOn))) {
    // Off: only take the emoji back out of a title the badge wrote.
    const record = await loadRecord($, input.sessionId)
    if (!record) return undefined
    const decision = decideTitle({ current: input.sessionTitle, recentSet: record.recentSet, pinned: record.pinned, aiTitle: undefined, tint: undefined, isOff: true })
    if (decision.title || decision.pinned !== record.pinned) await saveRecord($, input.sessionId, { ...record, pinned: decision.pinned })
    return decision.title
  }
  const base = await adoptSession($, input.sessionId)
  if (!base) return undefined
  let aiTitle: string | undefined
  try {
    aiTitle = await readAiTitle($, input.sessionId, input.transcriptPath)
  } catch (error) {
    logDebug($, `could not read the topic: ${describeError(error)}`)
  }
  const decision = decideTitle({
    current: input.sessionTitle,
    recentSet: base.recentSet,
    pinned: base.pinned,
    aiTitle,
    tint: findTint(base.tint),
    isOff: false,
  })
  const counted: BadgeRecord = { ...base, pinned: decision.pinned }
  await saveRecord($, input.sessionId, decision.title ? rememberSet(counted, decision.title) : counted)
  return decision.title
}

/** Answers `/mochi badge <args>`. */
export async function runBadgeCommand($: EngineInterface, args: string): Promise<string> {
  await within($, runtime.ready, START_WAIT_MS)
  const sessionId = await $.session.id()
  const isOn = await read($, isBadgeOn)
  // While off a session may have no color yet: one is picked blind, and checked against the other tabs once switched on.
  const record = (await adoptSession($, sessionId)) ?? newRecord(pickTint([], sessionId).id)
  const command = parseBadgeCommand(args)
  const save = async (next: BadgeRecord): Promise<void> => {
    await saveRecord($, sessionId, next)
    await showBadge($, sessionId, next)
  }
  const tabNote = (isPainted: boolean): string => (isPainted ? '' : ' No Terminal.app tab could be painted, so only the title changes.')

  switch (command.kind) {
    case 'status':
      return `${describeStatus(record, isOn, (await read($, badgeTab))?.tty)}\n\n${BADGE_USAGE}`
    case 'switch': {
      await update($, isBadgeOn, () => command.isOn)
      const isSaved = await $.store.set(SWITCH_KEY, command.isOn).then(() => true, () => false)
      const note = isSaved ? '' : ' (could not save it for next time)'
      if (!command.isOn) {
        await unpaint($).catch(error => warnAutomation($, error))
        return `Badge off${note}: the tab is back on its profile, and the emoji leaves the title on your next prompt.`
      }
      const adopted = (await adoptSession($, sessionId)) ?? record
      const tint = findTint(adopted.tint)
      const isPainted = tint ? await paint($, tint) : false
      return `Badge on${note}.${tabNote(isPainted)}`
    }
    case 'color': {
      await save({ ...record, tint: command.tint.id })
      if (!isOn) return `Color set to ${command.tint.emoji} ${command.tint.name}. The badge is off: /mochi badge on shows it.`
      const isPainted = await paint($, command.tint)
      return `Color set to ${command.tint.emoji} ${command.tint.name}. The title's emoji changes on your next prompt.${tabNote(isPainted)}`
    }
    case 'unknown-color':
      return `No color named "${sanitizeLabel(command.name, 24) ?? ''}". Pick one of: ${PALETTE.map(tint => tint.id).join(', ')}.`
    case 'title': {
      const pinned = sanitizeLabel(command.text, MAX_RENAME_LENGTH)
      if (!pinned) return 'That title has no letters or digits once control characters are removed.'
      await save({ ...record, pinned })
      return `Title pinned to "${pinned}". It shows from your next prompt.`
    }
    case 'auto':
      await save(withoutPinned(record))
      return 'Following Claude Code\'s own topic again, from your next prompt.'
    case 'help':
      return BADGE_USAGE
  }
}
