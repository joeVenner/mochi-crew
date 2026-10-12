import type { CalculateMetadataFunction } from 'remotion'
import { Composition, Html5Audio, Sequence, Series, staticFile } from 'remotion'
import { getAudioDurationInSeconds } from '@remotion/media-utils'

import type { SceneId } from './narration'
import { voiceFile } from './narration'
import { Crew } from './scenes/Crew'
import { Files } from './scenes/Files'
import { Intro } from './scenes/Intro'
import { Meter } from './scenes/Meter'
import { Outro } from './scenes/Outro'
import { Session } from './scenes/Session'
import { FPS, HEIGHT, VOICE_LEAD_SECONDS, WIDTH, seconds } from './theme'
import { Fade } from './ui'

/** Breathing room after a scene's line before the cut. */
const VOICE_TAIL_SECONDS = 0.9

/** The cut, in order; `minimum` is the shortest each scene's animation needs, in seconds. */
const SCENES = [
  { id: 'intro', minimum: 4, Scene: Intro },
  { id: 'session', minimum: 8.5, Scene: Session },
  { id: 'crew', minimum: 5, Scene: Crew },
  { id: 'meter', minimum: 6, Scene: Meter },
  { id: 'files', minimum: 8, Scene: Files },
  { id: 'outro', minimum: 5, Scene: Outro },
] as const satisfies ReadonlyArray<{ readonly id: SceneId; readonly minimum: number; readonly Scene: () => JSX.Element }>

type Props = { readonly lengths: Readonly<Record<SceneId, number>> }

const MochiPromo = ({ lengths }: Props) => (
  <Series>
    {SCENES.map(({ id, Scene }) => (
      <Series.Sequence key={id} name={id} durationInFrames={lengths[id]}>
        <Fade>
          <Scene />
        </Fade>
        <Sequence from={seconds(VOICE_LEAD_SECONDS)} name={`${id} voice`}>
          <Html5Audio src={staticFile(voiceFile(id))} />
        </Sequence>
      </Series.Sequence>
    ))}
  </Series>
)

/** Each scene lasts as long as its line needs, never shorter than its animation. */
const fitToVoice: CalculateMetadataFunction<Props> = async () => {
  const entries = await Promise.all(
    SCENES.map(async ({ id, minimum }) => {
      const spoken = await getAudioDurationInSeconds(staticFile(voiceFile(id)))
      return [id, seconds(Math.max(minimum, VOICE_LEAD_SECONDS + spoken + VOICE_TAIL_SECONDS))] as const
    }),
  )
  const lengths = Object.fromEntries(entries) as Record<SceneId, number>
  return { durationInFrames: entries.reduce((sum, [, frames]) => sum + frames, 0), props: { lengths } }
}

/** Placeholder lengths for the studio's first paint; fitToVoice replaces them before anything renders. */
const DEFAULT_LENGTHS: Readonly<Record<SceneId, number>> = Object.fromEntries(SCENES.map(({ id, minimum }) => [id, seconds(minimum)])) as Record<SceneId, number>

export const Root = () => (
  <Composition
    id="MochiPromo"
    component={MochiPromo}
    durationInFrames={Object.values(DEFAULT_LENGTHS).reduce((sum, frames) => sum + frames, 0)}
    fps={FPS}
    width={WIDTH}
    height={HEIGHT}
    defaultProps={{ lengths: DEFAULT_LENGTHS }}
    calculateMetadata={fitToVoice}
  />
)
