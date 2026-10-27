import type { TouchedFile, TutorFocus } from '../types'
import { relativeTo, safeText } from './fileTree'
import { redactSecrets } from './redact'

/** The whole digest a digest round sends, at most; every section fits inside it. */
export const MAX_DIGEST_CHARS = 16_000

/** The digest's sections, in the order they are written. */
export type DigestSection = 'header' | 'commits' | 'changed' | 'diff' | 'new-files' | 'layout' | 'asks' | 'notes' | 'trail'

/** Each section's own cap, in characters; what one leaves unused rolls over to `diff`. */
export const DIGEST_CAPS: Readonly<Record<DigestSection, number>> = {
  header: 200,
  commits: 800,
  changed: 1_000,
  diff: 7_500,
  'new-files': 2_000,
  layout: 1_200,
  asks: 1_500,
  notes: 1_000,
  trail: 600,
}

const SECTION_ORDER: readonly DigestSection[] = ['header', 'commits', 'changed', 'diff', 'new-files', 'layout', 'asks', 'notes', 'trail']

/** One file's share of the diff section, its heading included. */
const MAX_DIFF_FILE = 2_000
/** Untracked files shown at most, the lines read from each and each one's cap. */
const MAX_NEW_FILES = 2
const NEW_FILE_LINES = 60
const MAX_NEW_FILE = 1_000
/** User prompts kept and each one's cap. */
const MAX_ASKS = 6
const MAX_ASK = 240
/** Assistant replies kept; on the `turn` focus only the last one, but longer. */
const MAX_NOTES = 4
const MAX_TURN_NOTE = 1_200
/** Tool uses kept in the trail. */
const MAX_TRAIL = 20
/** Default slice of one line before redaction. */
const MAX_LINE = 300
/** Raw text kept per transcript row: enough for the longest note, so a huge reply is not held. */
const MAX_ROW_TEXT = 4_000
/** A tool name longer than this is not a real tool name. */
const MAX_TOOL_NAME = 60

/** What a diff file shows when its hunks were dropped to fit. */
const CUT_MARK = '… (cut)'
const PEM_REMOVED = '[private key removed]'

// Files whose purpose is holding secrets are never read; a config file that merely may hold one
// (settings.py, docker-compose.yml) is read and its values masked instead.
const SECRET_NAMES: ReadonlySet<string> = new Set([
  '.npmrc', '.netrc', '.pgpass', '.htpasswd', '.pypirc', '.dockercfg', '.vault-token', 'kubeconfig',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
])
const SECRET_EXTENSIONS: readonly string[] = [
  '.pem', '.key', '.p12', '.pfx', '.p8', '.jks', '.keystore', '.kdbx', '.ppk', '.gpg', '.asc', '.lock',
]
const SECRET_PREFIXES: readonly string[] = ['.env', 'id_rsa', 'id_dsa', 'id_ed25519', 'id_ecdsa']
const SECRET_INFIXES: readonly string[] = ['secret', 'credential', '.tfstate', '.tfvars', '.min.']
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set(['dist', 'node_modules'])
// Everything under these is a credential store.
const SECRET_FOLDERS: ReadonlySet<string> = new Set(['.aws', '.ssh', '.gnupg'])
// Names that are secret only in their folder: `config` is everywhere, `.kube/config` is a login.
const SECRET_TAILS: readonly (readonly [string, string])[] = [
  ['.kube', 'config'], ['.docker', 'config.json'], ['config', 'database.yml'],
]

// Lowercased like the `icase` globs, so a read is refused for `Secrets.json` too.
const isSecretName = (segment: string): boolean => {
  const name = segment.toLowerCase()
  return SECRET_NAMES.has(name)
    || SECRET_EXTENSIONS.some(extension => name.endsWith(extension))
    || SECRET_PREFIXES.some(prefix => name.startsWith(prefix))
    || SECRET_INFIXES.some(infix => name.includes(infix))
    // Spring's application.properties, application-prod.properties: the database password's home.
    || (name.startsWith('application') && name.endsWith('.properties'))
}

/**
 * Whether a path is secret-shaped or noise (a lockfile, a build output), so it must never be
 * read for the model: the name rules apply to the basename and to every folder segment, a
 * credential folder (`.aws`, `.ssh`) or `dist` or `node_modules` anywhere above it rules it out,
 * and so does a folder-specific name like `.kube/config`. The one list every tutor read is
 * filtered by, git's included.
 */
