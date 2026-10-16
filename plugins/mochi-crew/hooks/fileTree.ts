import type { FolderToggles, GitMark, TouchedFile, TreeEntry, TreeFocus, TreeSnapshot, WorktreeSnapshot } from '../types'
import { fileName } from './mascot'

/** Entries an expanded folder shows before folding the rest into a `… N more` row. */
export const MAX_ENTRIES_PER_DIR = 12
/** The tree needs this many rows to be worth drawing; fewer, and it folds into one line. */
export const MIN_TREE_ROWS = 4
/** Touched files remembered; older ones fold their folders closed again. */
export const MAX_TOUCHED = 40
/** Linked worktrees drawn at most; past this the rest are left out. */
export const MAX_WORKTREES = 8
/** Branch names cut to this many cells on a worktree's row. */
const MAX_DETAIL = 24
/** Folders never opened, however a path inside them was touched. */
const NEVER_OPENED: ReadonlySet<string> = new Set(['.git', 'node_modules'])

// Control characters (C0, DEL, C1) and bidi or line separators: a file name holding them could
// drive the terminal (an escape sequence) or reorder what the row shows.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g

/** Text from disk, git or a tool call made safe to draw: each control character becomes `?`. */
export const safeText = (text: string): string => text.replace(UNSAFE_TEXT, '?')

/** How a row is drawn: the live file, a subagent's file, one touched earlier, or a plain or dim one. */
export type RowTone = 'active' | 'worker' | 'touched' | 'plain' | 'dim'

/** One line of the drawn tree. */
export type TreeRow = {
  /** A stable address within its root: the path, `more:<dir>` for a fold, `''` for a worktree's own row. */
  readonly key: string
  /** `root` is a linked worktree's own row, which opens or closes its section. */
  readonly kind: 'dir' | 'file' | 'more' | 'root'
  readonly depth: number
  /** The entry's name, `… N more` for a fold, or the worktree's folder name. */
  readonly name: string
  /** The linked worktree the row lies in (its path, as git lists it); unset in the session's own tree. */
  readonly worktree?: string
  /** Shown after the name on a worktree's row: its branch. */
  readonly detail?: string
  readonly isOpen: boolean
  readonly tone: RowTone
  /** The file's own git mark; for a folder, `M` when anything below it changed. */
  readonly mark?: GitMark
  /** Changed files below a folder (the folder's `M:k`). */
  readonly changes: number
  /** Lines added: the file's, or summed below a folder. */
  readonly added: number
  /** Set on a subagent's row, for its hat color. */
  readonly workerId?: string
  /** Set on the live row: what the main loop is doing to it. */
  readonly activeKind?: TreeFocus['kind']
}

/** Whether a root is spelled the Windows way: a drive (`C:\`) or a share (`\\server\`). */
export const isWindowsRoot = (root: string): boolean => /^(?:[A-Za-z]:[\\/]|\\\\)/.test(root)

/**
 * A path made relative to `root`, or undefined when it lies outside it. Absolute or relative
 * input; `.` and `..` are resolved by spelling alone, so `a/../../x` is outside. Under a Windows
 * root, `\` separates too and the root matches in any case, as the file system does; a
 * drive-relative part (`D:x`) is refused.
 */
export const relativeTo = (root: string, path: string): string | undefined => {
  const isWindows = isWindowsRoot(root)
  const slashed = (text: string): string => (isWindows ? text.replace(/\\/g, '/') : text)
  const base = slashed(root).replace(/\/+$/, '')
  const given = slashed(path)
  const isAbsolute = given.startsWith('/') || (isWindows && /^[A-Za-z]:\//.test(given))
  const head = given.slice(0, base.length)
  const isUnderBase = (isWindows ? head.toLowerCase() === base.toLowerCase() : head === base)
    && (given.length === base.length || given[base.length] === '/')
  if (isAbsolute && !isUnderBase) return undefined
  const rest = isAbsolute ? given.slice(base.length) : given
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (isWindows && /^[A-Za-z]:/.test(part)) return undefined
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

/** Whether a path is absolute: rooted at `/`, on a drive, or on a network share. */
export const isAbsolutePath = (path: string): boolean => path.startsWith('/') || isWindowsRoot(path)

/** Whether two absolute paths name the same folder: case-blind and either slash under Windows. */
export const isSamePath = (a: string, b: string): boolean => {
  const isWindows = isWindowsRoot(a) || isWindowsRoot(b)
  const plain = (path: string): string => {
    const trimmed = (isWindows ? path.replace(/\\/g, '/') : path).replace(/\/+$/, '')
    return isWindows ? trimmed.toLowerCase() : trimmed
  }
  return plain(a) === plain(b)
}

/** Whether an already resolved real path lies strictly inside the resolved root. */
export const isInside = (root: string, real: string): boolean => {
  const isWindows = isWindowsRoot(root)
  const given = isWindows ? real.replace(/\\/g, '/') : real
  const isAbsolute = given.startsWith('/') || (isWindows && /^[A-Za-z]:\//.test(given))
  return root.replace(/[\\/]+$/, '') !== '' && isAbsolute && relativeTo(root, real) !== undefined
}

/** The folders that hold `path`, outermost first, the root `''` included. */
export const ancestorsOf = (path: string): readonly string[] => {
  const parts = path.split('/').slice(0, -1)
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))]
}

