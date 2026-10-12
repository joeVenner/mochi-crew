import { Html5Audio, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'

import doneSound from '../../../plugins/mochi-crew/sounds/done.wav'
import { PixelScene } from '../PixelScene'
import type { MascotActivity, Turn } from '../plugin'
import { HOME_X, activityLabel, deskX } from '../plugin'
import { COLORS, seconds } from '../theme'
import { Backdrop, Caption, LINE_SIZE, Panel, StatusLine, typed } from '../ui'

const SCENE_WIDTH = 56
const PROMPT = 'fix the flaky checkout test'

/** When each beat of the turn lands, in seconds from the scene's start. */
const AT = { turn: 1.3, read: 2.0, edit: 3.1, test: 5.0, passed: 6.3, answer: 7.0 } as const

const ms = (secondsIn: number): number => secondsIn * 1000

/** What Mochi is doing at `now`, following the transcript beat by beat. */
const activityAt = (now: number): MascotActivity => {
  const desk = deskX(SCENE_WIDTH)
  if (now >= ms(AT.passed)) return { kind: 'done', file: 'src/checkout.ts', hasFailed: false, at: ms(AT.passed), x: desk }
  if (now >= ms(AT.test)) return { kind: 'using', gadget: 'hammer', detail: 'npm test', since: ms(AT.test), fromX: desk }
  if (now >= ms(AT.edit)) return { kind: 'editing', file: 'src/checkout.ts', tool: 'Edit', since: ms(AT.edit), fromX: HOME_X }
  if (now >= ms(AT.read)) return { kind: 'using', gadget: 'magnifier', detail: 'checkout.test.ts', since: ms(AT.read), fromX: HOME_X, verb: 'reading' }
  return { kind: 'idle', since: 0, fromX: HOME_X }
}

const turnAt = (now: number): Turn | null =>
  now < ms(AT.turn) ? null : { phase: 'working', turnId: 'promo', since: ms(AT.turn) }

type Line = { readonly at: number; readonly text: string; readonly color: string }

/** The transcript as Claude Code prints it: tool calls with a dot, results indented. */
const TRANSCRIPT: readonly Line[] = [
  { at: AT.read, text: '● Read(src/checkout.test.ts)', color: COLORS.text },
  { at: AT.read + 0.4, text: '  ⎿  Read 84 lines', color: COLORS.dim },
  { at: AT.edit, text: '● Update(src/checkout.ts)', color: COLORS.text },
  { at: AT.edit + 0.4, text: '  ⎿  Updated with 3 additions', color: COLORS.dim },
  { at: AT.test, text: '● Bash(npm test)', color: COLORS.text },
  { at: AT.passed, text: '  ⎿  42 passed (1.9s)', color: COLORS.good },
  { at: AT.answer, text: '● Fixed: the test waited on a real timer.', color: COLORS.text },
]

/** A real turn, side by side: the transcript on the left, Mochi acting it out in the pane. */
export const Session = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const activity = activityAt(now)
  const turn = turnAt(now)
  const isWorking = turn !== null && now < ms(AT.passed)
  return (
    <Backdrop>
      <Caption title="It reacts to your real session" subtitle="every move comes from an actual event: edits, commands, reads, results" />
      <div style={{ position: 'absolute', top: 330, left: 110, right: 110, display: 'flex', gap: 56, alignItems: 'flex-start' }}>
        <Panel title="claude" style={{ flex: 1, height: 560 }}>
          <div style={{ fontSize: LINE_SIZE, lineHeight: 1.7, whiteSpace: 'pre' }}>
            <div>
              <span style={{ color: COLORS.accent }}>{'> '}</span>
              {typed(PROMPT, frame - seconds(0.2), 0.9)}
            </div>
            <div style={{ height: 18 }} />
            {TRANSCRIPT.filter(line => now >= ms(line.at)).map(line => (
              <div key={line.text} style={{ color: line.color }}>{line.text}</div>
            ))}
            {isWorking ? <div style={{ color: COLORS.accent, marginTop: 10 }}>✻ Working…</div> : null}
          </div>
        </Panel>
        <Panel title="Mochi" style={{ width: SCENE_WIDTH * 12 + 60 }}>
          <PixelScene
            now={now}
            width={SCENE_WIDTH}
            scale={12}
            input={{ activity, workers: [], outfit: 'classic', hour: 21, feeling: 'happy', reaction: null, bug: null, turn }}
          />
          <div style={{ marginTop: 18 }}>
            <StatusLine text={activityLabel(activity, now, isWorking)} />
          </div>
        </Panel>
      </div>
      <Sequence from={seconds(AT.passed)} durationInFrames={seconds(1.5)}>
        <Html5Audio src={doneSound} volume={0.6} />
      </Sequence>
    </Backdrop>
  )
}
