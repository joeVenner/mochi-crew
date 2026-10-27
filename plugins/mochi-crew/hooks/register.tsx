import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookFailure, ModelCompleteRequest, ModelCompleteResult, ModelForkResult, ModelUsage, Register, RenderSurface, SessionMeasureInput, Timer, ToolCallResult, TurnCompleteInput, UiPane } from 'claude-code'

import type { Bug, CacheTotals, Care, CrewStats, FolderToggles, Gadget, Journal, Measure, Provider, TouchedFile, TreeEntry, TreeFocus, TreeSnapshot, TurnLedger, WorktreeSnapshot, MascotActivity, OutfitName, Quip, Reaction, Turn, TurnOutcome, TutorFailure, TutorFocus, TutorProject, TutorQuestion, TutorRound, TutorSession, TutorState, TutorUsage, Worker } from '../types'
import type { Achievement, Facts } from './achievements'
import { ACHIEVEMENTS, achievementList, newlyUnlocked, parseUnlocked } from './achievements'
import { placeFor } from './badgePalette'
import { badgeTitleFor, endBadge, runBadgeCommand, startBadge } from './badge'
import { mascotXAt, settle } from './behavior'
import type { QuipEvent } from './events'
import { activeQuip, isBugAlive, quipFor, spawnBug, squashBug, visibleBug } from './events'
import type { CareEvent } from './care'
import { FRESH_CARE, activeReaction, applyCare, careAt, feelingOf, parseCare } from './care'
import { MAX_VISIBLE_WORKERS, XP_PER_WORKER, hatOf, isOnStage, isRunningStatus, joinWorker, markFinished, pruneWorkers, rejoinWorker, workerCallEnded, workerCallStarted, workerEdited, workerFinished } from './crew'
import { EMPTY_STATS, applyEdit, levelOf, parseStats } from './game'
import { BAR_GLYPH, barCells, barWidthFor, column, comboBadge, crewSummary, gutter, hudPlan, ruleFor, treeBudget, vitalNote } from './hud'
import type { EditorEnv, ShimEnv } from './editor'
import { SHIM_ENV, launchersFor, shimCandidates, shimLauncher } from './editor'
import type { TreeRoot, TreePlace, TreeRow, WorktreeEntry } from './fileTree'
import { MIN_TREE_ROWS, anchorOf, expandedDirs, focusIn, isAbsolutePath, isInside, isMissingListing, isMissingWorktreeListing, isWindowsRoot, isWorktreeOpen, diskSpelling, linkedWorktrees, openFolders, parseWorktreeList, placeFile, placeLabel, shownWorktrees, reachableFolders, reopenFor, reopenWorktreeFor, sessionTreeRows, spellingsOf, toggleFolder, toggleWorktreeFolder, parseGitStatus, parseNumstat, relativeTo, rowParts, safeText, toEntries, touch, touchedIn, treeLine, windowRows, withoutMounts } from './fileTree'
import type { JournalEvent } from './journal'
import { EMPTY_JOURNAL, journalLine, journalReport, record } from './journal'
import { XP_PER_MISSION, missionCount, missionLine, missionReport, newlyCompleted } from './missions'
import type { Mission } from './missions'
import { safeDetail } from './redact'
import { activityLabel, fileName, gadgetForCommand, mcpToolLabel, workerDoing, workerNote } from './mascot'
import type { TutorVerb } from './outfits'
import { DEFAULT_OUTFIT, OUTFIT_NAMES, isOutfitName, parseMascotCommand } from './outfits'
import { ROLE_INFO, roleFor } from './roles'
import type { SceneInput } from './sprite'
import { DONE_MS, SCENE_ROWS, cellsFor } from './sprite'
import { FRESH_LEDGER, XP_PER_GREEN_TESTS, beginLedger, isTestCommand, noteEdit, noteGreenTests, settleTurn } from './progress'
import { completeTurn, isThinking, isTurnTrouble, keepTurnAlive, startTurn, touchTurn, turnLabel } from './turn'
import { MIN_SCENE_WIDTH, sceneWidthFor } from './world'
import type { Digest, TranscriptRow } from './tutorDigest'
import { buildDigest, capGitOutput, diffArgs, isReadableNewFile, isSecretPath, logArgs, lsFilesArgs, nameStatusArgs, numstatArgs, planDiff, toTranscriptRows, type DiffPlan } from './tutorDigest'
import type { ParseOutcome } from './tutorParse'
import { cleanModelText, parseGrade, parseRound } from './tutorParse'
import type { TutorConfig, TutorPlan, TutorPlanInput } from './tutorPlan'
import { DEFAULT_TUTOR_CONFIG, afterDigest, afterFork, choosePlan, isForkMiss, parseTutorConfig, planLabel, wasForkMiss } from './tutorPlan'
import { askRequest, digestRequest, forkPrompt, gradeRequest } from './tutorPrompt'
import { FRESH_PROJECT, afterRound, dueCards, parseProgress, projectOf, withProject } from './tutorProgress'
import type { TutorEvent } from './tutorRound'
import { EMPTY_USAGE, ROUND_SIZE, addTutorUsage, applyTutor, closeOutRound, currentAnswer, currentQuestion, isAnswerTooShort, isLastQuestion, replayQuestion, roundXp, scoreRound, spliceReview, verdictOf } from './tutorRound'
import type { TutorAction, TutorControl, TutorInputRow, TutorRow, TutorTone, TutorViewContext } from './tutorView'
import { tutorHudLabel, tutorScreen } from './tutorView'
import type { ProviderEnv, TtlEnv } from './meter'
import { EMPTY_CACHE, addUsage, certainlyColdAfterMs, describeFailure, detectProvider, isCacheUnreported, isCertainlyCold, settleProvider } from './meter'
import type { Alert } from './meterAlerts'
import { checkAlerts } from './meterAlerts'
import { meterReport } from './meterReport'
import type { MeterView } from './meterRows'
import type { Tone as MeterTone } from './meterRows'
import { meterRows, meterSummary } from './meterRows'

const PANE = 'mochi-crew'
/** The slash commands that open and drive the pane; `/mochi` is an alias of `/mascot`. */
const MASCOT_COMMANDS = ['mascot', 'mochi'] as const
const TITLE = 'Mochi'
const SCENE_KEY = 'scene'
/** The HUD's one accent, the host theme's own Claude orange (follows light/dark themes). */
const ACCENT = 'claude'
/** The empty part of a bar: a muted line in the same weight as the fill. */
const TRACK = '#454a55'
/** Theme colors kept for meaning only: something needs you, or it is your turn. */
const THEME = { alert: 'error', good: 'success' } as const
/** Text props for each meter tone, in the HUD's own palette. */
const METER_TONES: Readonly<Record<MeterTone, { color?: string; dimColor?: boolean; bold?: boolean }>> = {
  label: { dimColor: true },
  dim: { dimColor: true },
  value: {},
  strong: {},
  accent: { color: ACCENT },
  track: { color: TRACK },
  alert: { color: THEME.alert },
}
const TICK_MS = 180
// Ask the engine which agents ended every this many ticks (~1 s), only while workers are on stage.
const POLL_EVERY_TICKS = 6
// A step that keeps throwing (not a closed pane) stops the ticker after this many in a row.
const MAX_STEP_FAILURES = 20

/** Keys in $.store, which outlives the session. */
const STORE = {
  stats: 'stats', outfit: 'outfit', isSoundOn: 'isSoundOn', care: 'care', achievements: 'achievements', isTreeOn: 'treeOn',
  // A number: the tutor notice's version the person accepted.
  tutorConsent: 'tutorConsent',
  // A TutorProgressStore, keyed by project root and capped well under the store's budget.
  tutorProgress: 'tutorProgress',
} as const

const SOUNDS = { done: 'sounds/done.wav', levelUp: 'sounds/levelup.wav', join: 'sounds/join.wav' } as const
type Sound = (typeof SOUNDS)[keyof typeof SOUNDS]

const IDLE: MascotActivity = { kind: 'idle', since: 0 }
const NO_WORKERS: readonly Worker[] = []
const activity = atom({ plugin: 'mochi-crew', key: 'activity' } as const, IDLE)
const stats = atom({ plugin: 'mochi-crew', key: 'stats' } as const, EMPTY_STATS)
const workers = atom({ plugin: 'mochi-crew', key: 'workers' } as const, NO_WORKERS)
const outfit = atom({ plugin: 'mochi-crew', key: 'outfit' } as const, DEFAULT_OUTFIT)
/**
 * The session badge's tint and switch (written by badge.ts): they pick the place Mochi's desk
 * stands in. Declared again here because the plugin validator wants each atom in the file that reads it.
 */
const badge = atom({ plugin: 'mochi-crew', key: 'badge' } as const, null)
const isBadgeOn = atom({ plugin: 'mochi-crew', key: 'isBadgeOn' } as const, true)
const isSoundOn = atom({ plugin: 'mochi-crew', key: 'isSoundOn' } as const, false)
const care = atom({ plugin: 'mochi-crew', key: 'care' } as const, FRESH_CARE)
const NO_REACTION: Reaction | null = null
const reaction = atom({ plugin: 'mochi-crew', key: 'reaction' } as const, NO_REACTION)
const NO_BUG: Bug | null = null
const bug = atom({ plugin: 'mochi-crew', key: 'bug' } as const, NO_BUG)
const NO_QUIP: Quip | null = null
const quip = atom({ plugin: 'mochi-crew', key: 'quip' } as const, NO_QUIP)
const NONE_UNLOCKED: readonly string[] = []
const achievements = atom({ plugin: 'mochi-crew', key: 'achievements' } as const, NONE_UNLOCKED)
const NO_TURN: Turn | null = null
const turn = atom({ plugin: 'mochi-crew', key: 'turn' } as const, NO_TURN)
const journal = atom({ plugin: 'mochi-crew', key: 'journal' } as const, EMPTY_JOURNAL)
const ledger = atom({ plugin: 'mochi-crew', key: 'ledger' } as const, FRESH_LEDGER)
const NO_MISSIONS: readonly string[] = []
const missions = atom({ plugin: 'mochi-crew', key: 'missions' } as const, NO_MISSIONS)
const NO_FOCUS: TreeFocus | null = null
const treeFocus = atom({ plugin: 'mochi-crew', key: 'treeFocus' } as const, NO_FOCUS)
const NOTHING_TOUCHED: readonly TouchedFile[] = []
const treeTouched = atom({ plugin: 'mochi-crew', key: 'treeTouched' } as const, NOTHING_TOUCHED)
const NO_TREE: TreeSnapshot | null = null
const tree = atom({ plugin: 'mochi-crew', key: 'tree' } as const, NO_TREE)
const isTreeOn = atom({ plugin: 'mochi-crew', key: 'isTreeOn' } as const, true)
const NO_TOGGLES: FolderToggles = {}
const treeToggles = atom({ plugin: 'mochi-crew', key: 'treeToggles' } as const, NO_TOGGLES)
const NO_WORKTREE_TOGGLES: Readonly<Record<string, FolderToggles>> = {}
const treeWorktreeToggles = atom({ plugin: 'mochi-crew', key: 'treeWorktreeToggles' } as const, NO_WORKTREE_TOGGLES)
// Fixing a failing command is worth more than a routine edit.
const XP_PER_SQUASH = 15


// Module-local animation state; a reload restarts it, which only resets a blink.
let tick = 0
let ticker: Timer | undefined
// Off the terminal there is no animation ticker, so this redraws the HUD for time-based text
// (the meter's idle time) on its own slow beat.
let hudRefresh: Timer | undefined
const HUD_REFRESH_MS = 30_000
// Main-loop tool calls running now. Module-local: a reload mid-call only under-counts, which at
// worst lets a long-quiet turn expire.
let mainCallsRunning = 0
// The timer does not wait for an async step, so a slow one must not overlap the next.
let isStepping = false
let stepFailures = 0
// The width the pane last drew the scene at; a blit must match the mounted Raster.
let sceneWidth = MIN_SCENE_WIDTH
// The cells last sent to the terminal, so an unchanged frame is not sent again. A render
// that re-mounts the Raster resets it to what that render drew.
let paintedCells = ''
// A resize briefly makes blits miss the new Raster; only a run of refusals means the pane is gone.
let blitRefusals = 0
const MAX_BLIT_REFUSALS = 6
// Meters and the bubble change with time alone; redraw the HUD about once a minute for them.
const HUD_REFRESH_TICKS = 330
const REACTION_LINES = { pet: 'Mochi liked that.', feed: 'Mochi ate the fish.', dance: 'Mochi danced.' } as const

/** The local hour for the window's sky (the host's time zone). */
const hourAt = (now: number): number => new Date(now).getHours()

/** Plays a clip when sound is on; a missing audio device is logged, never surfaced. */
const playSound = async ($: EngineInterface, asset: Sound): Promise<void> => {
  if (!(await read($, isSoundOn))) return
  await $.audio.play({ asset }).catch((error: unknown) =>
    $.ui.log(`mochi-crew: could not play ${asset}: ${String(error)}`, { to: 'debug' }),
  )
}

/** Puts a line in Mochi's speech bubble. */
const say = async ($: EngineInterface, event: QuipEvent, detail: string): Promise<void> => {
  const now = await $.clock.now()
  await update($, quip, (): Quip | null => quipFor(event, detail, tick, now))
}

/** Unlocks whatever these facts newly earn: saved, toasted, cheered. */
const unlock = async ($: EngineInterface, facts: Facts): Promise<void> => {
  // Decided inside the update, so two callers racing for one badge announce it once.
  let earned: readonly Achievement[] = []
  await update($, achievements, current => {
    earned = newlyUnlocked(current, facts)
    return earned.length === 0 ? current : [...current, ...earned.map(badge => badge.id)]
  })
  if (earned.length === 0) return
  await persist($, STORE.achievements, await read($, achievements))
  for (const badge of earned) {
    $.ui.toast(`Achievement unlocked: ${badge.title}`)
    await playSound($, SOUNDS.levelUp)
    await say($, 'achievement', badge.title)
  }
}

/** Writes one event into this session's journal. */
const note = async ($: EngineInterface, event: JournalEvent): Promise<void> => {
  const written = await update($, journal, (current): Journal => record(current, event))
  await completeMissions($, written)
}

/** Pays each mission the journal now meets, once: decided inside the update, so racing notes pay one. */
const completeMissions = async ($: EngineInterface, written: Journal): Promise<void> => {
  let finished: readonly Mission[] = []
  await update($, missions, current => {
    finished = newlyCompleted(current, written)
    return finished.length === 0 ? current : [...current, ...finished.map(mission => mission.id)]
  })
  for (const mission of finished) {
    $.ui.toast(`Mission complete: ${mission.title} (+${XP_PER_MISSION} XP)`)
    await saveStats($, score => ({ ...score, xp: score.xp + XP_PER_MISSION }))
    await say($, 'mission', mission.title)
  }
}

/** Applies a stats change to the session and saves it for the next one. */
const saveStats = async ($: EngineInterface, change: (score: CrewStats) => CrewStats): Promise<CrewStats> => {
  // Change the latest value in one update so concurrent edits and spawns never overwrite each other.
  let before = EMPTY_STATS
  const after = await update($, stats, score => {
    before = score
    return change(score)
  })
  // Saving is best-effort, and saves the latest value so a slower concurrent save can't win.
  await persist($, STORE.stats, await read($, stats))
  const { level } = levelOf(after.xp)
  if (level > levelOf(before.xp).level) {
    $.ui.toast(`Level up: Mochi is now LV ${level}`)
    await playSound($, SOUNDS.levelUp)
    await say($, 'level', String(level))
  }
  return after
}

/** A value earlier sessions saved, or undefined when the store cannot read it (logged). */
const readSaved = ($: EngineInterface, key: string): Promise<unknown> =>
  $.store.get(key).catch((error: unknown) => {
    $.ui.log(`mochi-crew: could not read saved ${key}: ${String(error)}`, { to: 'debug' })
    return undefined
  })

/** Restores what earlier sessions saved; anything malformed falls back to defaults. */
const loadSaved = async ($: EngineInterface): Promise<void> => {
  const savedStats = parseStats(await readSaved($, STORE.stats))
  const savedOutfit = await readSaved($, STORE.outfit)
  const savedSound = await readSaved($, STORE.isSoundOn)
  const savedCare = await readSaved($, STORE.care)
  const savedAchievements = await readSaved($, STORE.achievements)
  const savedTreeOn = await readSaved($, STORE.isTreeOn)
  await update($, stats, (): CrewStats => savedStats)
  // Start the idle clock now, so Mochi does not wake up already asleep.
  const now = await $.clock.now()
  await update($, activity, (): MascotActivity => ({ kind: 'idle', since: now }))
  await update($, care, (): Care => parseCare(savedCare, now))
  await update($, achievements, (): readonly string[] => parseUnlocked(savedAchievements))
  await update($, outfit, (): OutfitName => (isOutfitName(savedOutfit) ? savedOutfit : DEFAULT_OUTFIT))
  await update($, isSoundOn, () => savedSound === true)
  // The file tree is on unless it was switched off.
  await update($, isTreeOn, () => savedTreeOn !== false)
  // Session-only state starts empty, also when a session restarts in the same process.
  await update($, turn, (): Turn | null => NO_TURN)
  await update($, journal, (): Journal => EMPTY_JOURNAL)
  await update($, ledger, (): TurnLedger => FRESH_LEDGER)
  await update($, missions, (): readonly string[] => NO_MISSIONS)
  await update($, treeFocus, (): TreeFocus | null => NO_FOCUS)
  await update($, treeTouched, (): readonly TouchedFile[] => NOTHING_TOUCHED)
  await update($, treeToggles, (): FolderToggles => NO_TOGGLES)
  await update($, treeWorktreeToggles, (): Readonly<Record<string, FolderToggles>> => NO_WORKTREE_TOGGLES)
  await update($, tree, (): TreeSnapshot | null => NO_TREE)
}

