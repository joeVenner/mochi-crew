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

/**
 * Who serves and bills the session's model requests, for the session meter.
 *
 * `subscription`: a claude.ai plan (rate-limit windows reported). `api-key`: a Claude
 * Console key. `anthropic`: first-party, billing not yet known (no limits reported yet).
 * `gateway`: a custom ANTHROPIC_BASE_URL or a Claude apps gateway. The cloud ones are
 * selected by their CLAUDE_CODE_USE_* variable.
 */
export type Provider =
  | 'subscription'
  | 'api-key'
  | 'anthropic'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'anthropic-aws'
  | 'gateway'
  | 'unknown'

/** Prompt-cache token totals for the main conversation, summed over its turns. */
export type CacheTotals = {
  /** Main-thread turns that reported usage. */
  readonly turns: number
  /** Input tokens served from the cache. */
  readonly read: number
  /** Input tokens written to the cache. */
  readonly write: number
  /** Input tokens neither read from nor written to the cache. */
  readonly uncached: number
  /** Output tokens generated. */
  readonly output: number
}

/** One rate-limit window as the meter keeps it. */
export type LimitWindow = {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  readonly kind: string
  /** 0 to 100, past 100 on an exceeded spend limit. */
  readonly percentUsed: number
}

/** The latest session measurement the meter draws from. */
export type Measure = {
  /** Input tokens of the last response; absent before the first response and after a compact. */
  readonly tokens?: number
  /** The model's context window in tokens; 0 when the engine reported no usable size. */
  readonly window: number
  /** `tokens` over `window`, 0 to 100; absent with `tokens`. */
  readonly percent?: number
  readonly limits: readonly LimitWindow[]
  /** US dollars at list (or configured) price; absent where the host keeps no ledger. */
  readonly costUsd?: number
}

/** A file's git state as the file tree badges it: modified, added, deleted, renamed, untracked. */
export type GitMark = 'M' | 'A' | 'D' | 'R' | '?'

/**
 * The file Claude's main loop is editing or reading right now. `path` is relative to the project
 * root, or to `worktree` (a linked git worktree's absolute path, as git lists it) when set.
 */
export type TreeFocus = { readonly path: string; readonly kind: 'edit' | 'read'; readonly since: number; readonly worktree?: string }

/**
 * A file touched this session, relative to the project root, or to `worktree` when set;
 * `workerId` when a subagent touched it last.
 */
export type TouchedFile = { readonly path: string; readonly workerId?: string; readonly worktree?: string }

/** Folders the person opened or closed by hand, over the session's own: true open, false closed. */
export type FolderToggles = Readonly<Record<string, boolean>>

/** One directory entry as the file tree keeps it. */
export type TreeEntry = { readonly name: string; readonly isDir: boolean }

/** What the file tree last read from disk and git; the rows are drawn from it at render time. */
export type TreeSnapshot = {
  /** The project root's folder name. */
  readonly rootName: string
  /** Listings by directory relative to the root (`''` is the root), sorted, only for expanded ones. */
  readonly listings: Readonly<Record<string, readonly TreeEntry[]>>
  /** Git state per changed file, relative to the root. */
  readonly marks: Readonly<Record<string, GitMark>>
  /** Lines added per changed file, relative to the root. */
  readonly added: Readonly<Record<string, number>>
  /** The checked-out branch, absent outside a repository or on a detached head. */
  readonly branch?: string
  /** The repository's other worktrees, in git's order; absent outside a repository. */
  readonly worktrees?: readonly WorktreeSnapshot[]
}

/** A linked git worktree as the tree last read it. */
export type WorktreeSnapshot = {
  /** Its absolute path as `git worktree list` prints it: the key its touches and toggles carry. */
  readonly path: string
  /** Its own read: listings only while its section is open, badges always. */
  readonly tree: TreeSnapshot
}

/** The session badge's color ids. */
export type TintId = 'plum' | 'harbor' | 'pine' | 'claret' | 'rust' | 'moss' | 'walnut' | 'graphite'

/** Session badge: which session the tint belongs to. */
export type BadgeState = { readonly sessionId: string; readonly tintId: TintId }

/** Session badge: the Terminal.app tab this session draws in and the profile to restore it to. */
export type BadgeTab = { readonly tty: string; readonly profile: string }

/** Session badge: how the last session in this process ended, so a /clear hands its color on. */
export type BadgeEnding = { readonly sessionId: string; readonly reason: string }

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
      /** Session meter: the latest measurement, null before one. */
      meterMeasure: Measure | null
      /** Session meter: main-conversation prompt-cache totals. */
      meterCache: CacheTotals
      /** Session meter: the session's model id, null before it is known. */
      meterModel: string | null
      meterProvider: Provider
      /** Session meter: clock ms of the last main-thread turn's end, null before one. */
      meterLastResponseAt: number | null
      /** Session meter: alert keys already raised (e.g. `context:90`), once per crossing. */
      meterAlerts: readonly string[]
      /** File tree: the file the main loop works on now, null between calls. */
      treeFocus: TreeFocus | null
      /** File tree: files touched this session, oldest first. */
      treeTouched: readonly TouchedFile[]
      /** File tree: folders the person opened or closed by hand this session. */
      treeToggles: FolderToggles
      /** File tree: the same per linked worktree, by its path; `''` opens or closes its section. */
      treeWorktreeToggles: Readonly<Record<string, FolderToggles>>
      /** File tree: the last read of disk and git, null before one. */
      tree: TreeSnapshot | null
      /** File tree: whether the section shows under the HUD (saved across sessions). */
      isTreeOn: boolean
      /** Session badge: this session's tint, null before it is picked. */
      badge: BadgeState | null
      /** Session badge: the tab being tinted, null when none was found. */
      badgeTab: BadgeTab | null
      /** Session badge: how the last session in this process ended. */
      badgeEnded: BadgeEnding | null
      /** Session badge: whether tabs are tinted and titles get the emoji (saved across sessions). */
      isBadgeOn: boolean
    }
  }
}
