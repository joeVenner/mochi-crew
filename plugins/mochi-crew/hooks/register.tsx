import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookFailure, Register, SessionMeasureInput, Timer, ToolCallResult, TurnCompleteInput } from 'claude-code'

import type { Bug, CacheTotals, Care, CrewStats, Gadget, Journal, Measure, Provider, TouchedFile, TreeEntry, TreeFocus, TreeSnapshot, TurnLedger, MascotActivity, OutfitName, Quip, Reaction, Turn, TurnOutcome, Worker } from '../types'
import type { Achievement, Facts } from './achievements'
import { ACHIEVEMENTS, achievementList, newlyUnlocked, parseUnlocked } from './achievements'
import { mascotXAt, settle } from './behavior'
import type { QuipEvent } from './events'
import { activeQuip, isBugAlive, quipFor, spawnBug, squashBug, visibleBug } from './events'
import type { CareEvent } from './care'
import { FRESH_CARE, activeReaction, applyCare, careAt, feelingOf, parseCare } from './care'
import { MAX_VISIBLE_WORKERS, XP_PER_WORKER, hatOf, isOnStage, isRunningStatus, joinWorker, markFinished, pruneWorkers, rejoinWorker, workerCallEnded, workerCallStarted, workerEdited, workerFinished } from './crew'
import { EMPTY_STATS, applyEdit, levelOf, parseStats } from './game'
import { BAR_GLYPH, barCells, barWidthFor, column, comboBadge, crewSummary, gutter, hudPlan, ruleFor, treeBudget, vitalNote } from './hud'
import { launchersFor } from './editor'
import type { TreeRow } from './fileTree'
import { MIN_TREE_ROWS, anchorOf, expandedDirs, isInside, isMissingListing, parseGitStatus, parseNumstat, relativeTo, rowParts, safeText, toEntries, touch, treeLine, treeRows, windowRows } from './fileTree'
import type { JournalEvent } from './journal'
import { EMPTY_JOURNAL, journalLine, journalReport, record } from './journal'
import { XP_PER_MISSION, missionCount, missionLine, missionReport, newlyCompleted } from './missions'
import type { Mission } from './missions'
import { safeDetail } from './redact'
import { activityLabel, fileName, gadgetForCommand, mcpToolLabel, workerDoing, workerNote } from './mascot'
import { DEFAULT_OUTFIT, OUTFIT_NAMES, isOutfitName, parseMascotCommand } from './outfits'
import { ROLE_INFO, roleFor } from './roles'
import type { SceneInput } from './sprite'
import { DONE_MS, SCENE_ROWS, cellsFor } from './sprite'
import { FRESH_LEDGER, XP_PER_GREEN_TESTS, beginLedger, isTestCommand, noteEdit, noteGreenTests, settleTurn } from './progress'
import { completeTurn, isThinking, isTurnTrouble, keepTurnAlive, startTurn, touchTurn, turnLabel } from './turn'
import { MIN_SCENE_WIDTH, sceneWidthFor } from './world'
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
const STORE = { stats: 'stats', outfit: 'outfit', isSoundOn: 'isSoundOn', care: 'care', achievements: 'achievements', isTreeOn: 'treeOn' } as const

const SOUNDS = { done: 'sounds/done.wav', levelUp: 'sounds/levelup.wav', join: 'sounds/join.wav' } as const
type Sound = (typeof SOUNDS)[keyof typeof SOUNDS]

const IDLE: MascotActivity = { kind: 'idle', since: 0 }
const NO_WORKERS: readonly Worker[] = []
const activity = atom({ plugin: 'mochi-crew', key: 'activity' } as const, IDLE)
const stats = atom({ plugin: 'mochi-crew', key: 'stats' } as const, EMPTY_STATS)
const workers = atom({ plugin: 'mochi-crew', key: 'workers' } as const, NO_WORKERS)
const outfit = atom({ plugin: 'mochi-crew', key: 'outfit' } as const, DEFAULT_OUTFIT)
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