/** The folders drawn open: the session's own, then the person's toggles over them. */
export const openFolders = (auto: ReadonlySet<string>, toggles: FolderToggles): ReadonlySet<string> => {
  const open = new Set(auto)
  for (const [path, isOpen] of Object.entries(toggles)) {
    if (isOpen) open.add(path)
    else open.delete(path)
  }
  return open
}

/** A click on a folder row: an open one closes, a closed one opens. */
export const toggleFolder = (toggles: FolderToggles, path: string, isOpen: boolean): FolderToggles =>
  ({ ...toggles, [path]: !isOpen })

/** An edit inside a folder the person closed opens it again, so new work is never hidden. */
export const reopenFor = (toggles: FolderToggles, path: string): FolderToggles => {
  const holders = new Set(ancestorsOf(path))
  const kept = Object.entries(toggles).filter(([dir, isOpen]) => isOpen || !holders.has(dir))
  return kept.length === Object.keys(toggles).length ? toggles : Object.fromEntries(kept)
}

/** The open folders the tree can reach: each one's holders are open too, so it is drawn. */
export const reachableFolders = (open: ReadonlySet<string>): readonly string[] =>
  [...open].filter(dir => ancestorsOf(dir).every(holder => open.has(holder)))

/**
 * A tool's path in the disk's own spelling when the two differ only in case: Windows opens
 * `SRC\App.ts` for `src\App.ts`, but the tree's listings and git name it the disk's way.
 */
export const diskSpelling = (spelled: string, onDisk: string | undefined): string =>
  onDisk !== undefined && onDisk.toLowerCase() === spelled.toLowerCase() ? onDisk : spelled

/** Whether a path may open folders: nothing under `.git` or `node_modules`. */
const isOpenable = (path: string): boolean => !path.toLowerCase().split('/').some(part => NEVER_OPENED.has(part))

/** The folders to list and draw open: the root and every folder on the way to a touched or live file. */
export const expandedDirs = (paths: readonly string[]): ReadonlySet<string> => {
  const dirs = new Set<string>([''])
  for (const path of paths) {
    if (!isOpenable(path)) continue
    for (const dir of ancestorsOf(path)) dirs.add(dir)
  }
  return dirs
}

/** Entries kept per folder listing: past this a folder is generated or vendored, not browsed. */
export const MAX_LISTED = 2000

/** A listing as the tree keeps it: folders first, then names in a case-blind order, capped. */
export const toEntries = (listing: readonly { name: string; kind: 'file' | 'dir' | 'other' }[]): readonly TreeEntry[] =>
  listing
    .map(entry => ({ name: entry.name, isDir: entry.kind === 'dir' }))
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
    .slice(0, MAX_LISTED)

/** A repo-relative git path made relative to the session root (`prefix` is `git rev-parse --show-prefix`). */
const underPrefix = (path: string, prefix: string): string | undefined =>
  prefix === '' ? path : path.startsWith(prefix) ? path.slice(prefix.length) || undefined : undefined

/** One porcelain status pair as a single mark. */
const markOf = (xy: string): GitMark => {
  if (xy === '??') return '?'
  if (xy.includes('D')) return 'D'
  if (xy.includes('R') || xy.includes('C')) return 'R'
  if (xy.includes('A')) return 'A'
  return 'M'
}

