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

/**
 * Where Mochi's desk stands: the view through the window, the prop in the shelf's spot
 * and the floor line change; the desk, the monitor and where everyone walks never do.
 * The session badge gives each session its own place, so a glance at the pane tells
 * sessions apart in any terminal.
 */
export type PlaceId = 'house' | 'mountain' | 'gym' | 'forest' | 'beach' | 'desert' | 'space' | 'library'

export const PLACE_IDS: readonly PlaceId[] = ['house', 'mountain', 'gym', 'forest', 'beach', 'desert', 'space', 'library']

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
  /** How far a landscape in the window darkens toward night, 0 to 1. */
  dim: number
}

export const skyFor = (hour: number): Sky => {
  if (hour >= 6 && hour < 8) return { top: 0xf48fb1, bottom: 0xffcc80, body: 'sun', hasStars: false, dim: 0.15 }
  if (hour >= 8 && hour < 18) return { top: 0x5fb6ef, bottom: 0xa8dcf7, body: 'sun', hasStars: false, dim: 0 }
  if (hour >= 18 && hour < 21) return { top: 0x5e35b1, bottom: 0xff8a65, body: 'none', hasStars: false, dim: 0.3 }
  return { top: 0x0b1a33, bottom: 0x1b2d4f, body: 'moon', hasStars: true, dim: 0.55 }
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

/** Each place's floor line: muted like the rest of the room, so Mochi still reads first. */
const FLOOR_LINES: Readonly<Record<PlaceId, number>> = {
  house: FLOOR_LINE,
  mountain: 0x4f5a4a,
  gym: 0x484b52,
  forest: 0x3f5240,
  beach: 0x6b5f45,
  desert: 0x6a4a35,
  space: 0x3d3a5c,
  library: WOOD_DARK,
}

/** The floor is one thin line where the wall would meet it; the rest is the pane itself. */
const drawFloor = (canvas: Canvas, place: PlaceId): void => {
  fillColor(canvas, 0, GROUND_Y, canvas.width, 1, FLOOR_LINES[place])
}

/** Star spots inside the window, clear of the mullion and the moon. */
const STARS: ReadonlyArray<readonly [number, number]> = [[1, 1], [3, 3], [4, 0], [1, 6], [8, 6], [3, 7], [7, 5]]
const MOON: Sprite = ['.MM', 'M..', 'M..', '.MM']

const WINDOW_WIDTH = 12
const WINDOW_HEIGHT = 10
const WINDOW_TOP = 3

/** The window's inner view box. */
type View = { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

/** Space has no day: the porthole always looks out on the dark. */
const SPACE_SKY: Sky = { top: 0x07061a, bottom: 0x1b1140, body: 'none', hasStars: true, dim: 0 }
const SPACE_STARS: ReadonlyArray<readonly [number, number]> = [[0, 0], [2, 2], [4, 1], [1, 5], [3, 7], [8, 0], [9, 2], [7, 7], [0, 3]]

const NIGHT = 0x0b1a33

/** Plots a landscape pixel at view coordinates, dimmed for the time of day and kept inside the view. */
const viewPlot = (canvas: Canvas, view: View, dim: number) => (x: number, y: number, color: number): void => {
  if (x < 0 || y < 0 || x >= view.width || y >= view.height) return
  plotColor(canvas, view.left + x, view.top + y, dim > 0 ? mix(color, NIGHT, dim) : color)
}

/** Fills a column from `fromY` down to the bottom of the view. */
const column = (plot: (x: number, y: number, color: number) => void, x: number, fromY: number, bottomY: number, color: number): void => {
  for (let y = fromY; y <= bottomY; y += 1) plot(x, y, color)
}

/** Sun, a drifting cloud, or the moon and stars: the sky of the house, and behind every landscape. */
const drawSkyBodies = (canvas: Canvas, view: View, sky: Sky, tick: number): void => {
  if (sky.hasStars) {
    STARS.forEach(([x, y], i) => {
      // Each star twinkles on its own beat.
      if ((tick + i * 3) % 11 === 0) return
      plotColor(canvas, view.left + x, view.top + y, i % 2 === 0 ? 0xfff9c4 : 0xb3c7e6)
    })
  }
  if (sky.body === 'sun') {
    fillColor(canvas, view.left + 6, view.top + 1, 2, 2, 0xffeb3b)
    // A cloud drifts across, wrapping around the pane.
    const cloudX = view.left + ((Math.floor(tick / 8) % (view.width + 4)) - 4)
    for (let dx = 0; dx < 4; dx += 1) {
      const x = cloudX + dx
      if (x >= view.left && x < view.left + view.width) plotColor(canvas, x, view.top + 4, 0xffffff)
      if (dx > 0 && dx < 3 && x >= view.left && x < view.left + view.width) plotColor(canvas, x, view.top + 3, 0xffffff)
    }
  }
  if (sky.body === 'moon') {
    stampSprite(canvas, MOON, view.left + 7, view.top, { M: 0xfff3c4 })
  }
}

/** Peaks with snow on the tall ones, over a strip of meadow. */
const drawMountains = (canvas: Canvas, view: View, sky: Sky): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  const heights = [3, 5, 6, 4, 3, 2, 3, 5, 4, 3]
  heights.forEach((height, x) => {
    const top = view.height - height
    const isShadow = (heights[x + 1] ?? 0) < height
    column(plot, x, top, view.height - 1, isShadow ? 0x56637a : 0x6b7a8f)
    if (height >= 5) plot(x, top, 0xeef3f7)
  })
  for (let x = 0; x < view.width; x += 1) plot(x, view.height - 1, 0x5f8f4e)
}

/** A jagged line of pines in two greens. */
const drawForest = (canvas: Canvas, view: View, sky: Sky): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  const heights = [3, 5, 4, 2, 4, 6, 3, 5, 4, 2]
  heights.forEach((height, x) => column(plot, x, view.height - height, view.height - 1, x % 2 === 0 ? 0x2f5e3c : 0x3d7a4b))
  for (const x of [1, 5, 7]) plot(x, view.height - 1, 0x5a4636)
}

