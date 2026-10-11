import type { Bug, Gadget, MascotActivity, OutfitName, Reaction, Turn, Worker } from '../types'
import type { IdleRoutine } from './behavior'
import { MASCOT_WIDTH, HOME_X, mascotXAt, idleMoment, isMascotWalking } from './behavior'
import type { Canvas, Palette, Sprite } from './canvas'
import type { Feeling } from './care'
import { createCanvas, encodeCanvas, fillColor, plotColor, stampSprite } from './canvas'
import { MAX_VISIBLE_WORKERS, workerX } from './crew'
import { OUTFITS } from './outfits'
import { isHandingOff, isThinking } from './turn'
import { WORKER_WIDTH, drawWorker, drawWorkerOverlay } from './workerArt'
import { GROUND_Y, SCENE_HEIGHT, drawWorld, scatter } from './world'

/** How long the "done" pose shows before the cat settles back to idle. */
export const DONE_MS = 3000

const PALETTE: Palette = {
  O: 0xb9a7d6, // Mochi's fur
  o: 0x8f7fb0, // fur underside
  q: 0xf2a7b8, // nose
  K: 0x1f1f1f, // eyes
  W: 0xf5f5f5, // paper
  g: 0xbdbdbd, // paper fold
  L: 0x7e8a97, // ink lines
  G: 0x66bb6a, // success check
  R: 0xef5350, // failure cross
  B: 0x4fc3f7, // sweat
  Y: 0xffd54f, // confetti / gold
  P: 0xf06292, // confetti
  C: 0x4dd0e1, // confetti
  V: 0x9575cd, // wizard hat
  h: 0x8d6e63, // hammer handle
  s: 0x90a4ae, // steel
  c: 0xb3e5fc, // lens
  z: 0xe3f2fd, // sleep Z
  m: 0xeceff1, // mug
  r: 0xe57373, // mug stripe / antenna tip
  k: 0x3b1f17, // open mouth
  v: 0x8e24aa, // bug shell
  a: 0xce93d8, // bug antenna
  x: 0x7cb342, // bug legs
  n: 0x5a7189, // book cover
}
const SHADOW = 0x2a1c18
const CONFETTI: readonly string[] = ['Y', 'P', 'C', 'G']

/** Mochi, a pixel cat: ears up top, eyes in the sockets the poses redraw, a pink nose. */
const MASCOT_BODY: Sprite = [
  '...O........O...',
  '...OO......OO...',
  '..OOOOOOOOOOOO..',
  '..OOKKOOOOKKOO..',
  '..OOKKOOOOKKOO..',
  '..OOOOOqqOOOOO..',
  '..OOOOOOOOOOOO..',
  '..OOOOOOOOOOOO..',
  '..oooooooooooo..',
  '...O.O....O.O...',
  '...O.O....O.O...',
]
const MASCOT_HEIGHT = MASCOT_BODY.length
/** Walking swaps the two leg rows between these frames. */
const MASCOT_LEGS: readonly [readonly [string, string], readonly [string, string]] = [
  ['...O.O....O.O...', '...O.O....O.O...'],
  ['..O...O..O...O..', '...O.O....O.O...'],
]

const PAPER: Sprite = [
  'WWWWWg.',
  'WWWWWgg',
  'WLLLLWW',
  'WWWWWWW',
  'WLLLLLW',
  'WWWWWWW',
  'WLLLWWW',
  'WWWWWWW',
]
const PAPER_LINE_ROWS: readonly number[] = [2, 4, 6]
const CHECK: ReadonlyArray<readonly [number, number]> = [[1, 4], [2, 5], [3, 6], [4, 5], [5, 4], [6, 3]]
const CROSS: ReadonlyArray<readonly [number, number]> = [
  [1, 2], [5, 2], [2, 3], [4, 3], [3, 4], [2, 5], [4, 5], [1, 6], [5, 6],
]

