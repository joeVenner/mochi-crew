import { describe, expect, test } from 'claude-code/testing'

import { TRANSPARENT, createCanvas, encodeCanvas, halfBlockCell, mix, toBase64 } from '../hooks/canvas'
import {
  GROUND_Y, MAX_SCENE_WIDTH, MIN_SCENE_WIDTH, SCENE_HEIGHT, drawWorld, layoutFor, sceneWidthFor, screenBox, skyFor,
} from '../hooks/world'

const DEFAULT = 0x01000000
const FUR = 0xb9a7d6
const GREEN = 0x66bb6a

const world = (width: number, tick: number, hour: number) => {
  const canvas = createCanvas(width, SCENE_HEIGHT)
  drawWorld(canvas, tick, hour)
  return canvas.pixels
}

describe('world', () => {
  test('the scene width follows the pane, clamped', async () => {
    expect(sceneWidthFor(undefined)).toBe(MIN_SCENE_WIDTH)
    expect(sceneWidthFor(10)).toBe(MIN_SCENE_WIDTH)
    expect(sceneWidthFor(55.7)).toBe(55)
    expect(sceneWidthFor(500)).toBe(MAX_SCENE_WIDTH)
  })

  test('the sky follows the hour', async () => {
    expect(skyFor(3)).toMatchObject({ body: 'moon', hasStars: true })
    expect(skyFor(7).body).toBe('sun')
    expect(skyFor(12)).toMatchObject({ body: 'sun', hasStars: false })
    expect(skyFor(19)).toMatchObject({ body: 'none', hasStars: false })
    expect(skyFor(23).hasStars).toBe(true)
    expect(world(MIN_SCENE_WIDTH, 1, 3)).not.toEqual(world(MIN_SCENE_WIDTH, 1, 12))
  })

  test('furniture fits: the shelf only appears when there is room, the desk stays inside', async () => {
    expect(layoutFor(MIN_SCENE_WIDTH).shelfLeft).toBeUndefined()
    expect(layoutFor(MAX_SCENE_WIDTH).shelfLeft).toBeDefined()
    for (const width of [MIN_SCENE_WIDTH, 52, MAX_SCENE_WIDTH]) {
      const layout = layoutFor(width)
      expect(layout.deskLeft + 14).toBeLessThanOrEqual(width)
      if (layout.shelfLeft !== undefined) expect(layout.shelfLeft + 8).toBeLessThan(layout.deskLeft)
    }
  })

  test('the room is alive: steam, code, dust and plant move between ticks', async () => {
    expect(world(MIN_SCENE_WIDTH, 1, 12)).not.toEqual(world(MIN_SCENE_WIDTH, 2, 12))
  })

  test('the room paints only its furniture (wall and floor stay transparent) and never uses the cat colors', async () => {
    const pixels = world(MAX_SCENE_WIDTH, 5, 12)
    expect(pixels.includes(TRANSPARENT)).toBe(true)
    expect(pixels.includes(FUR)).toBe(false)
  })
})

describe('canvas', () => {
  test('halfBlockCell packs two stacked pixels into one cell', async () => {
    expect(halfBlockCell(-1, -1)).toEqual([0x20, DEFAULT, DEFAULT])
    expect(halfBlockCell(FUR, -1)).toEqual([0x2580, FUR, DEFAULT])
    expect(halfBlockCell(-1, FUR)).toEqual([0x2584, FUR, DEFAULT])
    expect(halfBlockCell(FUR, FUR)).toEqual([0x2588, FUR, DEFAULT])
    expect(halfBlockCell(FUR, GREEN)).toEqual([0x2580, FUR, GREEN])
  })

  test('encodeCanvas emits one 12-byte cell per column per row pair', async () => {
    const canvas = createCanvas(3, 4)
    expect(encodeCanvas(canvas).length).toBe(Math.ceil((3 * 2 * 12) / 3) * 4)
  })

  test('mix blends channels', async () => {
    expect(mix(0x000000, 0xffffff, 0)).toBe(0x000000)
    expect(mix(0x000000, 0xffffff, 1)).toBe(0xffffff)
    expect(mix(0x000000, 0x0000ff, 0.5)).toBe(0x000080)
  })

  test('toBase64 matches the standard encoding', async () => {
    const bytes = (text: string) => new TextEncoder().encode(text)
    expect(toBase64(bytes(''))).toBe('')
    expect(toBase64(bytes('f'))).toBe('Zg==')
    expect(toBase64(bytes('fo'))).toBe('Zm8=')
    expect(toBase64(bytes('foo'))).toBe('Zm9v')
    expect(toBase64(bytes('foobar'))).toBe('Zm9vYmFy')
  })
})

