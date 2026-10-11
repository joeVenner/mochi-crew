/** The prop Mochi holds while a non-editing tool runs. */
export type Gadget = 'hammer' | 'magnifier' | 'antenna'

/**
 * What Mochi is doing. `since`/`at` are clock ms; `fromX` is where Mochi stood
 * when the activity began, so walks continue smoothly from there.
 */
export type MascotActivity =
  | { kind: 'idle'; since: number; fromX?: number }
  | { kind: 'editing'; file: string; tool: string; since: number; fromX?: number }
  | { kind: 'using'; gadget: Gadget; detail: string; since: number; fromX?: number; verb?: string }
  | { kind: 'done'; file: string; hasFailed: boolean; at: number; x?: number }

export type CrewStats = { xp: number; edits: number; combo: number }

/** A subagent shown as a worker cat; `leftAt` is set once it finished and is walking out. */
export type Worker = {
  id: string
  type: string
  description: string
  file?: string
  /** The worker's latest tool call for the HUD, e.g. `🔍 util.ts` or `🔨 npm test`. */
  doing?: string
  /** Whether that latest call was an edit (the worker holds its page) or another tool. */
  lastKind?: 'edit' | 'tool'
  /** Tool calls of this worker running right now; none means its model is thinking. */
  activeCalls?: number
  joinedAt: number
  leftAt?: number
}

/** Mochi's wellbeing, 0–100 each, as of `updatedAt` (clock ms); both decay over time. */
export type Care = { mood: number; energy: number; updatedAt: number }

/** A short animation the person triggered from the pane. */
export type Reaction = { kind: 'pet' | 'feed' | 'dance'; at: number }

/** A bug monster born from a failed command; `squashedAt` is set once a later command succeeds. */
export type Bug = { command: string; spawnedAt: number; squashedAt?: number }

/** A line in Mochi's speech bubble, shown for a few seconds from `at`. */
export type Quip = { text: string; at: number }

/** Why a main-loop turn ended, as `turn.complete` reports it. */
export type TurnOutcome = 'answer' | 'aborted' | 'refusal' | 'error'

/** The main loop's turn (`turnId` from turn.start): Claude working on it, or handed back to you at `since`. */
export type Turn =
  | { phase: 'working'; turnId: string; since: number; lastSeenAt?: number }
  | { phase: 'waiting'; turnId: string; since: number; outcome: TurnOutcome; durationMs: number }

/**
 * This session's work as Mochi saw it (not persisted): main-loop turns and
 * their time and how many shipped a change, clean and failed edits (Claude's and
 * subagents'), shell commands and passing test runs (also subagents'), bugs fixed, subagents
 * hired, and distinct files edited, oldest first.
 */
export type Journal = {
  turns: number
  shipped: number
  workingMs: number
  edits: number
  failedEdits: number
  commands: number
  failedCommands: number
  greenRuns: number
  fixes: number
  hires: number
  files: readonly string[]
}

/**
 * What the current main-loop turn has achieved so far, for scoring it fairly. Fresh at
 * each turn start; `turnId` is unset before the first turn and once the turn is settled.
 * `previous` holds the last turn's ledger until its completion settles it, because a
 * queued prompt's turn.start can arrive before that completion is processed.
 */
export type TurnLedger = {
  files: readonly string[]
  cleanEdits: number
  hasGreenTests: boolean
  turnId?: string
  previous?: TurnLedger
  /** The last turn settled, so a late or replayed start or completion of it changes nothing. */
  settledTurnId?: string
}

/** Mochi's outfits; hooks/outfits.ts must define a pixel overlay for each. */
export type OutfitName = 'classic' | 'wizard' | 'pirate' | 'party' | 'shades' | 'crown'

declare module 'claude-code' {
  interface PluginState {
    'mochi-crew': {
      activity: MascotActivity
      stats: CrewStats
      workers: readonly Worker[]
      outfit: OutfitName
      isSoundOn: boolean
      care: Care
      reaction: Reaction | null
      bug: Bug | null
      quip: Quip | null
      achievements: readonly string[]
      turn: Turn | null
      journal: Journal
      ledger: TurnLedger
      missions: readonly string[]
    }
  }
}