/** The status of each agent this session knows, or undefined when the engine could not say. */
const agentStatuses = async ($: EngineInterface): Promise<ReadonlyMap<string, string> | undefined> => {
  try {
    const agents = await $.agent.list()
    return new Map(agents.map(agent => [agent.id, agent.status]))
  } catch (error: unknown) {
    // A failed poll must not freeze the scene or send everyone home; try again next poll.
    $.ui.log(`mochi-crew: could not list agents: ${String(error)}`, { to: 'debug' })
    return undefined
  }
}

/** Walks finished workers out and drops the ones already offstage. */
const refreshCrew = async ($: EngineInterface, now: number): Promise<readonly Worker[]> => {
  const crew = await read($, workers)
  if (crew.length === 0) return crew
  const isPollDue = tick % POLL_EVERY_TICKS === 0 && crew.some(worker => worker.leftAt === undefined)
  const statuses = isPollDue ? await agentStatuses($) : undefined
  const refreshed = (latest: readonly Worker[]): readonly Worker[] =>
    pruneWorkers(statuses === undefined ? latest : markFinished(latest, statuses, now), now)
  // Most ticks change nothing: skip the write. Otherwise apply it to the latest crew, so a
  // worker hired or edited during the poll is kept.
  if (refreshed(crew) === crew) return crew
  return update($, workers, refreshed)
}

/** Starts the animation ticker unless it already runs. */
const ensureTicker = ($: EngineInterface): void => {
  if (ticker !== undefined) return
  stepFailures = 0
  ticker = $.clock.every(TICK_MS, () => {
    if (isStepping) return
    isStepping = true
    step($)
      .then(() => {
        stepFailures = 0
      })
      .catch((error: unknown) => {
        stepFailures += 1
        $.ui.log(`mochi-crew: animation step failed: ${String(error)}`, { to: 'debug' })
        if (stepFailures >= MAX_STEP_FAILURES) stopTicker()
      })
      .finally(() => {
        isStepping = false
      })
  })
}

const stopTicker = (): void => {
  ticker?.cancel()
  ticker = undefined
}

/** Everything the scene needs for a frame at `now`, read from the session's state. */
const frameInput = async (
  $: EngineInterface,
  now: number,
  current: MascotActivity,
  crew: readonly Worker[],
): Promise<SceneInput> => {
  const [worn, wellbeing, playing, loose, latestTurn, badged, isBadged] = await Promise.all([
    read($, outfit), read($, care), read($, reaction), read($, bug), read($, turn), read($, badge), read($, isBadgeOn),
  ])
  return {
    activity: current,
    tick,
    workers: crew,
    now,
    outfit: worn,
    width: sceneWidth,
    hour: hourAt(now),
    feeling: feelingOf(careAt(wellbeing, now)),
    reaction: activeReaction(playing, now),
    bug: visibleBug(loose, now),
    turn: latestTurn,
    place: placeFor(badged?.tintId, isBadged),
  }
}

/** Refreshes a busy turn's sign of life and drops one lost long ago; writes only when that changes it. */
const checkTurnAlive = async ($: EngineInterface, now: number, isBusy: boolean): Promise<void> => {
  const current = await read($, turn)
  if (keepTurnAlive(current, now, isBusy) === current) return
  await update($, turn, latest => keepTurnAlive(latest, now, isBusy))
  $.ui.invalidate('ui.render')
}

/** A main-loop call began: its turn is alive. Off the call's path. */
const markTurnAlive = ($: EngineInterface, now: number): void => {
  void update($, turn, current => touchTurn(current, now)).catch((error: unknown) =>
    $.ui.log(`mochi-crew: could not mark the turn alive: ${String(error)}`, { to: 'debug' }),
  )
}

/** Clears a finished quip and reaction, so the HUD redraws without them. */
const expireTransients = async ($: EngineInterface, now: number): Promise<void> => {
  const [said, playing] = await Promise.all([read($, quip), read($, reaction)])
  if (said !== null && activeQuip(said, now) === null) await update($, quip, current => activeQuip(current, now))
  if (playing !== null && activeReaction(playing, now) === null) await update($, reaction, current => activeReaction(current, now))
}

/** One animation step: settle a stale "done", move the crew, then repaint the scene in place. */
const step = async ($: EngineInterface): Promise<void> => {
  tick += 1
  const now = await $.clock.now()
  // Settling rarely changes anything: read first and write only when it does. The write
  // settles the latest value, so an edit that just started is never overwritten.
  const shown = await read($, activity)
  const settled = settle(shown, now, DONE_MS, sceneWidth) === shown
    ? shown
    : await update($, activity, current => settle(current, now, DONE_MS, sceneWidth))
  const crew = await refreshCrew($, now)
  await expireTransients($, now)
  // A call still running keeps the turn alive even after its pose has settled (a 40-minute build).
  await checkTurnAlive($, now, mainCallsRunning > 0 || crew.some(worker => worker.leftAt === undefined))
  if (tick % HUD_REFRESH_TICKS === 0 || (isTreePulsing && tick % TREE_PULSE_TICKS === 0)) $.ui.invalidate('ui.render')
  const cells = cellsFor(await frameInput($, now, settled, crew))
  if (cells === paintedCells) return
  const painted = await $.ui.blit({ requestId: PANE, key: SCENE_KEY, cells, columns: sceneWidth, rows: SCENE_ROWS })
  if (painted.deny === undefined) {
    paintedCells = cells
    blitRefusals = 0
    return
  }
  paintedCells = ''
  blitRefusals += 1
  // A run of refusals means the pane is closed or not on a terminal. Keep ticking while
  // workers are on stage so they can still leave; otherwise stop until the next draw restarts it.
  if (blitRefusals >= MAX_BLIT_REFUSALS && crew.length === 0) stopTicker()
}

/** Scores a finished edit off the tool call's path; its failures are logged, never surfaced. */
const scoreEdit = async ($: EngineInterface, file: string, isMainLoop: boolean, hasFailed: boolean): Promise<void> => {
  if (isMainLoop && !hasFailed) await playSound($, SOUNDS.done)
  // Decided inside the update, so two concurrent edits of one new file pay full XP once.
  let isRepeat = false
  await update($, ledger, (current): TurnLedger => {
    const noted = noteEdit(current, file, hasFailed)
    isRepeat = noted.isRepeat
    return noted.ledger
  })
  const after = await saveStats($, score => applyEdit(score, hasFailed, isRepeat))
  await changeCare($, hasFailed ? 'failed-edit' : 'clean-edit')
  await unlock($, { combo: after.combo, level: levelOf(after.xp).level, editHour: hourAt(await $.clock.now()) })
}

/** Applies a care event to the latest care and saves it. */
const changeCare = async ($: EngineInterface, event: CareEvent): Promise<Care> => {
  const now = await $.clock.now()
  const after = await update($, care, current => applyCare(current, event, now))
  await persist($, STORE.care, await read($, care))
  return after
}

/**
 * Plays a pet, feed or dance: wakes Mochi (a fresh idle spell), starts the
 * reaction animation and applies its care effect.
 */
const react = async ($: EngineInterface, kind: Reaction['kind']): Promise<string> => {
  const now = await $.clock.now()
  await update($, reaction, (): Reaction | null => ({ kind, at: now }))
  await update($, activity, (current): MascotActivity =>
    current.kind === 'idle' ? { kind: 'idle', since: now, fromX: mascotXAt(current, now, sceneWidth) } : current,
  )
  const after = await changeCare($, kind)
  if (kind !== 'dance') await say($, kind, '')
  ensureTicker($)
  return `${REACTION_LINES[kind]} (mood ${after.mood}, energy ${after.energy})`
}

/** The next outfit after the current one, wrapping around. */
const cycleOutfit = async ($: EngineInterface): Promise<string> => {
  const current = await read($, outfit)
  const next = OUTFIT_NAMES[(OUTFIT_NAMES.indexOf(current) + 1) % OUTFIT_NAMES.length] ?? DEFAULT_OUTFIT
  return runMascotCommand($, `outfit ${next}`)
}

/** The pane's place button: Mochi moves to the next place, and the session takes that place's color. */
const cyclePlace = ($: EngineInterface): Promise<string> => runBadgeCommand($, 'place next')

const toggleSound = async ($: EngineInterface): Promise<string> =>
  runMascotCommand($, (await read($, isSoundOn)) ? 'sound off' : 'sound on')

/** Runs a pane button's action; its answer shows as a toast, and null shows none. */
const pressButton = async ($: EngineInterface, action: () => Promise<string | null>): Promise<void> => {
  try {
    const answer = await action()
    if (answer !== null) $.ui.toast(answer)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: button failed: ${String(error)}`, { to: 'debug' })
  }
}

/** Puts Mochi in the done pose where Mochi stands, then scores the edit. */
const finishEdit = async ($: EngineInterface, file: string, isMainLoop: boolean, hasFailed: boolean): Promise<void> => {
  await note($, { kind: 'edit', file, hasFailed })
  if (isMainLoop) {
    const at = await $.clock.now()
    await update($, activity, (current): MascotActivity => ({
      kind: 'done', file, hasFailed, at, x: mascotXAt(current, at, sceneWidth),
    }))
  }
  await scoreEdit($, file, isMainLoop, hasFailed)
}

/** What one tracked edit is about. */
type EditCall = {
  file: string
  tool: string
  /** Set when a subagent made the call; its worker cat moves instead of Mochi. */
  agentId: string | undefined
}

/**
 * Shows who is working on the file while `run` performs the tool call, then
 * scores it once the result is already on its way back.
 */
const trackEdit = async (
  $: EngineInterface,
  { file, tool, agentId }: EditCall,
  run: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> => {
  const isMainLoop = agentId === undefined
  if (isMainLoop) noteTreeFile($, file, { kind: 'edit', isLive: true })
  // Awaited on purpose: "editing" must land before "done" (or Mochi would stay mid-edit) and be
  // on screen while the call runs. It is one or two local host calls, not I/O.
  if (isMainLoop) {
    const since = await $.clock.now()
    // Mochi sets off for the desk from wherever Mochi stands right now.
    await update($, activity, (current): MascotActivity => ({
      kind: 'editing', file, tool, since, fromX: mascotXAt(current, since, sceneWidth),
    }))
    markTurnAlive($, since)
  } else {
    const crew = await update($, workers, current =>
      workerCallStarted(workerEdited(current, agentId, file), agentId, { kind: 'edit', doing: workerDoing('edit', fileName(file)) }),
    )
    if (!isOnStage(crew, agentId)) bringBackWorker($, agentId)
  }
  if (isMainLoop) mainCallsRunning += 1
  let hasFailed = true
  try {
    const ran = await run()
    hasFailed = ran.deny !== undefined || ran.isError === true
    return ran
  } finally {
    if (isMainLoop) mainCallsRunning = Math.max(0, mainCallsRunning - 1)
    // Even if the call throws, Mochi must not stay stuck on "Working on…". Runs after the
    // result is on its way back, so the animation never delays the tool.
    void finishEdit($, file, isMainLoop, hasFailed).catch((error: unknown) =>
      $.ui.log(`mochi-crew: could not finish an edit: ${String(error)}`, { to: 'debug' }),
    )
    if (agentId !== undefined) endWorkerCall($, agentId)
    // Only an edit that went through marks its file touched; a write can add a file, so reread.
    if (!hasFailed) noteTreeFile($, file, { kind: 'edit', isLive: false, agentId })
    queueTreeRefresh($)
  }
}

// Agents being looked up to come back on stage, so a burst of their calls asks once.
const rejoining = new Set<string>()

/**
 * A call from an agent with no worker on stage: a resumed subagent or a teammate whose
 * earlier run walked its worker out. If the engine says it is running, its worker walks
 * back in (no hire, no XP). Off the call's path; failures are logged.
 */
const bringBackWorker = ($: EngineInterface, agentId: string): void => {
  if (rejoining.has(agentId)) return
  rejoining.add(agentId)
  void (async () => {
    const agents = await $.agent.list()
    const agent = agents.find(candidate => candidate.id === agentId && isRunningStatus(candidate.status))
    if (agent === undefined) return
    const now = await $.clock.now()
    await update($, workers, crew => rejoinWorker(crew, { id: agent.id, type: agent.type, description: safeDetail(agent.description, 60) }, now))
    ensureTicker($)
  })()
    .catch((error: unknown) => $.ui.log(`mochi-crew: could not bring a worker back: ${String(error)}`, { to: 'debug' }))
    .finally(() => rejoining.delete(agentId))
}

/** A worker's call ended: off the call's path, failures logged. */
const endWorkerCall = ($: EngineInterface, agentId: string): void => {
  void update($, workers, crew => workerCallEnded(crew, agentId)).catch((error: unknown) =>
    $.ui.log(`mochi-crew: could not end a worker's call: ${String(error)}`, { to: 'debug' }),
  )
}

/** What one gadget-tool call is about. */
type GadgetCall = {
  gadget: Gadget
  detail: string
  /** Overrides the gadget's own verb on the status line (`calling` for MCP tools). */
  verb?: string
  agentId: string | undefined
  /** Set for shell commands: a failure spawns a bug, a success squashes one. */
  command?: string
  /** Set for file reads: the main loop's read file is marked live in the file tree. */
  file?: string
}

/**
 * Shows Mochi holding the tool's gadget while `run` performs the call. Only the
 * main loop's calls animate Mochi; once done, Mochi goes back to idling unless
 * another activity has started meanwhile.
 */
const trackGadget = async (
  $: EngineInterface,
  { gadget, detail, verb, agentId, command, file }: GadgetCall,
  run: () => Promise<ToolCallResult>,
): Promise<ToolCallResult> => {
  if (agentId !== undefined) {
    // A subagent's call moves its worker, never Mochi. The start is awaited (one local update)
    // so the end can never land before it and leave the worker counted busy.
    const crew = await update($, workers, current => workerCallStarted(current, agentId, { kind: 'tool', doing: workerDoing(gadget, detail, verb === undefined ? undefined : 'call') }))
      .catch((error: unknown) => {
        $.ui.log(`mochi-crew: could not note a worker's call: ${String(error)}`, { to: 'debug' })
        return undefined
      })
    if (crew !== undefined && !isOnStage(crew, agentId)) bringBackWorker($, agentId)
    let workerOutcome: CommandOutcome = 'skipped'
    try {
      const ran = await run()
      workerOutcome = outcomeOf(ran)
      return ran
    } finally {
      endWorkerCall($, agentId)
      if (command !== undefined) {
        queueTreeRefresh($)
        void scoreCommand($, command, workerOutcome).catch((error: unknown) =>
          $.ui.log(`mochi-crew: could not score a worker's command: ${String(error)}`, { to: 'debug' }),
        )
      }
    }
  }
  const since = await $.clock.now()
  await update($, activity, (current): MascotActivity => ({
    kind: 'using', gadget, detail, since, fromX: mascotXAt(current, since, sceneWidth), ...(verb === undefined ? {} : { verb }),
  }))
  markTurnAlive($, since)
  if (file !== undefined) noteTreeFile($, file, { kind: 'read', isLive: true })
  mainCallsRunning += 1
  // A denied call never ran, so it neither spawns nor squashes a bug.
  let outcome: CommandOutcome = 'skipped'
  try {
    const ran = await run()
    outcome = outcomeOf(ran)
    return ran
  } finally {
    mainCallsRunning = Math.max(0, mainCallsRunning - 1)
    // A command may have changed files or what git says of them.
    if (command !== undefined) queueTreeRefresh($)
    void finishGadget($, since, command === undefined ? 'skipped' : outcome, command ?? '').catch((error: unknown) =>
      $.ui.log(`mochi-crew: could not put a gadget away: ${String(error)}`, { to: 'debug' }),
    )
  }
}

/** Back to idling once the gadget call that began at `since` ends, unless something else began meanwhile. */
/** How a shell command went; a denied or non-shell call is `skipped` and scores nothing. */
type CommandOutcome = 'failed' | 'passed' | 'skipped'

const outcomeOf = (ran: ToolCallResult): CommandOutcome =>
  ran.deny !== undefined ? 'skipped' : ran.isError === true ? 'failed' : 'passed'

/**
 * Journals a finished shell command, Claude's or a subagent's (the turn delegated it), and
 * pays the turn's first green test run once. Bugs are Mochi's own fight: main loop only.
 */
const scoreCommand = async ($: EngineInterface, command: string, outcome: CommandOutcome): Promise<void> => {
  if (outcome === 'skipped') return
  await note($, { kind: 'command', hasFailed: outcome === 'failed' })
  if (outcome !== 'passed' || !isTestCommand(command)) return
  await note($, { kind: 'green' })
  await celebrateGreenTests($)
}

const finishGadget = async (
  $: EngineInterface,
  since: number,
  outcome: CommandOutcome,
  command: string,
): Promise<void> => {
  const end = await $.clock.now()
  await update($, activity, (current): MascotActivity =>
    current.kind === 'using' && current.since === since
      ? { kind: 'idle', since: end, fromX: mascotXAt(current, end, sceneWidth) }
      : current,
  )
  if (outcome === 'failed') await releaseBug($, command, end)
  if (outcome === 'passed') await fightBug($, end)
  await scoreCommand($, command, outcome)
}

