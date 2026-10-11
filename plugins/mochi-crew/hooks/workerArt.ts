import type { Worker } from '../types'
import type { Canvas, Palette, Sprite } from './canvas'
import { fillColor, plotColor, stampSprite } from './canvas'
import { hatOf, isWalking, isWorkerBusy, isWorkerThinking } from './crew'
import type { Role } from './roles'
import { roleFor } from './roles'

/** Worker kittens are 9 px wide; their costume adds up to 3 rows on top. */
export const WORKER_WIDTH = 9

const ART: Palette = {
  O: 0xa9b3bf, o: 0x7f8996, q: 0xf2a7b8, K: 0x1f1f1f, W: 0xf5f5f5, Y: 0xffd54f,
  N: 0x283593, D: 0x455a64, T: 0x8d6e63, t: 0x5d4037, U: 0x42a5f5, u: 0xbbdefb,
  c: 0xb3e5fc, g: 0x76ff03, b: 0x607d8b, R: 0xc62828, r: 0xef9a9a, s: 0x90a4ae,
  h: 0x8d6e63, l: 0x78909c, e: 0x4dd0e1, L: 0x7e8a97,
}
const SHADOW = 0x2a1c18
/** Builder hard hats keep the worker's own color, matching its HUD line. */
const HAT_COLORS: Readonly<Record<string, number>> = { Y: 0xffd54f, C: 0x4dd0e1, P: 0xf06292, G: 0x66bb6a }

/** A gray kitten; its role hat sits where the ears would be. */
const BODY: Sprite = [
  '.OOOOOOO.',
  'OOOOOOOOO',
  'OOKOOOKOO',
  'OOOOqOOOO',
  '.ooooooo.',
]
const EYE_ROW = 2
const LEGS: readonly [string, string] = ['.O.O.O.O.', 'O.O...O.O']
const MINI_PAPER: Sprite = ['WWW.', 'WLWW', 'WWWW', 'WLLW']
const MINI_THOUGHT: Sprite = ['.WWWWW.', 'WWWWWWW', '.WWWWW.']
const THOUGHT_INK = 0x5c6773

/** Costume layers, positioned relative to the body's top-left (negative rows sit above it). */
type Layer = { dx: number; dy: number; sprite: Sprite }

/** Three-row hats give each role a silhouette you can read at a glance. */
const HATS: Readonly<Record<Role, Sprite>> = {
  police: ['..NNNNN..', '.NNNYNNN.', 'KKKKKKKKK'],
  swat: ['..DDDDD..', '.DDDDDDD.', 'DDDDDDDDD'],
  lab: ['.W.W.W.W.', 'WWWWWWWWW', '.........'],
  detective: ['...TtT...', '.TtTtTtT.', 'TTTTTTTTT'],
  architect: ['...YYY...', '.YYYYYYY.', 'YYYYYYYYY'],
  librarian: ['...ttt...', '..ttttt..', '.ttttttt.'],
  nerd: ['..K.K.K..', '.KKKKKKK.', '.........'],
  builder: ['...HHH...', '.HHHHHHH.', 'HHHHHHHHH'],
}

/** Overlays from the eye row down: glasses, visors, coats, ties. */
const OUTFIT_ROWS: Partial<Record<Role, Sprite>> = {
  swat: ['DcccccccD'],
  lab: ['OccKKKccO', 'OWWWWWWWO', '.WWWWWWW.'],
  detective: ['', 'OTTTOTTTO', '.TTTTTTT.'],
  librarian: ['OOKKOKKOO'],
  nerd: ['OKcKOKcKO', '....R....'],
}

