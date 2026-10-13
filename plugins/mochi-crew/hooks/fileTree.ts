import type { GitMark, TouchedFile, TreeEntry, TreeFocus, TreeSnapshot } from '../types'

/** Entries an expanded folder shows before folding the rest into a `… N more` row. */
export const MAX_ENTRIES_PER_DIR = 12
/** The tree needs this many rows to be worth drawing; fewer, and it folds into one line. */
export const MIN_TREE_ROWS = 4
/** Touched files remembered; older ones fold their folders closed again. */
export const MAX_TOUCHED = 40
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
  /** A stable address: the path relative to the root, or `more:<dir>` for a fold. */
  readonly key: string
  readonly kind: 'dir' | 'file' | 'more'
  readonly depth: number
  /** The entry's name, or `… N more` for a fold. */
  readonly name: string
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

/**
 * A path made relative to `root`, or undefined when it lies outside it. Absolute or relative
 * input; `.` and `..` are resolved by spelling alone, so `a/../../x` is outside.
 */
export const relativeTo = (root: string, path: string): string | undefined => {
  const base = root.replace(/\/+$/, '')
  const isAbsolute = path.startsWith('/')
  if (isAbsolute && path !== base && !path.startsWith(`${base}/`)) return undefined
  const rest = isAbsolute ? path.slice(base.length) : path
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

/** Whether an already resolved real path lies strictly inside the resolved root. */
export const isInside = (root: string, real: string): boolean => {
  const base = root.replace(/\/+$/, '')
  return base !== '' && real.startsWith(`${base}/`) && relativeTo(base, real) !== undefined
}

/** The folders that hold `path`, outermost first, the root `''` included. */
export const ancestorsOf = (path: string): readonly string[] => {
  const parts = path.split('/').slice(0, -1)
  return ['', ...parts.map((_, index) => parts.slice(0, index + 1).join('/'))]
}

/** Whether a path may open folders: nothing under `.git` or `node_modules`. */
const isOpenable = (path: string): boolean => !path.split('/').some(part => NEVER_OPENED.has(part))

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
  readonly maxPerDir?: number
}

/** Edited files and every folder that holds one: what each folder lists first. */
const editedPaths = (touched: readonly TouchedFile[], focus: TreeFocus | null): ReadonlySet<string> => {
  const files = [...touched.map(file => file.path), ...(focus?.kind === 'edit' ? [focus.path] : [])].filter(isOpenable)
  return new Set([...files, ...files.flatMap(ancestorsOf)])
}

/**
 * The tree's rows, depth first: folders on the way to a touched or live file are open, every
 * other folder closed. Each folder lists what leads to an edited file first, so the session's
 * work sits at the top of the tree. A folder longer than `maxPerDir` folds its tail into one
 * `… N more` row, but never hides a touched or live file.
 */
export const treeRows = ({ snapshot, focus, touched, maxPerDir = MAX_ENTRIES_PER_DIR }: TreeInput): readonly TreeRow[] => {
  const touches = touchIndex(touched)
  const open = expandedDirs([...touches.keys(), ...(focus === null ? [] : [focus.path])])
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

/** The row the window centres on: the live file, else the latest touched one shown, else the top. */
export const anchorOf = (rows: readonly TreeRow[], touched: readonly TouchedFile[]): number => {
  const active = rows.findIndex(row => row.tone === 'active')
  if (active >= 0) return active
  for (const file of [...touched].reverse()) {
    const index = rows.findIndex(row => row.key === file.path)
    if (index >= 0) return index
  }
  return 0
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

/** A row's badge text: `+3 M` on a file, `+3 M:2` on a folder, empty when unchanged. */
export const badgeOf = (row: TreeRow): string => {
  if (row.mark === undefined) return ''
  const lines = row.added > 0 ? `+${row.added} ` : ''
  return row.kind === 'dir' ? `${lines}M:${row.changes}` : `${lines}${row.mark}`
}

/** The folded section's one line: what the main loop works on, else the last file touched. */
export const treeLine = (focus: TreeFocus | null, touched: readonly TouchedFile[]): string | null => {
  if (focus !== null) return `${focus.kind === 'edit' ? 'editing' : 'reading'} ${safeText(focus.path)}`
  const last = touched.at(-1)
  return last === undefined ? null : `last ${safeText(last.path)}`
}

/** Notes a touch: the file moves to the end, carrying who touched it this time. */
export const touch = (touched: readonly TouchedFile[], path: string, workerId: string | undefined): readonly TouchedFile[] => {
  const latest = touched.at(-1)
  if (latest?.path === path && latest.workerId === workerId) return touched
  const fresh: TouchedFile = workerId === undefined ? { path } : { path, workerId }
  return [...touched.filter(file => file.path !== path), fresh].slice(-MAX_TOUCHED)
}

/** Whether the snapshot lacks a listing the tree would open now, so a read is due. */
export const isMissingListing = (snapshot: TreeSnapshot | null, paths: readonly string[]): boolean =>
  snapshot === null || [...expandedDirs(paths)].some(dir => snapshot.listings[dir] === undefined)

/** The pieces of one drawn row, the name cut so the row fits `columns` cells. */
export type RowParts = { readonly indent: string; readonly glyph: string; readonly name: string; readonly badge: string }

/** Lays out a row: two cells of indent per level, a glyph, the name, then its badge after a gap. */
export const rowParts = (row: TreeRow, columns: number): RowParts => {
  const indent = '  '.repeat(row.depth)
  const glyph = row.kind === 'dir' ? (row.isOpen ? '▾ ' : '▸ ')
    : row.tone === 'active' || row.tone === 'worker' ? '● '
    : row.tone === 'touched' ? '· '
    : '  '
  const badge = badgeOf(row)
  const room = Math.max(4, columns - indent.length - glyph.length - (badge === '' ? 0 : badge.length + 2))
  // Counted by code point, so a cut never splits a surrogate pair.
  const shown = [...safeText(row.name)]
  const name = shown.length <= room ? shown.join('') : `${shown.slice(0, room - 1).join('')}…`
  return { indent, glyph, name, badge }
}