type ArmPose = 'out' | 'up'

// Characters stand with their feet on the second floor row, so they read as in front of the wall.
const FEET_Y = GROUND_Y + 1
/** Workers stand in a front row, lower on the floor and drawn over Mochi, so a crowded room reads as depth. */
const WORKER_FEET_Y = SCENE_HEIGHT - 2
const MASCOT_TOP = FEET_Y - (MASCOT_HEIGHT - 1)
const PAPER_OFFSET = 5
const PAPER_TOP = MASCOT_TOP - 9
const BLINK_EVERY = 16

const MUG_HELD: Sprite = ['mmm', 'mrm', 'mmm']
/** Raised, head up over the paw. */
const HAMMER_UP: Sprite = ['ssss', 'ssss', '.h..', '.h..', '.h..', '.h..']
/** Mid-strike, swung down to the right; `Y` are sparks. */
const HAMMER_DOWN: Sprite = ['.....Y', 'hhhss.', '...ssY', '...ss.']
const MAGNIFIER: Sprite = ['.ssss.', 'sccccs', 'scWccs', 'sccccs', '.ssss.', '.....h', '......h']
const Z_GLYPH: Sprite = ['zzzz', '..z.', '.z..', 'zzzz']
const HEART: Sprite = ['.P.P.', 'PPPPP', '.PPP.', '..P..']
/** Swims left, toward Mochi: eye at the front, tail fin at the back. */
const FISH: Sprite = ['.CCC.B', 'CKCCCB', '.CCC.B']
const NOTE: Sprite = ['.YY', '.Y.', 'YY.']
const NOTE_COLORS: readonly string[] = ['Y', 'C', 'P']
/** The bug monster, facing left toward Mochi; the last row is its legs. */
const BUG_BODY: Sprite = ['.a...a.', '..vvv..', 'vvKvKvv', '.vvvvv.']
const BUG_LEGS: readonly [string, string] = ['x.x.x.x', '.x.x.x.']
const BUG_WIDTH = 7
/** A thought cloud; `d` marks the three dots that light up in turn. */
const THOUGHT: Sprite = ['.WWWWWWW.', 'WWdWdWdWW', '.WWWWWWW.']
const THOUGHT_DOTS: readonly number[] = [2, 4, 6]
/** A speech bubble with a red "!", its tail pointing down-left at Mochi. */
const EXCLAIM: Sprite = ['.WWWWW.', 'WWWRWWW', 'WWWRWWW', 'WWWWWWW', 'WWWRWWW', '.WWWWW.', '.W.....']
const BURST_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]

/** How Mochi's face and paws look this frame. */
type Pose = {
  arms: readonly [ArmPose, ArmPose]
  eyes: 'open' | 'closed' | 'left' | 'right' | 'sad' | 'half'
  isMouthOpen: boolean
  isStepping: boolean
}

/** Paws are 2×2 (out, at the sides) or 2×4 (raised); `side` -1 is left, 1 is right. */
const drawArm = (canvas: Canvas, mascotLeft: number, mascotTop: number, side: -1 | 1, pose: ArmPose): void => {
  const x = side === -1 ? mascotLeft : mascotLeft + MASCOT_WIDTH - 2
  const fur = PALETTE.O ?? 0xb9a7d6
  if (pose === 'out') fillColor(canvas, x, mascotTop + 5, 2, 2, fur)
  else fillColor(canvas, x, mascotTop + 1, 2, 4, fur)
}

