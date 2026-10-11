import type { Worker } from '../types'

/** How long a worker takes to walk in or out of the scene. */
export const WALK_MS = 1200
export const MAX_VISIBLE_WORKERS = 3
/** XP the crew earns each time Claude delegates to a subagent. */
export const XP_PER_WORKER = 5

const ENDED_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'killed'])

/** Hard-hat colors as palette keys, with the HUD's matching text color. */
export const HATS = [
  { key: 'Y', text: 'yellow' },
  { key: 'C', text: 'cyan' },
  { key: 'P', text: 'magenta' },
  { key: 'G', text: 'green' },
] as const
export type Hat = (typeof HATS)[number]

/** A stable hat per worker id, so a worker keeps its color while others come and go. */
export const hatOf = (id: string): Hat => {
  let hash = 0
  for (const char of id) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return HATS[hash % HATS.length] ?? HATS[0]
}

export const joinWorker = (
  workers: readonly Worker[],
  joining: Pick<Worker, 'id' | 'type' | 'description'>,
  now: number,
): Worker[] =>
  workers.some(worker => worker.id === joining.id)
    ? [...workers]
    : [...workers, { ...joining, joinedAt: now }]

/** The worker now holds `file` as its page. */
/** True while the agent's worker stands on stage (not gone, not walking out). */
export const isOnStage = (workers: readonly Worker[], id: string): boolean =>
  workers.some(worker => worker.id === id && worker.leftAt === undefined)

/**
 * Brings an agent's worker back for a run after its first one ended (a resumed subagent,
 * a teammate): it walks in fresh, or turns around if it was still walking out. Already on
 * stage, nothing changes. No hire: the agent was hired once.
 */
export const rejoinWorker = (
  workers: readonly Worker[],
  joining: Pick<Worker, 'id' | 'type' | 'description'>,
  now: number,
): readonly Worker[] => {
  if (isOnStage(workers, joining.id)) return workers
  const fresh: Worker = { ...joining, joinedAt: now }
  return workers.some(worker => worker.id === joining.id)
    ? workers.map(worker => (worker.id === joining.id ? fresh : worker))
    : [...workers, fresh]
}

/** Whether an agent status means its run is still going. */
export const isRunningStatus = (status: string): boolean => !ENDED_STATUSES.has(status)

export const workerEdited = (workers: readonly Worker[], id: string, file: string): Worker[] =>
  workers.map(worker => (worker.id === id ? { ...worker, file } : worker))

/** What a worker's tool call is, for its HUD note and pose. */
export type WorkerCall = { kind: 'edit' | 'tool'; doing: string }

/** One of the worker's calls began; unknown ids change nothing. */
export const workerCallStarted = (workers: readonly Worker[], id: string, call: WorkerCall): readonly Worker[] =>
  workers.some(worker => worker.id === id)
    ? workers.map(worker =>
        worker.id === id ? { ...worker, doing: call.doing, lastKind: call.kind, activeCalls: (worker.activeCalls ?? 0) + 1 } : worker,
      )
    : workers

/** One of the worker's calls ended (never below zero); unknown ids change nothing. */
export const workerCallEnded = (workers: readonly Worker[], id: string): readonly Worker[] =>
  workers.some(worker => worker.id === id)
    ? workers.map(worker => (worker.id === id ? { ...worker, activeCalls: Math.max(0, (worker.activeCalls ?? 0) - 1) } : worker))
    : workers

export const isWorkerBusy = (worker: Worker): boolean => (worker.activeCalls ?? 0) > 0

/** True between calls of a worker that has done something: its model is working out the next step. */
export const isWorkerThinking = (worker: Worker): boolean =>
  worker.leftAt === undefined && worker.doing !== undefined && !isWorkerBusy(worker)

/**
 * Starts the walk-out for every present worker whose agent ended or vanished.
 *
 * @param statuses agent id → status, as `$.agent.list()` reports this session's agents
 */
export const markFinished = (
  workers: readonly Worker[],
  statuses: ReadonlyMap<string, string>,
  now: number,
): readonly Worker[] => {
  const isLeaving = (worker: Worker): boolean => {
    if (worker.leftAt !== undefined) return false
    const status = statuses.get(worker.id)
    return status === undefined || ENDED_STATUSES.has(status)
  }
  // The same array when nobody leaves, so the ticker can skip writing an unchanged crew.
  if (!workers.some(isLeaving)) return workers
  // A worker that leaves is done: calls it never heard back from no longer count.
  return workers.map(worker => (isLeaving(worker) ? { ...worker, leftAt: now, activeCalls: 0 } : worker))
}

/** Starts one worker's walk-out the moment its agent's run completes; others are untouched. */
export const workerFinished = (workers: readonly Worker[], id: string, now: number): Worker[] =>
  workers.map(worker => (worker.id === id && worker.leftAt === undefined ? { ...worker, leftAt: now, activeCalls: 0 } : worker))

/** Drops workers that have finished walking out; the same array when none has. */
export const pruneWorkers = (workers: readonly Worker[], now: number): readonly Worker[] => {
  const isGone = (worker: Worker): boolean => worker.leftAt !== undefined && now - worker.leftAt >= WALK_MS
  return workers.some(isGone) ? workers.filter(worker => !isGone(worker)) : workers
}

/**
 * A worker's left edge in scene pixels: walking in from the right edge to its
 * slot, standing there, then walking back out past the edge.
 */
export const workerX = (worker: Worker, slotX: number, now: number, sceneWidth: number): number => {
  const offstage = sceneWidth - slotX
  if (worker.leftAt !== undefined) {
    const progress = Math.min(1, (now - worker.leftAt) / WALK_MS)
    return Math.round(slotX + progress * offstage)
  }
  const progress = Math.min(1, Math.max(0, (now - worker.joinedAt) / WALK_MS))
  return Math.round(slotX + (1 - progress) * offstage)
}

export const isWalking = (worker: Worker, now: number): boolean =>
  worker.leftAt !== undefined || now - worker.joinedAt < WALK_MS