/**
 * Parses `git status --porcelain=v1 -z` into a mark per file under the session root. A rename
 * or copy carries its old path as the next field, which is skipped.
 */
export const parseGitStatus = (output: string, prefix = ''): Readonly<Record<string, GitMark>> => {
  const marks: Record<string, GitMark> = {}
  const fields = output.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? ''
    if (field.length < 4) continue
    const xy = field.slice(0, 2)
    const path = underPrefix(field.slice(3), prefix)
    if (xy.includes('R') || xy.includes('C')) index += 1
    if (path === undefined || path.endsWith('/')) continue
    marks[path] = markOf(xy)
  }
  return marks
}

/**
 * Parses `git diff --numstat -z` into lines added per file under the session root. A binary
 * file (`-`) counts 0; a rename's empty path field is followed by its old and new paths.
 */
export const parseNumstat = (output: string, prefix = ''): Readonly<Record<string, number>> => {
  const added: Record<string, number> = {}
  const fields = output.split('\0')
  for (let index = 0; index < fields.length; index += 1) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[index] ?? '')
    if (match === null) continue
    let path = match[3] ?? ''
    if (path === '') {
      // Rename: old path, then new path.
      path = fields[index + 2] ?? ''
      index += 2
    }
    const relative = underPrefix(path, prefix)
    if (relative === undefined) continue
    added[relative] = match[1] === '-' ? 0 : Number(match[1])
  }
  return added
}

/** The latest touch per file: a later main-loop touch clears an earlier worker's claim. */
const touchIndex = (touched: readonly TouchedFile[]): ReadonlyMap<string, TouchedFile> =>
  new Map(touched.map(file => [file.path, file]))

/** Changed files and added lines below each folder, the root's included. */
const rollUp = (snapshot: TreeSnapshot): ReadonlyMap<string, { changes: number; added: number }> => {
  const totals = new Map<string, { changes: number; added: number }>()
  for (const [path, mark] of Object.entries(snapshot.marks)) {
    const lines = mark === 'D' ? 0 : snapshot.added[path] ?? 0
    for (const dir of ancestorsOf(path)) {
      const total = totals.get(dir) ?? { changes: 0, added: 0 }
      totals.set(dir, { changes: total.changes + 1, added: total.added + lines })
    }
  }
  return totals
}

/** Everything the rows are drawn from. */
export type TreeInput = {
  readonly snapshot: TreeSnapshot
  readonly focus: TreeFocus | null
  readonly touched: readonly TouchedFile[]
  readonly toggles?: FolderToggles
  readonly maxPerDir?: number
}

/** Edited files and every folder that holds one: what each folder lists first. */
const editedPaths = (touched: readonly TouchedFile[], focus: TreeFocus | null): ReadonlySet<string> => {
  const files = [...touched.map(file => file.path), ...(focus?.kind === 'edit' ? [focus.path] : [])].filter(isOpenable)
  return new Set([...files, ...files.flatMap(ancestorsOf)])
}

/**
 * The tree's rows, depth first: folders on the way to a touched or live file are open, every
 * other folder closed, unless the person toggled it. Each folder lists what leads to an edited file first, so the session's
 * work sits at the top of the tree. A folder longer than `maxPerDir` folds its tail into one
 * `… N more` row, but never hides a touched or live file.
 */
