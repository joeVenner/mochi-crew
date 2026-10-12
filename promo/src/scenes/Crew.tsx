import { Html5Audio, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'

import joinSound from '../../../plugins/mochi-crew/sounds/join.wav'
import { PixelScene } from '../PixelScene'
import type { Turn, Worker } from '../plugin'
import { HOME_X } from '../plugin'
import { seconds } from '../theme'
import { Backdrop, Caption, Panel, Rule, StatusLine, WorkerLine } from '../ui'

const SCENE_WIDTH = 64

/** Three subagents a real review turn starts; their types pick the costumes. */
const CREW: readonly Worker[] = [
  { id: 'agent-tests', type: 'test-engineer', description: 'cover the checkout edge cases', doing: 'run npm test', lastKind: 'tool', activeCalls: 1, joinedAt: 500 },
  { id: 'agent-sec', type: 'security-auditor', description: 'audit the session cookie', doing: 'look auth.ts', lastKind: 'tool', activeCalls: 1, joinedAt: 1500 },
  { id: 'agent-explore', type: 'Explore', description: 'find every caller of charge()', doing: 'web OWASP session guide', lastKind: 'tool', activeCalls: 1, joinedAt: 2500 },
]

const TURN: Turn = { phase: 'working', turnId: 'promo', since: 0 }

/** Subagents walk in one by one as kittens in role costumes, each with its own HUD row. */
export const Crew = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const onStage = CREW.filter(worker => now >= worker.joinedAt)
  return (
    <Backdrop>
      <Caption title="Subagents join the crew" subtitle="each one walks in as a kitten in a costume picked from its type" />
      <div style={{ position: 'absolute', top: 320, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
        <Panel title="Mochi" style={{ width: SCENE_WIDTH * 12 + 60 }}>
          <PixelScene
            now={now}
            width={SCENE_WIDTH}
            scale={12}
            input={{ activity: { kind: 'idle', since: 0, fromX: HOME_X }, workers: onStage, outfit: 'classic', hour: 21, feeling: 'happy', reaction: null, bug: null, turn: TURN }}
          />
          <div style={{ marginTop: 18 }}>
            <StatusLine text={`thinking · crew of ${onStage.length}`} />
            <Rule width={44} />
            {onStage.map(worker => <WorkerLine key={worker.id} worker={worker} />)}
          </div>
        </Panel>
      </div>
      {CREW.map(worker => (
        <Sequence key={worker.id} from={Math.round((worker.joinedAt / 1000) * fps)} durationInFrames={seconds(1)}>
          <Html5Audio src={joinSound} volume={0.5} />
        </Sequence>
      ))}
    </Backdrop>
  )
}