const drawEyes = (canvas: Canvas, left: number, top: number, eyes: Pose['eyes']): void => {
  if (eyes === 'open') return
  const fur = PALETTE.O ?? 0xb9a7d6
  const ink = PALETTE.K ?? 0x1f1f1f
  // Repaint both eye sockets with fur, then draw the eyes again for this look.
  fillColor(canvas, left + 4, top + 3, 2, 2, fur)
  fillColor(canvas, left + 10, top + 3, 2, 2, fur)
  if (eyes === 'closed' || eyes === 'half') {
    fillColor(canvas, left + 4, top + 4, 2, 1, ink)
    fillColor(canvas, left + 10, top + 4, 2, 1, ink)
    return
  }
  if (eyes === 'sad') {
    // Downcast: eyes sink a pixel.
    fillColor(canvas, left + 4, top + 4, 2, 2, ink)
    fillColor(canvas, left + 10, top + 4, 2, 2, ink)
    return
  }
  const shift = eyes === 'left' ? -1 : 1
  fillColor(canvas, left + 4 + shift, top + 3, 2, 2, ink)
  fillColor(canvas, left + 10 + shift, top + 3, 2, 2, ink)
}

const drawMascot = (canvas: Canvas, left: number, top: number, pose: Pose, outfit: OutfitName, tick: number): void => {
  fillColor(canvas, left + 2, FEET_Y + 1, MASCOT_WIDTH - 4, 1, SHADOW)
  const legs = MASCOT_LEGS[pose.isStepping && tick % 2 === 1 ? 1 : 0]
  stampSprite(canvas, [...MASCOT_BODY.slice(0, -2), ...legs], left, top, PALETTE)
  drawEyes(canvas, left, top, pose.eyes)
  if (pose.isMouthOpen) fillColor(canvas, left + 7, top + 6, 2, 1, PALETTE.k ?? 0x3b1f17)
  drawArm(canvas, left, top, -1, pose.arms[0])
  drawArm(canvas, left, top, 1, pose.arms[1])
  OUTFITS[outfit].forEach(overlay => stampSprite(canvas, overlay.rows, left, top + overlay.top, PALETTE))
}

/** The prop in Mochi's raised right paw while a tool runs. */
const drawGadget = (canvas: Canvas, gadget: Gadget, left: number, top: number, tick: number): void => {
  const pawX = left + MASCOT_WIDTH - 2
  switch (gadget) {
    case 'hammer': {
      if (isHammerStriking(tick)) stampSprite(canvas, HAMMER_DOWN, pawX + 1, top + 4, PALETTE)
      else stampSprite(canvas, HAMMER_UP, pawX - 1, top - 5, PALETTE)
      return
    }
    case 'magnifier': {
      // The glass sweeps up and down, scanning.
      const sweep = [0, 1, 2, 1][tick % 4] ?? 0
      stampSprite(canvas, MAGNIFIER, pawX - 2, top - 6 + sweep, PALETTE)
      return
    }
    case 'antenna': {
      const mast = left + 7
      fillColor(canvas, mast, top - 2, 1, 3, PALETTE.s ?? 0x90a4ae)
      if (tick % 2 === 0) plotColor(canvas, mast, top - 3, PALETTE.r ?? 0xe57373)
      // Signal arcs pulse outwards.
      const ring = tick % 3
      plotColor(canvas, mast - 2 - ring, top - 4 - ring, PALETTE.C ?? 0x4dd0e1)
      plotColor(canvas, mast + 2 + ring, top - 4 - ring, PALETTE.C ?? 0x4dd0e1)
      return
    }
  }
}

const isHammerStriking = (tick: number): boolean => tick % 4 >= 2

const drawSleep = (canvas: Canvas, left: number, top: number, tick: number): void => {
  for (let i = 0; i < 2; i += 1) {
    const rise = (Math.floor(tick / 3) + i * 7) % 14
    stampSprite(canvas, Z_GLYPH, left + 13 + Math.floor(rise / 4), top - 3 - rise, PALETTE)
  }
}