/** The prop and its idle animation, held in front so it stays inside the worker's own space. */
const propLayers = (role: Role, tick: number): readonly Layer[] => {
  switch (role) {
    case 'police':
      return [{ dx: 2, dy: 3, sprite: ['Y'] }, { dx: 6, dy: 2, sprite: ['tt', 'WW', 'WL', 'WW'] }]
    case 'swat': {
      const lift = tick % 6 < 3 ? 0 : -1
      return [{ dx: -1, dy: 2 + lift, sprite: ['bbb', 'bWb', 'bbb', '.b.'] }]
    }
    case 'lab': {
      const bubble = tick % 4
      return [
        { dx: 8, dy: 0, sprite: ['c', 'c', 'g', 'g'] },
        { dx: 8, dy: -1 - bubble, sprite: [bubble % 2 === 0 ? 'g' : 'c'] },
      ]
    }
    case 'detective': {
      const sweep = [0, 1, 2, 1][tick % 4] ?? 0
      return [{ dx: 4 + sweep, dy: 1, sprite: ['.s.', 'scs', '.s.', '..h'] }]
    }
    case 'architect': {
      // The blueprint unrolls and rolls back up.
      const open = [1, 2, 3, 4, 5, 4, 3, 2][tick % 8] ?? 1
      return [{ dx: 1, dy: 3, sprite: ['u'.repeat(open) + 'U', 'U'.repeat(open + 1)] }]
    }
    case 'librarian': {
      const page = tick % 4 < 2 ? 'RWWR' : 'RWrR'
      return [{ dx: 2, dy: 3, sprite: ['RRRR', page] }]
    }
    case 'nerd': {
      // Laptop in front; the keys flicker as it types.
      const keys = tick % 2 === 0 ? 'lelel' : 'lleel'
      return [{ dx: 2, dy: 3, sprite: ['eeeee', keys] }]
    }
    case 'builder': {
      const isUp = tick % 4 < 2
      return [{ dx: 7, dy: isUp ? -1 : 1, sprite: isUp ? ['ss', 'h.', 'h.'] : ['hss', '..s'] }]
    }
  }
}

/** Police walk a small beat around their spot; everyone else stands still between walks. */
const PATROL: readonly number[] = [0, 1, 2, 2, 1, 0, -1, -2, -2, -1]

export const roleOffsetX = (role: Role, tick: number): number =>
  role === 'police' ? PATROL[Math.floor(tick / 2) % PATROL.length] ?? 0 : 0

/** Where a worker stands this frame and what it wears, shared by both drawing passes. */
const workerFrame = (worker: Worker, left: number, feetY: number, tick: number, now: number) => {
  const role = roleFor(worker.type)
  const isMoving = isWalking(worker, now)
  return {
    role,
    isMoving,
    x: left + (isMoving ? 0 : roleOffsetX(role, tick)),
    bodyTop: feetY - BODY.length,
    palette: { ...ART, H: HAT_COLORS[hatOf(worker.id).key] ?? 0xffd54f } as Palette,
  }
}

/** Draws a worker cat in its role costume, feet on `feetY`, at `left`. */
export const drawWorker = (canvas: Canvas, worker: Worker, left: number, feetY: number, tick: number, now: number): void => {
  const { role, isMoving, x, bodyTop, palette } = workerFrame(worker, left, feetY, tick, now)
  const isStepping = isMoving || (role === 'police' && Math.floor(tick / 2) % 5 !== 2)
  fillColor(canvas, x + 1, feetY + 1, WORKER_WIDTH - 2, 1, SHADOW)
  stampSprite(canvas, [...BODY, LEGS[isStepping && tick % 2 === 1 ? 1 : 0]], x, bodyTop, palette)
  stampSprite(canvas, OUTFIT_ROWS[role] ?? [], x, bodyTop + EYE_ROW, palette)
  stampSprite(canvas, HATS[role], x, bodyTop - HATS[role].length, palette)
  if (!isMoving) propLayers(role, tick).forEach(layer => stampSprite(canvas, layer.sprite, x + layer.dx, bodyTop + layer.dy, palette))
}

/**
 * What floats over a worker's head: its page while an edit runs, a thought cloud between
 * calls. Drawn before Mochi, so Mochi stays readable behind a front-row worker.
 */
export const drawWorkerOverlay = (canvas: Canvas, worker: Worker, left: number, feetY: number, tick: number, now: number): void => {
  const { role, isMoving, x, bodyTop, palette } = workerFrame(worker, left, feetY, tick, now)
  const aboveHat = bodyTop - HATS[role].length
  // The page only while an edit runs; between calls three dots light up in turn: thinking.
  if (worker.leftAt === undefined && isWorkerBusy(worker) && worker.lastKind === 'edit') {
    const bob = tick % 4 < 2 ? 0 : 1
    stampSprite(canvas, MINI_PAPER, x + 2, aboveHat - 5 + bob, palette)
  }
  if (isWorkerThinking(worker) && !isMoving) {
    // A mini thought cloud like Mochi's, so the dots read over any furniture behind.
    const top = aboveHat - 4
    stampSprite(canvas, MINI_THOUGHT, x + 1, top, palette)
    const lit = Math.floor(tick / 3) % 4
    for (let dot = 0; dot < lit; dot += 1) plotColor(canvas, x + 2 + dot * 2, top + 1, THOUGHT_INK)
  }
}
