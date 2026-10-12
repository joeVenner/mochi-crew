import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

import { PixelScene } from '../PixelScene'
import { HOME_X, activeReaction } from '../plugin'
import { COLORS, PIXEL, seconds } from '../theme'
import { Backdrop, typed } from '../ui'

const SCENE_WIDTH = 56
const TITLE = 'MOCHI CREW'
// Mochi dances as the name starts typing; the plugin draws a reaction only once it has begun.
const DANCE_AT_MS = 1000

/** Mochi pops in at home, then the name types out under the room. */
export const Intro = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const pop = spring({ frame, fps, config: { damping: 14, mass: 0.8 } })
  const titleFrame = frame - seconds(1)
  const taglineOpacity = interpolate(frame, [seconds(2.1), seconds(2.6)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <Backdrop>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 56 }}>
        <div style={{ transform: `scale(${0.6 + pop * 0.4})`, opacity: pop, borderRadius: 18, overflow: 'hidden', border: `3px solid ${COLORS.border}` }}>
          <PixelScene
            now={now}
            width={SCENE_WIDTH}
            scale={14}
            input={{ activity: { kind: 'idle', since: 0, fromX: HOME_X }, workers: [], outfit: 'classic', hour: 21, feeling: 'happy', reaction: now >= DANCE_AT_MS ? activeReaction({ kind: 'dance', at: DANCE_AT_MS }, now) : null, bug: null, turn: null }}
          />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: PIXEL, fontSize: 72, color: COLORS.fur, minHeight: 80 }}>
            {typed(TITLE, titleFrame, 0.5)}
          </div>
          <div style={{ marginTop: 28, fontSize: 34, color: COLORS.dim, opacity: taglineOpacity }}>
            a pixel cat that lives in your Claude Code side pane
          </div>
        </div>
      </div>
    </Backdrop>
  )
}