/** Sea and sand, with a sail that crosses the horizon. */
const drawBeach = (canvas: Canvas, view: View, sky: Sky, tick: number): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  for (let x = 0; x < view.width; x += 1) {
    plot(x, view.height - 3, 0x3b8fd0)
    plot(x, view.height - 2, 0x2f75b0)
    plot(x, view.height - 1, 0xe6cf98)
  }
  // A glint rides the water.
  plot(Math.floor(tick / 4) % view.width, view.height - 3, 0xbfe3f7)
  const boatX = (Math.floor(tick / 12) % (view.width + 3)) - 2
  plot(boatX, view.height - 5, 0xf5f5f5)
  plot(boatX, view.height - 4, 0xf5f5f5)
  plot(boatX + 1, view.height - 4, 0xf5f5f5)
  plot(boatX, view.height - 3, 0x6e5a51)
  plot(boatX + 1, view.height - 3, 0x6e5a51)
}

/** Dunes, a flat-topped mesa and a cactus. */
const drawDesert = (canvas: Canvas, view: View, sky: Sky): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  for (let x = 6; x < view.width; x += 1) column(plot, x, view.height - 5, view.height - 1, x === 6 ? 0x9c5534 : 0xb5643c)
  for (let x = 0; x < view.width; x += 1) {
    plot(x, view.height - 1, 0xe0a868)
    if (x < 5) plot(x, view.height - 2, 0xc98c52)
  }
  column(plot, 2, view.height - 6, view.height - 2, 0x5f9a4a)
  plot(1, view.height - 4, 0x5f9a4a)
  plot(1, view.height - 5, 0x5f9a4a)
  plot(3, view.height - 5, 0x5f9a4a)
}