/** The turn's first passing test run earns XP once; reruns in the same turn earn nothing more. */
const celebrateGreenTests = async ($: EngineInterface): Promise<void> => {
  let isFirst = false
  await update($, ledger, (current): TurnLedger => {
    const noted = noteGreenTests(current)
    isFirst = noted.isFirst
    return noted.ledger
  })
  if (!isFirst) return
  await saveStats($, score => ({ ...score, xp: score.xp + XP_PER_GREEN_TESTS }))
  await say($, 'tests', '')
}

/** A failed command lets a bug loose, unless one already is. */
const releaseBug = async ($: EngineInterface, command: string, now: number): Promise<void> => {
  let hasSpawned = false
  await update($, bug, current => {
    const next = spawnBug(current, safeDetail(command, 20), now)
    hasSpawned = next !== current
    return next
  })
  if (hasSpawned) await say($, 'bug', '')
}

/** A passing command squashes a live bug: burst, XP and a badge. */
const fightBug = async ($: EngineInterface, now: number): Promise<void> => {
  // Decided inside the update, so two passing commands at once squash (and pay for) one bug.
  let hasSquashed = false
  await update($, bug, current => {
    if (!isBugAlive(current)) return current
    hasSquashed = true
    return squashBug(current, now)
  })
  if (!hasSquashed) return
  await note($, { kind: 'fix' })
  await say($, 'squash', '')
  await saveStats($, score => ({ ...score, xp: score.xp + XP_PER_SQUASH }))
  await unlock($, { hasSquashed: true })
}

/** The host part of a URL, or the URL made safe to show when it does not parse. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).host
  } catch {
    return safeDetail(url)
  }
}

/** Brings a just-started subagent on stage as a worker. */
const hireWorker = async ($: EngineInterface, joining: Pick<Worker, 'id' | 'type' | 'description'>): Promise<void> => {
  const now = await $.clock.now()
  await update($, workers, crew => joinWorker(crew, joining, now))
  await note($, { kind: 'hire' })
  // Workers must be able to leave even when no terminal pane is drawing the scene.
  ensureTicker($)
}

/** The fanfare for a hire — sound, quip, XP, badges — run after the spawn result returns. */
const celebrateHire = async ($: EngineInterface, joining: Pick<Worker, 'id' | 'type' | 'description'>): Promise<void> => {
  await playSound($, SOUNDS.join)
  await say($, 'hire', ROLE_INFO[roleFor(joining.type)].title)
  await saveStats($, score => ({ ...score, xp: score.xp + XP_PER_WORKER }))
  const crewSize = (await read($, workers)).filter(worker => worker.leftAt === undefined).length
  await unlock($, { hasHired: true, crewSize })
}

/** Claude started working on a prompt: Mochi wakes up (a fresh idle spell) and thinks along. */
const beginTurn = async ($: EngineInterface, turnId: string): Promise<void> => {
  await update($, ledger, (current): TurnLedger => beginLedger(current, turnId))
  const now = await $.clock.now()
  // A late or replayed start of a turn already seen (even one already handed back) changes nothing.
  await update($, turn, (current): Turn | null => (current?.turnId === turnId ? current : startTurn(turnId, now)))
  // A new prompt: last turn's live file is no longer live.
  await update($, treeFocus, (): TreeFocus | null => NO_FOCUS)
  await update($, activity, (current): MascotActivity =>
    current.kind === 'idle' ? { kind: 'idle', since: now, fromX: mascotXAt(current, now, sceneWidth) } : current,
  )
  $.ui.invalidate('ui.render')
}

/** Claude handed the turn back: Mochi waves for attention and the HUD says how it went. */
const endTurn = async ($: EngineInterface, turnId: string, outcome: TurnOutcome, durationMs: number): Promise<void> => {
  // Keyed by turn id: a prompt queued right behind this turn may already have started a new
  // ledger (this turn's then waits in `previous`), and a repeated completion pays nothing.
  let bonus = 0
  await update($, ledger, (current): TurnLedger => {
    const settled = settleTurn(current, turnId, outcome)
    bonus = settled.bonus
    return settled.ledger
  })
  const now = await $.clock.now()
  let isDuplicate = false
  await update($, turn, (current): Turn | null => {
    const completed = completeTurn(current, turnId, outcome, durationMs, now)
    isDuplicate = completed.isDuplicate
    return completed.turn
  })
  // The turn is handed back: no file is in hand any more, the tree points at the last one.
  if (!isDuplicate) await update($, treeFocus, (): TreeFocus | null => NO_FOCUS)
  if (!isDuplicate) await note($, { kind: 'turn', durationMs })
  if (bonus > 0) {
    await note($, { kind: 'shipped' })
    await saveStats($, score => ({ ...score, xp: score.xp + bonus }))
    await say($, 'shipped', '')
  }
  // The wave starts a fresh idle spell, so the routines after it begin from where Mochi stands.
  await update($, activity, (current): MascotActivity =>
    current.kind === 'idle' ? { kind: 'idle', since: now, fromX: mascotXAt(current, now, sceneWidth) } : current,
  )
  $.ui.invalidate('ui.render')
}

/** A subagent's run completed: its worker walks out now instead of at the next status poll. */
const releaseWorker = async ($: EngineInterface, agentId: string): Promise<void> => {
  const now = await $.clock.now()
  await update($, workers, crew => workerFinished(crew, agentId, now))
}

/** Saves one setting; true when the store took it. */
const persist = async ($: EngineInterface, key: string, value: unknown): Promise<boolean> => {
  try {
    await $.store.set(key, value)
    return true
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: could not save ${key}: ${String(error)}`, { to: 'debug' })
    return false
  }
}

/** Answers `/mascot <args>`: opens the pane, lists or switches outfits, toggles sound. */
const runMascotCommand = async ($: EngineInterface, args: string): Promise<string> => {
  // `badge` takes free text (a title), so it is read by its own parser.
  const [verb = ''] = args.trim().split(/\s+/)
  if (verb.toLowerCase() === 'badge') return runBadgeCommand($, args.trim().slice(verb.length))
  // `place <name>` is the badge's place under its own name: picking a place picks its color.
  if (verb.toLowerCase() === 'place') return runBadgeCommand($, args.trim())
  const command = parseMascotCommand(args)
  switch (command.kind) {
    case 'open':
      await $.ui.open({ id: PANE, title: TITLE })
      return 'Mochi crew pane opened.'
    case 'list': {
      const current = await read($, outfit)
      return `Outfits: ${OUTFIT_NAMES.map(name => (name === current ? `[${name}]` : name)).join('  ')}`
    }
    case 'outfit':
      await update($, outfit, (): OutfitName => command.name)
      return (await persist($, STORE.outfit, command.name))
        ? `Mochi is now wearing: ${command.name}`
        : `Mochi is now wearing: ${command.name} (could not save it for next time)`
    case 'sound':
      await update($, isSoundOn, () => command.isOn)
      return (await persist($, STORE.isSoundOn, command.isOn))
        ? `Sound ${command.isOn ? 'on' : 'off'}.`
        : `Sound ${command.isOn ? 'on' : 'off'} (could not save it for next time).`
    case 'react':
      return react($, command.reaction)
    case 'achievements':
      return achievementList(await read($, achievements))
    case 'journal': {
      const score = await read($, stats)
      return `${journalReport(await read($, journal))}\n  All-time   LV ${levelOf(score.xp).level} · ${score.xp} XP · ${score.edits} edits`
    }
    case 'missions':
      return missionReport(await read($, missions), await read($, journal))
    case 'meter':
      return meterReportText($)
    case 'files': {
      // Flipped inside the update, so two quick presses flip twice.
      const isOn = await update($, isTreeOn, current => command.isOn ?? !current)
      if (isOn) queueTreeRefresh($)
      $.ui.invalidate('ui.render')
      return (await persist($, STORE.isTreeOn, isOn))
        ? `File tree ${isOn ? 'on' : 'off'}.`
        : `File tree ${isOn ? 'on' : 'off'} (could not save it for next time).`
    }
    case 'tutor':
      return runTutorCommand($, command.action)
    case 'error':
      return command.message
  }
}

// ── Session meter ──────────────────────────────────────────────────────────────────────
// Model, context, prompt cache and limits or cost, read the way the session's provider means
// them. The pure logic lives in meter*.ts; the wiring is here because the engine follows `$`
// only within the hooks module.

const NO_MEASURE: Measure | null = null
const NO_MODEL: string | null = null
const NO_RESPONSE: number | null = null
const NO_ALERTS: readonly string[] = []
const UNKNOWN_PROVIDER: Provider = 'unknown'
const meterMeasure = atom({ plugin: 'mochi-crew', key: 'meterMeasure' } as const, NO_MEASURE)
const meterCache = atom({ plugin: 'mochi-crew', key: 'meterCache' } as const, EMPTY_CACHE)
const meterModel = atom({ plugin: 'mochi-crew', key: 'meterModel' } as const, NO_MODEL)
// The model as of the last main-thread turn: a model switched since then has its own cache, so
// the tutor must not count on the chat's cache being warm.
const meterResponseModel = atom({ plugin: 'mochi-crew', key: 'meterResponseModel' } as const, NO_MODEL)
const meterProvider = atom({ plugin: 'mochi-crew', key: 'meterProvider' } as const, UNKNOWN_PROVIDER)
const meterLastResponseAt = atom({ plugin: 'mochi-crew', key: 'meterLastResponseAt' } as const, NO_RESPONSE)
const meterAlerts = atom({ plugin: 'mochi-crew', key: 'meterAlerts' } as const, NO_ALERTS)

// The environment does not change within a process; a reload re-runs session.start, which
// reads it again. The credential can (/login, /logout), so it is re-read with each measurement.
let providerEnv: ProviderEnv = {}
let ttlEnv: TtlEnv = {}
// The last credential kind read, kept when a later read fails.
let authKind: 'bearer' | 'api-key' | null = null
// Alert checks run one at a time, so a slower event cannot write back a stale raised list.
let alertQueue: Promise<void> = Promise.resolve()

/** The provider-selecting variables; `$.env.get` takes literals so `plugin validate` can list them. */
const readProviderEnv = async ($: EngineInterface): Promise<ProviderEnv> => ({
  CLAUDE_CODE_USE_ANTHROPIC_AWS: await $.env.get('CLAUDE_CODE_USE_ANTHROPIC_AWS'),
  CLAUDE_CODE_USE_BEDROCK: await $.env.get('CLAUDE_CODE_USE_BEDROCK'),
  CLAUDE_CODE_USE_MANTLE: await $.env.get('CLAUDE_CODE_USE_MANTLE'),
  CLAUDE_CODE_USE_VERTEX: await $.env.get('CLAUDE_CODE_USE_VERTEX'),
  CLAUDE_CODE_USE_FOUNDRY: await $.env.get('CLAUDE_CODE_USE_FOUNDRY'),
  ANTHROPIC_BASE_URL: await $.env.get('ANTHROPIC_BASE_URL'),
})

const readTtlEnv = async ($: EngineInterface): Promise<TtlEnv> => ({
  FORCE_PROMPT_CACHING_5M: await $.env.get('FORCE_PROMPT_CACHING_5M'),
  CLAUDE_CODE_PROMPT_CACHE_TTL: await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
})

/** A figure the meter can draw, or undefined for a missing or non-finite one. */
const finite = (value: number | undefined): number | undefined =>
  value !== undefined && Number.isFinite(value) ? value : undefined

/** The meter's copy of a measurement: only the figures it draws, each checked at the boundary. */
const toMeasure = (e: SessionMeasureInput): Measure => {
  const tokens = finite(e.context.tokens)
  const percent = finite(e.context.percent)
  return {
    // A fill is drawn only when both halves of it are real numbers.
    tokens: percent === undefined ? undefined : tokens,
    percent: tokens === undefined ? undefined : percent,
    window: finite(e.context.window) ?? 0,
    limits: e.rateLimits.flatMap(window => {
      const percentUsed = finite(window.percentUsed)
      return percentUsed === undefined ? [] : [{ kind: window.kind, percentUsed }]
    }),
    costUsd: finite(e.cost?.usd),
  }
}

/** Re-reads who serves the session; plan windows only appear after the first response. */
const refreshProvider = async ($: EngineInterface, limitKinds: readonly string[]): Promise<void> => {
  try {
    authKind = (await $.session.authorize())?.kind ?? null
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: meter could not read the credential kind, keeping the last one: ${String(error)}`, { to: 'debug' })
  }
  const detected = detectProvider({ env: providerEnv, authKind, limitKinds })
  await update($, meterProvider, (previous): Provider => settleProvider(previous, detected))
}

const refreshModel = async ($: EngineInterface): Promise<void> => {
  const id = await $.session.model()
  await update($, meterModel, (): string | null => (id.trim() === '' ? null : id))
}

/** Clears what counts per conversation: a new session, a `/clear`, a resume. */
const resetConversation = async ($: EngineInterface): Promise<void> => {
  await update($, meterCache, (): CacheTotals => EMPTY_CACHE)
  await update($, meterLastResponseAt, (): number | null => NO_RESPONSE)
  await update($, meterResponseModel, (): string | null => NO_MODEL)
  await update($, tutorSession, (): TutorSession => FRESH_TUTOR_SESSION)
  await update($, meterAlerts, (): readonly string[] => NO_ALERTS)
  await update($, meterMeasure, (): Measure | null => NO_MEASURE)
}

/** Toasts each heads-up the latest figures newly call for, once per crossing. */
const checkAndToast = async ($: EngineInterface): Promise<void> => {
  const current = await read($, meterMeasure)
  const facts = {
    contextPercent: current?.tokens === undefined ? undefined : current.percent,
    limits: current?.limits ?? [],
    isCacheUnreported: isCacheUnreported(await read($, meterCache)),
  }
  // Decided inside the update, so two events racing for one alert toast it once.
  let due: readonly Alert[] = []
  await update($, meterAlerts, raised => {
    const check = checkAlerts(raised, facts)
    due = check.due
    return check.raised
  })
  for (const alert of due) $.ui.toast(alert.text)
}

/** Queues an alert check behind any still running, so each reads the figures its turn left. */
const raiseAlerts = ($: EngineInterface): Promise<void> => {
  const run = alertQueue.then(() => checkAndToast($))
  alertQueue = run.catch((error: unknown) => $.ui.log(`mochi-crew: meter alert check failed: ${String(error)}`, { to: 'debug' }))
  return run
}

/**
 * A failed meter hook steps aside for the engine, leaving its reason in the debug log. In a
 * re-entry failure the log call itself rejects; the engine then treats the hook as absent,
 * which is the same outcome, and its own line for the failure still stands.
 */
const logFailure = ($: EngineInterface, hook: string, failure: HookFailure): void =>
  $.ui.log(`mochi-crew: meter ${hook} failed: ${describeFailure(failure)}`, { to: 'debug' })

/** Time since the last main-thread turn ended, null before one or while a turn runs. */
const idleAt = async ($: EngineInterface, isWorking: boolean): Promise<number | null> => {
  const respondedAt = await read($, meterLastResponseAt)
  return respondedAt === null || isWorking ? null : (await $.clock.now()) - respondedAt
}

/** Everything the HUD's meter rows show, read from state only (the pane draws from this). */
const readMeterView = async ($: EngineInterface, isWorking: boolean): Promise<MeterView> => {
  const idleMs = await idleAt($, isWorking)
  return {
    modelId: await read($, meterModel),
    provider: await read($, meterProvider),
    measure: await read($, meterMeasure),
    cache: await read($, meterCache),
    idleMs,
    isCold: idleMs !== null && isCertainlyCold(idleMs, ttlEnv),
  }
}

/** The `/mascot meter` report. */
const meterReportText = async ($: EngineInterface): Promise<string> => {
  const view = await readMeterView($, false)
  return meterReport({ ...view, coldAfterMs: certainlyColdAfterMs(ttlEnv) })
}

/**
 * Starts the meter for a new session: reads the provider's environment and the model.
 * Called from Mochi's own session.start hook (a plugin hooks each event once); it never
 * throws, so a meter failure cannot stop Mochi from starting.
 */
const startMeter = async ($: EngineInterface): Promise<void> => {
  try {
    providerEnv = await readProviderEnv($)
    ttlEnv = await readTtlEnv($)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: meter could not start: ${String(error)}`, { to: 'debug' })
  }
  // Separate from the model read, so a failing model lookup still leaves the provider known.
  await refreshProvider($, []).catch((error: unknown) =>
    $.ui.log(`mochi-crew: meter could not detect the provider: ${String(error)}`, { to: 'debug' }),
  )
  await refreshModel($).catch((error: unknown) =>
    $.ui.log(`mochi-crew: meter could not read the model: ${String(error)}`, { to: 'debug' }),
  )
}

/**
 * Counts one finished turn: idle restarts and, on the main thread, the cache totals grow.
 * Called from Mochi's own turn.complete hook; it never throws.
 */
const noteMeterTurn = async ($: EngineInterface, e: TurnCompleteInput): Promise<void> => {
  // Subagents run their own caches; counting them would skew the main conversation's rate.
  if (e.agentId !== undefined) return
  try {
    // Any main turn may have touched the cache, an interrupted one included, so idle counts
    // from its end; that keeps "cold" from being claimed while the cache is still warm.
    const now = await $.clock.now()
    await update($, meterLastResponseAt, (): number | null => now)
    const usage = e.usage
    if (usage !== undefined) await update($, meterCache, totals => addUsage(totals, usage))
    await refreshModel($)
    // Read back rather than taken from the turn's usage: the tutor compares it with `meterModel`,
    // so both must be the same spelling of the id.
    const answeredBy = await read($, meterModel)
    await update($, meterResponseModel, (): string | null => answeredBy)
    // Claude answered again, so a fork that missed the cache earlier says nothing about it now.
    await update($, tutorSession, current => (current.isForkSuspect ? { ...current, isForkSuspect: false } : current))
    await raiseAlerts($)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: meter could not count a turn: ${String(error)}`, { to: 'debug' })
  }
}