export const isSecretPath = (path: string): boolean => {
  const segments = path.split(/[\\/]+/).filter(segment => segment !== '' && segment !== '.')
  if (segments.length === 0) return false
  const lower = segments.map(segment => segment.toLowerCase())
  const folders = lower.slice(0, -1)
  const [parent, name] = lower.slice(-2)
  return segments.some(isSecretName)
    || folders.some(folder => SKIPPED_FOLDERS.has(folder) || SECRET_FOLDERS.has(folder))
    || SECRET_TAILS.some(([folder, file]) => parent === folder && name === file)
}

const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/g
const PEM_END = /-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g

// An indexOf-style scan rather than one lazy regex, so many unclosed BEGINs stay linear; an
// unclosed block is removed to the end, since the key runs on past the cut.
const stripPrivateKeys = (text: string): string => {
  let out = ''
  let from = 0
  for (;;) {
    PEM_BEGIN.lastIndex = from
    const begin = PEM_BEGIN.exec(text)
    if (begin === null) return out + text.slice(from)
    out += text.slice(from, begin.index) + PEM_REMOVED
    PEM_END.lastIndex = begin.index + begin[0].length
    const end = PEM_END.exec(text)
    if (end === null) return out
    from = end.index + end[0].length
  }
}

/**
 * Text made fit to send to a model: private-key blocks removed, then per line sliced to
 * `maxLine`, secrets masked and control characters replaced, then cut to `maxChars` at a line
 * boundary. Lines are sliced before redaction so the regexes stay cheap on a huge line. When
 * not even the first line fits, it is sliced to the cap, so the result never exceeds it.
 */
export const maskForModel = (text: string, maxChars: number, maxLine: number = MAX_LINE): string => {
  if (maxChars <= 0 || text === '') return ''
  const kept: string[] = []
  let length = 0
  // Each line is masked as it is reached, so lines past the cap are never redacted at all.
  for (const raw of stripPrivateKeys(text).split(/\r?\n/)) {
    const line = safeText(redactSecrets(raw.slice(0, maxLine)))
    if (kept.length === 0 && line.length > maxChars) return line.slice(0, maxChars)
    const added = kept.length === 0 ? line.length : line.length + 1
    if (length + added > maxChars) break
    kept.push(line)
    length += added
  }
  return kept.join('\n')
}

const DIFF_FLAGS: readonly string[] = ['--no-color', '--no-ext-diff', '--no-textconv']

/** Files the diff and numstat name at most; past it the rest are counted, not shown. */
export const MAX_DIFF_PATHS = 150

/**
 * `git diff --name-status -z` of the whole repository against HEAD, renames and copies found.
 * Repository-wide and without `--relative` on purpose: a pathspec or `--relative` limits the
 * files before rename detection, so `git mv ../.env config.txt` would show only as a new
 * `config.txt` and its secret would pass. NUL-separated, so no name needs unquoting.
 */
export const nameStatusArgs = (): readonly string[] => ['diff', '--name-status', '-z', '-M', '-C', '--no-relative', ...DIFF_FLAGS, 'HEAD', '--', ':/']

// `literal` so a name holding `*` or `:` matches only itself.
const literalSpecs = (paths: readonly string[]): readonly string[] => paths.map(path => `:(literal)${path}`)

// Renames are off: each allowed path is diffed as itself, so no other file's content rides along.
const diffScope = (paths: readonly string[]): readonly string[] => ['--no-renames', '--relative', 'HEAD', '--', ...literalSpecs(paths)]

/** `git diff` of the allowed paths against HEAD, two lines of context, paths relative to the root. */
export const diffArgs = (paths: readonly string[]): readonly string[] => ['diff', ...DIFF_FLAGS, '-U2', ...diffScope(paths)]

/** `git diff --numstat` of the allowed paths against HEAD, scoped like the diff. */
export const numstatArgs = (paths: readonly string[]): readonly string[] => ['diff', '--numstat', ...DIFF_FLAGS, ...diffScope(paths)]

/** One `--name-status` entry: its status letter and score, and the paths it names (two for a rename or copy). */
export type NameStatus = { readonly status: string; readonly paths: readonly string[] }

