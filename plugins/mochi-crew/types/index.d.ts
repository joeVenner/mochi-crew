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

/** Tutor: what a round asks about. */
export type TutorFocus = 'recent' | 'turn' | 'project'

/** Tutor: what kind of understanding a question checks, easiest first. */
export type TutorTag = 'what' | 'how' | 'why' | 'what-if'

/** Tutor: the fields every question kind shares. */
export type TutorQuestionBase = {
  readonly id: string
  readonly tag: TutorTag
  readonly topic: string
  readonly prompt: string
  readonly hint?: string
  /** A project-relative path, kept only when it matched a file the tutor was given. */
  readonly file?: string
  readonly symbol?: string
  /** Set on a question replayed from the review deck. */
  readonly isReview?: true
}

/** Tutor: a multiple-choice question, graded locally; `why` gives each option's reason, in order. */
export type ChoiceQuestion = TutorQuestionBase & {
  readonly kind: 'choice'
  readonly options: readonly string[]
  readonly answer: number
  readonly why: readonly string[]
}

/** Tutor: a question answered in the learner's own words, checked against its key points. */
export type ExplainQuestion = TutorQuestionBase & {
  readonly kind: 'explain'
  readonly reference: string
  readonly keyPoints: readonly string[]
}

export type TutorQuestion = ChoiceQuestion | ExplainQuestion

/** Tutor: where a round's questions came from. */
export type TutorSource = 'fork' | 'digest' | 'review'

export type TutorOutcome = 'right' | 'partial' | 'wrong' | 'skipped'

/** Tutor: how the learner answered one question. */
export type TutorAnswer = {
  readonly questionId: string
  readonly outcome: TutorOutcome
  readonly hasUsedHint: boolean
  readonly picked?: number
  readonly given?: string
  readonly points?: readonly boolean[]
  readonly note?: string
  readonly isSelfGraded?: true
  readonly isCut?: true
}

/** Tutor: one follow-up question and Mochi's reply. */
export type TutorExchange = { readonly ask: string; readonly reply: string }

/** Tutor: tokens spent, as the API counted them, summed over calls. */
export type TutorUsage = {
  readonly calls: number
  readonly input: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly output: number
}

/** Tutor: why a round could not be written. */
export type TutorFailure =
  | { readonly kind: 'api-error'; readonly status: number | null; readonly error: string }
  | { readonly kind: 'bad-reply'; readonly why: 'no-json' | 'bad-json' | 'too-long' | 'bad-version' | 'bad-shape' | 'too-few' }
  | { readonly kind: 'empty-reply' | 'timeout' | 'nothing-to-quiz' }
  | { readonly kind: 'model-refused'; readonly model: string }

/** Tutor: one round of questions and how it is going. */
export type TutorRound = {
  readonly id: string
  readonly epoch: number
  readonly focus: TutorFocus
  readonly source: TutorSource
  readonly startedAt: number
  readonly questions: readonly TutorQuestion[]
  readonly index: number
  /** One per answered question, in question order. */
  readonly answers: readonly TutorAnswer[]
  readonly isHintShown: boolean
  readonly isRetry: boolean
  /** Follow-ups on the current question. */
  readonly chat: readonly TutorExchange[]
  readonly followUpsUsed: number
  readonly usage: TutorUsage
}

export type TutorLevel = 1 | 2 | 3

/** Tutor: the tab's screen; transitions happen in handlers, never while drawing. */
export type TutorState =
  | { readonly phase: 'closed' }
  | { readonly phase: 'consent'; readonly pending?: { readonly focus: TutorFocus; readonly isDigestOnly: boolean } }
  | { readonly phase: 'home'; readonly focus: TutorFocus; readonly isDigestOnly: boolean; readonly note?: string }
  | { readonly phase: 'loading'; readonly epoch: number; readonly focus: TutorFocus; readonly source: 'fork' | 'digest'; readonly since: number; readonly note?: string }
  | { readonly phase: 'question' | 'feedback'; readonly round: TutorRound }
  | { readonly phase: 'grading' | 'asking'; readonly round: TutorRound; readonly epoch: number; readonly since: number }
  | { readonly phase: 'summary'; readonly round: TutorRound; readonly xp: number; readonly levelBefore: TutorLevel; readonly levelAfter: TutorLevel; readonly wasForkMiss: boolean }
  | { readonly phase: 'error'; readonly failure: TutorFailure; readonly focus: TutorFocus; readonly canTryDigest: boolean }

/** Tutor: a missed question waiting to be asked again, `dueRound` counted in the project's rounds. */
export type TutorCard = { readonly question: TutorQuestion; readonly box: 1 | 2 | 3; readonly dueRound: number }

/** Tutor: one project's progress (saved across sessions). */
export type TutorProject = {
  readonly level: TutorLevel
  readonly rounds: number
  readonly streak: number
  readonly deck: readonly TutorCard[]
  readonly mastered: readonly string[]
  readonly recentMisses: readonly string[]
  readonly updatedAt: number
}

/** Tutor: every project's progress as saved in the store, keyed by project root. */
export type TutorProgressStore = { readonly v: 1; readonly projects: Readonly<Record<string, TutorProject>> }

/** Tutor: this conversation's rounds and spend (not saved). */
export type TutorSession = { readonly rounds: number; readonly usage: TutorUsage; readonly isForkSuspect: boolean }

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
      /** Session badge: the tint the badge put on the tab, null when it is on its profile. */
      badgePainted: TintId | null
      /** Tutor: the tutor tab's screen. */
      tutor: TutorState
      /** Tutor: the first-use notice version the person accepted, 0 before (saved across sessions). */
      tutorConsent: number
      /** Tutor: this project's level and review deck, null until the tab loads it. */
      tutorProject: TutorProject | null
      /** Tutor: this conversation's rounds and spend. */
      tutorSession: TutorSession
      /** Session meter: the session's model as of the last main-thread turn, null before one. */
      meterResponseModel: string | null
    }
  }
}