export const treeRows = ({ snapshot, focus, touched, toggles = {}, maxPerDir = MAX_ENTRIES_PER_DIR }: TreeInput): readonly TreeRow[] => {
  const touches = touchIndex(touched)
  const open = openFolders(expandedDirs([...touches.keys(), ...(focus === null ? [] : [focus.path])]), toggles)
  const edited = editedPaths(touched, focus)
  const totals = rollUp(snapshot)
  const rows: TreeRow[] = []

  const fileRow = (path: string, name: string, depth: number): TreeRow => {
    const touch = touches.get(path)
    const isActive = focus?.path === path
    const tone: RowTone = isActive ? 'active'
      : touch?.workerId !== undefined ? 'worker'
      : touch !== undefined ? 'touched'
      : name.startsWith('.') ? 'dim' : 'plain'
    const mark = snapshot.marks[path]
    return {
      key: path, kind: 'file', depth, name, isOpen: false, tone,
      ...(mark === undefined ? {} : { mark }),
      changes: mark === undefined ? 0 : 1,
      added: mark === 'D' ? 0 : snapshot.added[path] ?? 0,
      ...(tone === 'worker' && touch?.workerId !== undefined ? { workerId: touch.workerId } : {}),
      ...(isActive ? { activeKind: focus.kind } : {}),
    }
  }

  const walk = (dir: string, depth: number): void => {
    const pathOf = (name: string): string => (dir === '' ? name : `${dir}/${name}`)
    const listing = snapshot.listings[dir] ?? []
    // Folders before files and by name within each group, as the listing already sorts them.
    const entries = [
      ...listing.filter(entry => edited.has(pathOf(entry.name))),
      ...listing.filter(entry => !edited.has(pathOf(entry.name))),
    ]
    const isKept = (entry: TreeEntry, index: number): boolean => {
      const path = pathOf(entry.name)
      return index < maxPerDir || touches.has(path) || focus?.path === path || (entry.isDir && open.has(path))
    }
    const kept = entries.filter(isKept)
    for (const entry of kept) {
      const path = pathOf(entry.name)
      if (!entry.isDir) {
        rows.push(fileRow(path, entry.name, depth))
        continue
      }
      const isOpen = open.has(path) && snapshot.listings[path] !== undefined
      const total = totals.get(path)
      rows.push({
        key: path, kind: 'dir', depth, name: entry.name, isOpen,
        tone: entry.name.startsWith('.') || NEVER_OPENED.has(entry.name) ? 'dim' : 'plain',
        ...(total === undefined ? {} : { mark: 'M' as const }),
        changes: total?.changes ?? 0,
        added: total?.added ?? 0,
      })
      if (isOpen) walk(path, depth + 1)
    }
    const hidden = entries.length - kept.length
    if (hidden > 0) {
      rows.push({ key: `more:${dir}/`, kind: 'more', depth, name: `… ${hidden} more`, isOpen: false, tone: 'dim', changes: 0, added: 0 })
    }
  }

  walk('', 0)
  return rows
}

/**
 * The row the window centres on: the live file, else the latest touched one shown, else the
 * nearest shown folder holding the live or latest touched file (one closed by hand), else the top.
 */
export const anchorOf = (rows: readonly TreeRow[], touched: readonly TouchedFile[], focus: TreeFocus | null = null): number => {
  const active = rows.findIndex(row => row.tone === 'active')
  if (active >= 0) return active
  const latest = [...touched].reverse()
  for (const file of latest) {
    const index = rows.findIndex(row => row.kind === 'file' && row.key === file.path && row.worktree === file.worktree)
    if (index >= 0) return index
  }
  const holder = focus ?? latest[0]
  if (holder === undefined) return 0
  for (const dir of ancestorsOf(holder.path).slice(1).reverse()) {
    const index = rows.findIndex(row => row.kind === 'dir' && row.key === dir && row.worktree === holder.worktree)
    if (index >= 0) return index
  }
  // A worktree section closed by hand: its own row.
  const section = rows.findIndex(row => row.kind === 'root' && holder.worktree !== undefined && row.worktree === holder.worktree)
  return Math.max(0, section)
}

/** The rows that fit `budget` lines, and how many are cut above and below (each cut takes a line). */
export type TreeWindow = { readonly rows: readonly TreeRow[]; readonly above: number; readonly below: number }

/**
 * A window of at most `budget` lines around `anchor`, counting a `↑ n more` / `↓ n more` line
 * for each cut side, so the drawn section never outgrows its budget. Budgets under 3 count as 3:
 * a row between two markers is the least a cut window can show.
 */
export const windowRows = (rows: readonly TreeRow[], anchor: number, budget: number): TreeWindow => {
  if (rows.length <= budget) return { rows, above: 0, below: 0 }
  const lines = Math.max(3, budget)
  const place = (visible: number): number =>
    Math.max(0, Math.min(rows.length - visible, anchor - Math.floor(visible / 2)))
  // Settle on how many lines the cut markers take: at most two passes change it.
  let visible = Math.max(1, lines - 1)
  for (let pass = 0; pass < 3; pass += 1) {
    const start = place(visible)
    const markers = Number(start > 0) + Number(start + visible < rows.length)
    const next = Math.max(1, lines - markers)
    if (next === visible) break
    visible = next
  }
  const start = place(visible)
  return { rows: rows.slice(start, start + visible), above: start, below: rows.length - start - visible }
}

