import { describe, expect, test } from 'claude-code/testing'

import type { MascotActivity, OutfitName, Worker } from '../types'
import {
  HATS, WALK_MS, hatOf, isOnStage, isRunningStatus, isWalking, isWorkerBusy, rejoinWorker, workerFinished, isWorkerThinking, joinWorker, markFinished, pruneWorkers, workerCallEnded, workerCallStarted, workerEdited, workerX,
} from '../hooks/crew'
import { sceneFor, workerSlots } from '../hooks/sprite'

const scene = (activity: MascotActivity, tick: number, workers: readonly Worker[] = [], now = 0, outfit: OutfitName = 'classic') =>
  sceneFor({ activity, tick, workers, now, outfit, width: 40, hour: 12, feeling: 'okay', reaction: null, bug: null, turn: null }).pixels

const ALPHA: Worker = { id: 'a1', type: 'Explore', description: 'map the code', joinedAt: 0 }

describe('crew', () => {
  test('joining is idempotent per agent id', async () => {
    const once = joinWorker([], ALPHA, 0)
    expect(once).toHaveLength(1)
    expect(joinWorker(once, ALPHA, 50)).toHaveLength(1)
    expect(joinWorker(once, { ...ALPHA, id: 'b2' }, 50)).toHaveLength(2)
  })

  test('an edit lands on the right worker only', async () => {
    const crew = [ALPHA, { ...ALPHA, id: 'b2' }]
    const edited = workerEdited(crew, 'b2', '/r/x.ts')
    expect(edited[0]?.file).toBeUndefined()
    expect(edited[1]?.file).toBe('/r/x.ts')
  })

  test("a worker is busy while its calls run, thinking between them", async () => {
    const crew = [ALPHA, { ...ALPHA, id: 'b2' }]
    const started = workerCallStarted(crew, 'b2', { kind: 'tool', doing: 'look notes.md' })
    expect(started[0]).toBe(crew[0])
    expect(started[1]).toMatchObject({ doing: 'look notes.md', lastKind: 'tool', activeCalls: 1 })
    expect(isWorkerBusy(started[1] ?? ALPHA)).toBe(true)
    expect(isWorkerThinking(started[1] ?? ALPHA)).toBe(false)
    // Two calls in parallel: busy until both end.
    const both = workerCallStarted(started, 'b2', { kind: 'edit', doing: 'edit x.ts' })
    const oneLeft = workerCallEnded(both, 'b2')
    expect(isWorkerBusy(oneLeft[1] ?? ALPHA)).toBe(true)
    const idle = workerCallEnded(oneLeft, 'b2')
    expect(isWorkerThinking(idle[1] ?? ALPHA)).toBe(true)
    // An extra end never goes below zero; unknown ids change nothing.
    expect(workerCallEnded(idle, 'b2')[1]?.activeCalls).toBe(0)
    expect(workerCallStarted(crew, 'nobody', { kind: 'tool', doing: 'run ls' })).toBe(crew)
    expect(workerCallEnded(crew, 'nobody')).toBe(crew)
    // Before its first call a worker is neither busy nor thinking; leaving, never thinking.
    expect(isWorkerThinking(ALPHA)).toBe(false)
    expect(isWorkerThinking({ ...(idle[1] ?? ALPHA), leftAt: 5 })).toBe(false)
    expect(workerEdited(crew, 'b2', '/r/x.ts')[1]?.file).toBe('/r/x.ts')
  })

  test('the scene shows a page only while an edit runs, and dots while thinking', async () => {
    const editing: Worker = { ...ALPHA, file: '/r/x.ts', doing: 'edit x.ts', lastKind: 'edit', activeCalls: 1 }
    const thinking: Worker = { ...editing, activeCalls: 0 }
    const at = 60_000
    const busyFrame = scene({ kind: 'idle', since: 0 }, 1, [editing], at)
    const thinkingFrame = scene({ kind: 'idle', since: 0 }, 9, [thinking], at)
    const quietFrame = scene({ kind: 'idle', since: 0 }, 9, [ALPHA], at)
    expect(busyFrame).not.toEqual(scene({ kind: 'idle', since: 0 }, 1, [thinking], at))
    expect(thinkingFrame).not.toEqual(quietFrame)
  })

  test('a leaving worker is never left counted busy', async () => {
    const busy = workerCallStarted([ALPHA], 'a1', { kind: 'tool', doing: 'run x' })
    expect(workerFinished(busy, 'a1', 5)[0]?.activeCalls).toBe(0)
    expect(markFinished(busy, new Map(), 5)[0]?.activeCalls).toBe(0)
  })

  test('a worker comes back for a later run: walks in fresh, or turns around mid-exit', async () => {
    const joining = { id: 'a1', type: 'Explore', description: 'map the code' }
    expect(rejoinWorker([], joining, 50)).toEqual([{ ...joining, joinedAt: 50 }])
    const onStage = [ALPHA]
    expect(rejoinWorker(onStage, joining, 50)).toBe(onStage)
    const leaving: Worker = { ...ALPHA, leftAt: 40, doing: 'run x', activeCalls: 0 }
    expect(rejoinWorker([leaving], joining, 50)).toEqual([{ ...joining, joinedAt: 50 }])
    expect(isOnStage([leaving], 'a1')).toBe(false)
    expect(isOnStage(onStage, 'a1')).toBe(true)
    expect(isRunningStatus('running')).toBe(true)
    expect(isRunningStatus('completed')).toBe(false)
  })

  test('ended or vanished agents start walking out; running ones stay', async () => {
    const crew = [ALPHA, { ...ALPHA, id: 'b2' }, { ...ALPHA, id: 'c3' }]
    const statuses = new Map([['a1', 'running'], ['b2', 'completed']])
    const marked = markFinished(crew, statuses, 900)
    expect(marked[0]?.leftAt).toBeUndefined()
    expect(marked[1]?.leftAt).toBe(900)
    expect(marked[2]?.leftAt).toBe(900)
  })

  test('workers are pruned once their walk out is over', async () => {
    const leaving: Worker = { ...ALPHA, leftAt: 1000 }
    expect(pruneWorkers([leaving], 1000 + WALK_MS - 1)).toHaveLength(1)
    expect(pruneWorkers([leaving], 1000 + WALK_MS)).toHaveLength(0)
    expect(pruneWorkers([ALPHA], 99999)).toHaveLength(1)
  })

  test('workers walk in from the right edge to their slot and back out', async () => {
    expect(workerX(ALPHA, 20, 0, 40)).toBe(40)
    expect(workerX(ALPHA, 20, WALK_MS / 2, 40)).toBe(30)
    expect(workerX(ALPHA, 20, WALK_MS, 40)).toBe(20)
    expect(workerX({ ...ALPHA, leftAt: 5000 }, 20, 5000 + WALK_MS, 40)).toBe(40)
    expect(isWalking(ALPHA, WALK_MS)).toBe(false)
    expect(isWalking({ ...ALPHA, leftAt: 1 }, 99999)).toBe(true)
  })

  test('each worker keeps one hat color', async () => {
    expect(hatOf('a1')).toBe(hatOf('a1'))
    expect(HATS).toContain(hatOf('anything'))
  })

  test('a worker on stage adds its pixels to the scene', async () => {
    const empty = scene({ kind: 'idle', since: 0 }, 1, [], WALK_MS)
    const crewed = scene({ kind: 'idle', since: 0 }, 1, [ALPHA], WALK_MS)
    // Kittens wear gray fur, distinct from Mochi's lilac.
    const kittenFur = (pixels: Int32Array) => pixels.filter(p => p === 0xa9b3bf).length
    expect(kittenFur(empty)).toBe(0)
    expect(kittenFur(crewed)).toBeGreaterThan(15)
  })
})

