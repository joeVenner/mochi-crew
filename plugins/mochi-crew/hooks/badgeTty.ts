/**
 * Finds the Terminal tab a session draws in, without a shell. `ps` lists itself, and a
 * random marker in its own arguments picks its row out; from its parent the walk goes
 * up to the first process that has a terminal: Claude Code's own.
 */

export type ProcessRow = { readonly pid: number; readonly ppid: number; readonly tty: string }

const MARKER_PREFIX = 'mochi-badge-'
const TTY_PATH = /^\/dev\/ttys\d{3,4}$/
const MARKER = /^[0-9a-f]{32}$/

/** True for a macOS pseudo-terminal path such as `/dev/ttys001`, the only shape handed to AppleScript. */
export const isTerminalTty = (path: string): boolean => TTY_PATH.test(path)

/** The `ps` argument list that names `marker` in the header of its last column, and so in its own row. */
export const processTableArgv = (marker: string): readonly string[] => {
  if (!MARKER.test(marker)) throw new Error('the process table marker must be 32 hex digits')
  return ['/bin/ps', '-A', '-o', `pid=,ppid=,tty=,args=${MARKER_PREFIX}${marker}`]
}

/**
 * Reads that `ps` output: every process row, and the parent of the row that is this very
 * `ps` (its arguments carry the marker), or undefined when no row does.
 */
export const parseProcessTable = (text: string, marker: string): { startPid: number | undefined; rows: ReadonlyMap<number, ProcessRow> } => {
  const rows = new Map<number, ProcessRow>()
  let startPid: number | undefined
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    const row = { pid: Number(match[1]), ppid: Number(match[2]), tty: match[3] ?? '' }
    rows.set(row.pid, row)
    const args = match[4] ?? ''
    if (args.startsWith('/bin/ps ') && args.includes(`${MARKER_PREFIX}${marker}`)) startPid = row.ppid
  }
  return { startPid, rows }
}

/**
 * Walks from `startPid` up through its parents and answers the first real tty as a device
 * path, or undefined when no ancestor has one (a `-p` run, a daemon) or the walk loops.
 */
export const findControllingTty = (startPid: number | undefined, rows: ReadonlyMap<number, ProcessRow>): string | undefined => {
  const MAX_DEPTH = 32
  let pid = startPid
  for (let depth = 0; depth < MAX_DEPTH && pid !== undefined; depth += 1) {
    const row = rows.get(pid)
    if (!row) return undefined
    const path = `/dev/${row.tty}`
    if (isTerminalTty(path)) return path
    if (row.ppid <= 1 || row.ppid === pid) return undefined
    pid = row.ppid
  }
  return undefined
}