/**
 * `git diff --name-status -z` output split into entries. A rename (`R`) or copy (`C`) names its
 * old path, then its new one. An entry cut short (the output was capped) is dropped whole.
 */
export const parseNameStatus = (output: string): readonly NameStatus[] => {
  const tokens = output.split('\0')
  // A complete output ends with a NUL; whatever follows the last one is a cut entry.
  tokens.pop()
  const entries: NameStatus[] = []
  for (let index = 0; index < tokens.length;) {
    const status = tokens[index] ?? ''
    const count = /^[RC]/.test(status) ? 2 : 1
    const paths = tokens.slice(index + 1, index + 1 + count)
    if (status === '' || paths.length < count || paths.some(path => path === '')) break
    entries.push({ status, paths })
    index += 1 + count
  }
  return entries
}

/** What may be diffed for the model: root-relative paths, and how many were held back. */
export type DiffPlan = { readonly paths: readonly string[]; readonly blocked: number; readonly omitted: number }

/**
 * The paths a digest may diff, from repository-wide `--name-status -z` output and the root's
 * `rev-parse --show-prefix`. An entry is blocked when any path it names, old or new, is
 * secret-shaped; one whose new path is outside the root is out of scope. The rest are ordered
 * like the diff (touched first) and cut to `limit`.
 */
export const planDiff = (nameStatus: string, prefix: string, touched: readonly TouchedFile[], added: Readonly<Record<string, number>>, limit: number = MAX_DIFF_PATHS): DiffPlan => {
  const allowed: string[] = []
  const seen = new Set<string>()
  let blocked = 0
  for (const entry of parseNameStatus(nameStatus)) {
    if (entry.paths.some(isSecretPath)) {
      blocked += 1
      continue
    }
    const path = entry.paths.at(-1) ?? ''
    if (!path.startsWith(prefix)) continue
    const relative = path.slice(prefix.length)
    if (relative === '' || seen.has(relative)) continue
    seen.add(relative)
    allowed.push(relative)
  }
  const ordered = orderDiffFiles(allowed, touched, added)
  return { paths: ordered.slice(0, limit), blocked, omitted: Math.max(0, ordered.length - limit) }
}

/** `git log` of the last 8 commits as `hash<TAB>subject`; no signature check runs gpg. */
export const logArgs = (): readonly string[] => ['log', '-n', '8', '--no-color', '--no-show-signature', '--format=%h%x09%s']

/** `git ls-files -z` for the project layout: names only, NUL-separated so any name splits safely. */
export const lsFilesArgs = (): readonly string[] => ['ls-files', '-z']

const C_ESCAPES: Readonly<Record<string, number>> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 }