/** Draws the reaction the person triggered, `elapsed` ms into it, around Mochi at `left`/`top`. */
const drawReaction = (canvas: Canvas, reaction: Reaction, elapsed: number, left: number, top: number, tick: number): void => {
  switch (reaction.kind) {
    case 'pet':
      // Three hearts float up from Mochi's head, one after another.
      // Three hearts float straight up from Mochi's head, one after another.
      for (let i = 0; i < 3; i += 1) {
        const rise = Math.floor((elapsed - i * 400) / 220)
        if (rise < 0 || rise > 8) continue
        stampSprite(canvas, HEART, left + 1 + i * 5, top - 3 - rise, PALETTE)
      }
      return
    case 'feed': {
      const flight = Math.min(1, elapsed / 1100)
      if (flight < 1) {
        // The fish arcs in from the right and lands in Mochi's mouth.
        const startX = left + MASCOT_WIDTH + 12
        const endX = left + 6
        const x = Math.round(startX + (endX - startX) * flight)
        const y = Math.round(top + 5 - 14 * flight * (1 - flight) * 2 + (1 - flight) * -4)
        stampSprite(canvas, FISH, x, y, PALETTE)
        return
      }
      // Chomp: crumbs scatter.
      if (tick % 4 < 2) {
        plotColor(canvas, left + 5, top + 8, PALETTE.Y ?? 0xffd54f)
        plotColor(canvas, left + 11, top + 7, PALETTE.Y ?? 0xffd54f)
      }
      return
    }
    case 'dance':
      // Two notes drift up at a walking pace, beside Mochi rather than all over the window.
      for (let i = 0; i < 2; i += 1) {
        const rise = (Math.floor(elapsed / 220) + i * 5) % 10
        const color = NOTE_COLORS[i % NOTE_COLORS.length] ?? 'Y'
        stampSprite(canvas, NOTE.map(row => row.replaceAll('Y', color)), left + (i === 0 ? -1 : MASCOT_WIDTH - 2), top - 2 - rise, PALETTE)
      }
      return
  }
}

/** Mochi's pose while a reaction plays, overriding the idle routine. */
const reactionPose = (reaction: Reaction, elapsed: number, tick: number): Pose => {
  switch (reaction.kind) {
    case 'pet':
      return { arms: ['out', 'out'], eyes: 'closed', isMouthOpen: false, isStepping: false }
    case 'feed':
      // Chomping on a beat too (every 4 ticks), so the mouth reads as chewing rather than flicker.
      return { arms: ['up', 'up'], eyes: elapsed < 1100 ? 'open' : 'closed', isMouthOpen: elapsed >= 900 && tick % 4 < 2, isStepping: false }
    case 'dance':
      // Paws swap with the hop; feet stay planted so the beat is the only motion.
      return { arms: tick % 4 < 2 ? ['up', 'out'] : ['out', 'up'], eyes: 'closed', isMouthOpen: true, isStepping: false }
  }
}

/** The bug's left edge: scuttling just right of Mochi, kept inside the scene. */
const bugXFor = (mascotX: number, width: number, tick: number): number =>
  Math.min(width - BUG_WIDTH, mascotX + MASCOT_WIDTH + 3 + ([0, 1, 0, -1][tick % 4] ?? 0))

/** The bug monster, or its squash burst once a command succeeded. */
const drawBug = (canvas: Canvas, bug: Bug, mascotX: number, now: number, tick: number): void => {
  const left = bugXFor(mascotX, canvas.width, tick)
  const top = FEET_Y - BUG_BODY.length
  if (bug.squashedAt === undefined) {
    stampSprite(canvas, [...BUG_BODY, BUG_LEGS[tick % 2] ?? BUG_LEGS[0]], left, top, PALETTE)
    return
  }
  // Starburst from where the bug stood, flying outward and fading through the colors.
  // Two rings of sparks: a fast outer one and a trailing inner one.
  const radius = 1 + Math.floor((now - bug.squashedAt) / 150)
  for (const ring of [radius, radius - 2]) {
    if (ring < 1) continue
    const color = PALETTE[(['Y', 'W', 'P', 'C'] as const)[ring % 4] ?? 'Y'] ?? 0xffd54f
    BURST_DIRECTIONS.forEach(([dx, dy]) => {
      plotColor(canvas, left + 3 + dx * ring, top + 2 + dy * ring, color)
      plotColor(canvas, left + 3 + dx * ring + (dy === 0 ? 0 : 1), top + 2 + dy * ring, color)
    })
  }
}