// ── Mochi Tutor ──────────────────────────────────────────────────────────────────────
// A quiz tab on the project and on what Claude changed. The pure logic lives in tutor*.ts; the
// wiring is here because the engine follows `$` only within the hooks module. The tab draws from
// atoms only; every screen change happens in a handler, through `dispatchTutor`.

const TUTOR_PANE = 'mochi-tutor'
const TUTOR_TITLE = 'Tutor'
/**
 * The first-use notice's version: a stored consent below it shows the notice again. 2: the
 * notice now says the digest sends every uncommitted change in the folder, not touched files only.
 */
const TUTOR_CONSENT_VERSION = 2
/** At most this many due cards make one review round. */
const REVIEW_ROUND_MAX = 5
/** Text props for each tutor tone: the meter's, and green for a right answer. */
const TUTOR_TONES: Readonly<Record<TutorTone, { color?: string; dimColor?: boolean; bold?: boolean }>> = {
  ...METER_TONES,
  good: { color: THEME.good },
}
// Opened from the main pane, the tab usually does not get the keys (the person holds them there).
const TUTOR_UNFOCUSED = 'Tutor tab is open: press ctrl+x tab, or click it.'
const TUTOR_UNPLACED = 'Tutor tab opened; widen the terminal to see it.'
const TUTOR_BUSY = 'Mochi is already writing one.'
const TUTOR_TOO_SHORT = 'type an answer, or press r to see it'
const TUTOR_ASK_FAILED = "Mochi couldn't answer that one."
// Shown while the digest stands in for a fork that could not answer.
const TUTOR_FALLBACK_NOTE = 'session unavailable, using the digest…'
// A fork has no time limit of its own; past this the round stops waiting and asks the digest.
const FORK_WAIT_MS = 60_000
// A digest's git reads whole diffs, slower than the tree's status reads.
const TUTOR_GIT_MS = 8_000
const TUTOR_SPINNER_MS = 500
// Transcript messages the digest may draw on, newest kept.
const TUTOR_MESSAGES = 200
// New files the digest shows, and how far into each it reads.
const TUTOR_NEW_FILES = 2
const TUTOR_NEW_FILE_LINES = 60

const TUTOR_CLOSED: TutorState = { phase: 'closed' }
const NO_TUTOR_PROJECT: TutorProject | null = null
const FRESH_TUTOR_SESSION: TutorSession = { rounds: 0, usage: EMPTY_USAGE, isForkSuspect: false }
const tutor = atom({ plugin: 'mochi-crew', key: 'tutor' } as const, TUTOR_CLOSED)
const tutorConsent = atom({ plugin: 'mochi-crew', key: 'tutorConsent' } as const, 0)
const tutorProject = atom({ plugin: 'mochi-crew', key: 'tutorProject' } as const, NO_TUTOR_PROJECT)
const tutorSession = atom({ plugin: 'mochi-crew', key: 'tutorSession' } as const, FRESH_TUTOR_SESSION)

// The `/config` pickers, read once per load: a change there reloads the module, which drops a
// round in flight along with every other module variable.
let tutorConfig: TutorConfig = DEFAULT_TUTOR_CONFIG
// A `-p` run has no tab to quiz in. Set by each session.start.
let isInteractive = true
// Where the tab last drew (a module variable, not state, so drawing may write it): a handler
// works out the screen it just caused, and so its focus key, without render props.
let tutorViewport: { readonly surface: RenderSurface; readonly columns: number; readonly bodyRows: number } = { surface: 'terminal', columns: 44, bodyRows: 30 }
// The last epoch handed out: each screen that waits on a call (and each round, as its shuffle
// seed) takes the next one, inside the update that puts it up. Whether a reply still counts is
// read off the screen (isLiveCall), never off this, so a stop needs no bump and a refused press
// strands nothing.
let tutorEpoch = 0
// The digest call's abort, the fork's watchdog and the loading spinner of the round in flight.
// A continuation releases only the one it armed, so a stale one never stops a newer round's.
let tutorAbort: AbortController | undefined
let tutorWatchdog: Timer | undefined
let tutorSpinner: Timer | undefined
// The digest the round on screen was written from (its excerpts back follow-ups); null on a fork.
let tutorDigest: Digest | null = null

/** A round asked for before the notice was accepted, started once it is. */
type TutorPending = { readonly focus: TutorFocus; readonly isDigestOnly: boolean }

/** Everything the plan weighs, read from atoms: the tab's ctx line and a start read it alike, so the label names the source used. */
const readPlanInput = async ($: EngineInterface, isDigestOnly: boolean, now: number): Promise<TutorPlanInput> => ({
  config: tutorConfig,
  isDigestOnly,
  lastResponseAt: await read($, meterLastResponseAt),
  now,
  isWorking: isThinking(await read($, turn)),
  ttl: ttlEnv,
  contextTokens: (await read($, meterMeasure))?.tokens,
  modelNow: await read($, meterModel),
  modelAtResponse: await read($, meterResponseModel),
  isForkSuspect: (await read($, tutorSession)).isForkSuspect,
})

/** Everything a tutor screen needs besides its state, read from atoms only (the tab draws from this). */
const readTutorView = async ($: EngineInterface, state: TutorState): Promise<TutorViewContext> => {
  const now = await $.clock.now()
  const session = await read($, tutorSession)
  const touched = await read($, treeTouched)
  const snapshot = await read($, tree)
  const input = await readPlanInput($, state.phase === 'home' && state.isDigestOnly, now)
  const plan = choosePlan(input)
  // Only a file the session itself touched in its own checkout may open: a model-named path never does.
  const openable = new Set(touched.filter(file => file.worktree === undefined).map(file => file.path))
  return {
    ...tutorViewport,
    now,
    plan,
    canFork: choosePlan({ ...input, isDigestOnly: false }).source === 'fork',
    planText: planLabel(plan, tutorConfig.model),
    project: (await read($, tutorProject)) ?? FRESH_PROJECT,
    session,
    hasContent: (await read($, journal)).turns > 0 || touched.length > 0 || Object.keys(snapshot?.marks ?? {}).length > 0,
    canOpenFile: file => openable.has(file),
    model: tutorConfig.model,
  }
}

/**
 * Moves the tab's focus ring to what its screen asks for. A tab without the keys says no, the
 * usual case after opening it from the main pane, so a refusal or failure only reaches the
 * debug log: every control also works by click.
 */
const focusTutor = async ($: EngineInterface, state: TutorState): Promise<void> => {
  try {
    const key = tutorScreen(state, await readTutorView($, state)).focusKey
    if (key === undefined) return
    const moved = await $.ui.focus({ requestId: TUTOR_PANE, key })
    if (moved.deny !== undefined) $.ui.log(`mochi-crew: tutor focus stayed put: ${moved.deny}`, { to: 'debug' })
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: tutor could not move the focus: ${String(error)}`, { to: 'debug' })
  }
}

/** Applies one event to the latest screen and redraws; the screens before and after it. */
const changeTutor = async ($: EngineInterface, event: TutorEvent): Promise<{ readonly before: TutorState; readonly after: TutorState }> => {
  const seen: { before: TutorState } = { before: TUTOR_CLOSED }
  const after = await update($, tutor, current => {
    seen.before = current
    return applyTutor(current, event)
  })
  $.ui.invalidate('ui.render')
  return { before: seen.before, after }
}

/** Applies one event to the latest screen and redraws; the screen it led to. */
const showTutor = async ($: EngineInterface, event: TutorEvent): Promise<TutorState> => (await changeTutor($, event)).after

/** One screen change from a handler: applied, drawn, and the focus moved onto it. */
const dispatchTutor = async ($: EngineInterface, event: TutorEvent): Promise<TutorState> => {
  const shown = await showTutor($, event)
  await focusTutor($, shown)
  return shown
}

/** Loads the saved consent and this project's progress once; a bad read starts fresh (logged). */
const loadTutor = async ($: EngineInterface): Promise<void> => {
  if ((await read($, tutorProject)) !== null) return
  const savedConsent = await readSaved($, STORE.tutorConsent)
  const saved = parseProgress(await readSaved($, STORE.tutorProgress))
  const root = await $.session.root()
  await update($, tutorConsent, () => (typeof savedConsent === 'number' && Number.isFinite(savedConsent) ? savedConsent : 0))
  await update($, tutorProject, (): TutorProject | null => projectOf(saved, root))
}

const hasTutorConsent = async ($: EngineInterface): Promise<boolean> =>
  (await read($, tutorConsent)) >= TUTOR_CONSENT_VERSION

/** Saves this project's progress beside the other projects' (re-read, so none is dropped); true when the store took it. */
const saveTutorProject = async ($: EngineInterface, project: TutorProject): Promise<boolean> => {
  const root = await $.session.root()
  const saved = parseProgress(await readSaved($, STORE.tutorProgress))
  return persist($, STORE.tutorProgress, withProject(saved, root, project))
}

/** The tutor tab as the engine lists it, or undefined when it cannot say (logged). */
const tutorPaneNow = async ($: EngineInterface): Promise<UiPane | undefined> => {
  try {
    return (await $.ui.panes()).find(pane => pane.id === TUTOR_PANE)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: could not list the tutor tab: ${String(error)}`, { to: 'debug' })
    return undefined
  }
}

/**
 * Opens or raises the tutor tab on the screen it was left on, the notice first until it is
 * accepted; it never starts a round. Returns the toast saying how to reach the tab when it did
 * not get the keys, else null.
 */
const openTutor = async ($: EngineInterface, pending?: TutorPending): Promise<string | null> => {
  await loadTutor($)
  const shown = await showTutor($, { kind: 'open', hasConsent: await hasTutorConsent($), ...(pending === undefined ? {} : { pending }) })
  const opened = await $.ui.open({ id: TUTOR_PANE, title: TUTOR_TITLE, focus: true })
  const pane = await tutorPaneNow($)
  // Checked first: a tab waiting undrawn holds no keys either, and widening is what it needs.
  if (!opened.isPlaced || pane?.isPlaced === false) return TUTOR_UNPLACED
  if (pane?.isFocused !== true) return TUTOR_UNFOCUSED
  await focusTutor($, shown)
  return null
}

/** `y` on the notice: saved for next time, then Home, or the round asked for before it. */
const acceptTutor = async ($: EngineInterface): Promise<void> => {
  await update($, tutorConsent, () => TUTOR_CONSENT_VERSION)
  // A failed save is logged by persist; the consent still holds until the process ends.
  await persist($, STORE.tutorConsent, TUTOR_CONSENT_VERSION)
  // Read inside the update, so a doubled `y` starts the pending round once.
  let pending: TutorPending | undefined
  const shown = await update($, tutor, current => {
    pending = current.phase === 'consent' ? current.pending : undefined
    return applyTutor(current, { kind: 'consented' })
  })
  $.ui.invalidate('ui.render')
  if (pending !== undefined) {
    await startRound($, pending.focus, pending.isDigestOnly)
    return
  }
  await focusTutor($, shown)
}

/** `n` on the notice or `x: close`: the tab closes, and the next open starts from the notice or Home. */
const closeTutor = async ($: EngineInterface, kind: 'declined' | 'closed'): Promise<void> => {
  await showTutor($, { kind })
  await $.ui.close({ id: TUTOR_PANE })
}

// ── writing a round ────────────────────────────────────────────────────────────────

/**
 * Stops what can be stopped of a call in flight: the digest's, grade's or follow-up's request,
 * the fork's watchdog, the spinner. Its reply is already stale once the screen moved on.
 */
const abortTutorCalls = (): void => {
  tutorAbort?.abort()
  tutorAbort = undefined
  tutorWatchdog?.cancel()
  tutorWatchdog = undefined
  tutorSpinner?.cancel()
  tutorSpinner = undefined
}

/** Whether a screen waits on a call; one call runs at a time, so a start then is turned away. */
const isTutorBusy = (state: TutorState): boolean => state.phase === 'loading' || state.phase === 'grading' || state.phase === 'asking'

/** The epoch a screen waits under (a round being written, a grade, a follow-up); undefined when it waits on nothing. */
const waitingEpoch = (state: TutorState): number | undefined =>
  state.phase === 'loading' || state.phase === 'grading' || state.phase === 'asking' ? state.epoch : undefined

/** Whether the screen still waits on the call of `epoch`; a stop, a fallback or session end has moved it on otherwise. */
const isLiveCall = async ($: EngineInterface, epoch: number): Promise<boolean> => waitingEpoch(await read($, tutor)) === epoch

/**
 * Applies the event `make` builds from the latest screen and a fresh epoch, or nothing when it
 * returns undefined. Decided inside the update, so a doubled press claims one screen; the epoch
 * is taken only when the reducer accepts the event. Undefined `epoch` when it did not.
 */
const claimTutor = async ($: EngineInterface, make: (current: TutorState, epoch: number) => TutorEvent | undefined): Promise<{ readonly state: TutorState; readonly epoch?: number }> => {
  let claimed: number | undefined
  const state = await update($, tutor, current => {
    // A missed write runs this again on the newer screen, which decides afresh.
    claimed = undefined
    const epoch = tutorEpoch + 1
    const event = make(current, epoch)
    if (event === undefined) return current
    const next = applyTutor(current, event)
    if (next === current) return current
    tutorEpoch = epoch
    claimed = epoch
    return next
  })
  $.ui.invalidate('ui.render')
  return claimed === undefined ? { state } : { state, epoch: claimed }
}

/** Adds one call's spend to this conversation's total; stale and failed calls count too (C.7). */
const spendTutor = async ($: EngineInterface, usage: ModelUsage): Promise<void> => {
  await update($, tutorSession, (current): TutorSession => ({ ...current, usage: addTutorUsage(current.usage, usage) }))
}

/** Counts a fork's spend, and latches the digest when its reply missed the cache, on time or late. */
const noteFork = async ($: EngineInterface, result: ModelForkResult): Promise<void> => {
  // Nothing to fork made no request.
  if (!('usage' in result)) return
  await spendTutor($, result.usage)
  // An API error's usage says nothing about the cache: only a reply's does.
  if ((result.isAnswered || result.reason === 'empty-reply') && isForkMiss(result.usage)) {
    await update($, tutorSession, (current): TutorSession => (current.isForkSuspect ? current : { ...current, isForkSuspect: true }))
  }
}

/** A fork's outcome: its result, or that the watchdog stopped waiting for it first. */
type ForkWait = { readonly kind: 'result'; readonly result: ModelForkResult } | { readonly kind: 'late' }

// A refused fork made no request either; the digest takes over as it does for nothing to fork.
const NOTHING_FORKED: ModelForkResult = { isAnswered: false, reason: 'nothing-to-fork' }

/**
 * Asks the session's own chat for a round (C.2), waiting at most FORK_WAIT_MS. A fork has no
 * signal, so the watchdog only stops the waiting: a late reply's spend still counts, and its
 * cache miss still latches the digest.
 */
const runFork = async ($: EngineInterface, prompt: string): Promise<ForkWait> => {
  const forked = $.model.fork({ prompt }).then(
    (result): ForkWait => ({ kind: 'result', result }),
    (error: unknown): ForkWait => {
      $.ui.log(`mochi-crew: tutor fork was refused: ${String(error)}`, { to: 'debug' })
      return { kind: 'result', result: NOTHING_FORKED }
    },
  )
  let stopWaiting: (wait: ForkWait) => void = () => undefined
  const late = new Promise<ForkWait>(resolve => {
    stopWaiting = resolve
  })
  // A timer, not a sleep: a sleep would spend the hook's own budget.
  const watchdog = $.clock.after(FORK_WAIT_MS, () => stopWaiting({ kind: 'late' }))
  tutorWatchdog = watchdog
  try {
    const first = await Promise.race([forked, late])
    if (first.kind === 'result') {
      await noteFork($, first.result)
    } else {
      void forked
        .then(settled => (settled.kind === 'result' ? noteFork($, settled.result) : undefined))
        .catch((error: unknown) => $.ui.log(`mochi-crew: tutor could not count a late fork: ${String(error)}`, { to: 'debug' }))
    }
    return first
  } finally {
    watchdog.cancel()
    if (tutorWatchdog === watchdog) tutorWatchdog = undefined
  }
}

/**
 * A tutor completion's outcome: its result, that the engine refused to send it (a blocked
 * model), or that it was never sent because its screen had moved on.
 */
type CompleteCall = { readonly kind: 'result'; readonly result: ModelCompleteResult } | { readonly kind: 'refused' } | { readonly kind: 'stale' }

/**
 * Sends one tutor completion (a digest round, a grade, a follow-up) with its own abort, which
 * `x` and session end pull (C.6), only while the screen still waits on `epoch`. Its spend
 * counts for the session at once, stale or not.
 */
