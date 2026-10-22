import { describe, expect, test } from 'claude-code/testing'

import { TRANSPARENT, createCanvas, encodeCanvas, halfBlockCell, mix, toBase64 } from '../hooks/canvas'
import {
  GROUND_Y, MAX_SCENE_WIDTH, MIN_SCENE_WIDTH, PLACE_IDS, SCENE_HEIGHT, drawWorld, layoutFor, sceneWidthFor, screenBox, skyFor,
} from '../hooks/world'
import type { PlaceId } from '../hooks/world'

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

describe('places', () => {
  const at = (place: PlaceId, width: number, tick: number, hour: number) => {
    const canvas = createCanvas(width, SCENE_HEIGHT)
    drawWorld(canvas, tick, hour, false, place)
    return canvas.pixels
  }
  const region = (pixels: Int32Array, width: number, left: number, top: number, right: number, bottom: number) => {
    const out: number[] = []
    for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) out.push(pixels[y * width + x] ?? -2)
    return out
  }
  const windowView = (pixels: Int32Array, width: number) => region(pixels, width, 4, 4, 14, 12)

  // Hashes of the room as 1.5.2 drew it (origin/main before places), for widths 40, 52 and 64,
  // ticks 0, 3, 7 and 19 (typing on odd ticks) and hours 3, 7, 12, 19 and 23, in that order.
  const HOUSE_GOLDEN = [
    292341936, 1351319429, 988719805, 3027865557, 292341936, 1044909471, 1248271815, 1379801423, 3535530359, 1044909471,
    2101288034, 1363489371, 281069987, 300097815, 2101288034, 2449079458, 3054603389, 308995886, 1680139464, 2449079458,
    278067457, 3563723068, 1004952808, 3292203484, 278067457, 2294503862, 3315871602, 1144059638, 4161192082, 2294503862,
    1126461447, 899547194, 2197898590, 1888419430, 1126461447, 4048501679, 2831099588, 3511877539, 3248249413, 4048501679,
    4113570937, 1140682964, 3776700848, 2489475828, 4113570937, 1937988222, 3592549114, 1441942894, 3775028762, 1937988222,
    1312619375, 2029594498, 3195285974, 1206545902, 1312619375, 3486635751, 214337932, 2439975563, 580428365, 3486635751,
  ]
  const hash = (pixels: Int32Array): number => {
    let h = 0x811c9dc5
    for (const value of pixels) {
      h ^= value & 0xffff
      h = Math.imul(h, 0x01000193) >>> 0
      h ^= (value >>> 16) & 0xffff
      h = Math.imul(h, 0x01000193) >>> 0
    }
    return h
  }

  test('the house is pixel for pixel the room Mochi had before places, and the default', async () => {
    const hashes: number[] = []
    for (const width of [40, 52, 64]) {
      for (const tick of [0, 3, 7, 19]) {
        for (const hour of [3, 7, 12, 19, 23]) {
          const canvas = createCanvas(width, SCENE_HEIGHT)
          drawWorld(canvas, tick, hour, tick % 2 === 1, 'house')
          hashes.push(hash(canvas.pixels))
        }
      }
    }
    expect(hashes).toEqual(HOUSE_GOLDEN)
    expect(at('house', 64, 3, 12)).toEqual(world(64, 3, 12))
  })

  test('a place changes only its window, its prop slot and its floor line', async () => {
    for (const width of [MIN_SCENE_WIDTH, 52, MAX_SCENE_WIDTH]) {
      const { shelfLeft, windowLeft } = layoutFor(width)
      const isPlaceOwned = (x: number, y: number) =>
        y === GROUND_Y ||
        (x >= windowLeft - 1 && x <= windowLeft + 12 && y >= 3 && y <= 13) ||
        (shelfLeft !== undefined && x >= shelfLeft && x < shelfLeft + 8 && y < GROUND_Y)
      for (const place of PLACE_IDS) {
        for (let tick = 0; tick < 60; tick += 1) {
          const placed = at(place, width, tick, 12)
          const house = at('house', width, tick, 12)
          for (let y = 0; y < SCENE_HEIGHT; y += 1) {
            for (let x = 0; x < width; x += 1) {
              if (isPlaceOwned(x, y)) continue
              const index = y * width + x
              if (placed[index] !== house[index]) throw new Error(`${place} at width ${width}, tick ${tick} paints (${x}, ${y}) outside its own parts`)
            }
          }
        }
      }
    }
  })

  test('every place keeps the desk and monitor exactly where the house has them', async () => {
    for (const width of [MIN_SCENE_WIDTH, 52, MAX_SCENE_WIDTH]) {
      const { deskLeft } = layoutFor(width)
      // Above the floor line, whose color is the place's own.
      const desk = (place: PlaceId) => region(at(place, width, 7, 12), width, deskLeft, 9, width, GROUND_Y)
      for (const place of PLACE_IDS) expect(desk(place)).toEqual(desk('house'))
    }
  })

  test('each place has its own view through the window, wide or narrow', async () => {
    for (const width of [MIN_SCENE_WIDTH, MAX_SCENE_WIDTH]) {
      const views = PLACE_IDS.map(place => windowView(at(place, width, 5, 12), width).join(','))
      expect(new Set(views).size).toBe(PLACE_IDS.length)
    }
  })

  test('space has no day, while the landscapes darken at night', async () => {
    expect(windowView(at('space', 64, 5, 12), 64)).toEqual(windowView(at('space', 64, 5, 23), 64))
    expect(windowView(at('mountain', 64, 5, 12), 64)).not.toEqual(windowView(at('mountain', 64, 5, 23), 64))
  })

  test('every place keeps the clean room: open wall, one floor line, nothing below, no cat colors', async () => {
    for (const place of PLACE_IDS) {
      for (const tick of [0, 7, 19, 40]) {
        const pixels = at(place, 64, tick, tick % 2 === 0 ? 12 : 23)
        // From just past the prop slot to just before the desk: nothing painted.
        const { shelfLeft = 0, deskLeft } = layoutFor(64)
        expect(new Set(region(pixels, 64, shelfLeft + 8, 0, deskLeft, GROUND_Y)).size).toBe(1)
        // The line, crossed by the desk legs (the library's floor is the legs' own dark wood).
        expect(new Set(region(pixels, 64, 0, GROUND_Y, 64, GROUND_Y + 1)).size).toBeLessThanOrEqual(2)
        expect(region(pixels, 64, 0, GROUND_Y, 64, GROUND_Y + 1).includes(-1)).toBe(false)
        expect(new Set(region(pixels, 64, 36, GROUND_Y + 1, 44, SCENE_HEIGHT))).toEqual(new Set([-1]))
        expect(pixels.includes(FUR)).toBe(false)
      }
    }
  })

  test('the prop stands in the shelf\'s spot, and its moving part moves', async () => {
    const { shelfLeft = 0 } = layoutFor(64)
    for (const place of PLACE_IDS) {
      const slot = (tick: number) => region(at(place, 64, tick, 12), 64, shelfLeft, 0, shelfLeft + 9, GROUND_Y)
      expect(slot(0).some(pixel => pixel !== -1)).toBe(true)
    }
    const moving = (place: PlaceId) => [0, 6, 12, 18, 24].map(tick => region(at(place, 64, tick, 12), 64, shelfLeft, 0, shelfLeft + 9, GROUND_Y).join(','))
    for (const place of ['house', 'gym', 'forest', 'space', 'library'] as const) expect(new Set(moving(place)).size).toBeGreaterThan(1)
  })
})