// git quotes a path holding a control character, a quote or (with the default core.quotePath)
// any non-ASCII byte: "caf\303\251.ts". The escapes go back to bytes and then UTF-8, so the
// path matches the one treeTouched and the file system spell.
const unquote = (path: string): string => {
  if (path.length < 2 || !path.startsWith('"') || !path.endsWith('"')) return path
  const encoder = new TextEncoder()
  const bytes: number[] = []
  for (const token of path.slice(1, -1).match(/\\[0-3][0-7]{2}|\\[\s\S]|[^\\]+/g) ?? []) {
    if (!token.startsWith('\\')) bytes.push(...encoder.encode(token))
    else if (token.length === 4) bytes.push(parseInt(token.slice(1), 8))
    else bytes.push(C_ESCAPES[token.slice(1)] ?? token.charCodeAt(1))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

// `+++ b/x` names the new side; a deletion's `+++ /dev/null` falls back to `--- a/x`. Git ends a
// name holding a space with a tab, which is dropped.
const sidePath = (line: string, prefix: string): string | undefined => {
  const raw = unquote(line.slice(4).replace(/\t$/, ''))
  if (raw === '/dev/null') return undefined
  return raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
}

// For a binary or mode-only change there is no ---/+++ pair: `diff --git a/P b/P` splits in the middle.
const headerPath = (line: string): string => {
  const rest = line.slice('diff --git '.length)
  const quoted = /^"a\/(?:[^"\\]|\\.)*" "b\/((?:[^"\\]|\\.)*)"$/.exec(rest)
  if (quoted !== null) return unquote(`"${quoted[1] ?? ''}"`)
  const half = (rest.length - 5) / 2
  const path = rest.slice(2, 2 + half)
  return Number.isInteger(half) && rest === `a/${path} b/${path}` ? path : rest.replace(/^a\//, '').split(' b/').at(-1) ?? rest
}

const isBodyStart = (line: string): boolean => line.startsWith('@@') || line.startsWith('Binary files ') || line === 'GIT binary patch'

/**
 * A unified diff split into one entry per file at each `diff --git` header. The path is the new
 * side's (the old one for a deletion); the body is everything from the first hunk on, or the
 * `Binary files … differ` line, without the header lines.
 */
export const splitDiffByFile = (diff: string): readonly { readonly path: string; readonly body: string }[] => {
  const files: { readonly path: string; readonly body: string }[] = []
  const chunks = diff.split(/^(?=diff --git )/m).filter(chunk => chunk.startsWith('diff --git '))
  for (const chunk of chunks) {
    const lines = chunk.replace(/\n$/, '').split('\n')
    const start = lines.findIndex(isBodyStart)
    const header = start === -1 ? lines : lines.slice(0, start)
    const plus = header.find(line => line.startsWith('+++ '))
    const minus = header.find(line => line.startsWith('--- '))
    const path = (plus === undefined ? undefined : sidePath(plus, 'b/'))
      ?? (minus === undefined ? undefined : sidePath(minus, 'a/'))
      ?? headerPath(lines[0] ?? '')
    files.push({ path, body: start === -1 ? '' : lines.slice(start).join('\n') })
  }
  return files
}

/**
 * A file's diff body cut to whole hunks within `max`, ending with `… (cut)` when any were
 * dropped; '' when the first hunk alone does not fit.
 */
export const capHunks = (body: string, max: number): string => {
  if (body.length <= max) return body
  const hunks = body.split(/\n(?=@@)/)
  const kept: string[] = []
  let length = 0
  for (const hunk of hunks) {
    const added = (kept.length === 0 ? 0 : 1) + hunk.length
    // Room is left for the cut mark, since a later hunk is certainly dropped.
    if (length + added + 1 + CUT_MARK.length > max) break
    kept.push(hunk)
    length += added
  }
  return kept.length === 0 ? '' : `${kept.join('\n')}\n${CUT_MARK}`
}

/**
 * The diff's files in the order they earn space: those this session touched in the main root,
 * newest first, then the rest by lines added, most first (ties keep git's order).
 */
export const orderDiffFiles = (files: readonly string[], touched: readonly TouchedFile[], added: Readonly<Record<string, number>>): readonly string[] => {
  const present = new Set(files)
  const seen = new Set<string>()
  const first: string[] = []
  // treeTouched keeps the newest touch last.
  for (const file of [...touched].reverse()) {
    if (file.worktree !== undefined || !present.has(file.path) || seen.has(file.path)) continue
    seen.add(file.path)
    first.push(file.path)
  }
  const rest = files
    .map((path, index) => ({ path, index }))
    .filter(({ path }) => !seen.has(path))
    .sort((a, b) => (added[b.path] ?? 0) - (added[a.path] ?? 0) || a.index - b.index)
    .map(({ path }) => path)
  return [...first, ...rest]
}

/**
 * The project's shape from `git ls-files -z`: files counted per folder two levels deep (`a/b/`),
 * one line each in name order, files at the top under `./`. Whole lines within `max`, then a
 * `… N more folders` line when it fits.
 */
export const layoutSummary = (lsFilesZ: string, max: number): string => {
  const counts = new Map<string, number>()
  for (const path of lsFilesZ.split('\0')) {
    if (path === '') continue
    const folders = path.split('/').slice(0, -1).slice(0, 2)
    const key = folders.length === 0 ? './' : `${folders.join('/')}/`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const lines = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // A folder name holding a newline stays on its own line.
    .map(([folder, count]) => `${safeText(folder)} ${count} file${count === 1 ? '' : 's'}`)
  const kept: string[] = []
  let length = 0
  for (const line of lines) {
    const added = (kept.length === 0 ? 0 : 1) + line.length
    if (length + added > max) break
    kept.push(line)
    length += added
  }
  if (kept.length === lines.length) return kept.join('\n')
  // Folders give way to the "more" line, so a cut summary always says it was cut.
  const moreLine = (left: number): string => `… ${left} more folder${left === 1 ? '' : 's'}`
  while (kept.length > 0 && kept.join('\n').length + 1 + moreLine(lines.length - kept.length).length > max) kept.pop()
  const more = moreLine(lines.length - kept.length)
  if (kept.length === 0) return more.length <= max ? more : ''
  return [...kept, more].join('\n')
}

/** One transcript message as the digest keeps it: its text, and per tool use only the name and a file path. */
export type TranscriptRow = { readonly role: 'user' | 'assistant'; readonly text: string; readonly toolUses: readonly { readonly tool: string; readonly path?: string }[] }

type MessageLike = { role: 'user' | 'assistant'; text: string; toolUses: readonly { tool: string; input: Record<string, unknown> }[] }

const PATH_KEYS: readonly string[] = ['file_path', 'notebook_path']

// Only the two path keys are ever read: a command, a pattern or file content in the input stays behind.
const toolPath = (input: Record<string, unknown>, root: string): string | undefined => {
  // The transcript is the model's own arguments; a malformed call must not break the digest.
  if (typeof input !== 'object' || input === null) return undefined
  for (const key of PATH_KEYS) {
    const value = input[key]
    if (typeof value !== 'string' || value === '') continue
    // A path outside the project is dropped rather than sent absolute, which would name the home folder.
    return relativeTo(root, value)
  }
  return undefined
}

/**
 * The newest `max` messages mapped at once to what the digest may use: role, text (bounded) and,
 * per tool use, the tool's name plus `file_path` or `notebook_path` made relative to `root`.
 * Results, tool text and every other input field are never read.
 */
export const toTranscriptRows = (messages: readonly MessageLike[], root: string, max: number): readonly TranscriptRow[] =>
  messages.slice(Math.max(0, messages.length - max)).map(message => ({
    role: message.role,
    text: message.text.slice(0, MAX_ROW_TEXT),
    toolUses: message.toolUses.map(use => {
      const tool = use.tool.slice(0, MAX_TOOL_NAME)
      const path = toolPath(use.input, root)
      return path === undefined ? { tool } : { tool, path }
    }),
  }))

/** Everything a digest is built from, already read by register; absent git output gives an empty section. */
export type DigestSources = {
  readonly rootName: string
  readonly branch?: string
  readonly focus: TutorFocus
  readonly log?: string
  readonly numstat?: string
  readonly diff?: string
  readonly lsFiles?: string
  readonly newFiles: readonly { readonly path: string; readonly text: string }[]
  readonly rows: readonly TranscriptRow[]
  readonly touched: readonly TouchedFile[]
  readonly added: Readonly<Record<string, number>>
  /** The paths planDiff allowed; register always passes it, and then nothing else of the diff or numstat is used. */
  readonly plan?: DiffPlan
}

/**
 * The digest: its text, the files it names (the allowlist for a question's `file`), each diffed
 * or new file's masked excerpt for follow-ups, and whether it holds anything to quiz on.
 */
export type Digest = { readonly text: string; readonly files: readonly string[]; readonly excerpts: Readonly<Record<string, string>>; readonly isEmpty: boolean }

const heading = (section: DigestSection): string => `[${section}]`

// A section's framing (heading line, blank line before the next) counts toward the total.
const framed = (section: DigestSection, body: string): string => `${heading(section)}\n${body}`
const frameCost = (section: DigestSection): number => heading(section).length + 1 + 2

// One line per item: newlines would let a single ask eat the section.
const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim()

const shortened = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

// The leading items that fit within `max` once joined by newlines.
const fitting = <T>(items: readonly T[], textOf: (item: T) => string, max: number): readonly T[] => {
  const kept: T[] = []
  let length = 0
  for (const item of items) {
    const added = (kept.length === 0 ? 0 : 1) + textOf(item).length
    if (length + added > max) break
    kept.push(item)
    length += added
  }
  return kept
}

const headerText = (sources: DigestSources): string =>
  [`project: ${safeText(sources.rootName)}`, ...(sources.branch === undefined || sources.branch === '' ? [] : [`branch: ${safeText(sources.branch)}`])].join('\n')

const commitsText = (log: string | undefined): string =>
  (log ?? '').split('\n').filter(line => line.trim() !== '').map(line => line.replace('\t', ' ')).join('\n')

type ChangedFile = { readonly path: string; readonly line: string }

// A path the plan did not allow is dropped even when git printed it (a directory a literal
// pathspec matched, say).
const isPlanned = (plan: DiffPlan | undefined): ((path: string) => boolean) => {
  if (plan === undefined) return () => true
  const paths = new Set(plan.paths)
  return path => paths.has(path)
}

const changedFiles = (numstat: string | undefined, isAllowed: (path: string) => boolean): readonly ChangedFile[] =>
  (numstat ?? '').split('\n').flatMap((line): ChangedFile[] => {
    const match = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line)
    if (match === null) return []
    const [, adds = '', dels = '', quoted = ''] = match
    const path = unquote(quoted)
    // Checked again here: the diff text is input, and a path git did not exclude must still not pass.
    if (isSecretPath(path) || !isAllowed(path)) return []
    // One line per file: a name holding a newline must not split into a forged line.
    const shown = safeText(path)
    return [{ path, line: adds === '-' ? `${shown} (binary)` : `${shown} +${adds} -${dels}` }]
  })

const asksText = (rows: readonly TranscriptRow[]): string =>
  rows.filter(row => row.role === 'user' && row.text.trim() !== '').slice(-MAX_ASKS)
    .map(row => `- ${shortened(maskForModel(oneLine(row.text), MAX_LINE), MAX_ASK - 2)}`)
    .join('\n')

const notesText = (rows: readonly TranscriptRow[], focus: TutorFocus): string => {
  const replies = rows.filter(row => row.role === 'assistant' && row.text.trim() !== '')
  if (focus === 'turn') return maskForModel(replies.at(-1)?.text ?? '', MAX_TURN_NOTE)
  const each = Math.floor(DIGEST_CAPS.notes / MAX_NOTES) - 3
  return replies.slice(-MAX_NOTES).map(row => `- ${shortened(maskForModel(oneLine(row.text), MAX_LINE), each)}`).join('\n')
}

const trailUses = (rows: readonly TranscriptRow[]): readonly { readonly tool: string; readonly path?: string }[] =>
  rows.flatMap(row => row.toolUses).slice(-MAX_TRAIL)

const trailText = (rows: readonly TranscriptRow[]): string =>
  trailUses(rows).map(use => safeText(use.path === undefined ? use.tool : `${use.tool} ${use.path}`)).join('\n')

const newFilesOf = (newFiles: DigestSources['newFiles']): readonly { readonly path: string; readonly text: string }[] =>
  newFiles.filter(file => !isSecretPath(file.path)).slice(0, MAX_NEW_FILES).map(file => {
    const title = `file: ${safeText(file.path)} (new)`
    // Each entry and the newline after it fit in MAX_NEW_FILE, so two full files fit the section.
    const body = maskForModel(file.text.split('\n').slice(0, NEW_FILE_LINES).join('\n'), MAX_NEW_FILE - title.length - 2)
    return { path: file.path, text: body === '' ? title : `${title}\n${body}` }
  })

type DiffPart = { readonly text: string; readonly files: readonly string[]; readonly excerpts: Readonly<Record<string, string>> }

// Masked per file before its hunks are capped: past this much, a line-cut tail can only ever
// be dropped, since one masked line stays far below the margin over MAX_DIFF_FILE.
const MAX_DIFF_MASKED = MAX_DIFF_FILE * 2

// Files are masked one at a time in order and the loop stops once the budget is spent, and
// maskForModel stops at MAX_DIFF_MASKED, so a 1 MB diff is never redacted whole.
const diffPart = (sources: DigestSources, budget: number): DiffPart => {
  // Checked again here: the diff text is input, and a path git did not exclude must still not pass.
  const isAllowed = isPlanned(sources.plan)
  const byPath = new Map(splitDiffByFile(sources.diff ?? '').filter(file => !isSecretPath(file.path) && isAllowed(file.path)).map(file => [file.path, file.body]))
  const order = orderDiffFiles([...byPath.keys()], sources.touched, sources.added)
  const entries: string[] = []
  const files: string[] = []
  const excerpts: Record<string, string> = {}
  let used = 0
  for (const path of order) {
    const room = budget - used - (entries.length === 0 ? 0 : 1)
    const title = `file: ${safeText(path)}`
    if (room < title.length + 1 + CUT_MARK.length) break
    const body = byPath.get(path) ?? ''
    const isBinary = body !== '' && !body.startsWith('@@')
    const masked = isBinary || body === '' ? '' : maskForModel(body, MAX_DIFF_MASKED)
    const capped = capHunks(masked, Math.min(MAX_DIFF_FILE, room) - title.length - 1)
    const entry = isBinary ? `${title} (binary)`
      : body === '' ? `${title} (mode or rename only)`
      : capped === '' ? `${title}\n${CUT_MARK}` : `${title}\n${capped}`
    if (entry.length > room) continue
    entries.push(entry)
    files.push(path)
    if (capped !== '') excerpts[path] = capped
    used += entry.length + (entries.length === 1 ? 0 : 1)
  }
  return { text: entries.join('\n'), files, excerpts }
}

/**
 * The capped, masked digest a digest round sends. Sections go in the C.4 order, each masked and
 * cut to its cap; what a section leaves unused rolls over to the diff, which is built last, and
 * the whole text stays within MAX_DIGEST_CHARS. Empty sections are left out; `isEmpty` means
 * there is nothing beyond the header to quiz on.
 */
export const buildDigest = (sources: DigestSources): Digest => {
  const shown = fitting(newFilesOf(sources.newFiles), file => file.text, DIGEST_CAPS['new-files'])
  const changed = changedFiles(sources.numstat, isPlanned(sources.plan))
  const omitted = sources.plan?.omitted ?? 0
  const raw: Readonly<Record<Exclude<DigestSection, 'diff'>, string>> = {
    header: headerText(sources),
    commits: commitsText(sources.log),
    changed: [...changed.map(file => file.line), ...(omitted === 0 ? [] : [`… ${omitted} more changed file${omitted === 1 ? '' : 's'} not shown`])].join('\n'),
    'new-files': shown.map(file => file.text).join('\n'),
    layout: sources.focus === 'project' && sources.lsFiles !== undefined ? layoutSummary(sources.lsFiles, DIGEST_CAPS.layout) : '',
    asks: asksText(sources.rows),
    notes: notesText(sources.rows, sources.focus),
    trail: trailText(sources.rows),
  }
  const capOf = (section: Exclude<DigestSection, 'diff'>): number =>
    section === 'notes' && sources.focus === 'turn' ? MAX_TURN_NOTE : DIGEST_CAPS[section]
  const bodies = new Map<DigestSection, string>()
  let unused = 0
  let spent = 0
  for (const section of SECTION_ORDER) {
    if (section === 'diff') continue
    const body = maskForModel(raw[section], capOf(section))
    unused += Math.max(0, DIGEST_CAPS[section] - body.length)
    if (body === '') continue
    bodies.set(section, body)
    spent += body.length + frameCost(section)
  }
  const diffBudget = Math.min(DIGEST_CAPS.diff + unused, MAX_DIGEST_CHARS - spent - frameCost('diff'))
  const diff = diffPart(sources, diffBudget)
  if (diff.text !== '') bodies.set('diff', diff.text)
  const text = SECTION_ORDER.flatMap(section => {
    const body = bodies.get(section)
    return body === undefined ? [] : [framed(section, body)]
  }).join('\n\n')
  // Only what the model was actually shown may be named as a question's file.
  // Whole lines are compared, so `a.ts` is not listed because `src/a.ts` was.
  const shownLines = (section: DigestSection): ReadonlySet<string> => new Set((bodies.get(section) ?? '').split('\n'))
  const changedLines = shownLines('changed')
  const trailLines = shownLines('trail')
  const files = [...new Set([
    ...diff.files,
    ...shown.map(file => file.path),
    ...changed.filter(file => changedLines.has(safeText(file.line))).map(file => file.path),
    ...trailUses(sources.rows).flatMap(use => (use.path !== undefined && trailLines.has(safeText(`${use.tool} ${use.path}`)) ? [use.path] : [])),
  ])]
  const newExcerpts = Object.fromEntries(shown.map(file => [file.path, file.text]))
  const hasContent = SECTION_ORDER.some(section => section !== 'header' && bodies.has(section))
  return { text, files, excerpts: { ...newExcerpts, ...diff.excerpts }, isEmpty: !hasContent }
}