const runComplete = async ($: EngineInterface, request: ModelCompleteRequest, epoch: number): Promise<CompleteCall> => {
  const controller = new AbortController()
  tutorAbort = controller
  try {
    // Armed before the check, so a stop landing while it reads still aborts what is sent.
    if (!(await isLiveCall($, epoch)) || controller.signal.aborted) return { kind: 'stale' }
    const result = await $.model.complete(request, { signal: controller.signal })
    await spendTutor($, result.usage)
    return { kind: 'result', result }
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: tutor model call was refused: ${String(error)}`, { to: 'debug' })
    return { kind: 'refused' }
  } finally {
    if (tutorAbort === controller) tutorAbort = undefined
  }
}

/** The files this session touched in its own checkout, newest first, once each. */
const ownTouched = (touched: readonly TouchedFile[]): readonly string[] =>
  [...new Set([...touched].reverse().filter(file => file.worktree === undefined).map(file => file.path))]

/** The transcript as the digest may use it, mapped at once so no tool result is held; none when it cannot be read (logged). */
const readTranscript = async ($: EngineInterface, root: string): Promise<readonly TranscriptRow[]> => {
  try {
    return toTranscriptRows(await $.session.messages(), root, TUTOR_MESSAGES)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: tutor could not read the transcript: ${String(error)}`, { to: 'debug' })
    return []
  }
}

/**
 * The first lines of up to two new (untracked) files this session touched, never a
 * secret-looking one, a link, a large file or one that lands outside the project.
 */
const readNewFiles = async ($: EngineInterface, root: string, touched: readonly TouchedFile[], snapshot: TreeSnapshot | null): Promise<readonly { readonly path: string; readonly text: string }[]> => {
  const marks = snapshot?.marks ?? {}
  const paths = ownTouched(touched).filter(path => marks[path] === '?' && !isSecretPath(path)).slice(0, TUTOR_NEW_FILES)
  if (paths.length === 0) return []
  const rootReal = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath
  if (rootReal === undefined) return []
  const read = await Promise.all(paths.map(async path => {
    try {
      const stat = await $.fs.stat(`${root}/${path}`, { resolve: true })
      if (!isReadableNewFile(stat, rootReal) || stat.realPath === undefined) return []
      // Read where it landed, not by the spelling that was checked.
      const text = await $.fs.read(stat.realPath)
      return [{ path, text: text.split('\n').slice(0, TUTOR_NEW_FILE_LINES).join('\n') }]
    } catch (error: unknown) {
      $.ui.log(`mochi-crew: tutor could not read a new file: ${String(error)}`, { to: 'debug' })
      return []
    }
  }))
  return read.flat()
}

/** A git command for the tutor: its longer timeout, and its output capped so a huge diff is never held whole. */
const tutorGit = async ($: EngineInterface, root: string, args: readonly string[]): Promise<string | undefined> =>
  capGitOutput(await gitOutput($, root, args, TUTOR_GIT_MS))

/** The uncommitted changes a digest may show, read in two steps; each part is absent when git fails. */
type DigestChanges = { readonly plan: DiffPlan; readonly numstat?: string; readonly diff?: string }

/**
 * Lists the changes repository-wide first, renames found, and keeps only paths whose old and new
 * names are both safe; then diffs just those, by literal path. One step with exclude pathspecs
 * would let `git mv .env config.txt` through, since pathspecs apply before rename detection.
 */
const readChanges = async ($: EngineInterface, root: string, touched: readonly TouchedFile[], added: Readonly<Record<string, number>>): Promise<DigestChanges> => {
  const [prefix, listed] = await Promise.all([
    tutorGit($, root, ['rev-parse', '--show-prefix']),
    tutorGit($, root, nameStatusArgs()),
  ])
  const none: DiffPlan = { paths: [], blocked: 0, omitted: 0 }
  if (prefix === undefined || listed === undefined) return { plan: none }
  const plan = planDiff(listed, prefix.replace(/\n$/, ''), touched, added)
  if (plan.blocked > 0 || plan.omitted > 0) {
    $.ui.log(`mochi-crew: tutor digest left out ${plan.blocked} secret-shaped and ${plan.omitted} extra changed files`, { to: 'debug' })
  }
  if (plan.paths.length === 0) return { plan }
  const [numstat, diff] = await Promise.all([
    tutorGit($, root, numstatArgs(plan.paths)),
    tutorGit($, root, diffArgs(plan.paths)),
  ])
  return { plan, numstat, diff }
}

/** The masked digest of the project and this session (C.4); its reads run in parallel, and a part that fails is left out. */
const gatherDigest = async ($: EngineInterface, root: string, focus: TutorFocus, touched: readonly TouchedFile[]): Promise<Digest> => {
  const snapshot = await read($, tree)
  const [log, changes, lsFiles, rows, newFiles] = await Promise.all([
    tutorGit($, root, logArgs()),
    readChanges($, root, touched, snapshot?.added ?? {}),
    focus === 'project' ? tutorGit($, root, lsFilesArgs()) : Promise.resolve(undefined),
    readTranscript($, root),
    readNewFiles($, root, touched, snapshot),
  ])
  const { plan, numstat, diff } = changes
  return buildDigest({
    rootName: snapshot?.rootName ?? root.split(/[\\/]/).filter(part => part !== '').at(-1) ?? root,
    branch: snapshot?.branch,
    focus,
    log,
    numstat,
    diff,
    lsFiles,
    newFiles,
    rows,
    touched,
    added: snapshot?.added ?? {},
    plan,
  })
}

/** What a start asked for: the round's first epoch, its focus and plan, the learner it is pitched at. */
type RoundOrder = { readonly epoch: number; readonly focus: TutorFocus; readonly plan: TutorPlan; readonly project: TutorProject; readonly at: number }

/** The epoch a round being written waits under now; mutable, since a fallback to the digest moves it on. */
type RoundHold = { epoch: number }

/**
 * Applies a call's event only while the screen waiting on that call is up, so a stopped round,
 * grade or follow-up never paints over what replaced it. True when it was applied.
 */
const showReply = async ($: EngineInterface, epoch: number, event: TutorEvent): Promise<boolean> => {
  let isShown = false
  const shown = await update($, tutor, current => {
    if (waitingEpoch(current) !== epoch) return current
    isShown = true
    return applyTutor(current, event)
  })
  if (!isShown) return false
  $.ui.invalidate('ui.render')
  await focusTutor($, shown)
  return true
}

const dropStale = ($: EngineInterface): void => $.ui.log('mochi-crew: tutor dropped a stale reply', { to: 'debug' })

/** The reason a reply was not a quiz, with counts only: model text is never logged. */
const logInvalid = ($: EngineInterface, parsed: Extract<ParseOutcome, { isValid: false }>): void =>
  $.ui.log(`mochi-crew: tutor reply invalid: ${parsed.why}${parsed.valid === undefined ? '' : ` (${parsed.valid} valid, ${parsed.dropped ?? 0} dropped)`}`, { to: 'debug' })

/**
 * Writes the round a start asked for (B.3): from the fork when the plan says so, falling back to
 * the digest at most once; the digest never retries. Every continuation checks that the screen
 * still waits on its epoch: a stopped round's reply is dropped, and only its spend is kept.
 */
const writeQuestions = async ($: EngineInterface, order: RoundOrder, hold: RoundHold): Promise<void> => {
  const { focus, project, at } = order
  let spent: TutorUsage = EMPTY_USAGE
  const root = await $.session.root()
  const touched = await read($, treeTouched)
  const review = dueCards(project, 1)[0]?.question
  const ctx = { focus, level: project.level, count: ROUND_SIZE - (review === undefined ? 0 : 1), misses: project.recentMisses, mastered: project.mastered }
  // Unique across sessions: a replayed card keeps its own id, which a new question must never share.
  const roundId = (): string => `round-${at}-${hold.epoch}`
  const fail = async (failure: TutorFailure, canTryDigest: boolean): Promise<void> => {
    await showReply($, hold.epoch, { kind: 'failed', failure, canTryDigest })
  }
  const show = async (source: 'fork' | 'digest', questions: readonly TutorQuestion[]): Promise<void> => {
    const round: TutorRound = {
      id: roundId(),
      epoch: hold.epoch,
      focus,
      source,
      startedAt: at,
      questions: spliceReview(questions, review, hold.epoch),
      index: 0,
      answers: [],
      isHintShown: false,
      isRetry: false,
      chat: [],
      followUpsUsed: 0,
      usage: spent,
    }
    if (await showReply($, hold.epoch, { kind: 'loaded', round })) await say($, 'tutor-start', '')
  }
  tutorDigest = null

  if (order.plan.source === 'fork') {
    const files = ownTouched(touched)
    const commits = (await tutorGit($, root, logArgs())) ?? ''
    if (!(await isLiveCall($, hold.epoch))) return dropStale($)
    const waited = await runFork($, forkPrompt({ ...ctx, files, commits }))
    if (!(await isLiveCall($, hold.epoch))) return dropStale($)
    if (waited.kind === 'result') {
      if ('usage' in waited.result) spent = addTutorUsage(spent, waited.result.usage)
      const next = afterFork(waited.result)
      if (next.kind === 'error') return fail(next.failure, true)
      if (next.kind === 'parse') {
        const parsed = parseRound(next.text, roundId(), new Set(files), ctx.count, hold.epoch)
        if (parsed.isValid) return show('fork', parsed.questions)
        logInvalid($, parsed)
      }
    } else {
      $.ui.log('mochi-crew: tutor fork took too long, using the digest', { to: 'debug' })
    }
    const now = await $.clock.now()
    // Once, under a new epoch, so the fork's late reply is stale and the digest's round is current.
    const fellBack = await claimTutor($, (current, next) =>
      waitingEpoch(current) === hold.epoch ? { kind: 'loading', epoch: next, focus, source: 'digest', at: now, note: TUTOR_FALLBACK_NOTE } : undefined,
    )
    if (fellBack.epoch === undefined) return dropStale($)
    hold.epoch = fellBack.epoch
    await focusTutor($, fellBack.state)
  }

  const digest = await gatherDigest($, root, focus, touched)
  if (!(await isLiveCall($, hold.epoch))) return dropStale($)
  // Nothing in git or the transcript, and nothing forked: no call is made (B.3).
  if (digest.isEmpty) return fail({ kind: 'nothing-to-quiz' }, false)
  tutorDigest = digest
  const called = await runComplete($, digestRequest({ ...ctx, files: digest.files, commits: '' }, digest, tutorConfig), hold.epoch)
  if (called.kind === 'stale' || !(await isLiveCall($, hold.epoch))) return dropStale($)
  if (called.kind === 'refused') return fail({ kind: 'model-refused', model: tutorConfig.model }, false)
  spent = addTutorUsage(spent, called.result.usage)
  const next = afterDigest(called.result)
  if (next.kind === 'error') return fail(next.failure, false)
  const parsed = parseRound(next.text, roundId(), new Set(digest.files), ctx.count, hold.epoch)
  if (!parsed.isValid) {
    logInvalid($, parsed)
    return fail({ kind: 'bad-reply', why: parsed.why }, false)
  }
  return show('digest', parsed.questions)
}

/** Runs `work` with the tab's spinner turning, released when it settles (only this one: a newer call's stays). */
const withSpinner = async ($: EngineInterface, work: () => Promise<void>): Promise<void> => {
  // The ticker repaints only the scene, so the spinner and its seconds need their own redraw.
  const spinner = $.clock.every(TUTOR_SPINNER_MS, () => $.ui.invalidate('ui.render'))
  tutorSpinner = spinner
  try {
    await work()
  } finally {
    spinner.cancel()
    if (tutorSpinner === spinner) tutorSpinner = undefined
  }
}

/** Writes a round with the loading spinner turning; a round that throws goes back Home rather than spin on (logged). */
const writeRound = async ($: EngineInterface, order: RoundOrder): Promise<void> => {
  const hold: RoundHold = { epoch: order.epoch }
  return withSpinner($, async () => {
    try {
      await writeQuestions($, order, hold)
    } catch (error: unknown) {
      $.ui.log(`mochi-crew: tutor could not write a round: ${String(error)}`, { to: 'debug' })
      // Its own loading screen only, by the epoch it holds: a round started after this one was stopped has a higher one.
      await update($, tutor, current => (current.phase === 'loading' && current.epoch === hold.epoch ? applyTutor(current, { kind: 'cancel' }) : current))
      $.ui.invalidate('ui.render')
    }
  })
}

/**
 * Starts a round on `focus`, asking for consent first. One call runs at a time: a start while
 * one does is turned away with a toast. The round is written unawaited, so a press and `/mochi
 * tutor start` answer at once; true when its loading screen is up.
 */
const startRound = async ($: EngineInterface, focus: TutorFocus, isDigestOnly: boolean): Promise<boolean> => {
  if (!(await hasTutorConsent($))) {
    await dispatchTutor($, { kind: 'open', hasConsent: false, pending: { focus, isDigestOnly } })
    return false
  }
  // Read now rather than at the last measure: a `/model` switch since has a cache of its own.
  await refreshModel($).catch((error: unknown) => $.ui.log(`mochi-crew: tutor could not read the model: ${String(error)}`, { to: 'debug' }))
  const at = await $.clock.now()
  const plan = choosePlan(await readPlanInput($, isDigestOnly, at))
  const project = (await read($, tutorProject)) ?? FRESH_PROJECT
  let isBusy = false
  const { state: shown, epoch } = await claimTutor($, (current, next) => {
    isBusy = isTutorBusy(current)
    return isBusy ? undefined : { kind: 'loading', epoch: next, focus, source: plan.source, at }
  })
  if (isBusy) {
    $.ui.toast(TUTOR_BUSY)
    return false
  }
  // A round on screen takes no start: it is finished or ended first.
  if (epoch === undefined) return false
  // Nothing on screen waited, so a call still running is a stopped one's.
  abortTutorCalls()
  await focusTutor($, shown)
  void writeRound($, { epoch, focus, plan, project, at }).catch((error: unknown) =>
    $.ui.log(`mochi-crew: tutor round failed: ${String(error)}`, { to: 'debug' }),
  )
  return true
}

/** The review round of `cards` under `epoch`, each question reshuffled by its own seed. */
const reviewRound = (cards: ReturnType<typeof dueCards>, epoch: number, now: number, focus: TutorFocus): TutorRound => ({
  // Unique across sessions, since a review card keeps its question's own id.
  id: `review-${now}-${epoch}`,
  epoch,
  focus,
  source: 'review',
  startedAt: now,
  // Seeded per question, as the parser seeds a round, so equal-length option lists move apart.
  questions: cards.map(({ question }, index) => replayQuestion(question, epoch * 31 + index)),
  index: 0,
  answers: [],
  isHintShown: false,
  isRetry: false,
  chat: [],
  followUpsUsed: 0,
  usage: EMPTY_USAGE,
})

/**
 * A review round from the deck's due cards, asked again as they were saved (choices reshuffled)
 * with no model call. True when it is on screen.
 */
const startReview = async ($: EngineInterface): Promise<boolean> => {
  const cards = dueCards((await read($, tutorProject)) ?? FRESH_PROJECT, REVIEW_ROUND_MAX)
  if (cards.length === 0) return false
  const now = await $.clock.now()
  let isBusy = false
  const { state: shown, epoch } = await claimTutor($, (current, next) => {
    isBusy = isTutorBusy(current)
    return isBusy ? undefined : { kind: 'loaded', round: reviewRound(cards, next, now, current.phase === 'home' ? current.focus : 'recent') }
  })
  if (isBusy) {
    $.ui.toast(TUTOR_BUSY)
    return false
  }
  // Only Home and the summary take a review round.
  if (epoch === undefined) return false
  abortTutorCalls()
  await focusTutor($, shown)
  return true
}


// ── playing a round ────────────────────────────────────────────────────────────────

/**
 * Scores the round on screen and shows its summary: XP once (the existing level-up toast and
 * sound fire), the deck and level saved for this project, the session's count, Mochi's quip and
 * a dance for a perfect round. Also `x: end` mid-round, which scores what was answered and
 * counts the question on screen as skipped. Decided inside the update, so a doubled press pays once.
 */
const finishRound = async ($: EngineInterface): Promise<void> => {
  const state = await read($, tutor)
  if (state.phase !== 'question' && state.phase !== 'feedback') return
  const round = closeOutRound(state.round)
  const xp = roundXp(round)
  const project = (await read($, tutorProject)) ?? FRESH_PROJECT
  const after = afterRound(project, round, await $.clock.now())
  const event: TutorEvent = { kind: 'finished', xp, levelBefore: project.level, levelAfter: after.level, wasForkMiss: wasForkMiss(round) }
  let isFinished = false
  const shown = await update($, tutor, current => {
    if ((current.phase !== 'question' && current.phase !== 'feedback') || current.round.id !== round.id) return current
    isFinished = true
    return applyTutor(current, event)
  })
  if (!isFinished) return
  $.ui.invalidate('ui.render')
  await focusTutor($, shown)
  await update($, tutorProject, (): TutorProject | null => after)
  // A retry pass replays the round just counted.
  if (!round.isRetry) await update($, tutorSession, (current): TutorSession => ({ ...current, rounds: current.rounds + 1 }))
  // A failed write is logged by persist; the round still completes.
  await saveTutorProject($, after)
  if (xp > 0) await saveStats($, score => ({ ...score, xp: score.xp + xp }))
  const { right, total, isPerfect } = scoreRound(round)
  await say($, isPerfect ? 'tutor-perfect' : 'tutor-done', `${right}/${total}`)
  if (isPerfect) await react($, 'dance')
}