/** Restores what earlier sessions saved; anything malformed falls back to defaults. */
const loadSaved = async ($: EngineInterface): Promise<void> => {
  const readSaved = (key: string): Promise<unknown> =>
    $.store.get(key).catch((error: unknown) => {
      $.ui.log(`mochi-crew: could not read saved ${key}: ${String(error)}`, { to: 'debug' })
      return undefined
    })
  const savedStats = parseStats(await readSaved(STORE.stats))
  const savedOutfit = await readSaved(STORE.outfit)
  const savedSound = await readSaved(STORE.isSoundOn)
  const savedCare = await readSaved(STORE.care)
  const savedAchievements = await readSaved(STORE.achievements)
  const savedTreeOn = await readSaved(STORE.isTreeOn)
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
  const [worn, wellbeing, playing, loose, latestTurn] = await Promise.all([
    read($, outfit), read($, care), read($, reaction), read($, bug), read($, turn),
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

const toggleSound = async ($: EngineInterface): Promise<string> =>
  runMascotCommand($, (await read($, isSoundOn)) ? 'sound off' : 'sound on')

/** Runs a pane button's action; its answer shows as a toast. */
const pressButton = async ($: EngineInterface, action: () => Promise<string>): Promise<void> => {
  try {
    $.ui.toast(await action())
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
    await raiseAlerts($)
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: meter could not count a turn: ${String(error)}`, { to: 'debug' })
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

/** A git command's output in the project root, or undefined when it fails or there is no repo. */
const gitOutput = async ($: EngineInterface, root: string, args: readonly string[]): Promise<string | undefined> => {
  try {
    // No optional locks, so a refresh never holds index.lock against the person's own git; no
    // fsmonitor command from the repository's config.
    const ran = await $.process.run(
      ['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', ...args],
      { cwd: root, timeoutMs: TREE_RUN_MS },
    )
    return ran.exitCode === 0 ? ran.stdout : undefined
  } catch (error: unknown) {
    $.ui.log(`mochi-crew: git ${args[0] ?? ''} failed for the file tree: ${String(error)}`, { to: 'debug' })
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

/** Reads the open folders and git's view of the project into a fresh snapshot. */
const readTree = async ($: EngineInterface): Promise<void> => {
  const root = await $.session.root()
  const focus = await read($, treeFocus)
  const touched = await read($, treeTouched)
  const dirs = [...expandedDirs([...touched.map(file => file.path), ...(focus === null ? [] : [focus.path])])]
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
  const snapshot: TreeSnapshot = {
    rootName: safeText(fileName(root)),
    listings: Object.fromEntries(listed),
    marks: !isRepo ? {} : status === undefined ? previous?.marks ?? {} : parseGitStatus(status, prefix),
    added: !isRepo ? {} : numstat === undefined ? previous?.added ?? {} : parseNumstat(numstat, prefix),
    ...(branchName === undefined || branchName === '' ? {} : { branch: safeText(branchName) }),
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
// The project root as given and as it resolves: tools may report either spelling (/var vs
// /private/var on macOS). Re-read when the root moves.
let treeRoots: { root: string; real: string } | undefined

/** A tool's path relative to the project, under either spelling of the root. */
const treePathOf = async ($: EngineInterface, file: string): Promise<string | undefined> => {
  const root = await $.session.root()
  if (treeRoots?.root !== root) {
    const real = (await $.fs.stat(root, { resolve: true }).catch(() => undefined))?.realPath ?? root
    treeRoots = { root, real }
  }
  return relativeTo(root, file) ?? relativeTo(treeRoots.real, file)
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
    const path = await treePathOf($, file)
    if (path === undefined) {
      $.ui.log('mochi-crew: a file outside the project is left out of the tree', { to: 'debug' })
      return
    }
    const touched = isLive ? await read($, treeTouched) : await update($, treeTouched, current => touch(current, path, agentId))
    if (isLive) {
      const since = await $.clock.now()
      await update($, treeFocus, (): TreeFocus | null => ({ path, kind, since }))
    }
    if (isMissingListing(await read($, tree), [...touched.map(entry => entry.path), path])) queueTreeRefresh($)
    $.ui.invalidate('ui.render')
  }
  treeNotes = treeNotes
    .then(apply)
    .catch((error: unknown) => $.ui.log(`mochi-crew: could not note a file for the tree: ${String(error)}`, { to: 'debug' }))
}

/**
 * Opens a file of the tree in the person's editor. The path must resolve inside the project;
 * only windowed editors are run, by argument vector, never through a shell.
 */
const openInEditor = async ($: EngineInterface, path: string, surface: string): Promise<string> => {
  // Commands run only from the terminal CLI; a desktop or editor surface has no host to run on.
  if (surface !== 'terminal') return 'Opening a file from the tree works in the terminal app only.'
  const root = await $.session.root()
  const rootReal = (await $.fs.stat(root, { resolve: true })).realPath ?? root
  const relative = relativeTo(root, path)
  const target = relative === undefined
    ? undefined
    : (await $.fs.stat(`${root}/${relative}`, { resolve: true }).catch(() => undefined))?.realPath
  const shown = safeText(relative ?? path)
  if (target === undefined || !isInside(rootReal, target)) return `Could not open ${shown}: it is not a file in this project.`
  const env = { VISUAL: await $.env.get('VISUAL'), EDITOR: await $.env.get('EDITOR') }
  for (const argv of launchersFor(env, target)) {
    try {
      const ran = await $.process.run(argv, { timeoutMs: TREE_RUN_MS })
      if (ran.exitCode === 0) return `Opened ${shown}.`
    } catch (error: unknown) {
      // Not installed, or not a terminal session: try the next one.
      $.ui.log(`mochi-crew: ${argv[0] ?? ''} could not open a file: ${String(error)}`, { to: 'debug' })
    }
  }
  return `Could not open ${shown}: no editor found (set VISUAL to code, cursor or zed).`
}

export const register: Register = on => {
  on('session.end', async ($, e, next) => {
    // Every ending closes this conversation's figures, a /clear and a resume included.
    await resetConversation($)
    isTreePulsing = false
    if (e.reason === 'prompt_input_exit' || e.reason === 'logout' || e.reason === 'other') {
      hudRefresh?.cancel()
      hudRefresh = undefined
    }
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
    await loadSaved($)
    // Local state only, so it is cheap to await; done first so no turn is counted and then wiped.
    await resetConversation($).catch((error: unknown) =>
      $.ui.log(`mochi-crew: meter could not reset: ${String(error)}`, { to: 'debug' }),
    )
    // `/mochi` is the same command under the cat's own name.
    for (const name of MASCOT_COMMANDS) {
      await $.command.register({
        name,
        description: 'Open the Mochi crew pane, read the session journal or meter, show the file tree, change outfit, toggle sound',
        argumentHint: '[journal | missions | achievements | meter | files [on|off] | outfits | outfit <name> | sound on|off]',
      })
    }
    void $.ui.open({ id: PANE, title: TITLE })
    // The host reads go off the start-up path, so Mochi and /mascot never wait on them.
    void startMeter($).catch((error: unknown) => $.ui.log(`mochi-crew: meter could not start: ${String(error)}`, { to: 'debug' }))
    queueTreeRefresh($)

    return next(e)
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
    const label = liveBug !== null && isBugAlive(liveBug) && current.kind === 'idle'
      ? `fighting a bug · ${liveBug.command}`
      : activityLabel(current, now, isThinking(currentTurn))
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
    const treeSpace = snapshot !== null && !isCompact ? treeBudget(e.props.scroll.bodyRows, sceneRows, hudExtras) : 0
    const allTreeRows = snapshot !== null && treeSpace >= MIN_TREE_ROWS ? treeRows({ snapshot, focus, touched: touchedFiles }) : null
    const shownTree = allTreeRows === null ? null : windowRows(allTreeRows, anchorOf(allTreeRows, touchedFiles), treeSpace)
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
          <Text color={nameColor} bold={isActive} dimColor={isDim}>{parts.name}</Text>
          <Text>{gap}</Text>
          <Text color={THEME.good}>{lines}</Text>
          <Text>{lines !== '' && mark !== '' ? ' ' : ''}</Text>
          <Text color={row.mark === 'D' ? THEME.alert : undefined} dimColor={row.mark !== 'D'}>{mark}</Text>
        </Text>
      )
      if (row.kind !== 'file') return <Text key={`tree:${row.key}`}>{pieces}</Text>
      return (
        <Button key={`file:${row.key}`} plain onPress={press => void pressButton($, () => openInEditor($, row.key, press.surface))}>
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
          <Button key="sound" hotkey="s" plain label={soundOn ? 'mute' : 'sound'} onPress={() => void pressButton($, () => toggleSound($))} />
          <Button key="files" hotkey="t" plain label="files" onPress={() => void pressButton($, () => runMascotCommand($, 'files'))} />
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
}