/** Squaring up to a live bug: paws snapping in turn, eyes locked on it. */
const battlePose = (tick: number): Pose => ({
  arms: tick % 2 === 0 ? ['up', 'out'] : ['out', 'up'],
  eyes: 'right',
  isMouthOpen: tick % 4 === 0,
  isStepping: false,
})

/** Extras for low moods: a tear rolls down when sad, a lone Z drifts up when tired. */
const drawFeeling = (canvas: Canvas, feeling: Feeling, left: number, top: number, tick: number): void => {
  if (feeling === 'sad') {
    const fall = tick % 8
    if (fall < 5) plotColor(canvas, left + 4, top + 6 + fall, PALETTE.B ?? 0x4fc3f7)
  }
  if (feeling === 'tired' && tick % 24 < 10) {
    stampSprite(canvas, Z_GLYPH, left + 13 + Math.floor((tick % 24) / 5), top - 2 - Math.floor((tick % 24) / 2), PALETTE)
  }
}

/** The resting eyes for how Mochi feels. */
const feelingEyes = (feeling: Feeling, tick: number): Pose['eyes'] => {
  if (feeling === 'tired') return 'half'
  if (feeling === 'sad') return 'sad'
  return tick % BLINK_EVERY === 0 ? 'closed' : 'open'
}

/** Claude is mid-turn: Mochi ponders, eyes drifting side to side, a thought cloud filling with dots. */
const thinkingPose = (tick: number): Pose => ({
  arms: ['out', 'up'],
  eyes: Math.floor(tick / 10) % 2 === 0 ? 'left' : 'right',
  isMouthOpen: false,
  isStepping: false,
})

const drawThought = (canvas: Canvas, mascotLeft: number, mascotTop: number, tick: number): void => {
  const left = mascotLeft + MASCOT_WIDTH - 3
  const top = mascotTop - 7
  const lit = Math.floor(tick / 3) % (THOUGHT_DOTS.length + 1)
  const ink = PALETTE.L ?? 0x7e8a97
  stampSprite(canvas, THOUGHT.map(row => row.replaceAll('d', 'W')), left, top, PALETTE)
  THOUGHT_DOTS.slice(0, lit).forEach(dx => plotColor(canvas, left + dx, top + 1, ink))
  // Trailing puffs from Mochi's head up to the cloud.
  plotColor(canvas, left - 1, top + 4, PALETTE.W ?? 0xf5f5f5)
  plotColor(canvas, left - 2, top + 6, PALETTE.W ?? 0xf5f5f5)
}

/** The turn just came back to you: Mochi hops and waves both paws under a "!". */
const handoffPose = (tick: number): Pose => ({
  arms: tick % 4 < 2 ? ['up', 'out'] : ['out', 'up'],
  eyes: 'open',
  isMouthOpen: true,
  isStepping: false,
})

/** True while `progress` (0–1 through a routine) is inside [from, to). */
const during = (progress: number, from: number, to: number): boolean => progress >= from && progress < to

/**
 * Mochi's pose for an idle routine at `progress` through it: each routine is a short
 * scene with a start, a peak and a settle, so motion reads as intent rather than jitter.
 */