/** A row's badge text: `+3 M` on a file, `+3 M:2` on a folder or worktree, empty when unchanged. */
export const badgeOf = (row: TreeRow): string => {
  if (row.mark === undefined) return ''
  const lines = row.added > 0 ? `+${row.added} ` : ''
  return row.kind === 'file' ? `${lines}${row.mark}` : `${lines}M:${row.changes}`
}

/** A file as the folded line names it: prefixed by its worktree's folder when it lies in one. */
export const placeLabel = (file: { readonly path: string; readonly worktree?: string }): string =>
  safeText(file.worktree === undefined ? file.path : `${fileName(file.worktree)}: ${file.path}`)

/** The folded section's one line: what the main loop works on, else the last file touched. */
export const treeLine = (focus: TreeFocus | null, touched: readonly TouchedFile[]): string | null => {
  if (focus !== null) return `${focus.kind === 'edit' ? 'editing' : 'reading'} ${placeLabel(focus)}`
  const last = touched.at(-1)
  return last === undefined ? null : `last ${placeLabel(last)}`
}

/** Notes a touch: the file moves to the end, carrying who touched it this time and in which worktree. */
export const touch = (touched: readonly TouchedFile[], path: string, workerId: string | undefined, worktree?: string): readonly TouchedFile[] => {
  const latest = touched.at(-1)
  if (latest?.path === path && latest.workerId === workerId && latest.worktree === worktree) return touched
  const fresh: TouchedFile = {
    path,
    ...(workerId === undefined ? {} : { workerId }),
    ...(worktree === undefined ? {} : { worktree }),
  }
  return [...touched.filter(file => file.path !== path || file.worktree !== worktree), fresh].slice(-MAX_TOUCHED)
}

/** Whether the snapshot lacks a listing the tree would open now, so a read is due. */
export const isMissingListing = (snapshot: TreeSnapshot | null, paths: readonly string[]): boolean =>
  snapshot === null || [...expandedDirs(paths)].some(dir => snapshot.listings[dir] === undefined)

/** The pieces of one drawn row, the name cut so the row fits `columns` cells. */
export type RowParts = {
  readonly indent: string
  readonly glyph: string
  readonly name: string
  /** A worktree row's branch, cut short; empty on other rows. */
  readonly detail: string
  readonly badge: string
}

/** Safe text cut to `room` cells, counted by code point so a cut never splits a surrogate pair. */
const cutTo = (text: string, room: number): string => {
  const shown = [...safeText(text)]
  return shown.length <= room ? shown.join('') : `${shown.slice(0, room - 1).join('')}…`
}

/** Lays out a row: two cells of indent per level, a glyph, the name, a worktree's branch, then its badge after a gap. */
export const rowParts = (row: TreeRow, columns: number): RowParts => {
  const indent = '  '.repeat(row.depth)
  const glyph = row.kind === 'dir' || row.kind === 'root' ? (row.isOpen ? '▾ ' : '▸ ')
    : row.tone === 'active' || row.tone === 'worker' ? '● '
    : row.tone === 'touched' ? '· '
    : '  '
  const badge = badgeOf(row)
  const detail = row.detail === undefined ? '' : cutTo(row.detail, MAX_DETAIL)
  const room = Math.max(4, columns - indent.length - glyph.length
    - (badge === '' ? 0 : badge.length + 2) - (detail === '' ? 0 : [...detail].length + 2))
  return { indent, glyph, name: cutTo(row.name, room), detail, badge }
}

// ── Linked worktrees ───────────────────────────────────────────────────────────────────
// The repository's other worktrees (a subagent's under .claude/worktrees, a `git worktree add
// ../x`) each draw as a section of their own under the session's tree, read in their own root.

/** One linked worktree as `git worktree list` names it. */
export type WorktreeEntry = { readonly path: string; readonly branch?: string }

/**
 * Parses `git worktree list --porcelain -z` (git 2.36 or later; older git fails the call and no
 * worktree is drawn): each attribute ends in NUL, each record in one more. Bare repositories,
 * prunable ones (gone from disk) and paths that are not absolute are skipped.
 */
