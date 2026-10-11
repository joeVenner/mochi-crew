import type { Journal } from '../types'

/** XP for finishing a mission; each pays once per session. */
export const XP_PER_MISSION = 20

export type MissionId = 'ship-3' | 'green' | 'squash' | 'delegate'

/** A session goal measured on the journal: `target` of whatever `progress` counts. */
export type Mission = {
  id: MissionId
  title: string
  target: number
  progress: (journal: Journal) => number
}

/** This session's goals, in the order the HUD suggests them. */
export const MISSIONS: readonly Mission[] = [
  { id: 'green', title: 'Get the tests green', target: 1, progress: journal => journal.greenRuns },
  { id: 'ship-3', title: 'Ship 3 turns', target: 3, progress: journal => journal.shipped },
  { id: 'squash', title: 'Fix a failing command', target: 1, progress: journal => journal.fixes },
  { id: 'delegate', title: 'Delegate to a subagent', target: 1, progress: journal => journal.hires },
]

const isMet = (mission: Mission, journal: Journal): boolean => mission.progress(journal) >= mission.target

/** Missions this journal completes that were not completed before, in list order. */
export const newlyCompleted = (done: readonly string[], journal: Journal): readonly Mission[] =>
  MISSIONS.filter(mission => !done.includes(mission.id) && isMet(mission, journal))

/** `2/3`, capped at the target. */
const progressText = (mission: Mission, journal: Journal): string =>
  `${Math.min(mission.progress(journal), mission.target)}/${mission.target}`

/** The HUD's "next" row: the next open mission (with its progress when it counts to more than 1). */
export const missionLine = (done: readonly string[], journal: Journal): string => {
  const next = MISSIONS.find(mission => !done.includes(mission.id))
  if (next === undefined) return 'All missions done'
  return `${next.title}${next.target > 1 ? ` (${progressText(next, journal)})` : ''}`
}

/** How many missions are done, as `1/4`. */
export const missionCount = (done: readonly string[]): string =>
  `${MISSIONS.filter(mission => done.includes(mission.id)).length}/${MISSIONS.length}`

/** The `/mascot missions` list. */
export const missionReport = (done: readonly string[], journal: Journal): string =>
  [
    `Missions this session (+${XP_PER_MISSION} XP each)`,
    ...MISSIONS.map(mission =>
      `  ${done.includes(mission.id) ? '[x]' : '[ ]'} ${mission.title}  ${progressText(mission, journal)}`,
    ),
  ].join('\n')