/**
 * `x` and `/mascot tutor stop`. While a call runs, it is stopped (a digest aborted, a fork only
 * no longer waited for) and the screen steps back; with a question on screen, the round ends
 * and is scored.
 */
const cancelTutor = async ($: EngineInterface): Promise<void> => {
  const state = await read($, tutor)
  if (state.phase === 'question' || state.phase === 'feedback') return finishRound($)
  // The screen first: an aborted call settles at once, and must find its screen gone.
  const shown = await showTutor($, { kind: 'cancel' })
  abortTutorCalls()
  await focusTutor($, shown)
}

/** A pick on a choice question: graded locally, and Mochi says how it went. */
const chooseOption = async ($: EngineInterface, index: number): Promise<void> => {
  const { before, after } = await changeTutor($, { kind: 'chose', index })
  if (after === before || after.phase !== 'feedback') return
  await focusTutor($, after)
  await say($, currentAnswer(after.round)?.outcome === 'right' ? 'tutor-right' : 'tutor-wrong', '')
}

/** `n`: the next question, the summary after the last one, or Home from the summary. */
const nextTutor = async ($: EngineInterface): Promise<void> => {
  const state = await read($, tutor)
  if (state.phase === 'feedback' && isLastQuestion(state.round)) return finishRound($)
  await dispatchTutor($, { kind: 'next' })
}

/** `r` on the summary: this round's misses again, locally, reshuffled, for no XP. */
const retryMissed = async ($: EngineInterface): Promise<void> => {
  const at = await $.clock.now()
  // A new seed only: from the summary no call runs.
  const { state, epoch } = await claimTutor($, (current, next) => (current.phase === 'summary' ? { kind: 'retry-missed', epoch: next, at } : undefined))
  if (epoch !== undefined) await focusTutor($, state)
}

/** `o` on feedback: the question's file in the editor, only when the session itself touched exactly that file in its own checkout. */
const openTutorFile = async ($: EngineInterface): Promise<void> => {
  const state = await read($, tutor)
  if (state.phase !== 'feedback') return
  const file = currentQuestion(state.round)?.file
  if (file === undefined) return
  // Checked again here, not only where the button is drawn: the path came from the model.
  if (!(await read($, treeTouched)).some(touched => touched.worktree === undefined && touched.path === file)) return
  // The button is drawn on the terminal only; any other surface gets openInEditor's own refusal.
  $.ui.toast(await openInEditor($, undefined, file, tutorViewport.surface))
}

/** A screen waiting on one grade or follow-up call. */
type TutorWait = Extract<TutorState, { phase: 'grading' | 'asking' }>

/**
 * Puts up the screen that waits on a grade or a follow-up, under a new epoch claimed inside the
 * update as a start does, so a doubled Enter sends one call and never stops the first. Undefined
 * when the event did not fit (no question on screen, no follow-ups left, one already waiting).
 */
const beginWait = async ($: EngineInterface, event: (epoch: number) => TutorEvent): Promise<TutorWait | undefined> => {
  const { state, epoch } = await claimTutor($, (current, next) => event(next))
  if (epoch === undefined || (state.phase !== 'grading' && state.phase !== 'asking') || state.epoch !== epoch) return undefined
  // A question or feedback waited on nothing, so a call still running is a stopped one's.
  abortTutorCalls()
  await focusTutor($, state)
  return state
}

/** A grade's or follow-up's reply text, or null when there is none; its spend when a request was made. */
type TutorReply = { readonly text: string | null; readonly usage?: ModelUsage }

/** One grade or follow-up completion; a failure is logged by kind only, never with model text. */
const askTutorModel = async ($: EngineInterface, request: ModelCompleteRequest, epoch: number): Promise<TutorReply> => {
  const called = await runComplete($, request, epoch)
  // A stale call was never sent; its caller drops it on the same check.
  if (called.kind !== 'result') return { text: null }
  const { result } = called
  if (!result.isAnswered) {
    $.ui.log(`mochi-crew: tutor call failed: ${result.reason}`, { to: 'debug' })
    return { text: null, usage: result.usage }
  }
  return { text: result.text, usage: result.usage }
}

/** The spend to carry on a reply's event, when a request was made. */
const spendOf = (reply: TutorReply): { readonly usage?: ModelUsage } => (reply.usage === undefined ? {} : { usage: reply.usage })

/**
 * Enter on an explain question's field (B.4): a too-short answer only gets a toast; otherwise
 * the answer, cut to 600, goes to the grader under its own abort. The verdict comes from the
 * points; a failed or unreadable grade, or `x`, hands grading to the learner.
 */
const submitAnswer = async ($: EngineInterface, text: string): Promise<void> => {
  if (isAnswerTooShort(text)) {
    $.ui.toast(TUTOR_TOO_SHORT)
    return
  }
  const at = await $.clock.now()
  const waiting = await beginWait($, epoch => ({ kind: 'grading', epoch, given: text, at }))
  if (waiting === undefined) return
  const { epoch } = waiting
  const question = currentQuestion(waiting.round)
  // The held answer, already cut: the grader reads what the feedback will show.
  const given = currentAnswer(waiting.round)?.given
  if (question?.kind !== 'explain' || given === undefined) {
    await showReply($, epoch, { kind: 'grade-failed' })
    return
  }
  await withSpinner($, async () => {
    try {
      const reply = await askTutorModel($, gradeRequest(question, given, tutorConfig), epoch)
      if (!(await isLiveCall($, epoch))) return dropStale($)
      const grade = reply.text === null ? null : parseGrade(reply.text, question.keyPoints.length)
      if (grade === null) {
        if (reply.text !== null) $.ui.log('mochi-crew: tutor grade reply invalid', { to: 'debug' })
        await showReply($, epoch, { kind: 'grade-failed', ...spendOf(reply) })
        return
      }
      if (!(await showReply($, epoch, { kind: 'graded', points: grade.points, note: grade.note, ...spendOf(reply) }))) return
      await say($, verdictOf(grade.points) === 'right' ? 'tutor-right' : 'tutor-wrong', '')
    } catch (error: unknown) {
      $.ui.log(`mochi-crew: tutor could not grade an answer: ${String(error)}`, { to: 'debug' })
      await showReply($, epoch, { kind: 'grade-failed' })
    }
  })
}

/** The diff excerpt a digest kept for `file`: own keys only, so a file named like an Object method reads nothing. */
const excerptFor = (digest: Digest | null, file: string | undefined): string | undefined =>
  digest !== null && file !== undefined && Object.hasOwn(digest.excerpts, file) ? digest.excerpts[file] : undefined

/**
 * Enter on the feedback's ask field (B.6): one capped completion on the tutor model, never a
 * fork, with the round's diff excerpt for the question's file on digest rounds. A failure costs
 * no follow-up and only says so in a toast; model text never goes there.
 */
const submitAsk = async ($: EngineInterface, text: string): Promise<void> => {
  if (text.trim() === '') return
  const at = await $.clock.now()
  const waiting = await beginWait($, epoch => ({ kind: 'asking', epoch, at }))
  if (waiting === undefined) return
  const { epoch, round } = waiting
  const question = currentQuestion(round)
  const failAsk = async (reply?: TutorReply): Promise<void> => {
    if (await showReply($, epoch, { kind: 'ask-failed', ...(reply === undefined ? {} : spendOf(reply)) })) $.ui.toast(TUTOR_ASK_FAILED)
  }
  if (question === undefined) return failAsk()
  // Only a digest round sent the diff; a fork's prefix was the chat itself, and a review has none.
  const excerpt = round.source === 'digest' ? excerptFor(tutorDigest, question.file) : undefined
  await withSpinner($, async () => {
    try {
      const reply = await askTutorModel($, askRequest(question, currentAnswer(round), round.chat, text, excerpt, tutorConfig), epoch)
      if (!(await isLiveCall($, epoch))) return dropStale($)
      // Cleaned here as well as in the reducer, so a blank reply counts as none and costs no follow-up.
      const answer = reply.text === null ? '' : cleanModelText(reply.text)
      if (answer === '') return failAsk(reply)
      await showReply($, epoch, { kind: 'answered-ask', ask: text, reply: answer, ...spendOf(reply) })
    } catch (error: unknown) {
      $.ui.log(`mochi-crew: tutor could not answer a follow-up: ${String(error)}`, { to: 'debug' })
      await failAsk()
    }
  })
}

/** A typed answer or follow-up. Never logged: it is the person's own text. */
const submitTutorText = async ($: EngineInterface, purpose: TutorInputRow['purpose'], text: string): Promise<void> => {
  try {
    await (purpose === 'ask' ? submitAsk($, text) : submitAnswer($, text))
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: tutor ${purpose} failed: ${String(error)}`, { to: 'debug' })
  }
}

/** Runs a tutor control; a failure is logged and the tab stays as it was. */
const pressTutor = async ($: EngineInterface, action: TutorAction): Promise<void> => {
  try {
    switch (action.kind) {
      case 'consent':
        return await acceptTutor($)
      case 'decline':
        return await closeTutor($, 'declined')
      case 'close':
        return await closeTutor($, 'closed')
      case 'toggle-digest':
        await dispatchTutor($, { kind: 'toggle-digest' })
        return
      case 'start': {
        const state = await read($, tutor)
        await startRound($, action.focus, state.phase === 'home' && state.isDigestOnly)
        return
      }
      case 'retry':
      case 'try-digest': {
        const state = await read($, tutor)
        if (state.phase !== 'error') return
        await startRound($, state.focus, action.kind === 'try-digest')
        return
      }
      case 'review':
        await startReview($)
        return
      case 'cancel':
        return await cancelTutor($)
      case 'choose':
        return await chooseOption($, action.index)
      case 'hint':
        await dispatchTutor($, { kind: 'hint' })
        return
      case 'skip':
        await dispatchTutor($, { kind: 'skip' })
        return
      case 'reveal':
        await dispatchTutor($, { kind: 'reveal' })
        return
      case 'self-grade':
        await dispatchTutor($, { kind: 'self-graded', outcome: action.outcome })
        return
      case 'next':
        return await nextTutor($)
      case 'retry-missed':
        return await retryMissed($)
      case 'open-file':
        return await openTutorFile($)
    }
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: tutor control ${action.kind} failed: ${String(error)}`, { to: 'debug' })
  }
}

/** The focus a screen was on, for the Home it goes back to. */
const focusOf = (state: Exclude<TutorState, { phase: 'closed' | 'consent' }>): TutorFocus =>
  state.phase === 'home' || state.phase === 'loading' || state.phase === 'error' ? state.focus : state.round.focus

/**
 * Session end (C.6): the round in flight is stopped and any on screen dropped unscored, as a new
 * conversation starts; the tab goes back Home. Progress already saved stays.
 */
const endTutorSession = async ($: EngineInterface): Promise<void> => {
  tutorDigest = null
  // The screen first: an aborted call settles at once, and must find its screen gone.
  await update($, tutor, (current): TutorState =>
    current.phase === 'closed' || current.phase === 'consent' || current.phase === 'home'
      ? current
      : { phase: 'home', focus: focusOf(current), isDigestOnly: false },
  )
  abortTutorCalls()
  $.ui.invalidate('ui.render')
}

/**
 * Forgets this project's level and deck, here and in the store (other projects keep theirs),
 * and the consent, which covers every project, so the notice shows again before the next model
 * call. True when the store took both.
 */
const resetTutorProgress = async ($: EngineInterface): Promise<boolean> => {
  // Loaded first: a later first load must not bring back the consent cleared here.
  await loadTutor($)
  await update($, tutorProject, (): TutorProject | null => FRESH_PROJECT)
  await update($, tutorConsent, () => 0)
  $.ui.invalidate('ui.render')
  const [isProgressSaved, isConsentSaved] = await Promise.all([saveTutorProject($, FRESH_PROJECT), persist($, STORE.tutorConsent, 0)])
  return isProgressSaved && isConsentSaved
}

const toastTutorHint = ($: EngineInterface, hint: string | null): void => {
  if (hint !== null) $.ui.toast(hint)
}

/**
 * Answers `/mascot tutor [action]` with neutral text only: the line lands in the transcript, so
 * no question or model text ever goes in it.
 */
const runTutorCommand = async ($: EngineInterface, verb: TutorVerb): Promise<string> => {
  if (!isInteractive) return 'Tutor needs an interactive session.'
  switch (verb) {
    case 'open':
      toastTutorHint($, await openTutor($))
      return 'Tutor opened.'
    case 'start':
    case 'digest': {
      const state = await read($, tutor)
      const pending: TutorPending = { focus: state.phase === 'home' ? state.focus : 'recent', isDigestOnly: verb === 'digest' }
      toastTutorHint($, await openTutor($, pending))
      // Without consent the notice is on screen, holding the round until `y`.
      if (!(await hasTutorConsent($))) return 'Tutor opened.'
      return (await startRound($, pending.focus, pending.isDigestOnly)) ? 'Tutor round starting in its tab.' : 'Tutor opened.'
    }
    case 'review': {
      await loadTutor($)
      if (dueCards((await read($, tutorProject)) ?? FRESH_PROJECT, 1).length === 0) return 'No missed questions to review yet.'
      toastTutorHint($, await openTutor($))
      return (await startReview($)) ? 'Tutor round starting in its tab.' : 'Tutor opened.'
    }
    case 'stop':
      await cancelTutor($)
      return 'Tutor stopped.'
    case 'reset':
      return (await resetTutorProgress($))
        ? 'Tutor progress for this project and the data notice consent cleared.'
        : 'Tutor progress for this project and the data notice consent cleared (could not save it for next time).'
  }
}

// ── File tree ──────────────────────────────────────────────────────────────────────────
// The project's folders on the way to the files this session touched, with the live file
// marked and git's badges. Hooks read disk and git; the pane only draws the last snapshot,
// since state cannot be written while it draws.

// Ticks between the live row's pulse frames (~0.7 s), redrawn only while it pulses.
const TREE_PULSE_TICKS = 4
// Git and the editor launch are local and quick; anything slower is stuck.
const TREE_RUN_MS = 5_000
// Set by the pane each time it draws (a module flag, not $.state, so drawing may write it):
// whether its live row is pulsing now. Cleared at session end so a closed pane stops the pulse.
let isTreePulsing = false
// One read at a time; a request during one runs once more after it, never in parallel.
let treeReading: Promise<void> | undefined
let isTreeReadDue = false

/**
 * A git command's output in the project root, or undefined when it fails or there is no repo.
 * `timeoutMs` bounds it; the tree's reads are quick, the tutor's diffs may take longer.
 */
const gitOutput = async ($: EngineInterface, root: string, args: readonly string[], timeoutMs: number = TREE_RUN_MS): Promise<string | undefined> => {
  try {
    // No optional locks, so a refresh never holds index.lock against the person's own git; no
    // fsmonitor command from the repository's config.
    const ran = await $.process.run(
      ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
      { cwd: root, timeoutMs },
    )
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: git ${args[0] ?? ''} failed: ${String(error)}`, { to: 'debug' })
    return undefined
  }
}

/** A folder's entries, or none when it cannot be listed (gone, unreadable). */
const listFolder = async ($: EngineInterface, root: string, dir: string): Promise<readonly TreeEntry[]> => {
  try {
    return toEntries(await $.fs.list(dir === '' ? root : `${root}/${dir}`))
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: could not list ${dir || '.'} for the file tree: ${String(error)}`, { to: 'debug' })
    return []
  }
}

// The project root as given and as it resolves: tools may report either spelling (/var vs
// /private/var on macOS). Re-read when the root moves.
let treeRoots: { root: string; real: string } | undefined
// The linked worktrees as git last listed them for this root (all of them, past the drawn cap),
// and when; `top` is the session's checkout as git names it, kept once git answered.
let treeWorktrees: { root: string; top?: string; entries: readonly WorktreeEntry[]; at: number } | undefined
// A file under no known worktree lists them again at most this often: a subagent's worktree is
// made after the last read, a session's own edits must not run git each time.
const WORKTREE_RELIST_MS = 3_000

/** The session root in both spellings, read again when it moves. */
const sessionRoots = async ($: EngineInterface): Promise<{ root: string; real: string }> => {
  const root = await $.session.root()
  if (treeRoots?.root !== root) {
    const real = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
    treeRoots = { root, real }
  }
  return treeRoots
}

/** Lists the repository's linked worktrees from git, never from a tool's input; none outside a repo. */
const readWorktrees = async ($: EngineInterface): Promise<readonly WorktreeEntry[]> => {
  const { root, real } = await sessionRoots($)
  // Asked again until git answers: without it a session in a subfolder would draw its own checkout.
  const known = treeWorktrees?.root === root ? treeWorktrees.top : undefined
  const top = known ?? ((await gitOutput($, root, ['rev-parse', '--show-toplevel']))?.trim() || undefined)
  const listed = await gitOutput($, root, ['worktree', 'list', '--porcelain', '-z'])
  const own = [...(top === undefined ? [] : [top]), root, real]
  const entries = listed === undefined ? [] : linkedWorktrees(parseWorktreeList(listed), own)
  treeWorktrees = { root, ...(top === undefined ? {} : { top }), entries, at: await $.clock.now() }
  return entries
}

/** The roots a tool's path may lie under: the session's, then each known worktree in each spelling. */
const placeRoots = (root: string, real: string): readonly TreeRoot[] => [
  { spellings: [root, real] },
  ...(treeWorktrees?.root === root ? treeWorktrees.entries : [])
    .map(entry => ({ worktree: entry.path, spellings: spellingsOf(entry.path, root, real) })),
]

