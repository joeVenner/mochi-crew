import { describe, expect, test } from 'claude-code/testing'

import type { Bug, MascotActivity, OutfitName, Reaction, Turn, Worker } from '../types'
import type { Feeling } from '../hooks/care'
import { OUTFIT_NAMES } from '../hooks/outfits'
import { DONE_MS, SCENE_ROWS, cellsFor, sceneFor } from '../hooks/sprite'
import { HOME_X, ROUTINE_MS, SLEEP_MS, idleMoment, settle } from '../hooks/behavior'
import { MAX_SCENE_WIDTH, MIN_SCENE_WIDTH } from '../hooks/world'

const IDLE: MascotActivity = { kind: 'idle', since: 0 }
const EDITING: MascotActivity = { kind: 'editing', file: 'a.ts', tool: 'Edit', since: 0, fromX: 2 }
const SUCCESS: MascotActivity = { kind: 'done', file: 'a.ts', hasFailed: false, at: 0 }
const FAILURE: MascotActivity = { kind: 'done', file: 'a.ts', hasFailed: true, at: 0 }
const ACTIVITIES = [IDLE, EDITING, SUCCESS, FAILURE] as const

const FUR = 0xb9a7d6
const GREEN = 0x66bb6a
const RED = 0xef5350

const scene = (
  activity: MascotActivity,
  tick: number,
  {
    workers = [], now = 0, outfit = 'classic', width = MIN_SCENE_WIDTH, hour = 12, feeling = 'okay', reaction = null, bug = null, turn = null,
  }: {
    workers?: readonly Worker[]; now?: number; outfit?: OutfitName; width?: number; hour?: number
    feeling?: Feeling; reaction?: Reaction | null; bug?: Bug | null; turn?: Turn | null
  } = {},
) => sceneFor({ activity, tick, workers, now, outfit, width, hour, feeling, reaction, bug, turn }).pixels
const count = (pixels: Int32Array, color: number) => pixels.filter(p => p === color).length

describe('scene', () => {
  test('every pose at every width encodes to a full Raster', async () => {
    for (const width of [MIN_SCENE_WIDTH, 52, MAX_SCENE_WIDTH]) {
      const expectedLength = Math.ceil((width * SCENE_ROWS * 12) / 3) * 4
      for (const activity of ACTIVITIES) {
        for (let tick = 0; tick < 24; tick += 1) {
          const input = { activity, tick, workers: [], now: 0, outfit: 'classic', width, hour: tick, feeling: 'okay', reaction: null, bug: null, turn: null } as const
          expect(cellsFor(input).length).toBe(expectedLength)
        }
      }
    }
  })

  test('the cat is drawn in every pose', async () => {
    for (const activity of ACTIVITIES) expect(count(scene(activity, 1), FUR)).toBeGreaterThan(80)
  })

  test('idle bobs and blinks, editing animates the paws', async () => {
    expect(scene(IDLE, 1)).not.toEqual(scene(IDLE, 5))
    expect(scene(IDLE, 0)).not.toEqual(scene(IDLE, 8))
    expect(scene(EDITING, 0)).not.toEqual(scene(EDITING, 1))
  })

  test('success shows a green check, failure a red cross', async () => {
    const success = scene(SUCCESS, 2)
    const failure = scene(FAILURE, 2)
    expect(count(success, GREEN)).toBeGreaterThanOrEqual(6)
    expect(count(failure, RED)).toBeGreaterThanOrEqual(9)
  })

  test('open wall and floor are left to the pane background (transparent), not painted', async () => {
    // Most of the scene is wall: a terminal with line spacing would stripe any fill there.
    expect(count(scene(IDLE, 3), -1)).toBeGreaterThan((MIN_SCENE_WIDTH * 32) / 2)
  })

  test('settle keeps a fresh done and drops a stale one', async () => {
    const done: MascotActivity = { ...SUCCESS, at: 1000 }
    expect(settle(done, 1000 + DONE_MS - 1, DONE_MS, 40)).toBe(done)
    expect(settle(done, 1000 + DONE_MS, DONE_MS, 40)).toMatchObject({ kind: 'idle', since: 1000 + DONE_MS })
    expect(settle(EDITING, 99999, DONE_MS, 40)).toBe(EDITING)
  })
})