describe('crew layout', () => {
  test('a narrow scene only uses slots clear of Mochi’s home spot', async () => {
    expect(workerSlots(40)).toHaveLength(2)
    expect(workerSlots(52)).toHaveLength(3)
    for (const width of [40, 52, 64]) for (const slot of workerSlots(width)) expect(slot).toBeGreaterThanOrEqual(14)
  })

  test('front-row workers never hide Mochi at home, even three of them', async () => {
    const FUR = 0xb9a7d6
    const crew = ['a', 'b', 'c'].map(id => ({ ...ALPHA, id, joinedAt: -10_000 }))
    const homeShell = (pixels: Int32Array) => {
      let fur = 0
      for (let y = 0; y < 32; y += 1) for (let x = 2; x < 14; x += 1) if (pixels[y * 40 + x] === FUR) fur += 1
      return fur
    }
    const alone = scene({ kind: 'idle', since: 0 }, 1, [], 0)
    const crowded = scene({ kind: 'idle', since: 0 }, 1, crew, 0)
    expect(homeShell(crowded)).toBe(homeShell(alone))
  })

  test('a thinking worker’s cloud goes behind Mochi at the desk', async () => {
    const FUR = 0xb9a7d6
    const editing: MascotActivity = { kind: 'editing', file: 'a.ts', tool: 'Edit', since: -60_000, fromX: 2 }
    const crew = (doing: string | undefined): Worker[] =>
      ['a', 'b', 'c'].map(id => ({ ...ALPHA, id, joinedAt: -10_000, ...(doing === undefined ? {} : { doing, lastKind: 'tool' as const, activeCalls: 0 }) }))
    const frame = (doing: string | undefined) =>
      sceneFor({ activity: editing, tick: 9, workers: crew(doing), now: 0, outfit: 'classic', width: 52, hour: 12, feeling: 'okay', reaction: null, bug: null, turn: null }).pixels
    const quiet = frame(undefined)
    const thinking = frame('look a')
    // The clouds appear, but not one pixel of fur (Mochi's, at the desk) is painted over.
    expect(thinking).not.toEqual(quiet)
    quiet.forEach((pixel, i) => {
      if (pixel === FUR) expect(thinking[i]).toBe(FUR)
    })
  })
})
