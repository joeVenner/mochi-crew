import type { Canvas, Palette, Sprite } from './canvas'
import { createCanvas, fillColor, mix, plotColor, stampSprite } from './canvas'

/** Scene height in pixels; the first floor row is GROUND_Y. */
export const SCENE_HEIGHT = 32
export const GROUND_Y = 26
export const MIN_SCENE_WIDTH = 40
export const MAX_SCENE_WIDTH = 64

/** The scene width for a pane body, so the room fills the pane without overflowing it. */
export const sceneWidthFor = (bodyColumns: number | undefined): number =>
  Math.max(MIN_SCENE_WIDTH, Math.min(MAX_SCENE_WIDTH, Math.floor(bodyColumns ?? MIN_SCENE_WIDTH)))

/** Where the furniture stands for a scene width; characters use it to walk to the desk. */
export type WorldLayout = {
  windowLeft: number
  /** On top of the bookshelf; absent with no shelf (a narrow room keeps fewer props). */
  plantLeft: number | undefined
  /** Absent when the scene is too narrow for a bookshelf. */
  shelfLeft: number | undefined
  deskLeft: number
}

const DESK_WIDTH = 14
const SHELF_MIN_WIDTH = 52

export const layoutFor = (width: number): WorldLayout => ({
  windowLeft: 3,
  // On top of the bookshelf: clear of the window's sky and of the floor Mochi strolls on.
  plantLeft: width >= SHELF_MIN_WIDTH ? 26 + 2 : undefined,
  shelfLeft: width >= SHELF_MIN_WIDTH ? 26 : undefined,
  deskLeft: width - DESK_WIDTH - 3,
})

/** The window's sky for a local hour 0–23. */
export type Sky = {
  top: number
  bottom: number
  body: 'sun' | 'moon' | 'none'
  hasStars: boolean
}

export const skyFor = (hour: number): Sky => {
  if (hour >= 6 && hour < 8) return { top: 0xf48fb1, bottom: 0xffcc80, body: 'sun', hasStars: false }
  if (hour >= 8 && hour < 18) return { top: 0x5fb6ef, bottom: 0xa8dcf7, body: 'sun', hasStars: false }
  if (hour >= 18 && hour < 21) return { top: 0x5e35b1, bottom: 0xff8a65, body: 'none', hasStars: false }
  return { top: 0x0b1a33, bottom: 0x1b2d4f, body: 'moon', hasStars: true }
}

// A calm room: flat surfaces, one muted wood, low-contrast details, so Mochi (the only
// saturated color) reads first. Flat fills also hide terminal line spacing best: an
// alternating or speckled texture turns every row gap into a visible stripe.
// No wall or floor fill: they are the pane's own background (transparent cells). Terminals
// with line spacing show the background between rows, so any large fill turns into
// stripes; with nothing painted there, only the furniture and characters meet the gaps.
const FLOOR_LINE = 0x3b3f48
// What the mug's steam fades toward: a dark neutral close to a terminal background.
const STEAM_FADE = 0x262626
const WOOD = 0x6e5a51
const WOOD_DARK = 0x4a3c36
/** The monitor is a thin bezel around a see-through screen: code shows on the pane's own dark. */
const BEZEL = 0x3b4048
const STAND = 0x2f333a
const CODE_COLORS: readonly number[] = [0x5f8f8a, 0x8f7f63, 0x7a6f8f, 0x5f7a8f]

const FURNITURE: Palette = {
  w: WOOD, d: WOOD_DARK, k: 0x263238, s: 0x37474f, g: 0x6f9a6a, G: 0x557d52, p: 0x7d6b62, P: 0x6a5850,
  m: 0xc9ced3, r: 0xa86a64, b: 0x7f8b94,
}

/** A small potted plant that sits on top of the bookshelf. */
const PLANT_POT: Sprite = [
  'PPPPP',
  '.ppp.',
  '.ppp.',
]
const PLANT_LEAVES: Sprite = [
  'g.g.g',
  '.GgG.',
  '..G..',
]
const MUG: Sprite = [
  'mmm.',
  'mrmb',
  'mmmb',
  'mmm.',
]

/** Cheap deterministic scatter so "random" details are stable and testable. */
export const scatter = (seed: number): number => ((seed * 2654435761) >>> 0) % 1000

/** The floor is one thin line where the wall would meet it; the rest is the pane itself. */
const drawFloor = (canvas: Canvas): void => {
  fillColor(canvas, 0, GROUND_Y, canvas.width, 1, FLOOR_LINE)
}

/** Star spots inside the window, clear of the mullion and the moon. */
const STARS: ReadonlyArray<readonly [number, number]> = [[1, 1], [3, 3], [4, 0], [1, 6], [8, 6], [3, 7], [7, 5]]
const MOON: Sprite = ['.MM', 'M..', 'M..', '.MM']

const WINDOW_WIDTH = 12
const WINDOW_HEIGHT = 10
const WINDOW_TOP = 3