const idlePose = (routine: IdleRoutine, progress: number, tick: number, isWalking: boolean, feeling: Feeling): Pose => {
  const base: Pose = { arms: ['out', 'out'], eyes: feelingEyes(feeling, tick), isMouthOpen: false, isStepping: isWalking }
  // A sad or tired face wins over the playful beats.
  const isDown = feeling === 'sad' || feeling === 'tired'
  switch (routine) {
    case 'look':
      // Glance left, hold; blink; glance right, hold; back to the front.
      if (isDown) return base
      if (during(progress, 0.15, 0.45)) return { ...base, eyes: 'left' }
      if (during(progress, 0.48, 0.52)) return { ...base, eyes: 'closed' }
      if (during(progress, 0.55, 0.85)) return { ...base, eyes: 'right' }
      return { ...base, eyes: 'open' }
    case 'sip':
      // Lift the mug, drink with eyes closed, lower it.
      if (during(progress, 0.25, 0.7)) return { ...base, arms: ['out', 'up'], eyes: 'closed' }
      return { ...base, arms: ['out', during(progress, 0.1, 0.85) ? 'up' : 'out'] }
    case 'wave':
      // Three waves, then the paw comes down.
      return { ...base, arms: [during(progress, 0.1, 0.7) && tick % 4 < 2 ? 'up' : 'out', 'out'], eyes: 'open' }
    case 'yawn':
      // A slow yawn: mouth opens wide with eyes shut and paws up, then a settle.
      if (during(progress, 0.2, 0.65)) return { ...base, arms: ['up', 'up'], eyes: 'closed', isMouthOpen: true }
      return base
    case 'stretch':
      // Both paws up and eyes shut at the peak (the body rises a pixel, see stretchLift).
      if (during(progress, 0.15, 0.75)) return { ...base, arms: ['up', 'up'], eyes: during(progress, 0.3, 0.6) ? 'closed' : base.eyes }
      return base
    case 'read':
      // Eyes down on the book held in both paws.
      return { ...base, arms: ['out', 'out'], eyes: isDown ? base.eyes : 'sad' }
    case 'sleep':
      return { ...base, eyes: 'closed' }
    case 'returning':
    case 'wander':
      return base
  }
}

/** How far Mochi rises while stretching: a pixel at the peak. */
const stretchLift = (routine: IdleRoutine, progress: number): number =>
  routine === 'stretch' && during(progress, 0.25, 0.65) ? -1 : 0

/** A small open book held in front of Mochi while reading; its page turns now and then. */
const drawBook = (canvas: Canvas, mascotLeft: number, mascotTop: number, progress: number): void => {
  const left = mascotLeft + 5
  const top = mascotTop + 6
  const turned = Math.floor(progress * 4) % 2 === 1
  stampSprite(canvas, ['nnnnnn', 'nWWWWn', 'nWWWWn'], left, top, PALETTE)
  plotColor(canvas, left + (turned ? 2 : 3), top + 1, PALETTE.L ?? 0x7e8a97)
}

const drawPaper = (canvas: Canvas, left: number, top: number, linesShown: number): void => {
  const hiddenRows = new Set(PAPER_LINE_ROWS.slice(linesShown))
  stampSprite(canvas, PAPER.map((row, y) => (hiddenRows.has(y) ? row.replaceAll('L', 'W') : row)), left, top, PALETTE)
}

const mark = (canvas: Canvas, pixels: ReadonlyArray<readonly [number, number]>, left: number, top: number, key: string): void =>
  pixels.forEach(([x, y]) => plotColor(canvas, left + x, top + y, PALETTE[key] ?? 0xffffff))

const drawConfetti = (canvas: Canvas, tick: number): void => {
  for (let i = 0; i < 12; i += 1) {
    const x = scatter(i + 1) % canvas.width
    const y = (scatter(i + 17) + tick) % 15
    plotColor(canvas, x, y, PALETTE[CONFETTI[i % CONFETTI.length] ?? 'Y'] ?? 0xffd54f)
  }
}

/**
 * The worker slots, from the right edge inwards, with room for each worker's prop. A
 * narrow scene drops the slots that would stand a worker over Mochi's home spot.
 */