/** What a section was last read with: its own touches, live file and toggles. */
type SectionWork = {
  readonly touched: readonly TouchedFile[]
  readonly focus: TreeFocus | null
  readonly toggles: FolderToggles
  readonly previous: WorktreeSnapshot | undefined
  /** Other roots' paths, hidden from its listings. */
  readonly mounts: readonly string[]
}

/**
 * Reads one linked worktree in its own root. Its badges are always read (one git call), so a
 * closed section still says what changed there; folders and added lines only while it is open.
 */
const readWorktree = async ($: EngineInterface, entry: WorktreeEntry, work: SectionWork): Promise<WorktreeSnapshot> => {
  const paths = [...work.touched.map(file => file.path), ...(work.focus === null ? [] : [work.focus.path])]
  const isOpen = isWorktreeOpen(entry.path, work.touched, work.focus, work.toggles)
  const dirs = isOpen ? reachableFolders(openFolders(expandedDirs(paths), work.toggles)) : []
  const [listed, status, numstat] = await Promise.all([
    Promise.all(dirs.map(async dir => [dir, await listFolder($, entry.path, dir)] as const)),
    gitOutput($, entry.path, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.']),
    isOpen ? gitOutput($, entry.path, ['diff', '--numstat', '-z', '--no-ext-diff', 'HEAD', '--', '.']) : Promise.resolve(undefined),
  ])
  // A git call that failed or timed out (or was not run) keeps the last badges.
  const previous = work.previous?.tree
  return {
    path: entry.path,
    tree: {
      rootName: safeText(fileName(entry.path)),
      listings: withoutMounts(Object.fromEntries(listed), [entry.path], work.mounts),
      marks: status === undefined ? previous?.marks ?? {} : parseGitStatus(status),
      added: numstat === undefined ? previous?.added ?? {} : parseNumstat(numstat),
      ...(entry.branch === undefined ? {} : { branch: safeText(entry.branch) }),
    },
  }
}

/** Reads the open folders and git's view of the project and its worktrees into a fresh snapshot. */
const readTree = async ($: EngineInterface): Promise<void> => {
  const { root, real } = await sessionRoots($)
  const focus = await read($, treeFocus)
  const allTouched = await read($, treeTouched)
  const touched = touchedIn(allTouched, undefined)
  const ownFocus = focusIn(focus, undefined)
  const toggles = await read($, treeToggles)
  const dirs = reachableFolders(openFolders(expandedDirs([...touched.map(file => file.path), ...(ownFocus === null ? [] : [ownFocus.path])]), toggles))
  const listed = await Promise.all(dirs.map(async dir => [dir, await listFolder($, root, dir)] as const))
  // The session root may sit below the repository's top: git's paths are cut to it.
  const prefix = (await gitOutput($, root, ['rev-parse', '--show-prefix']))?.replace(/\n$/, '')
  const isRepo = prefix !== undefined
  const [status, numstat, branch] = isRepo
    ? await Promise.all([
      // Untracked folders stay one entry each (and are skipped), so a vendored tree costs nothing.
      gitOutput($, root, ['status', '--porcelain=v1', '-z', '--untracked-files=normal', '--', '.']),
      gitOutput($, root, ['diff', '--numstat', '-z', '--no-ext-diff', 'HEAD', '--', '.']),
      gitOutput($, root, ['branch', '--show-current']),
    ])
    : [undefined, undefined, undefined]
  const branchName = branch?.trim()
  // A git call that failed or timed out keeps the last badges; only leaving a repo clears them.
  const previous = await read($, tree)
  const linked = isRepo ? await readWorktrees($) : []
  const entries = shownWorktrees(linked, allTouched, focus)
  const top = treeWorktrees?.top
  const own = [...(top === undefined ? [] : [top]), root, real]
  const worktreeToggles = await read($, treeWorktreeToggles)
  const worktrees = await Promise.all(entries.map(entry => readWorktree($, entry, {
    touched: touchedIn(allTouched, entry.path),
    focus: focusIn(focus, entry.path),
    toggles: worktreeToggles[entry.path] ?? {},
    previous: previous?.worktrees?.find(section => section.path === entry.path),
    mounts: [...own, ...linked.filter(other => other !== entry).map(other => other.path)],
  })))
  const snapshot: TreeSnapshot = {
    rootName: safeText(fileName(root)),
    listings: withoutMounts(Object.fromEntries(listed), [root, real], linked.map(entry => entry.path)),
    marks: !isRepo ? {} : status === undefined ? previous?.marks ?? {} : parseGitStatus(status, prefix),
    added: !isRepo ? {} : numstat === undefined ? previous?.added ?? {} : parseNumstat(numstat, prefix),
    ...(branchName === undefined || branchName === '' ? {} : { branch: safeText(branchName) }),
    ...(isRepo ? { worktrees } : {}),
  }
  await update($, tree, (): TreeSnapshot | null => snapshot)
  $.ui.invalidate('ui.render')
}

/** Asks for a fresh read while the tree is on; off the caller's path, failures logged. */
const queueTreeRefresh = ($: EngineInterface): void => {
  if (treeReading !== undefined) {
    isTreeReadDue = true
    return
  }
  treeReading = (async () => {
    for (;;) {
      isTreeReadDue = false
      try {
        if (await read($, isTreeOn)) await readTree($)
      } catch (error: unknown) {
        $.ui.log(`mochi-crew: could not read the file tree: ${String(error)}`, { to: 'debug' })
      }
      // Checked and cleared in one step, so a request arriving as the read ends is never lost.
      if (!isTreeReadDue) {
        treeReading = undefined
        return
      }
    }
  })()
}

// File notes apply one at a time, in call order, so a quick edit then read never leaves the
// older file live.
let treeNotes: Promise<void> = Promise.resolve()

/**
 * Where a tool's path sits: in a linked worktree when one holds it (the deepest wins), else in
 * the project, under either spelling of each root. A path under no known worktree lists them
 * again first (throttled), since a subagent's worktree is made after the tree last read them.
 */
const treePlaceOf = async ($: EngineInterface, file: string): Promise<TreePlace | undefined> => {
  const { root, real } = await sessionRoots($)
  const isListStale = treeWorktrees?.root !== root || (await $.clock.now()) - treeWorktrees.at >= WORKTREE_RELIST_MS
  let place = placeFile(placeRoots(root, real), file)
  if (place?.worktree === undefined && isAbsolutePath(file) && isListStale) {
    await readWorktrees($)
    place = placeFile(placeRoots(root, real), file)
  }
  const resolved = place === undefined || isWindowsRoot(root)
    ? (await $.fs.stat(file, { resolve: true }).catch(() => undefined))?.realPath
    : undefined
  // Git names worktrees by real path: a sibling given as /var/… is found as /private/var/….
  if (place === undefined) return resolved === undefined ? undefined : placeFile(placeRoots(root, real), resolved)
  if (!isWindowsRoot(root)) return place
  const onDisk = resolved === undefined ? undefined : placeFile(placeRoots(root, real), resolved)
  const path = diskSpelling(place.path, onDisk !== undefined && onDisk.worktree === place.worktree ? onDisk.path : undefined)
  return { ...place, path }
}

/** What a call says about a file: live in the main loop now, or edited (by a worker or not). */
type TreeNote = { kind: TreeFocus['kind']; isLive: boolean; agentId?: string }

/**
 * Notes a file: the main loop's file in hand becomes the live one, and an edit that went
 * through is remembered as touched (with its worker for a subagent). A read is live only, so
 * reading around never opens folders for good. Off the call's path; failures logged.
 */
const noteTreeFile = ($: EngineInterface, file: string, { kind, isLive, agentId }: TreeNote): void => {
  const apply = async (): Promise<void> => {
    const place = await treePlaceOf($, file)
    if (place === undefined) {
      $.ui.log('mochi-crew: a file outside the project and its worktrees is left out of the tree', { to: 'debug' })
      return
    }
    const { path, worktree } = place
    const touched = isLive ? await read($, treeTouched) : await update($, treeTouched, current => touch(current, path, agentId, worktree))
    if (kind === 'edit') {
      if (worktree === undefined) await update($, treeToggles, current => reopenFor(current, path))
      else await update($, treeWorktreeToggles, current => reopenWorktreeFor(current, worktree, path))
    }
    if (isLive) {
      const since = await $.clock.now()
      await update($, treeFocus, (): TreeFocus | null => ({ path, kind, since, ...(worktree === undefined ? {} : { worktree }) }))
    }
    const paths = [...touchedIn(touched, worktree).map(entry => entry.path), path]
    const snapshot = await read($, tree)
    const isMissing = worktree === undefined
      ? isMissingListing(snapshot, paths)
      : isMissingWorktreeListing(snapshot, worktree, paths, (await read($, treeWorktreeToggles))[worktree])
    if (isMissing) queueTreeRefresh($)
    $.ui.invalidate('ui.render')
  }
  treeNotes = treeNotes
    .then(apply)
    .catch((error: unknown) => $.ui.log(`mochi-crew: could not note a file for the tree: ${String(error)}`, { to: 'debug' }))
}

/**
 * A click on a folder row opens or closes it; an opened folder is read from disk first. In a
 * worktree's section, `''` is the worktree's own row.
 */
const toggleTreeFolder = async ($: EngineInterface, worktree: string | undefined, path: string, isOpen: boolean): Promise<void> => {
  try {
    if (worktree === undefined) await update($, treeToggles, current => toggleFolder(current, path, isOpen))
    else await update($, treeWorktreeToggles, current => toggleWorktreeFolder(current, worktree, path, isOpen))
    if (!isOpen) queueTreeRefresh($)
    $.ui.invalidate('ui.render')
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: could not toggle a folder in the tree: ${String(error)}`, { to: 'debug' })
  }
}

/** One way to open a file: a command, and the variables it runs with. */
type Launch = { readonly argv: readonly string[]; readonly env?: Readonly<Record<string, string>> }

/**
 * On Windows, VS Code's `code` (and its forks') is a `.cmd` shim, which cannot run without a
 * shell; the launches here run what the shim would, by argument vector. Shims that are missing,
 * of another shape, or inside the project (`npm run` puts its `node_modules\.bin` on PATH) are
 * skipped, as is a shim whose program or script lies in the project.
 */
const windowsShimLaunches = async ($: EngineInterface, editors: EditorEnv, path: string, roots: readonly string[]): Promise<readonly Launch[]> => {
  const isInProject = (file: string): boolean => roots.some(root => isInside(root, file))
  const env: ShimEnv = {
    ...editors,
    PATH: await $.env.get('PATH'),
    LOCALAPPDATA: await $.env.get('LOCALAPPDATA'),
    ProgramFiles: await $.env.get('ProgramFiles'),
  }
  const launches: Launch[] = []
  for (const shimPath of shimCandidates(env)) {
    if (isInProject(shimPath)) continue
    const shim = await $.fs.read(shimPath).catch(() => undefined)
    const argv = shim === undefined ? undefined : shimLauncher(shim, shimPath, path)
    if (argv !== undefined && !argv.slice(0, 2).some(isInProject)) launches.push({ argv, env: SHIM_ENV })
  }
  return launches
}

/**
 * Opens a file of the tree in the person's editor. The path must resolve inside the project, or
 * inside the linked worktree it is drawn in (one git listed, as the last read kept it); only
 * windowed editors are run, by argument vector, never through a shell.
 */
const openInEditor = async ($: EngineInterface, worktree: string | undefined, path: string, surface: string): Promise<string> => {
  // Commands run only from the terminal CLI; a desktop or editor surface has no host to run on.
  if (surface !== 'terminal') return 'Opening a file from the tree works in the terminal app only.'
  const root = await $.session.root()
  const rootReal = (await $.fs.stat(root, { resolve: true })).realPath ?? root
  const sections = (await read($, tree))?.worktrees ?? []
  // The row's worktree only names which listed one to look in; its path is git's, not the row's.
  const base = worktree === undefined ? root : sections.find(section => section.path === worktree)?.path
  const baseReal = worktree === undefined ? rootReal
    : base === undefined ? undefined
    : (await $.fs.stat(base, { resolve: true }).catch(() => undefined))?.realPath ?? base
  const relative = base === undefined ? undefined : relativeTo(base, path)
  const target = relative === undefined
    ? undefined
    : (await $.fs.stat(`${base}/${relative}`, { resolve: true }).catch(() => undefined))?.realPath
  const shown = placeLabel({ path: relative ?? path, ...(worktree === undefined ? {} : { worktree }) })
  if (target === undefined || baseReal === undefined || !isInside(baseReal, target)) return `Could not open ${shown}: it is not a file in this project.`
  const env = { VISUAL: await $.env.get('VISUAL'), EDITOR: await $.env.get('EDITOR') }
  const isWindows = isWindowsRoot(root)
  // A shim inside the project or any of its worktrees, drawn or not, is never run; before git has
  // listed them, no shim is.
  const listed = treeWorktrees?.root === root ? treeWorktrees.entries : undefined
  const projectRoots = [root, rootReal, ...(baseReal === undefined ? [] : [baseReal]), ...(listed ?? []).map(entry => entry.path)]
  const launches: readonly Launch[] = [
    ...(isWindows && listed !== undefined ? await windowsShimLaunches($, env, target, projectRoots) : []),
    ...launchersFor(env, target, { isWindows }).map(argv => ({ argv })),
  ]
  for (const { argv, env: extraEnv } of launches) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: TREE_RUN_MS, ...(extraEnv === undefined ? {} : { env: { ...extraEnv } }) })
      if (ran.exitCode === 0) return `Opened ${shown}.`
    } catch (error: unknown) {
      // Not installed, or not a terminal session: try the next one.
      $.ui.log(`mochi-crew: ${argv[0] ?? ''} could not open a file: ${String(error)}`, { to: 'debug' })
    }
  }
  return `Could not open ${shown}: no editor found (set VISUAL to code, cursor or zed).`
}

export const register: Register = (on, options) => {
  tutorConfig = parseTutorConfig(options)
  on('session.end', async ($, e, next) => {
    // A round in flight belongs to the conversation ending: its late reply must not land in the next.
    await endTutorSession($).catch((error: unknown) =>
      $.ui.log(`mochi-crew: tutor could not stop at session end: ${String(error)}`, { to: 'debug' }),
    )
    // Every ending closes this conversation's figures, a /clear and a resume included.
    await resetConversation($)
    isTreePulsing = false
    if (e.reason === 'prompt_input_exit' || e.reason === 'logout' || e.reason === 'other') {
      hudRefresh?.cancel()
      hudRefresh = undefined
    }
    // Last and bounded: osascript may be slow, and Mochi's own cleanup above must not wait on it.
    await Promise.race([endBadge($, e.sessionId, e.reason), $.clock.sleep(3_000)]).catch((error: unknown) =>
      $.ui.log(`mochi-crew: badge could not restore the tab: ${String(error)}`, { to: 'debug' }),
    )
    return next(e)
  }).catch(($, e, next) => (logFailure($, 'session.end', next.error), next(e)))

  on('session.measure', async ($, e, next) => {
    await update($, meterMeasure, (): Measure | null => toMeasure(e))
    await refreshProvider($, e.rateLimits.map(window => window.kind))
    await refreshModel($)
    await raiseAlerts($)
    return next(e)
  }).catch(($, e, next) => (logFailure($, 'session.measure', next.error), next(e)))

  on('session.start', async ($, e, next) => {
    isInteractive = e.isInteractive
    await loadSaved($)
    // Local state only, so it is cheap to await; done first so no turn is counted and then wiped.
    await resetConversation($).catch((error: unknown) =>
      $.ui.log(`mochi-crew: meter could not reset: ${String(error)}`, { to: 'debug' }),
    )
    // `/mochi` is the same command under the cat's own name.
    for (const name of MASCOT_COMMANDS) {
      await $.command.register({
        name,
        description: 'Open the Mochi crew pane, read the session journal or meter, show the file tree, quiz you on the project, set the session badge, change outfit, toggle sound',
        argumentHint: '[journal | missions | achievements | meter | files [on|off] | tutor [start|digest|review|stop|reset] | badge [on|off|color <name>|title <text>|auto] | place [<name>] | outfits | outfit <name> | sound on|off]',
      })
    }
    void $.ui.open({ id: PANE, title: TITLE })
    // The host reads go off the start-up path, so Mochi and /mascot never wait on them.
    void startMeter($).catch((error: unknown) => $.ui.log(`mochi-crew: meter could not start: ${String(error)}`, { to: 'debug' }))
    queueTreeRefresh($)
    // Tinting the tab waits on osascript, so it runs behind the start; a `-p` run is never badged.
    if (e.isInteractive) startBadge($, await $.session.id())

    return next(e)
  }).catch(($, e, next) => next(e))

  // The session badge's emoji title. A title is never worth holding a prompt back: on failure the prompt goes on untitled.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    if (e.agent_id || result.sessionTitle !== undefined || result.block !== undefined) return result
    const title = await badgeTitleFor($, { sessionId: e.session_id, transcriptPath: e.transcript_path, sessionTitle: e.session_title })
    return title ? { ...result, sessionTitle: title } : result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mascot' }, async ($, e) => ({ text: await runMascotCommand($, e.args) }))
  on('command.run', { command: 'mochi' }, async ($, e) => ({ text: await runMascotCommand($, e.args) }))

  // The cat is decoration: if its bookkeeping throws, the edit still runs.
  on('tool.call', { tool: 'Edit' }, ($, e, next) =>
    trackEdit($, { file: e.file_path, tool: 'Edit', agentId: e.agentId }, () => next(e)),
  ).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Write' }, ($, e, next) =>
    trackEdit($, { file: e.file_path, tool: 'Write', agentId: e.agentId }, () => next(e)),
  ).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'NotebookEdit' }, ($, e, next) =>
    trackEdit($, { file: e.notebook_path, tool: 'NotebookEdit', agentId: e.agentId }, () => next(e)),
  ).catch(($, e, next) => next(e))

  // Tools that are not edits: Mochi grabs a gadget. Passed through untouched if bookkeeping fails.
  on('tool.call', { tool: 'Bash' }, ($, e, next) =>
    trackGadget($, { gadget: gadgetForCommand(e.command), detail: safeDetail(e.command), agentId: e.agentId, command: e.command }, () => next(e)),
  ).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'Read' }, ($, e, next) =>
    trackGadget($, { gadget: 'magnifier', detail: fileName(e.file_path), agentId: e.agentId, file: e.file_path }, () => next(e)),
  ).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'WebSearch' }, ($, e, next) =>
    trackGadget($, { gadget: 'antenna', detail: safeDetail(e.query), agentId: e.agentId }, () => next(e)),
  ).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'WebFetch' }, ($, e, next) =>
    trackGadget($, { gadget: 'antenna', detail: hostOf(e.url), agentId: e.agentId }, () => next(e)),
  ).catch(($, e, next) => next(e))

  // MCP tools (Figma, Gmail, Docs…): Mochi raises the antenna while a connector call runs.
  // Every other tool passes straight through this hook.
  on('tool.call', ($, e, next) => {
    const label = mcpToolLabel(e.tool)
    if (label === undefined) return next(e)
    return trackGadget($, { gadget: 'antenna', detail: safeDetail(label, 36), verb: 'calling', agentId: e.agentId }, () => next(e))
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    if (started.deny === undefined && started.agentId !== undefined) {
      // The task text is shown in the HUD before the worker's first call: masked like any command.
      const joining = { id: started.agentId, type: e.subagentType, description: safeDetail(e.description, 60) }
      await hireWorker($, joining)
      void celebrateHire($, joining).catch((error: unknown) =>
        $.ui.log(`mochi-crew: could not celebrate a hire: ${String(error)}`, { to: 'debug' }),
      )
    }

    return started
  }).catch(($, e, next) => next(e))

  // Observed, never altered: the turn runs and its answer passes through whatever the cat does.
  on('turn.start', async ($, e, next) => {
    const started = await next(e)
    void beginTurn($, e.turnId).catch((error: unknown) =>
      $.ui.log(`mochi-crew: could not follow a turn's start: ${String(error)}`, { to: 'debug' }),
    )
    return started
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    const outcome = e.reason
    const agentId = e.agentId
    void (agentId === undefined ? endTurn($, e.turnId, outcome, e.durationMs) : releaseWorker($, agentId)).catch((error: unknown) =>
      $.ui.log(`mochi-crew: could not follow a turn's end: ${String(error)}`, { to: 'debug' }),
    )
    if (agentId === undefined) queueTreeRefresh($)
    void noteMeterTurn($, e).catch((error: unknown) =>
      $.ui.log(`mochi-crew: meter could not count a turn: ${String(error)}`, { to: 'debug' }),
    )
    return completed
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const current = await read($, activity)
    const score = await read($, stats)
    const crew = await read($, workers)
    const onStage = crew.filter(worker => worker.leftAt === undefined)
    const now = await $.clock.now()
    const { level, intoLevel, needed } = levelOf(score.xp)
    const wellbeing = careAt(await read($, care), now)
    const soundOn = await read($, isSoundOn)
    const liveBug = await read($, bug)
    const bubble = activeQuip(await read($, quip), now)
    const badges = await read($, achievements)
    const currentTurn = await read($, turn)
    const turnLine = turnLabel(currentTurn)
    const diary = await read($, journal)
    const diaryLine = journalLine(diary)
    const goalLine = missionLine(await read($, missions), diary)
    // A live bug wins over a round in the tutor tab, which wins over what Mochi is doing.
    const label = liveBug !== null && isBugAlive(liveBug) && current.kind === 'idle'
      ? `fighting a bug · ${liveBug.command}`
      : tutorHudLabel(await read($, tutor)) ?? activityLabel(current, now, isThinking(currentTurn))
    const { Box, Text, Button } = $.ui.resolve(e)
    // Only the terminal draws the scene above the HUD.
    const isTerminal = e.surface === 'terminal'
    // One accent (the theme's own Claude orange); red and green only when something needs you.
    const columns = e.props.bodyColumns
    const barWidth = barWidthFor(columns)
    const rule = ruleFor(columns)
    const meterView = await readMeterView($, isThinking(currentTurn))
    const meter = meterRows(meterView, barWidth)
    const isTreeShown = await read($, isTreeOn)
    const hudExtras = {
      hasBubble: bubble !== null,
      hasTurnLine: turnLine !== null,
      workerCount: onStage.length,
      meterRows: meter.length,
      hasTreeLine: isTreeShown,
    }
    const sceneRows = isTerminal ? SCENE_ROWS : 0
    const { isCompact } = hudPlan(e.props.scroll.bodyRows, sceneRows, hudExtras)
    // The file tree gets only the rows the HUD leaves; too few, and it folds into one line.
    const snapshot = isTreeShown ? await read($, tree) : null
    const focus = await read($, treeFocus)
    const touchedFiles = await read($, treeTouched)
    const toggles = await read($, treeToggles)
    const worktreeToggles = await read($, treeWorktreeToggles)
    const treeSpace = snapshot !== null && !isCompact ? treeBudget(e.props.scroll.bodyRows, sceneRows, hudExtras) : 0
    const allTreeRows = snapshot !== null && treeSpace >= MIN_TREE_ROWS
      ? sessionTreeRows({ snapshot, focus, touched: touchedFiles, toggles, worktreeToggles })
      : null
    const shownTree = allTreeRows === null ? null : windowRows(allTreeRows, anchorOf(allTreeRows, touchedFiles, focus), treeSpace)
    isTreePulsing = isTerminal && shownTree !== null && isThinking(currentTurn) && shownTree.rows.some(row => row.tone === 'active')
    const isPulseLit = !isTreePulsing || Math.floor(tick / TREE_PULSE_TICKS) % 2 === 0
    const foldedTree = isTreeShown && shownTree === null ? treeLine(focus, touchedFiles) ?? 'nothing touched yet' : null
    const crewLine = isCompact ? crewSummary(onStage) : null
    const meterLine = isCompact ? meterSummary(meterView) : null
    const isTrouble = (current.kind === 'done' && current.hasFailed) || isBugAlive(liveBug)
    const bar = (key: string, fraction: number) => {
      const { filled, empty } = barCells(fraction, barWidth)
      return (
        <Text key={key}>
          <Text color={ACCENT}>{BAR_GLYPH.repeat(filled)}</Text>
          <Text color={TRACK}>{BAR_GLYPH.repeat(empty)}</Text>
        </Text>
      )
    }
    const vital = (name: string, value: number) => (
      <Text>
        <Text dimColor>{gutter(name)}</Text>
        <Text>{column(String(value), 3)}  </Text>
        {bar(name, value / 100)}
        <Text color={THEME.alert}>  {vitalNote(value)}</Text>
      </Text>
    )

    const treeEntry = (row: TreeRow) => {
      const parts = rowParts(row, columns - 2)
      const workerColor = row.workerId === undefined ? undefined : hatOf(row.workerId).text
      const isActive = row.tone === 'active'
      const glyphColor = isActive ? (isPulseLit ? ACCENT : TRACK) : workerColor
      const nameColor = isActive ? ACCENT : workerColor
      const isDim = row.tone === 'dim'
      const lines = row.added > 0 ? `+${row.added}` : ''
      const mark = parts.badge.slice(lines.length).trim()
      const gap = parts.badge === '' ? '' : '  '
      const pieces = (
        <Text wrap="truncate-end">
          <Text dimColor>{parts.indent}</Text>
          <Text color={glyphColor} dimColor={glyphColor === undefined}>{parts.glyph}</Text>
          <Text color={nameColor} bold={isActive || row.kind === 'root'} dimColor={isDim}>{parts.name}</Text>
          <Text dimColor>{parts.detail === '' ? '' : `  ${parts.detail}`}</Text>
          <Text>{gap}</Text>
          <Text color={THEME.good}>{lines}</Text>
          <Text>{lines !== '' && mark !== '' ? ' ' : ''}</Text>
          <Text color={row.mark === 'D' ? THEME.alert : undefined} dimColor={row.mark !== 'D'}>{mark}</Text>
        </Text>
      )
      // Rows of a worktree's section carry its path in their key, so no two roots' rows collide.
      const section = row.worktree === undefined ? '' : `wt:${row.worktree}|`
      if (row.kind === 'dir' || row.kind === 'root') {
        return (
          <Button key={`${section}${row.kind}:${row.key}`} plain onPress={() => void toggleTreeFolder($, row.worktree, row.key, row.isOpen)}>
            {pieces}
          </Button>
        )
      }
      if (row.kind !== 'file') return <Text key={`${section}tree:${row.key}`}>{pieces}</Text>
      return (
        <Button key={`${section}file:${row.key}`} plain onPress={press => void pressButton($, () => openInEditor($, row.worktree, row.key, press.surface))}>
          {pieces}
        </Button>
      )
    }

    const hud = (
      <Box flexDirection="column" alignItems="flex-start" paddingX={1}>
        {bubble !== null && <Text italic dimColor>  “{bubble.text}”</Text>}
        <Text>
          <Text color={isTrouble ? THEME.alert : ACCENT}>▍ </Text>
          <Text bold color={isTrouble ? THEME.alert : undefined}>{label}</Text>
        </Text>
        {turnLine !== null && <Text color={isTurnTrouble(currentTurn) ? THEME.alert : THEME.good}>  {turnLine}</Text>}
        {!isCompact && <Text dimColor>{rule}</Text>}
        <Text>
          <Text dimColor>{gutter('level')}</Text>
          <Text bold>{column(String(level), 3)}  </Text>
          {bar('xp', intoLevel / needed)}
          <Text dimColor>  {intoLevel}/{needed}</Text>
        </Text>
        {vital('mood', wellbeing.mood)}
        {vital('energy', wellbeing.energy)}
        <Text>
          <Text dimColor>{gutter('streak')}</Text>
          <Text color={score.combo > 1 ? ACCENT : undefined}>{column(comboBadge(score.combo) || '–', 3)}  </Text>
          <Text dimColor>badges </Text>
          <Text>{badges.length}/{ACHIEVEMENTS.length}</Text>
        </Text>
        {!isCompact && <Text dimColor>{rule}</Text>}
        <Text>
          <Text dimColor>{gutter('next')}</Text>
          <Text>{goalLine}</Text>
          <Text dimColor>  {missionCount(await read($, missions))}</Text>
        </Text>
        {!isCompact && diaryLine !== null && (
          <Text>
            <Text dimColor>{gutter('log')}</Text>
            <Text dimColor>{diaryLine}</Text>
          </Text>
        )}
        {!isCompact && meter.length > 0 && <Text dimColor>{rule}</Text>}
        {!isCompact && meter.map(row => (
          // Truncated, never wrapped: a wrapped row would push the controls out of view.
          <Text key={row.key} wrap="truncate-end">
            {row.cells.map((cell, index) => (
              <Text key={String(index)} {...METER_TONES[cell.tone]}>{cell.text}</Text>
            ))}
          </Text>
        ))}
        {meterLine !== null && (
          <Text wrap="truncate-end">
            <Text dimColor>{gutter('meter')}</Text>
            <Text>{meterLine}</Text>
          </Text>
        )}
        {crewLine !== null && (
          <Text>
            <Text dimColor>{gutter('crew')}</Text>
            <Text>{crewLine}</Text>
          </Text>
        )}
        {!isCompact && onStage.slice(0, MAX_VISIBLE_WORKERS).map(worker => {
          const role = ROLE_INFO[roleFor(worker.type)]
          return (
            <Text key={worker.id}>
              <Text color={hatOf(worker.id).text}>{gutter(role.tag)}</Text>
              <Text>{role.title}</Text>
              <Text dimColor> · {workerNote(worker)}</Text>
            </Text>
          )
        })}
        {!isCompact && onStage.length > MAX_VISIBLE_WORKERS && (
          <Text dimColor>{gutter('')}+{onStage.length - MAX_VISIBLE_WORKERS} more on the crew</Text>
        )}
        {foldedTree !== null && (
          <Text wrap="truncate-end">
            <Text dimColor>{gutter('files')}</Text>
            <Text color={focus === null ? undefined : ACCENT}>{foldedTree}</Text>
          </Text>
        )}
        {shownTree !== null && snapshot !== null && <Text dimColor>{rule}</Text>}
        {shownTree !== null && snapshot !== null && (
          <Text wrap="truncate-end">
            <Text dimColor>{gutter('files')}</Text>
            <Text bold>{snapshot.rootName}</Text>
            <Text dimColor>{snapshot.branch === undefined ? '' : `  ${snapshot.branch}`}</Text>
          </Text>
        )}
        {shownTree !== null && shownTree.above > 0 && <Text dimColor>  ↑ {shownTree.above} more</Text>}
        {shownTree?.rows.map(treeEntry)}
        {shownTree !== null && shownTree.below > 0 && <Text dimColor>  ↓ {shownTree.below} more</Text>}
        <Box flexDirection="row" gap={2}>
          <Button key="pet" hotkey="p" plain label="pet" onPress={() => void pressButton($, () => react($, 'pet'))} />
          <Button key="feed" hotkey="f" plain label="feed" onPress={() => void pressButton($, () => react($, 'feed'))} />
          <Button key="dance" hotkey="d" plain label="dance" onPress={() => void pressButton($, () => react($, 'dance'))} />
          <Button key="outfit" hotkey="o" plain label="outfit" onPress={() => void pressButton($, () => cycleOutfit($))} />
          <Button key="place" hotkey="b" plain label="place" onPress={() => void pressButton($, () => cyclePlace($))} />
          <Button key="sound" hotkey="s" plain label={soundOn ? 'mute' : 'sound'} onPress={() => void pressButton($, () => toggleSound($))} />
          <Button key="files" hotkey="t" plain label="files" onPress={() => void pressButton($, () => runMascotCommand($, 'files'))} />
          <Button key="tutor" hotkey="q" plain label="tutor" onPress={() => void pressButton($, () => openTutor($))} />
        </Box>
      </Box>
    )

    if (e.surface !== 'terminal') {
      // Raster is terminal-only; other surfaces get the HUD alone.
      hudRefresh ??= $.clock.every(HUD_REFRESH_MS, () => $.ui.invalidate('ui.render'))
      return hud
    }

    sceneWidth = sceneWidthFor(e.props.bodyColumns)
    ensureTicker($)
    const { Raster } = $.ui.resolve(e)
    const sceneCells = cellsFor(await frameInput($, now, current, crew))
    paintedCells = sceneCells
    return (
      <Box flexDirection="column" alignItems="center">
        <Raster
          key={SCENE_KEY}
          columns={sceneWidth}
          rows={SCENE_ROWS}
          cells={sceneCells}
        />
        {hud}
      </Box>
    )
  })

  // The tutor tab draws its screen from atoms only; presses and submits change it in handlers.
  on('ui.render', { component: 'Pane', requestId: TUTOR_PANE }, async ($, e) => {
    tutorViewport = { surface: e.surface, columns: e.props.bodyColumns, bodyRows: e.props.scroll.bodyRows }
    const state = await read($, tutor)
    const screen = tutorScreen(state, await readTutorView($, state))
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    const line = (row: TutorRow) => (
      // Questions, reasons and replies wrap; the rest is cut, so the controls stay in view.
      <Text key={row.key} wrap={row.isWrapped ? 'wrap' : 'truncate-end'}>
        {row.cells.map((part, index) => (
          // Model text was cleaned when parsed; drawn as plain Text, cleaned once more.
          <Text key={String(index)} {...TUTOR_TONES[part.tone]}>{safeText(part.text)}</Text>
        ))}
      </Text>
    )
    const control = (item: TutorControl) => (
      <Button
        key={item.key}
        plain
        label={safeText(item.label)}
        {...(item.hotkey === undefined ? {} : { hotkey: item.hotkey })}
        onPress={() => void pressTutor($, item.action)}
      />
    )
    // Options and starts read as a list, one per row; the other controls share a row.
    const isListed = (item: TutorControl) =>
      item.action.kind === 'choose' || item.action.kind === 'start' || item.action.kind === 'review' || item.action.kind === 'self-grade'
    const field = screen.input
    // Mobile has no Input: its screens never ask for one, and this keeps a stray one off it.
    // No `value` either: the ticker redraws every pane, and a value would wipe what is typed.
    const typing = field !== undefined && 'Input' in elements
      ? (
        <elements.Input
          key={field.key}
          label={field.label}
          placeholder={field.placeholder}
          submitLabel={field.submitLabel}
          onSubmit={text => void submitTutorText($, field.purpose, text)}
        />
      )
      : null
    return (
      <Box flexDirection="column" alignItems="flex-start" paddingX={1}>
        {screen.header.map(line)}
        {screen.body.map(line)}
        {typing}
        <Box flexDirection="column">{screen.controls.filter(isListed).map(control)}</Box>
        <Box flexDirection="row" gap={2}>{screen.controls.filter(item => !isListed(item)).map(control)}</Box>
      </Box>
    )
  })
}
