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

/** The fallbacks, in order: VS Code's CLI, then the desktop's own opener (macOS, then Linux). */
const FALLBACKS: readonly (readonly string[])[] = [['code', '-g'], ['open'], ['xdg-open']]

/** The program an editor variable names, by its file name without a Windows extension. */
const programOf = (value: string): string | undefined => {
  const program = value.trim().split(/\s+/)[0]
  if (program === undefined || program === '') return undefined
  return program.split(/[\\/]/).pop()?.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase()
}

/**
 * The commands to try, in order, to open `path` (absolute, so it can never read as a flag):
 * $VISUAL, then $EDITOR, each only when it is a known windowed editor and without the flags it
 * was set with (a `--wait` would hold the run open), then the fallbacks. Never a shell.
 */
export const launchersFor = (env: EditorEnv, path: string): readonly (readonly string[])[] => {
  const chosen: (readonly string[])[] = []
  for (const value of [env.VISUAL, env.EDITOR]) {
    if (value === undefined) continue
    const program = programOf(value)
    const flags = program === undefined ? undefined : GUI_EDITORS[program]
    const executable = value.trim().split(/\s+/)[0]
    if (flags === undefined || executable === undefined) continue
    chosen.push([executable, ...flags])
  }
  const seen = new Set<string>()
  return [...chosen, ...FALLBACKS]
    .filter(argv => {
      const id = argv.join('\0')
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    .map(argv => [...argv, path])
}
