import { useLayoutEffect, useRef } from 'react'

import type { SceneInput } from './plugin'
import { SCENE_HEIGHT, TRANSPARENT, sceneFor } from './plugin'

/** The plugin's animation step: one tick every 180 ms, as in the live pane. */
const TICK_MS = 180

/** The room's backdrop where the scene leaves a pixel empty, as a terminal's background would show. */
const EMPTY_PIXEL = 0x1a1523

type Props = {
  /** Clock time in ms; the tick follows from it, so walks and blinks keep the plugin's pace. */
  readonly now: number
  /** Everything else the frame depends on; `tick` and `now` are filled in. */
  readonly input: Omit<SceneInput, 'tick' | 'now' | 'width'>
  readonly width: number
  /** Screen pixels per scene pixel. */
  readonly scale: number
}

/**
 * One frame of Mochi's room, drawn by the plugin's own `sceneFor` and scaled up with hard
 * pixel edges. The terminal shows two pixels per cell; here each pixel is a square.
 */
export const PixelScene = ({ now, input, width, scale }: Props) => {
  const ref = useRef<HTMLCanvasElement>(null)

  useLayoutEffect(() => {
    const context = ref.current?.getContext('2d')
    if (context === null || context === undefined) return
    const canvas = sceneFor({ ...input, width, now, tick: Math.floor(now / TICK_MS) })
    const image = context.createImageData(canvas.width, canvas.height)
    canvas.pixels.forEach((pixel, index) => {
      const color = pixel === TRANSPARENT ? EMPTY_PIXEL : pixel
      image.data[index * 4] = (color >> 16) & 0xff
      image.data[index * 4 + 1] = (color >> 8) & 0xff
      image.data[index * 4 + 2] = color & 0xff
      image.data[index * 4 + 3] = 0xff
    })
    context.putImageData(image, 0, 0)
  }, [now, input, width])

  return (
    <canvas
      ref={ref}
      width={width}
      height={SCENE_HEIGHT}
      style={{ width: width * scale, height: SCENE_HEIGHT * scale, imageRendering: 'pixelated', display: 'block' }}
    />
  )
}
