/** A badge Mochi's crew can earn; unlocked ids are saved in the store. */
export type Achievement = { id: AchievementId; title: string; how: string }

export type AchievementId = 'first-hire' | 'full-crew' | 'combo-10' | 'night-owl' | 'bug-squasher' | 'level-5'

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-hire', title: 'First Hire', how: 'Delegate to a subagent' },
  { id: 'full-crew', title: 'Full Crew', how: 'Have 3 workers on stage at once' },
  { id: 'combo-10', title: 'On Fire', how: 'Reach a combo of 10 clean edits' },
  { id: 'night-owl', title: 'Night Owl', how: 'Edit between midnight and 4 am' },
  { id: 'bug-squasher', title: 'Bug Squasher', how: 'Fix a failing command' },
  { id: 'level-5', title: 'Veteran', how: 'Reach level 5' },
]

/** What just happened, as far as achievements care; every field is optional. */
export type Facts = {
  hasHired?: boolean
  crewSize?: number
  combo?: number
  /** Local hour of an edit. */
  editHour?: number
  hasSquashed?: boolean
  level?: number
}

const EARNED: Readonly<Record<AchievementId, (facts: Facts) => boolean>> = {
  'first-hire': facts => facts.hasHired === true,
  'full-crew': facts => (facts.crewSize ?? 0) >= 3,
  'combo-10': facts => (facts.combo ?? 0) >= 10,
  'night-owl': facts => facts.editHour !== undefined && facts.editHour >= 0 && facts.editHour < 4,
  'bug-squasher': facts => facts.hasSquashed === true,
  'level-5': facts => (facts.level ?? 0) >= 5,
}

/** The achievements these facts earn that were not unlocked before, in list order. */
export const newlyUnlocked = (unlocked: readonly string[], facts: Facts): Achievement[] =>
  ACHIEVEMENTS.filter(achievement => !unlocked.includes(achievement.id) && EARNED[achievement.id](facts))

const KNOWN_IDS: ReadonlySet<string> = new Set(ACHIEVEMENTS.map(achievement => achievement.id))

/** Reads unlocked ids saved in the store, keeping only known ones, once each. */
export const parseUnlocked = (saved: unknown): string[] =>
  Array.isArray(saved) ? [...new Set(saved.filter((id): id is string => typeof id === 'string' && KNOWN_IDS.has(id)))] : []

/** `/mascot achievements`: every badge, earned ones checked. */
export const achievementList = (unlocked: readonly string[]): string =>
  [
    `Badges ${ACHIEVEMENTS.filter(({ id }) => unlocked.includes(id)).length}/${ACHIEVEMENTS.length}`,
    ...ACHIEVEMENTS.map(({ id, title, how }) => `  ${unlocked.includes(id) ? '[x]' : '[ ]'} ${title} — ${how}`),
  ].join('\n')