export const workerSlots = (width: number): readonly number[] =>
  Array.from({ length: MAX_VISIBLE_WORKERS }, (_, i) => width - (WORKER_WIDTH + 3) * (i + 1)).filter(
    slot => slot >= HOME_X + MASCOT_WIDTH - 4,
  )

/** Everything one frame depends on. */
export type SceneInput = {
  activity: MascotActivity
  /** Animation tick: drives bobbing, blinking, paws, legs, sky and confetti. */
  tick: number
  workers: readonly Worker[]
  /** Clock time in ms: drives worker walks. */
  now: number
  outfit: OutfitName
  /** Scene width in pixels (= terminal columns); see sceneWidthFor. */
  width: number
  /** Local hour 0–23, for the window's sky. */
  hour: number
  /** How Mochi feels; sets the resting face. */
  feeling: Feeling
  /** The reaction playing now (already filtered by activeReaction), if any. */
  reaction: Reaction | null
  /** The bug on screen (already filtered by visibleBug), if any. */
  bug: Bug | null
  /** The main loop's turn, if one has started this session. */
  turn: Turn | null
}

/**
 * Composes one frame: the room, Mochi in its outfit for the activity, and up
 * as many worker kittens as the width has slots for (up to MAX_VISIBLE_WORKERS), in a
 * front row: their head overlays behind Mochi, their bodies in front.
 */
