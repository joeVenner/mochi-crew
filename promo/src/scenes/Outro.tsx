import { Html5Audio, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

import levelUpSound from '../../../plugins/mochi-crew/sounds/levelup.wav'
import { PixelScene } from '../PixelScene'
import type { Reaction } from '../plugin'
import { HOME_X, activeReaction } from '../plugin'
import { COLORS, EFFECT_VOLUME, PIXEL, seconds } from '../theme'
import { Backdrop, LINE_SIZE, Panel, typed } from '../ui'

const SCENE_WIDTH = 56

/** Hearts first, then a dance: the plugin's own reactions, so the party hat stays in view. */
const reactionAt = (now: number): Reaction | null =>
  activeReaction(now < 2500 ? { kind: 'pet', at: 0 } : { kind: 'dance', at: 2500 }, now)

/** Word for word from the README's Install section. */
const INSTALL = ['/plugin marketplace add joeVenner/mochi-crew', '/plugin install mochi-crew@mochi-crew'] as const

/** Mochi celebrates while the two install commands type out, then the repository link. */
export const Outro = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const pop = spring({ frame, fps, config: { damping: 12 } })
  const linkOpacity = interpolate(frame, [seconds(2.6), seconds(3.1)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const secondLineStart = seconds(0.6) + Math.ceil(INSTALL[0].length / 1.6)
  return (
    <Backdrop>
      <Html5Audio src={levelUpSound} volume={EFFECT_VOLUME} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 80 }}>
        <div style={{ transform: `scale(${pop})`, borderRadius: 18, overflow: 'hidden', border: `3px solid ${COLORS.border}` }}>
          <PixelScene
            now={now}
            width={SCENE_WIDTH}
            scale={11}
            input={{ activity: { kind: 'idle', since: 0, fromX: HOME_X }, workers: [], outfit: 'party', hour: 21, feeling: 'happy', reaction: reactionAt(now), bug: null, turn: null }}
          />
        </div>
        <div style={{ width: 860 }}>
          <div style={{ fontFamily: PIXEL, fontSize: 64, color: COLORS.fur }}>MOCHI CREW</div>
          <div style={{ marginTop: 20, marginBottom: 48, fontSize: 32, color: COLORS.dim }}>free · open source · for Claude Code</div>
          <Panel title="claude">
            <div style={{ fontSize: LINE_SIZE + 2, lineHeight: 1.8, whiteSpace: 'pre' }}>
              <div><span style={{ color: COLORS.accent }}>{'> '}</span>{typed(INSTALL[0], frame - seconds(0.6), 1.6)}</div>
              <div><span style={{ color: COLORS.accent }}>{'> '}</span>{typed(INSTALL[1], frame - secondLineStart, 1.6)}</div>
            </div>
          </Panel>
          <div style={{ marginTop: 40, fontSize: 34, color: COLORS.text, opacity: linkOpacity }}>github.com/joeVenner/mochi-crew</div>
          <div style={{ marginTop: 18, fontSize: 22, color: COLORS.dim, opacity: linkOpacity }}>voice: AI-generated</div>
        </div>
      </div>
    </Backdrop>
  )
}