/** City towers; their windows light up once the sky darkens. */
const drawCity = (canvas: Canvas, view: View, sky: Sky): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  const heights = [5, 3, 6, 4, 7, 5, 3, 6, 4, 5]
  const isLit = sky.hasStars || sky.body === 'none'
  heights.forEach((height, x) => {
    column(plot, x, view.height - height, view.height - 1, x % 2 === 0 ? 0x4a5363 : 0x5b6576)
    for (let y = view.height - height + 1; y < view.height - 1; y += 2) {
      if (scatter(x * 7 + y) % 3 === 0) plotColor(canvas, view.left + x, view.top + y, isLit ? 0xffd36b : 0x9fb4c8)
    }
  })
}

/** Rain over dark rooftops, with one warm window across the street. */
const drawRain = (canvas: Canvas, view: View, sky: Sky, tick: number): void => {
  const plot = viewPlot(canvas, view, sky.dim)
  for (let x = 0; x < view.width; x += 1) {
    const roof = x < 4 ? 2 : x < 7 ? 3 : 2
    column(plot, x, view.height - roof, view.height - 1, 0x3d3a44)
  }
  plotColor(canvas, view.left + 5, view.top + view.height - 2, 0xffc46b)
  // Streaks, not dots: a drop is two pixels, brighter at its head.
  for (let drop = 0; drop < 5; drop += 1) {
    const x = (drop * 2 + Math.floor(drop / 2)) % view.width
    const y = (tick + drop * 3) % (view.height - 3)
    plotColor(canvas, view.left + x, view.top + y, 0x7f97ad)
    plotColor(canvas, view.left + x, view.top + y + 1, 0xc4d6e6)
  }
}

/** Deep space through a porthole: stars, a ringed planet and, now and then, a comet. */
const drawSpace = (canvas: Canvas, view: View, tick: number): void => {
  SPACE_STARS.forEach(([x, y], i) => {
    if ((tick + i * 5) % 13 === 0) return
    plotColor(canvas, view.left + x, view.top + y, i % 3 === 0 ? 0xb3c7e6 : 0xfff9c4)
  })
  stampSprite(canvas, ['.pp.', 'pPPp', 'pPPp', '.pp.'], view.left + 5, view.top + 3, { p: 0xc0703f, P: 0xe8915a })
  for (let x = 3; x < 10; x += 1) if (x < 5 || x > 8) plotColor(canvas, view.left + x, view.top + 4, 0xd9c27e)
  const cometX = Math.floor(tick / 2) % 40
  if (cometX < view.width) {
    plotColor(canvas, view.left + cometX, view.top + 1, 0xffffff)
    if (cometX > 0) plotColor(canvas, view.left + cometX - 1, view.top + 1, 0x8a9bb8)
  }
}

/** The window frame: wood in the house, metal for the porthole in space and the gym's steel. */
const FRAMES: Readonly<Partial<Record<PlaceId, { readonly frame: number; readonly mullion: number }>>> = {
  space: { frame: 0x6b7280, mullion: 0x4b5563 },
  gym: { frame: 0x5b6270, mullion: 0x464c57 },
}

