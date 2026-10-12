/**
 * The one place the promo reaches into the plugin. Mochi, the crew and the meter rows come
 * from the plugin's own pure code, so the video always shows the real thing, not a copy.
 */
export { sceneFor } from '../../plugins/mochi-crew/hooks/sprite'
export type { SceneInput } from '../../plugins/mochi-crew/hooks/sprite'
export { TRANSPARENT } from '../../plugins/mochi-crew/hooks/canvas'
export { SCENE_HEIGHT } from '../../plugins/mochi-crew/hooks/world'
export { meterRows } from '../../plugins/mochi-crew/hooks/meterRows'
export type { MeterView, Tone } from '../../plugins/mochi-crew/hooks/meterRows'
export { gutter } from '../../plugins/mochi-crew/hooks/hud'
export { ROLE_INFO, roleFor } from '../../plugins/mochi-crew/hooks/roles'
export type { MascotActivity, Worker } from '../../plugins/mochi-crew/types'
export { hatOf } from '../../plugins/mochi-crew/hooks/crew'
export { activityLabel, workerNote } from '../../plugins/mochi-crew/hooks/mascot'
export { HOME_X, deskX } from '../../plugins/mochi-crew/hooks/behavior'
export type { Reaction, Turn } from '../../plugins/mochi-crew/types'
export { activeReaction } from '../../plugins/mochi-crew/hooks/care'