const drawWindow = (canvas: Canvas, left: number, hour: number, tick: number): void => {
  const sky = skyFor(hour)
  const inner = { left: left + 1, top: WINDOW_TOP + 1, width: WINDOW_WIDTH - 2, height: WINDOW_HEIGHT - 2 }
  for (let y = 0; y < inner.height; y += 1) {
    fillColor(canvas, inner.left, inner.top + y, inner.width, 1, mix(sky.top, sky.bottom, y / (inner.height - 1)))
  }
  if (sky.hasStars) {
    STARS.forEach(([x, y], i) => {
      // Each star twinkles on its own beat.
      if ((tick + i * 3) % 11 === 0) return
      plotColor(canvas, inner.left + x, inner.top + y, i % 2 === 0 ? 0xfff9c4 : 0xb3c7e6)
    })
  }
  if (sky.body === 'sun') {
    fillColor(canvas, inner.left + 6, inner.top + 1, 2, 2, 0xffeb3b)
    // A cloud drifts across, wrapping around the pane.
    const cloudX = inner.left + ((Math.floor(tick / 8) % (inner.width + 4)) - 4)
    for (let dx = 0; dx < 4; dx += 1) {
      const x = cloudX + dx
      if (x >= inner.left && x < inner.left + inner.width) plotColor(canvas, x, inner.top + 4, 0xffffff)
      if (dx > 0 && dx < 3 && x >= inner.left && x < inner.left + inner.width) plotColor(canvas, x, inner.top + 3, 0xffffff)
    }
  }
  if (sky.body === 'moon') {
    stampSprite(canvas, MOON, inner.left + 7, inner.top, { M: 0xfff3c4 })
  }
  // Frame, one vertical mullion and a sill: no crossbar, so the sky reads as one view.
  fillColor(canvas, left, WINDOW_TOP, WINDOW_WIDTH, 1, WOOD)
  fillColor(canvas, left, WINDOW_TOP + WINDOW_HEIGHT - 1, WINDOW_WIDTH, 1, WOOD)
  fillColor(canvas, left, WINDOW_TOP, 1, WINDOW_HEIGHT, WOOD)
  fillColor(canvas, left + WINDOW_WIDTH - 1, WINDOW_TOP, 1, WINDOW_HEIGHT, WOOD)
  fillColor(canvas, left + WINDOW_WIDTH / 2, WINDOW_TOP, 1, WINDOW_HEIGHT, WOOD_DARK)
  fillColor(canvas, left - 1, WINDOW_TOP + WINDOW_HEIGHT, WINDOW_WIDTH + 2, 1, WOOD_DARK)
}

const drawPlant = (canvas: Canvas, left: number, tick: number): void => {
  // The pot stands on the shelf's top board.
  const potTop = SHELF_TOP - PLANT_POT.length
  stampSprite(canvas, PLANT_POT, left, potTop, FURNITURE)
  // The top leaves sway a pixel side to side; the stem stays put.
  const sway = Math.floor(tick / 6) % 2
  PLANT_LEAVES.forEach((row, i) => {
    stampSprite(canvas, [row], left + (i < 2 ? sway : 0), potTop - PLANT_LEAVES.length + i, FURNITURE)
  })
}

// Muted spines: the shelf is furniture, not a light show.
const BOOK_COLORS: readonly number[] = [0x9a6b62, 0x62809a, 0xa08c5c, 0x6b8f68]
const SHELF_WIDTH = 8
const SHELF_TOP = 6

/**
 * An open-backed bookshelf: two side posts, a top and four shelves, books standing on them.
 * No back panel — a solid slab is exactly what terminal line spacing stripes.
 */
const drawShelf = (canvas: Canvas, left: number): void => {
  fillColor(canvas, left, SHELF_TOP, 1, GROUND_Y - SHELF_TOP, WOOD_DARK)
  fillColor(canvas, left + SHELF_WIDTH - 1, SHELF_TOP, 1, GROUND_Y - SHELF_TOP, WOOD_DARK)
  fillColor(canvas, left, SHELF_TOP, SHELF_WIDTH, 1, WOOD)
  for (let shelf = 0; shelf < 4; shelf += 1) {
    const baseY = SHELF_TOP + 4 + shelf * 5
    fillColor(canvas, left, baseY, SHELF_WIDTH, 1, WOOD)
    for (let x = 1; x < SHELF_WIDTH - 1; x += 1) {
      const seed = shelf * 13 + x
      // Even rows of spines, with an occasional gap: tidy, not noisy.
      const height = 3
      if (scatter(seed + 99) % 6 === 0) continue
      fillColor(canvas, left + x, baseY - height, 1, height, BOOK_COLORS[scatter(seed + 7) % BOOK_COLORS.length] ?? 0xe57373)
    }
  }
}

const DESK_TOP = 19
const MONITOR_WIDTH = 12
const MONITOR_HEIGHT = 8

/** The monitor's screen box, so later behaviors can draw on it. */
export const screenBox = (layout: WorldLayout) => ({
  left: layout.deskLeft + 2,
  top: DESK_TOP - MONITOR_HEIGHT - 1,
  width: MONITOR_WIDTH - 2,
  height: MONITOR_HEIGHT - 2,
})