describe('outfits', () => {
  test('every outfit changes the cat, and classic adds nothing', async () => {
    const base = scene(IDLE, 1)
    for (const name of OUTFIT_NAMES.filter(name => name !== 'classic')) {
      expect(scene(IDLE, 1, { outfit: name })).not.toEqual(base)
    }
  })

  test('outfits stay inside the scene in every pose', async () => {
    for (const outfit of OUTFIT_NAMES) {
      for (const activity of ACTIVITIES) expect(() => scene(activity, 3, { outfit })).not.toThrow()
    }
  })
})

describe('reactions and moods', () => {
  const PINK = 0xf06292
  const CYAN = 0x4dd0e1

  test('petting floats hearts up', async () => {
    const pet: Reaction = { kind: 'pet', at: 0 }
    expect(count(scene(IDLE, 1, { now: 400, reaction: pet }), PINK)).toBeGreaterThanOrEqual(5)
    expect(count(scene(IDLE, 1, { now: 400 }), PINK)).toBe(0)
  })

  test('feeding throws a fish that Mochi catches', async () => {
    const feed: Reaction = { kind: 'feed', at: 0 }
    expect(count(scene(IDLE, 1, { now: 500, reaction: feed }), CYAN)).toBeGreaterThanOrEqual(5)
    expect(scene(IDLE, 1, { now: 200, reaction: feed })).not.toEqual(scene(IDLE, 1, { now: 800, reaction: feed }))
  })

  test('dancing moves on a beat, not on every frame', async () => {
    const dance: Reaction = { kind: 'dance', at: 0 }
    // Mochi's own pixels (the notes rise with time, the cloud and plant animate on their own).
    const mochi = (tick: number) => {
      const pixels = scene(IDLE, tick, { now: 500, reaction: dance })
      return Array.from(pixels).map((pixel, i) => (pixel === FUR ? i : -1)).filter(i => i >= 0).join()
    }
    expect(mochi(0)).toBe(mochi(1))
    expect(mochi(1)).not.toBe(mochi(2))
  })

  test('feelings change the face', async () => {
    const faces = (['happy', 'okay', 'sad', 'tired'] as const).map(feeling => scene(IDLE, 1, { feeling }).join(','))
    expect(new Set([faces[1], faces[2], faces[3]]).size).toBe(3)
  })
})

describe('bug fights', () => {
  const PURPLE = 0x8e24aa

  test('a live bug scuttles next to Mochi, who squares up to it', async () => {
    const bug: Bug = { command: 'npm test', spawnedAt: 0 }
    const withBug = scene(IDLE, 1, { bug })
    expect(count(withBug, PURPLE)).toBeGreaterThanOrEqual(10)
    expect(withBug).not.toEqual(scene(IDLE, 2, { bug }))
  })

  test('a squashed bug bursts and then vanishes', async () => {
    const squashed: Bug = { command: 'npm test', spawnedAt: 0, squashedAt: 1000 }
    const burst = scene(IDLE, 1, { bug: squashed, now: 1300 })
    expect(count(burst, PURPLE)).toBe(0)
    expect(burst).not.toEqual(scene(IDLE, 1, { now: 1300 }))
  })
})

describe('turns', () => {
  const PAPER_WHITE = 0xf5f5f5
  const working: Turn = { phase: 'working', turnId: 't', since: 0 }
  const answered: Turn = { phase: 'waiting', turnId: 't', since: 10_000, outcome: 'answer', durationMs: 10_000 }
  // Idle at home, past the walk back, on a non-wander routine.
  const atHome: MascotActivity = { kind: 'idle', since: 0 }

  test('while Claude works, Mochi thinks under a cloud whose dots fill in', async () => {
    const thinking = scene(atHome, 3, { turn: working })
    expect(count(thinking, PAPER_WHITE)).toBeGreaterThan(count(scene(atHome, 3), PAPER_WHITE))
    expect(thinking).not.toEqual(scene(atHome, 6, { turn: working }))
  })

  test('a long turn never puts Mochi to sleep', async () => {
    const SLEEP_BLUE = 0xe3f2fd
    const late = 10 * 60_000
    expect(count(scene(atHome, 3, { now: late }), SLEEP_BLUE)).toBeGreaterThan(0)
    expect(count(scene(atHome, 3, { now: late, turn: working }), SLEEP_BLUE)).toBe(0)
  })

  test('a finished turn makes Mochi wave beside a red "!" for a few seconds', async () => {
    expect(count(scene(atHome, 1, { now: 11_000, turn: answered }), RED)).toBeGreaterThanOrEqual(3)
    expect(scene(atHome, 1, { now: 30_000, turn: answered })).toEqual(scene(atHome, 1, { now: 30_000 }))
  })

  test('busy poses win over the turn', async () => {
    expect(scene(EDITING, 1, { turn: working })).toEqual(scene(EDITING, 1))
  })
})

