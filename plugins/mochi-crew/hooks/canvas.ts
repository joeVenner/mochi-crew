/**
 * A pixel canvas and its terminal encoding. Each terminal cell shows two
 * stacked pixels (`▀` with the top pixel as foreground, the bottom as
 * background), so a W × H canvas fills W columns × H/2 rows.
 */
export const TRANSPARENT = -1
const DEFAULT_COLOR = 0x01000000

/** A pixel buffer local to one frame's composition; colors are 0xRRGGBB or TRANSPARENT. */
export type Canvas = { readonly width: number; readonly height: number; readonly pixels: Int32Array }

/** A sprite: equal-length rows of palette keys, `.` (or any unknown key) for transparent. */
export type Sprite = readonly string[]
export type Palette = Readonly<Record<string, number>>

export const createCanvas = (width: number, height: number): Canvas => ({
  width,
  height,
  pixels: new Int32Array(width * height).fill(TRANSPARENT),
})

export const plotColor = (canvas: Canvas, x: number, y: number, color: number): void => {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return
  canvas.pixels[y * canvas.width + x] = color
}

export const fillColor = (canvas: Canvas, left: number, top: number, width: number, height: number, color: number): void => {
  for (let y = top; y < top + height; y += 1) for (let x = left; x < left + width; x += 1) plotColor(canvas, x, y, color)
}

export const stampSprite = (canvas: Canvas, sprite: Sprite, left: number, top: number, palette: Palette): void =>
  sprite.forEach((row, y) =>
    [...row].forEach((key, x) => {
      const color = palette[key]
      if (color !== undefined) plotColor(canvas, left + x, top + y, color)
    }),
  )

/** Blends two 0xRRGGBB colors; `amount` 0 keeps `from`, 1 gives `to`. */
export const mix = (from: number, to: number, amount: number): number => {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff
    const b = (to >> shift) & 0xff
    return Math.round(a + (b - a) * amount) & 0xff
  }
  return (channel(16) << 16) | (channel(8) << 8) | channel(0)
}

const UPPER_HALF = 0x2580 // ▀
const LOWER_HALF = 0x2584 // ▄
const FULL_BLOCK = 0x2588 // █
const SPACE = 0x20

/** The [codePoint, foreground, background] cell showing two stacked pixels. */
export const halfBlockCell = (top: number, bottom: number): readonly [number, number, number] => {
  if (top === TRANSPARENT && bottom === TRANSPARENT) return [SPACE, DEFAULT_COLOR, DEFAULT_COLOR]
  if (bottom === TRANSPARENT) return [UPPER_HALF, top, DEFAULT_COLOR]
  if (top === TRANSPARENT) return [LOWER_HALF, bottom, DEFAULT_COLOR]
  if (top === bottom) return [FULL_BLOCK, top, DEFAULT_COLOR]
  return [UPPER_HALF, top, bottom]
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64; written here so the module needs no host encoder. */
export const toBase64 = (bytes: Uint8Array): string => {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const triple = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += BASE64[(triple >> 18) & 63]
    out += BASE64[(triple >> 12) & 63]
    out += i + 1 < bytes.length ? BASE64[(triple >> 6) & 63] : '='
    out += i + 2 < bytes.length ? BASE64[triple & 63] : '='
  }
  return out
}

/**
 * Packs a canvas as Raster `cells`: per cell the little-endian u32 triplet
 * [codePoint, foreground, background], row-major, base64-encoded.
 */
export const encodeCanvas = (canvas: Canvas): string => {
  const rows = Math.ceil(canvas.height / 2)
  const bytes = new Uint8Array(canvas.width * rows * 12)
  const view = new DataView(bytes.buffer)
  for (let row = 0; row < rows; row += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const top = canvas.pixels[2 * row * canvas.width + x] ?? TRANSPARENT
      const bottom = canvas.pixels[(2 * row + 1) * canvas.width + x] ?? TRANSPARENT
      const offset = (row * canvas.width + x) * 12
      halfBlockCell(top, bottom).forEach((word, i) => view.setUint32(offset + i * 4, word, true))
    }
  }
  return toBase64(bytes)
}