const drawWindow = (canvas: Canvas, left: number, hour: number, tick: number, place: PlaceId): void => {
  const sky = place === 'space' ? SPACE_SKY : skyFor(hour)
  const view: View = { left: left + 1, top: WINDOW_TOP + 1, width: WINDOW_WIDTH - 2, height: WINDOW_HEIGHT - 2 }
  // Rain greys the sky over the library.
  const top = place === 'library' ? mix(sky.top, 0x6f7a86, 0.6) : sky.top
  const bottom = place === 'library' ? mix(sky.bottom, 0x6f7a86, 0.6) : sky.bottom
  for (let y = 0; y < view.height; y += 1) {
    fillColor(canvas, view.left, view.top + y, view.width, 1, mix(top, bottom, y / (view.height - 1)))
  }
  if (place === 'space') drawSpace(canvas, view, tick)
  else if (place !== 'library') drawSkyBodies(canvas, view, sky, tick)
  if (place === 'mountain') drawMountains(canvas, view, sky)
  if (place === 'forest') drawForest(canvas, view, sky)
  if (place === 'beach') drawBeach(canvas, view, sky, tick)
  if (place === 'desert') drawDesert(canvas, view, sky)
  if (place === 'gym') drawCity(canvas, view, sky)
  if (place === 'library') drawRain(canvas, view, sky, tick)
  // Frame, one vertical mullion and a sill: no crossbar, so the sky reads as one view.
  const { frame, mullion } = FRAMES[place] ?? { frame: WOOD, mullion: WOOD_DARK }
  fillColor(canvas, left, WINDOW_TOP, WINDOW_WIDTH, 1, frame)
  fillColor(canvas, left, WINDOW_TOP + WINDOW_HEIGHT - 1, WINDOW_WIDTH, 1, frame)
  fillColor(canvas, left, WINDOW_TOP, 1, WINDOW_HEIGHT, frame)
  fillColor(canvas, left + WINDOW_WIDTH - 1, WINDOW_TOP, 1, WINDOW_HEIGHT, frame)
  fillColor(canvas, left + WINDOW_WIDTH / 2, WINDOW_TOP, 1, WINDOW_HEIGHT, mullion)
  fillColor(canvas, left - 1, WINDOW_TOP + WINDOW_HEIGHT, WINDOW_WIDTH + 2, 1, mullion)
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

// The prop in the shelf's spot, one per place. Thin parts and open shapes, like the
// bookshelf: a solid slab is exactly what terminal line spacing stripes. Every prop draws
// through a SlotPainter, which keeps it inside the shelf's 8-pixel slot and off the floor
// line, so no prop can spill onto the open wall or the floor.

/** Draws in the shelf slot's own coordinates: x 0..SHELF_WIDTH-1, y above GROUND_Y. */
type SlotPainter = {
  readonly plot: (x: number, y: number, color: number) => void
  readonly fill: (x: number, y: number, width: number, height: number, color: number) => void
  readonly stamp: (sprite: Sprite, x: number, y: number, palette: Palette) => void
}

const slotPainter = (canvas: Canvas, left: number): SlotPainter => {
  const plot = (x: number, y: number, color: number): void => {
    if (x < 0 || x >= SHELF_WIDTH || y < 0 || y >= GROUND_Y) return
    plotColor(canvas, left + x, y, color)
  }
  return {
    plot,
    fill: (x, y, width, height, color) => {
      for (let dy = 0; dy < height; dy += 1) for (let dx = 0; dx < width; dx += 1) plot(x + dx, y + dy, color)
    },
    stamp: (sprite, x, y, palette) =>
      sprite.forEach((row, dy) =>
        [...row].forEach((key, dx) => {
          const color = palette[key]
          if (color !== undefined) plot(x + dx, y + dy, color)
        }),
      ),
  }
}

/** The lowest row a prop may use: the one just above the floor line. */
const PROP_BOTTOM = GROUND_Y - 1

/** A reading lamp on the library's bookshelf, its bulb warming and cooling slowly. */
const drawLamp = (slot: SlotPainter, tick: number): void => {
  const top = SHELF_TOP - 5
  slot.fill(2, top, 4, 1, 0xd9a35a)
  slot.fill(1, top + 1, 6, 1, 0xc28a45)
  slot.plot(3, top + 2, mix(0xfff1b8, 0xffc46b, (Math.floor(tick / 5) % 4) / 3))
  slot.fill(4, top + 2, 1, 2, 0x7d6b62)
  slot.fill(3, top + 4, 3, 1, 0x6a5850)
}

/** Skis and poles leaning on the wall, ski tips curled at the top. */
const drawSkis = (slot: SlotPainter): void => {
  const skiTop = SHELF_TOP
  for (const [x, color] of [[1, 0xd8574a], [3, 0x4a8fd8]] as const) {
    slot.fill(x, skiTop, 1, PROP_BOTTOM - skiTop + 1, color)
    slot.plot(x + 1, skiTop - 1, color)
  }
  const poleTop = SHELF_TOP + 3
  for (const x of [5, 7]) {
    slot.fill(x, poleTop, 1, PROP_BOTTOM - poleTop + 1, 0x9aa3ad)
    slot.plot(x, poleTop - 1, 0x37474f)
    // The basket near the foot; the slot clips the right pole's to two pixels.
    slot.fill(x - 1, PROP_BOTTOM - 2, 3, 1, 0x6f7a86)
  }
}

/** A dumbbell on the gym floor, under the punching bag. */
const drawDumbbell = (slot: SlotPainter): void => {
  const y = PROP_BOTTOM - 1
  slot.fill(0, y - 1, 2, 3, 0x37474f)
  slot.fill(6, y - 1, 2, 3, 0x37474f)
  slot.fill(2, y, 4, 1, 0x9aa3ad)
}

/** A punching bag swinging on its chain: a small body, about Mochi's own size, with a seam. */
const drawPunchingBag = (slot: SlotPainter, tick: number): void => {
  const sway = [0, 1, 0, -1][Math.floor(tick / 6) % 4] ?? 0
  slot.fill(4, 0, 1, 4, 0x9aa3ad)
  slot.fill(3 + sway, 4, 3, 1, 0x7f2f2f)
  slot.fill(2 + sway, 5, 5, 9, 0xb23b3b)
  slot.fill(2 + sway, 9, 5, 1, 0x7f2f2f)
  slot.fill(3 + sway, 14, 3, 1, 0x7f2f2f)
}

/** A potted tree: pot and trunk stay put, the leaves sway. */
const drawTreeTrunk = (slot: SlotPainter): void => {
  slot.fill(1, PROP_BOTTOM - 3, 6, 1, 0x6a5850)
  slot.fill(2, PROP_BOTTOM - 2, 4, 3, 0x7d6b62)
  slot.fill(3, 11, 2, PROP_BOTTOM - 3 - 11, 0x5a4636)
}

const drawTreeLeaves = (slot: SlotPainter, tick: number): void => {
  const sway = Math.floor(tick / 7) % 2
  for (let y = 1; y < 13; y += 1) {
    const half = y < 4 ? y : y > 10 ? 13 - y : 4
    for (let dx = -half; dx < half; dx += 1) {
      // Leafy, with gaps: a solid crown would stripe.
      if (scatter(y * 17 + dx + 40) % 5 === 0) continue
      slot.plot(4 + dx + (y < 6 ? sway : 0), y, (dx + y) % 3 === 0 ? 0x557d52 : 0x6f9a6a)
    }
  }
}

/** A surfboard leaning on the wall and a beach ball beside it. */
const drawSurfboard = (slot: SlotPainter): void => {
  const top = SHELF_TOP
  for (let y = top; y <= PROP_BOTTOM; y += 1) {
    const isTip = y === top || y === PROP_BOTTOM
    slot.fill(isTip ? 2 : 1, y, isTip ? 2 : 4, 1, 0xf2c14e)
  }
  slot.fill(2, top + 2, 1, PROP_BOTTOM - top - 3, 0xe2603f)
  slot.stamp(['.rw', 'rwb', 'wb.'], 5, PROP_BOTTOM - 2, { r: 0xe2603f, w: 0xf5f5f5, b: 0x3b8fd0 })
}

/** A saguaro in a clay pot. */
const drawCactus = (slot: SlotPainter): void => {
  const green = 0x5f9a4a
  slot.fill(1, PROP_BOTTOM - 3, 6, 1, 0xa65d36)
  slot.fill(2, PROP_BOTTOM - 2, 4, 3, 0xb8693e)
  slot.fill(3, SHELF_TOP + 1, 2, PROP_BOTTOM - 3 - SHELF_TOP - 1, green)
  slot.fill(1, 11, 1, 4, green)
  slot.plot(2, 14, green)
  slot.fill(6, 9, 1, 4, green)
  slot.plot(5, 12, green)
  for (const y of [9, 13, 17]) slot.plot(4, y, 0xa8d08d)
}

/** A model rocket on its stand; the light on its nose blinks. */
const drawRocket = (slot: SlotPainter): void => {
  const red = 0xd8574a
  slot.fill(3, SHELF_TOP, 2, 1, red)
  slot.fill(3, SHELF_TOP + 1, 2, 13, 0xe8ecf0)
  slot.plot(3, SHELF_TOP + 4, 0x3b8fd0)
  slot.fill(2, 16, 1, 4, red)
  slot.fill(5, 16, 1, 4, red)
  slot.fill(1, PROP_BOTTOM, 6, 1, 0x6b7280)
  slot.fill(2, 20, 1, PROP_BOTTOM - 20, 0x6b7280)
  slot.fill(5, 20, 1, PROP_BOTTOM - 20, 0x6b7280)
}

const drawRocketLight = (slot: SlotPainter, tick: number): void => {
  if (Math.floor(tick / 4) % 2 === 0) slot.plot(3, SHELF_TOP - 1, 0xff6b5a)
}

/** The prop's still part, painted once into the cached room. */
const drawPropStill = (canvas: Canvas, left: number, place: PlaceId): void => {
  if (place === 'house' || place === 'library') drawShelf(canvas, left)
  const slot = slotPainter(canvas, left)
  if (place === 'mountain') drawSkis(slot)
  if (place === 'gym') drawDumbbell(slot)
  if (place === 'forest') drawTreeTrunk(slot)
  if (place === 'beach') drawSurfboard(slot)
  if (place === 'desert') drawCactus(slot)
  if (place === 'space') drawRocket(slot)
}

/** The prop's moving part, painted every frame. */
const drawPropLife = (canvas: Canvas, layout: WorldLayout, place: PlaceId, tick: number): void => {
  if (layout.shelfLeft === undefined) return
  if (place === 'house' && layout.plantLeft !== undefined) {
    drawPlant(canvas, layout.plantLeft, tick)
    return
  }
  const slot = slotPainter(canvas, layout.shelfLeft)
  if (place === 'library') drawLamp(slot, tick)
  if (place === 'gym') drawPunchingBag(slot, tick)
  if (place === 'forest') drawTreeLeaves(slot, tick)
  if (place === 'space') drawRocketLight(slot, tick)
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
 * The parts of the room that never change for a width and place (floor, the prop's
 * still part, desk furniture), painted once and copied into every frame. At most one
 * entry per width in MIN_SCENE_WIDTH..MAX_SCENE_WIDTH and place, so the cache stays
 * small. Entries are shared and only ever read (copied with `.set`); never draw into one.
 */
const staticRooms = new Map<string, Int32Array>()

const staticRoom = (width: number, place: PlaceId): Int32Array => {
  const key = `${width}:${place}`
  const cached = staticRooms.get(key)
  if (cached !== undefined) return cached
  const canvas = createCanvas(width, SCENE_HEIGHT)
  const layout = layoutFor(width)
  drawFloor(canvas, place)
  if (layout.shelfLeft !== undefined) drawPropStill(canvas, layout.shelfLeft, place)
  drawDeskFurniture(canvas, layout)
  staticRooms.set(key, canvas.pixels)
  return canvas.pixels
}

/**
 * Paints the room behind the characters at `place`: the cached static room, then
 * what moves — the window's view for `hour`, the prop's moving part (the house's
 * swaying plant), code (racing when `isTyping`) and steam. The moving parts only
 * ever cover wall or furniture, so the layering matches painting everything from scratch.
 */
export const drawWorld = (canvas: Canvas, tick: number, hour: number, isTyping = false, place: PlaceId = 'house'): void => {
  const layout = layoutFor(canvas.width)
  if (canvas.height === SCENE_HEIGHT) canvas.pixels.set(staticRoom(canvas.width, place))
  drawWindow(canvas, layout.windowLeft, hour, tick, place)
  drawPropLife(canvas, layout, place, tick)
  drawDeskLife(canvas, layout, tick, isTyping)
}