/** One line of "code": an indent, then colored tokens separated by single-pixel spaces. */
const drawCodeLine = (canvas: Canvas, left: number, y: number, width: number, seed: number): void => {
  let x = left + (scatter(seed) % 3)
  const tokens = 1 + (scatter(seed + 11) % 3)
  for (let token = 0; token < tokens && x < left + width; token += 1) {
    const length = Math.min(1 + (scatter(seed * 7 + token) % 3), left + width - x)
    fillColor(canvas, x, y, length, 1, CODE_COLORS[(seed + token) % CODE_COLORS.length] ?? 0x80cbc4)
    x += length + 1
  }
}

/** The desk, monitor housing, dark screen and mug: everything on the desk that never moves. */
const drawDeskFurniture = (canvas: Canvas, layout: WorldLayout): void => {
  const left = layout.deskLeft
  // A 1-px bezel around the screen; the screen itself is left transparent (no slab to stripe).
  const top = DESK_TOP - MONITOR_HEIGHT - 2
  fillColor(canvas, left + 1, top, MONITOR_WIDTH, 1, BEZEL)
  fillColor(canvas, left + 1, top + MONITOR_HEIGHT - 1, MONITOR_WIDTH, 1, BEZEL)
  fillColor(canvas, left + 1, top, 1, MONITOR_HEIGHT, BEZEL)
  fillColor(canvas, left + MONITOR_WIDTH, top, 1, MONITOR_HEIGHT, BEZEL)
  fillColor(canvas, left + 6, DESK_TOP - 2, 2, 2, STAND)
  fillColor(canvas, left, DESK_TOP, DESK_WIDTH, 1, WOOD)
  fillColor(canvas, left, DESK_TOP + 1, DESK_WIDTH, 1, WOOD_DARK)
  fillColor(canvas, left + 1, DESK_TOP + 2, 1, GROUND_Y + 1 - DESK_TOP - 2, WOOD_DARK)
  fillColor(canvas, left + DESK_WIDTH - 2, DESK_TOP + 2, 1, GROUND_Y + 1 - DESK_TOP - 2, WOOD_DARK)
  stampSprite(canvas, MUG, left + DESK_WIDTH - 4, DESK_TOP - 4, FURNITURE)
}

/** What moves on the desk: code on the screen, the cursor, the mug's steam. */
const drawDeskLife = (canvas: Canvas, layout: WorldLayout, tick: number, isTyping: boolean): void => {
  const left = layout.deskLeft
  const screen = screenBox(layout)
  // Code scrolls slowly on its own, fast while Mochi types.
  const scroll = isTyping ? tick : Math.floor(tick / 3)
  for (let line = 0; line < screen.height - 1; line += 1) {
    drawCodeLine(canvas, screen.left, screen.top + 1 + line, screen.width - 1, line + scroll)
  }
  // Blinking cursor.
  if (tick % 4 < 2) plotColor(canvas, screen.left + screen.width - 2, screen.top + screen.height - 1, 0xc9ced3)
  // Steam rises from the mug and fades into the wall.
  const mugLeft = left + DESK_WIDTH - 4
  for (let puff = 0; puff < 2; puff += 1) {
    const rise = (tick + puff * 3) % 6
    const drift = Math.floor((tick + puff * 2) / 3) % 2
    plotColor(canvas, mugLeft + 1 + drift, DESK_TOP - 5 - rise, mix(0x9aa5ad, STEAM_FADE, rise / 6))
  }
}

/**
 * The parts of the room that never change for a width (wall, floor, shelf, desk
 * furniture), painted once and copied into every frame. At most one entry per
 * width in MIN_SCENE_WIDTH..MAX_SCENE_WIDTH, so the cache stays small. Entries are
 * shared and only ever read (copied with `.set`); never draw into one.
 */
const staticRooms = new Map<number, Int32Array>()

const staticRoom = (width: number): Int32Array => {
  const cached = staticRooms.get(width)
  if (cached !== undefined) return cached
  const canvas = createCanvas(width, SCENE_HEIGHT)
  const layout = layoutFor(width)
  drawFloor(canvas)
  if (layout.shelfLeft !== undefined) drawShelf(canvas, layout.shelfLeft)
  drawDeskFurniture(canvas, layout)
  staticRooms.set(width, canvas.pixels)
  return canvas.pixels
}

/**
 * Paints the room behind the characters: the cached static room, then what
 * moves — window sky for `hour`, swaying plant, code (racing when
 * `isTyping`) and steam. The moving parts only ever cover wall or
 * furniture, so the layering matches painting everything from scratch.
 */
export const drawWorld = (canvas: Canvas, tick: number, hour: number, isTyping = false): void => {
  const layout = layoutFor(canvas.width)
  if (canvas.height === SCENE_HEIGHT) canvas.pixels.set(staticRoom(canvas.width))
  drawWindow(canvas, layout.windowLeft, hour, tick)
  if (layout.plantLeft !== undefined) drawPlant(canvas, layout.plantLeft, tick)
  drawDeskLife(canvas, layout, tick, isTyping)
}
