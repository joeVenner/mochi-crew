/** The costume a worker cat wears, chosen from its subagent type. */
export type Role = 'police' | 'swat' | 'lab' | 'detective' | 'architect' | 'librarian' | 'nerd' | 'builder'

/** A role's three-letter HUD tag and its title. */
export type RoleInfo = { tag: string; title: string }

export const ROLE_INFO: Readonly<Record<Role, RoleInfo>> = {
  police: { tag: 'AUD', title: 'Auditor' },
  swat: { tag: 'SEC', title: 'Security' },
  lab: { tag: 'TST', title: 'Tester' },
  detective: { tag: 'EXP', title: 'Explorer' },
  architect: { tag: 'ARC', title: 'Architect' },
  librarian: { tag: 'DOC', title: 'Guide' },
  nerd: { tag: 'DEV', title: 'Coder' },
  builder: { tag: 'WRK', title: 'Worker' },
}

/**
 * Ordered rules: the first whose words appear in the type wins. Order matters
 * (`code-reviewer` is an auditor, not a coder; `security-auditor` is SWAT).
 */
const ROLE_RULES: ReadonlyArray<readonly [Role, readonly string[]]> = [
  ['swat', ['security', 'secur', 'pentest']],
  ['police', ['review', 'verif', 'audit', 'lint', 'qa', 'check']],
  ['lab', ['test']],
  ['librarian', ['guide', 'doc', 'librar', 'writer']],
  ['detective', ['explore', 'search', 'research', 'investig', 'scout']],
  ['architect', ['plan', 'architect', 'design']],
  ['nerd', ['general', 'code', 'coder', 'dev', 'engineer', 'build', 'implement', 'fork']],
]

export const roleFor = (subagentType: string): Role => {
  const type = subagentType.toLowerCase()
  for (const [role, words] of ROLE_RULES) {
    if (words.some(word => type.includes(word))) return role
  }
  return 'builder'
}