describe('clean room', () => {
  const frame = (tick: number) => {
    const canvas = createCanvas(64, SCENE_HEIGHT)
    drawWorld(canvas, tick, 12)
    return canvas
  }

  test('open wall is one flat color, with no dots or drifting dust, frame after frame', async () => {
    for (const tick of [0, 7, 19, 40]) {
      const canvas = frame(tick)
      const wall = new Set<number>()
      // Between the bookshelf and the monitor: nothing painted at all.
      for (let y = 0; y < GROUND_Y - 1; y += 1) for (let x = 36; x < 44; x += 1) wall.add(canvas.pixels[y * 64 + x] ?? -1)
      expect(wall.size).toBe(1)
    }
  })

  test('the floor is a single thin line; below it, nothing is painted', async () => {
    const canvas = frame(0)
    const line = new Set<number>()
    for (let x = 0; x < 64; x += 1) line.add(canvas.pixels[GROUND_Y * 64 + x] ?? -1)
    expect(line.size).toBe(2) // the line, crossed by the desk legs
    // Between the plant and the desk, below the line: only pane background.
    for (let y = GROUND_Y + 1; y < SCENE_HEIGHT; y += 1) for (let x = 36; x < 44; x += 1) expect(canvas.pixels[y * 64 + x]).toBe(-1)
  })
})

describe('open shelf', () => {
  test('the bookshelf has no back panel: the pane shows between a shelf and the books above it', async () => {
    const canvas = createCanvas(64, SCENE_HEIGHT)
    drawWorld(canvas, 0, 12)
    const shelfLeft = layoutFor(64).shelfLeft ?? 0
    // Row just under the first shelf plank (y = 10): above the next row of books, inside the frame.
    for (let x = shelfLeft + 1; x < shelfLeft + 7; x += 1) expect(canvas.pixels[11 * 64 + x]).toBe(-1)
    // The side posts are still there.
    expect(canvas.pixels[11 * 64 + shelfLeft]).not.toBe(-1)
  })
})

describe('see-through monitor', () => {
  test('the monitor is a thin bezel: its screen is not painted, only code and cursor sit on it', async () => {
    const canvas = createCanvas(64, SCENE_HEIGHT)
    drawWorld(canvas, 0, 12)
    const screen = screenBox(layoutFor(64))
    let empty = 0
    for (let y = screen.top; y < screen.top + screen.height; y += 1) {
      for (let x = screen.left; x < screen.left + screen.width; x += 1) if (canvas.pixels[y * 64 + x] === -1) empty += 1
    }
    // Code covers some of it; the rest is the pane, not a dark slab.
    expect(empty).toBeGreaterThan((screen.width * screen.height) / 3)
    // The bezel frames it.
    expect(canvas.pixels[(screen.top - 1) * 64 + screen.left]).not.toBe(-1)
  })
})

describe('window', () => {
  test('one view of the sky: no crossbar through the middle, only the vertical mullion', async () => {
    const canvas = createCanvas(64, SCENE_HEIGHT)
    drawWorld(canvas, 0, 12)
    const { windowLeft } = layoutFor(64)
    // Window: top 3, height 10, width 12; the old crossbar sat on row 8.
    const row = (y: number) => Array.from({ length: 10 }, (_, i) => canvas.pixels[y * 64 + windowLeft + 1 + i])
    // The vertical mullion's wood, read just under the frame's top edge.
    const mullion = canvas.pixels[4 * 64 + windowLeft + 6]
    expect(row(8).filter(pixel => pixel === mullion).length).toBeLessThanOrEqual(1)
  })
})