export const parseWorktreeList = (output: string): readonly WorktreeEntry[] => {
  const entries: WorktreeEntry[] = []
  for (const record of output.split('\0\0')) {
    const fields = record.split('\0')
    const path = fields.find(field => field.startsWith('worktree '))?.slice('worktree '.length)
    if (path === undefined || !isAbsolutePath(path)) continue
    if (fields.some(field => field === 'bare' || field === 'prunable' || field.startsWith('prunable '))) continue
    const branch = fields.find(field => field.startsWith('branch '))?.slice('branch '.length).replace(/^refs\/heads\//, '')
    entries.push(branch === undefined || branch === '' ? { path } : { path, branch })
  }
  return entries
}

/** The repository's other worktrees: all but the session's own (any of `own`'s spellings). */
export const linkedWorktrees = (entries: readonly WorktreeEntry[], own: readonly string[]): readonly WorktreeEntry[] =>
  entries.filter(entry => !own.some(path => isSamePath(path, entry.path)))

/**
 * The worktrees drawn as sections, capped: those the session worked in first, so a busy
 * `.claude/worktrees` never pushes out the one in use, then the rest in git's order.
 */
export const shownWorktrees = (entries: readonly WorktreeEntry[], touched: readonly TouchedFile[], focus: TreeFocus | null): readonly WorktreeEntry[] => {
  const isWorked = (entry: WorktreeEntry): boolean =>
    touchedIn(touched, entry.path).length > 0 || focusIn(focus, entry.path) !== null
  return [...entries.filter(isWorked), ...entries.filter(entry => !isWorked(entry))].slice(0, MAX_WORKTREES)
}

/**
 * A worktree's path in each spelling of the session root it may sit under: git prints real paths
 * (`/private/var` on macOS), a tool may give the root as the session spells it (`/var`).
 */
export const spellingsOf = (path: string, root: string, rootReal: string): readonly string[] => {
  const underReal = relativeTo(rootReal, path)
  const underRoot = relativeTo(root, path)
  const others = [
    ...(underReal === undefined ? [] : [`${root.replace(/[\\/]+$/, '')}/${underReal}`]),
    ...(underRoot === undefined ? [] : [`${rootReal.replace(/[\\/]+$/, '')}/${underRoot}`]),
  ]
  return [...new Set([path, ...others])]
}

/** A root a tool's path may lie under: the session's (`worktree` unset) or a linked worktree's, in each spelling. */
export type TreeRoot = { readonly worktree?: string; readonly spellings: readonly string[] }

/** Where a file sits in the tree: its path relative to its root, and the worktree when it is one. */
export type TreePlace = { readonly path: string; readonly worktree?: string }

/**
 * Places a tool's path under the deepest root holding it, so a worktree nested in the project
 * (`.claude/worktrees/x`) wins over the project itself. Within a root its first spelling that
 * holds the path counts, as given before resolved. A relative path is the session's own.
 */
export const placeFile = (roots: readonly TreeRoot[], file: string): TreePlace | undefined => {
  const isAbsolute = isAbsolutePath(file)
  let best: { readonly place: TreePlace; readonly depth: number } | undefined
  for (const root of roots) {
    if (!isAbsolute && root.worktree !== undefined) continue
    const spelling = root.spellings.find(candidate => relativeTo(candidate, file) !== undefined)
    const path = spelling === undefined ? undefined : relativeTo(spelling, file)
    if (spelling === undefined || path === undefined) continue
    const depth = spelling.split(/[\\/]+/).filter(part => part !== '').length
    if (best !== undefined && best.depth >= depth) continue
    best = { place: root.worktree === undefined ? { path } : { path, worktree: root.worktree }, depth }
  }
  return best?.place
}

/**
 * Listings without the folders another root sits in (a worktree under `.claude/worktrees`, the
 * session's own checkout), so no file is drawn twice. `rootSpellings` are the listed root's.
 */
export const withoutMounts = (
  listings: Readonly<Record<string, readonly TreeEntry[]>>,
  rootSpellings: readonly string[],
  mounts: readonly string[],
): Readonly<Record<string, readonly TreeEntry[]>> => {
  const hidden = new Set(mounts.flatMap(mount => rootSpellings.map(root => relativeTo(root, mount)))
    .filter((path): path is string => path !== undefined))
  if (hidden.size === 0) return listings
  return Object.fromEntries(Object.entries(listings).map(([dir, entries]) =>
    [dir, entries.filter(entry => !hidden.has(dir === '' ? entry.name : `${dir}/${entry.name}`))]))
}

/** The touches made in one root: the session's (`worktree` undefined) or a linked worktree's. */
export const touchedIn = (touched: readonly TouchedFile[], worktree: string | undefined): readonly TouchedFile[] =>
  touched.filter(file => file.worktree === worktree)

/** The live file when it lies in that root, else none. */
export const focusIn = (focus: TreeFocus | null, worktree: string | undefined): TreeFocus | null =>
  focus !== null && focus.worktree === worktree ? focus : null

/** Whether a worktree's section is open: the person's toggle, else whether the session worked in it. */
export const isWorktreeOpen = (worktree: string, touched: readonly TouchedFile[], focus: TreeFocus | null, toggles: FolderToggles = {}): boolean =>
  toggles[''] ?? (touchedIn(touched, worktree).length > 0 || focusIn(focus, worktree) !== null)

/** An edit inside a worktree: its section and folders closed by hand open again. */
export const reopenWorktreeFor = (
  all: Readonly<Record<string, FolderToggles>>,
  worktree: string,
  path: string,
): Readonly<Record<string, FolderToggles>> => {
  const current = all[worktree]
  if (current === undefined) return all
  const next = reopenFor(current, path)
  return next === current ? all : { ...all, [worktree]: next }
}

/** A click on a worktree's row or one of its folders. */
export const toggleWorktreeFolder = (
  all: Readonly<Record<string, FolderToggles>>,
  worktree: string,
  path: string,
  isOpen: boolean,
): Readonly<Record<string, FolderToggles>> => ({ ...all, [worktree]: toggleFolder(all[worktree] ?? {}, path, isOpen) })

/**
 * Whether a worktree's section lacks a listing it would draw now, so a read is due. A section
 * closed by hand draws none, so it never asks.
 */
export const isMissingWorktreeListing = (snapshot: TreeSnapshot | null, worktree: string, paths: readonly string[], toggles: FolderToggles = {}): boolean => {
  if (toggles[''] === false) return false
  const section = snapshot?.worktrees?.find(entry => entry.path === worktree)
  return section === undefined || [...expandedDirs(paths)].some(dir => section.tree.listings[dir] === undefined)
}

/** Everything the whole tree is drawn from: the session's root, then each linked worktree. */
export type SessionTreeInput = TreeInput & { readonly worktreeToggles?: Readonly<Record<string, FolderToggles>> }

/** One worktree's section: its own row, then (open) its tree one level in. */
const worktreeSection = (section: WorktreeSnapshot, input: SessionTreeInput): readonly TreeRow[] => {
  const { path: worktree, tree } = section
  const touched = touchedIn(input.touched, worktree)
  const focus = focusIn(input.focus, worktree)
  const toggles = input.worktreeToggles?.[worktree] ?? {}
  const isOpen = isWorktreeOpen(worktree, touched, focus, toggles) && tree.listings[''] !== undefined
  const total = rollUp(tree).get('')
  const header: TreeRow = {
    key: '', kind: 'root', depth: 0, name: tree.rootName, isOpen, worktree,
    tone: touched.length > 0 || focus !== null ? 'touched' : 'plain',
    ...(tree.branch === undefined ? {} : { detail: tree.branch }),
    ...(total === undefined ? {} : { mark: 'M' as const }),
    changes: total?.changes ?? 0,
    added: total?.added ?? 0,
  }
  if (!isOpen) return [header]
  const rows = treeRows({ snapshot: tree, focus, touched, toggles, ...(input.maxPerDir === undefined ? {} : { maxPerDir: input.maxPerDir }) })
  return [header, ...rows.map(row => ({ ...row, depth: row.depth + 1, worktree }))]
}

/** The session's tree, then a section per linked worktree, as one list of rows for the window. */
export const sessionTreeRows = (input: SessionTreeInput): readonly TreeRow[] => [
  ...treeRows({ ...input, focus: focusIn(input.focus, undefined), touched: touchedIn(input.touched, undefined) }),
  ...(input.snapshot.worktrees ?? []).flatMap(section => worktreeSection(section, input)),
]
