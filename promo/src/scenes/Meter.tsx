import { Easing, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import { PixelScene } from '../PixelScene'
import type { MeterView } from '../plugin'
import { HOME_X, meterRows } from '../plugin'
import { COLORS, seconds } from '../theme'
import { Backdrop, Caption, HudLine, Panel, Rule, StatusLine } from '../ui'

const SCENE_WIDTH = 56
const BAR_WIDTH = 20
const PROVIDERS = ['Claude plan', 'API key', 'Bedrock', 'Vertex AI', 'Microsoft Foundry', 'gateways']

/** The meter as a long session leaves it: everything grows from zero to these as the scene plays. */
const FINAL = { tokens: 620_000, percent: 62, fiveHour: 34, sevenDay: 12, cacheRead: 910_000 } as const

/** The meter view `fill` (0–1) of the way to FINAL, built just as the plugin builds it from a session. */
const viewAt = (fill: number, idleMs: number): MeterView => ({
  modelId: 'claude-opus-5-5',
  provider: 'subscription',
  measure: {
    tokens: Math.round(FINAL.tokens * fill),
    window: 1_000_000,
    percent: FINAL.percent * fill,
    limits: [
      { kind: 'five_hour', percentUsed: FINAL.fiveHour * fill },
      { kind: 'seven_day', percentUsed: FINAL.sevenDay * fill },
    ],
  },
  cache: { turns: 12, read: Math.round(FINAL.cacheRead * fill), write: 60_000, uncached: 30_000, output: 9_000 },
  idleMs,
  isCold: false,
})

/** The session meter filling under the room, rendered by the plugin's own meter rows. */
export const Meter = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const fill = interpolate(frame, [seconds(0.5), seconds(3.2)], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  // Idle counts up once the meter has filled, as it does between your prompts.
  const idleMs = Math.max(0, now - 3_000) * 40
  const rows = meterRows(viewAt(fill, idleMs), BAR_WIDTH)
  const providerIndex = Math.min(PROVIDERS.length - 1, Math.max(0, Math.floor((frame - seconds(2.4)) / seconds(0.45))))
  return (
    <Backdrop>
      <Caption title="A session meter, built in" subtitle="model, context, prompt cache, and plan limits or cost" />
      <div style={{ position: 'absolute', top: 300, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 64, alignItems: 'center' }}>
        <Panel title="Mochi" style={{ width: SCENE_WIDTH * 12 + 60 }}>
          <PixelScene
            now={now}
            width={SCENE_WIDTH}
            scale={12}
            input={{ activity: { kind: 'idle', since: 0, fromX: HOME_X }, workers: [], outfit: 'classic', hour: 21, feeling: 'happy', reaction: null, bug: null, turn: null }}
          />
          <div style={{ marginTop: 18 }}>
            <StatusLine text="your turn · took 42s" />
            <Rule width={44} />
            {rows.map(row => <HudLine key={row.key} cells={row.cells} />)}
          </div>
        </Panel>
        <div style={{ width: 480 }}>
          <div style={{ fontSize: 30, color: COLORS.dim, marginBottom: 24 }}>knows where it runs</div>
          {PROVIDERS.map((name, index) => {
            const opacity = interpolate(frame - seconds(2.4) - index * seconds(0.45), [0, 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
            return (
              <div key={name} style={{ fontSize: 38, lineHeight: 1.6, opacity, color: index === providerIndex ? COLORS.fur : COLORS.text }}>
                <span style={{ color: COLORS.accent }}>{'▍ '}</span>{name}
              </div>
            )
          })}
        </div>
      </div>
    </Backdrop>
  )
}
