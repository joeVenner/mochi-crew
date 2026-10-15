/** The editor variables the launcher reads, as `$.env.get` answers them. */
export type EditorEnv = { readonly VISUAL?: string; readonly EDITOR?: string }

/**
 * Editors that open a window of their own, with the flags that open a file in the running one.
 * A terminal editor (vim, nano, emacs -nw) is left out on purpose: run without a terminal it
 * would wait unseen until the run times out.
 */
const GUI_EDITORS: Readonly<Record<string, readonly string[]>> = {
  code: ['-g'],
  'code-insiders': ['-g'],
  codium: ['-g'],
  cursor: ['-g'],
  windsurf: ['-g'],
  zed: [],
  subl: [],
  mate: [],
  idea: [],
  webstorm: [],
  pycharm: [],
}

/**
 * The fallbacks, in order: VS Code's CLI, then the VS Code app by name (for when its `code`
 * command was never put on PATH), then macOS's default text editor. Never a bare `open` or
 * `xdg-open`: they launch whatever the file's type is tied to, so a click on a `.command` file
 * in a cloned repo would run it.
 */
const FALLBACKS: readonly (readonly string[])[] = [['code', '-g'], ['open', '-a', 'Visual Studio Code'], ['open', '-t']]

/** Where the launcher runs: Windows has no `open`, and its editor commands are `.cmd` shims. */
export type LaunchOptions = { readonly isWindows?: boolean }

/** The program an editor variable names, by its file name without a Windows extension. */
const programOf = (value: string): string | undefined => {
  const program = value.trim().split(/\s+/)[0]
  if (program === undefined || program === '') return undefined
  return program.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
}

/**
 * The commands to try, in order, to open `path` (absolute, so it can never read as a flag):
 * $VISUAL, then $EDITOR, each only when it is a known windowed editor and without the flags it
 * was set with (a `--wait` would hold the run open), then the fallbacks. Never a shell. An
 * empty list never happens: the fallbacks are always there.
 */
export const launchersFor = (env: EditorEnv, path: string, { isWindows = false }: LaunchOptions = {}): readonly (readonly string[])[] => {
  const chosen: (readonly string[])[] = []
  for (const value of [env.VISUAL, env.EDITOR]) {
    if (value === undefined) continue
    const program = programOf(value)
    const flags = program !== undefined && Object.hasOwn(GUI_EDITORS, program) ? GUI_EDITORS[program] : undefined
    const executable = value.trim().split(/\s+/)[0]
    // A bare name (found on PATH) or an absolute path; a relative one could pick up a project file.
    const isPlaced = executable !== undefined
      && (executable.startsWith('/') || /^[A-Za-z]:\\/.test(executable) || !/[\\/]/.test(executable))
    if (flags === undefined || executable === undefined || !isPlaced) continue
    chosen.push([executable, ...flags])
  }
  const seen = new Set<string>()
  return [...chosen, ...(isWindows ? [] : FALLBACKS)]
    .filter(argv => {
      const id = argv.join('\0')
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(argv => [...argv, path])
}

/** The variables a Windows shim lookup reads, as `$.env.get` answers them. */
export type ShimEnv = EditorEnv & { readonly PATH?: string; readonly LOCALAPPDATA?: string; readonly ProgramFiles?: string }

/** VS Code and its forks: on Windows each ships a `bin\<name>.cmd` shim around its CLI script. */
const SHIM_EDITORS: readonly string[] = ['code', 'code-insiders', 'codium', 'cursor', 'windsurf']

/** The variables a shim sets for the run: its CLI script runs under Electron as plain Node. */
export const SHIM_ENV: Readonly<Record<string, string>> = { ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }

const isDrivePath = (path: string): boolean => /^[A-Za-z]:\\/.test(path)

/**
 * The `.cmd` shims to look for on Windows, in order: the editors $VISUAL and $EDITOR name, then
 * VS Code, each in every absolute PATH folder, then VS Code's default install folders. A
 * relative PATH entry is skipped, so a shim planted in the project is never read.
 */
export const shimCandidates = (env: ShimEnv): readonly string[] => {
  const named = [env.VISUAL, env.EDITOR].map(value => (value === undefined ? undefined : programOf(value)))
  const programs = [...new Set([...named.filter(name => name !== undefined && SHIM_EDITORS.includes(name)), 'code'])]
  const pathDirs = (env.PATH ?? '').split(';').map(dir => dir.trim().replace(/^"|"$/g, '')).filter(isDrivePath)
  const vsCodeDirs = [
    env.LOCALAPPDATA === undefined ? undefined : `${env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\bin`,
    env.ProgramFiles === undefined ? undefined : `${env.ProgramFiles}\\Microsoft VS Code\\bin`,
  ].filter((dir): dir is string => dir !== undefined && isDrivePath(dir))
  const candidates = programs.flatMap(program => [...pathDirs, ...(program === 'code' ? vsCodeDirs : [])]
    .map(dir => `${dir.replace(/\\+$/, '')}\\${program}.cmd`))
  return [...new Set(candidates)]
}

/**
 * What a VS Code-style shim runs, as an argument vector that opens `path`: its `.exe` on its
 * `cli.js`, `%~dp0` filled in with the shim's folder. Undefined for any other shape, or when
 * a path is left unresolved or relative, so an odd `.cmd` is never guessed at.
 */
export const shimLauncher = (shim: string, shimPath: string, path: string): readonly string[] | undefined => {
  const binDir = shimPath.slice(0, shimPath.lastIndexOf('\\') + 1)
  const line = shim.split(/\r?\n/).find(text => /cli\.js"/i.test(text))
  if (line === undefined) return undefined
  const quoted = [...line.matchAll(/"([^"]*)"/g)].map(match => (match[1] ?? '').replaceAll('%~dp0', binDir))
  const [program, script] = quoted
  if (program === undefined || script === undefined) return undefined
  const isResolved = (text: string): boolean => isDrivePath(text) && !text.includes('%')
  if (!isResolved(program) || !isResolved(script) || !/\.exe$/i.test(program) || !/cli\.js$/i.test(script)) return undefined
  return [program, script, '-g', path]
}