export const sceneFor = ({ activity, tick, workers, now, outfit, width, hour, feeling, reaction, bug, turn }: SceneInput): Canvas => {
  const canvas = createCanvas(width, SCENE_HEIGHT)
  const x = mascotXAt(activity, now, width)
  const isWalking = isMascotWalking(activity, now, width)
  const isTyping = activity.kind === 'editing' && !isWalking
  drawWorld(canvas, tick, hour, isTyping)
  const slots = workerSlots(width)
  const placed = workers.slice(0, slots.length).map((worker, slot) => ({ worker, left: workerX(worker, slots[slot] ?? width, now, width) }))
  placed.forEach(({ worker, left }) => drawWorkerOverlay(canvas, worker, left, WORKER_FEET_Y, tick, now))
  const paperLeft = x + PAPER_OFFSET

  switch (activity.kind) {
    case 'idle': {
      if (reaction !== null) {
        const elapsed = now - reaction.at
        // The dance hops on a beat (up for 2 ticks of every 4), not on every frame.
        const hop = reaction.kind === 'dance' && tick % 4 < 2 ? -1 : 0
        drawMascot(canvas, x, MASCOT_TOP + hop, reactionPose(reaction, elapsed, tick), outfit, tick)
        drawReaction(canvas, reaction, elapsed, x, MASCOT_TOP + hop, tick)
        break
      }
      if (bug !== null && bug.squashedAt === undefined) {
        drawMascot(canvas, x, MASCOT_TOP, battlePose(tick), outfit, tick)
        break
      }
      if (isHandingOff(turn, now)) {
        const hop = tick % 4 < 2 ? -2 : 0
        drawMascot(canvas, x, MASCOT_TOP + hop, handoffPose(tick), outfit, tick)
        stampSprite(canvas, EXCLAIM, x + MASCOT_WIDTH - 3, MASCOT_TOP + hop - 8, PALETTE)
        break
      }
      const { routine, progress } = idleMoment(activity.fromX ?? HOME_X, now - activity.since)
      // While Claude works, Mochi thinks along instead of yawning or dozing off.
      if (isThinking(turn) && !isWalking && routine !== 'wander') {
        drawMascot(canvas, x, MASCOT_TOP, thinkingPose(tick), outfit, tick)
        drawThought(canvas, x, MASCOT_TOP, tick)
        break
      }
      // Slow breathing: a pixel up and down over ~3 s awake, ~4 s asleep. Faster bobbing
      // read as jitter, especially with terminal line spacing. A happy Mochi hops now and then.
      const isHappyHop = feeling === 'happy' && !isWalking && routine !== 'read' && tick % 48 < 2
      const breath = routine === 'sleep' ? (tick % 24 < 12 ? 0 : 1) : !isWalking && tick % 16 >= 8 ? 1 : 0
      const bob = isHappyHop ? -2 : breath + stretchLift(routine, progress)
      drawMascot(canvas, x, MASCOT_TOP + bob, idlePose(routine, progress, tick, isWalking, feeling), outfit, tick)
      drawFeeling(canvas, feeling, x, MASCOT_TOP + bob, tick)
      // The mug is held only while it is raised.
      if (routine === 'sip' && during(progress, 0.1, 0.85)) stampSprite(canvas, MUG_HELD, x + MASCOT_WIDTH - 2, MASCOT_TOP + bob - 2, PALETTE)
      if (routine === 'read' && !isWalking) drawBook(canvas, x, MASCOT_TOP + bob, progress)
      if (routine === 'sleep') drawSleep(canvas, x, MASCOT_TOP, tick)
      break
    }
    case 'editing': {
      const arms: readonly [ArmPose, ArmPose] = isWalking ? ['up', 'up'] : tick % 2 === 0 ? ['up', 'out'] : ['out', 'up']
      drawMascot(canvas, x, MASCOT_TOP, { arms, eyes: 'open', isMouthOpen: false, isStepping: isWalking }, outfit, tick)
      // Mochi carries the page to the desk; once typing, the monitor's racing code shows the
      // edit, and a page floating over the screen would only hide it.
      if (isWalking) drawPaper(canvas, paperLeft, PAPER_TOP, 0)
      // A pet mid-edit still gets hearts, without breaking Mochi's stride.
      if (reaction?.kind === 'pet') drawReaction(canvas, reaction, now - reaction.at, x, MASCOT_TOP, tick)
      break
    }
    case 'using': {
      // The hammer swings: paw up to wind up, out to strike.
      const rightArm: ArmPose = activity.gadget === 'hammer' && isHammerStriking(tick) ? 'out' : 'up'
      drawMascot(canvas, x, MASCOT_TOP, { arms: ['out', rightArm], eyes: 'open', isMouthOpen: false, isStepping: false }, outfit, tick)
      drawGadget(canvas, activity.gadget, x, MASCOT_TOP, tick)
      break
    }
    case 'done': {
      if (activity.hasFailed) {
        drawMascot(canvas, x, MASCOT_TOP, { arms: ['out', 'out'], eyes: 'open', isMouthOpen: true, isStepping: false }, outfit, tick)
        drawPaper(canvas, paperLeft, PAPER_TOP, PAPER_LINE_ROWS.length)
        mark(canvas, CROSS, paperLeft, PAPER_TOP, 'R')
        plotColor(canvas, x + MASCOT_WIDTH + 1, MASCOT_TOP + 1 + (tick % 6), PALETTE.B ?? 0x4fc3f7)
      } else {
        const jump = tick % 4 < 2 ? -2 : 0
        drawMascot(canvas, x, MASCOT_TOP + jump, { arms: ['up', 'up'], eyes: 'open', isMouthOpen: false, isStepping: false }, outfit, tick)
        drawPaper(canvas, paperLeft, PAPER_TOP + jump, PAPER_LINE_ROWS.length)
        mark(canvas, CHECK, paperLeft, PAPER_TOP + jump, 'G')
        drawConfetti(canvas, tick)
      }
      break
    }
  }

  if (bug !== null) drawBug(canvas, bug, x, now, tick)

  placed.forEach(({ worker, left }) => drawWorker(canvas, worker, left, WORKER_FEET_Y, tick, now))

  return canvas
}

/** Terminal rows the scene takes. */
export const SCENE_ROWS = SCENE_HEIGHT / 2

/** The Raster cells for one frame. */
export const cellsFor = (input: SceneInput): string => encodeCanvas(sceneFor(input))
