import { Composition, Series } from 'remotion'

import { Crew } from './scenes/Crew'
import { Intro } from './scenes/Intro'
import { Meter } from './scenes/Meter'
import { Outro } from './scenes/Outro'
import { Session } from './scenes/Session'
import { FPS, HEIGHT, WIDTH, seconds } from './theme'
import { Fade } from './ui'

/** The cut, in order, with each scene's length in seconds. */
const SCENES = [
  { id: 'intro', length: 4, Scene: Intro },
  { id: 'session', length: 8.5, Scene: Session },
  { id: 'crew', length: 5, Scene: Crew },
  { id: 'meter', length: 6, Scene: Meter },
  { id: 'outro', length: 5, Scene: Outro },
] as const

const TOTAL_FRAMES = SCENES.reduce((sum, scene) => sum + seconds(scene.length), 0)

const MochiPromo = () => (
  <Series>
    {SCENES.map(({ id, length, Scene }) => (
      <Series.Sequence key={id} name={id} durationInFrames={seconds(length)}>
        <Fade>
          <Scene />
        </Fade>
      </Series.Sequence>
    ))}
  </Series>
)

export const Root = () => (
  <Composition id="MochiPromo" component={MochiPromo} durationInFrames={TOTAL_FRAMES} fps={FPS} width={WIDTH} height={HEIGHT} />
)