describe('clean desk', () => {
  const PAPER = 0xf5f5f5
  test('Mochi carries the page while walking to the desk, but never floats it over the screen while typing', async () => {
    const walking: MascotActivity = { kind: 'editing', file: 'a.ts', tool: 'Edit', since: 0, fromX: 2 }
    const typing: MascotActivity = { ...walking, since: -60_000 }
    expect(count(scene(walking, 3, { now: 200, width: 64 }), PAPER)).toBeGreaterThan(20)
    for (const tick of [0, 3, 6]) expect(count(scene(typing, tick, { width: 64 }), PAPER)).toBe(0)
  })
})

describe('idle animations', () => {
  const MUG = 0xeceff1
  const BOOK = 0x5a7189
  const atHome: MascotActivity = { kind: 'idle', since: 0 }
  /** The first time `routine` starts in an idle spell at home, in ms. */
  const startOf = (routine: string): number => {
    for (let t = 0; t < SLEEP_MS; t += 50) {
      const moment = idleMoment(HOME_X, t)
      if (moment.routine === routine && moment.progress < 0.02) return t
    }
    throw new Error(`${routine} never plays`)
  }
  const at = (routine: string, progress: number) => startOf(routine) + progress * ROUTINE_MS

  test('the mug is in a paw only while it is raised', async () => {
    expect(count(scene(atHome, 1, { now: at('sip', 0.5) }), MUG)).toBeGreaterThan(0)
    expect(count(scene(atHome, 1, { now: at('sip', 0.95) }), MUG)).toBe(0)
  })

  test('stretching lifts Mochi a pixel at the peak', async () => {
    const before = scene(atHome, 0, { now: at('stretch', 0.05) })
    const peak = scene(atHome, 0, { now: at('stretch', 0.45) })
    const topRow = (pixels: Int32Array) => {
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 20; x += 1) if (pixels[y * MIN_SCENE_WIDTH + x] === FUR) return y
      return -1
    }
    expect(topRow(peak)).toBeLessThan(topRow(before))
  })

  test("reading shows a book in Mochi's paws", async () => {
    expect(count(scene(atHome, 1, { now: at('read', 0.5) }), BOOK)).toBeGreaterThan(5)
    expect(count(scene(atHome, 1, { now: at('look', 0.5) }), BOOK)).toBe(0)
  })

  test('breathing is slow: consecutive ticks of a quiet look rarely move Mochi', async () => {
    const now = at('look', 0.05)
    let moves = 0
    // Only Mochi's corner: the cloud, plant, steam and code animate on their own.
    const mochi = (pixels: Int32Array) => {
      const cells: number[] = []
      for (let y = 12; y < 30; y += 1) for (let x = 0; x < 18; x += 1) cells.push(pixels[y * MIN_SCENE_WIDTH + x] ?? -1)
      return cells.join()
    }
    for (let tick = 0; tick < 32; tick += 1) if (mochi(scene(atHome, tick, { now })) !== mochi(scene(atHome, tick + 1, { now }))) moves += 1
    // One rise and one fall per 16 ticks: 4 changes in 32 ticks (the old bob made 8).
    expect(moves).toBeLessThanOrEqual(5)
  })
})

describe('clear floor scene', () => {
  const LEAF = 0x6f9a6a
  test('a strolling Mochi never stands over the plant: no leaf pixel shares a column with Mochi near the floor', async () => {
    for (let t = 0; t < SLEEP_MS; t += 700) {
      const pixels = scene({ kind: 'idle', since: 0 }, 1, { now: t, width: 64 })
      // The plant's leaves stay up on the shelf, far above the floor band Mochi walks in.
      for (let y = 14; y < 32; y += 1) for (let x = 0; x < 64; x += 1) expect(pixels[y * 64 + x] === LEAF).toBe(false)
    }
  })
})
