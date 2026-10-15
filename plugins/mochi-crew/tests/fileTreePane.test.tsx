import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type On = Parameters<TestBody>[1]
type Finder = { find: (q: { type: string; text: string }) => Promise<unknown> }

const PANE = { component: 'Pane', requestId: 'mochi-crew' } as const
// Tall enough for scene, full HUD and a tree; the folded line has its own test.
const paneProps = (bodyRows = 60) => ({
  title: 'Mochi',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows },
  view: {},
} as const)

const mochiCommand = (args: string) => ({
  command: 'mochi',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const)

const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 0, mtimeMs: 0, isLink: false })

const LISTINGS: Readonly<Record<string, ReturnType<typeof entry>[]>> = {
  '/repo': [entry('.git', 'dir'), entry('docs', 'dir'), entry('hooks', 'dir'), entry('debug.log', 'file')],
  '/repo/hooks': [entry('config.yaml', 'file'), entry('README.md', 'file')],
  '/repo/docs': [entry('guide.md', 'file')],
}

type Disk = {
  /** Every command the plugin ran, as argv. */
  runs: string[][]
  toasts: string[]
  /** Set to make git status and diff time out from now on. */
  isGitStuck: boolean
  /** The variables each non-git command ran with, in run order. */
  runEnvs: (Readonly<Record<string, string>> | undefined)[]
}

/** The machine around the project: its environment variables and files outside the repo. */
type Host = { readonly env?: Readonly<Record<string, string>>; readonly files?: Readonly<Record<string, string>> }

/**
 * The project as the engine would answer for it: a repo at /repo with one changed file. `realPaths`
 * overrides where a path resolves, to stand in for a symbolic link; `root` spells the repo another
 * way (a Windows drive), its listings the same; `host` answers variables and reads.
 */
const project = (on: On, realPaths: Readonly<Record<string, string>> = {}, root = '/repo', host: Host = {}): Disk => {
  const disk: Disk = { runs: [], toasts: [], isGitStuck: false, runEnvs: [] }
  // A macOS test host reads a `C:\` path as relative and puts its own folder in front.
  const listingOf = (path: string) => LISTINGS[`/repo${path.slice(path.indexOf(root) + root.length).replace(/\\/g, '/')}`] ?? []
  on('session.root', () => ({ value: root }))
  on('env.get', ($, e) => ({ value: host.env?.[e.name] }))
  on('fs.read', ($, e) => {
    // Matched by ending, as the listings are: a macOS host prefixes a `C:\` path.
    const text = Object.entries(host.files ?? {}).find(([path]) => e.path.endsWith(path))?.[1]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('fs.list', ($, e) => ({ value: listingOf(e.path) }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: realPaths[e.path] ?? e.path } as never }))
  on('process.run', ($, e) => {
    disk.runs.push([...e.argv])
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } as never })
    const [program] = e.argv
    if (program !== 'git') disk.runEnvs.push(e.init?.env)
    const verb = e.argv.find(arg => ['rev-parse', 'status', 'diff', 'branch'].includes(arg))
    if (program !== 'git') return ok('')
    if (disk.isGitStuck && (verb === 'status' || verb === 'diff')) throw new Error('timed out')
    if (verb === 'rev-parse') return ok('\n')
    if (verb === 'status') return ok(' M hooks/README.md\0')
    if (verb === 'diff') return ok('1\t0\thooks/README.md\0')
    if (verb === 'branch') return ok('main\n')
    return ok('')
  })
  on('ui.toast', ($, e) => {
    disk.toasts.push(e.text)
    return { value: undefined }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
  return disk
}

const shows = async (ui: Finder, text: string) => expect(await ui.find({ type: 'Text', text })).toBeDefined()

describe('file tree pane', () => {
  test('an edit opens its folder, badges it from git, and a click opens it in the editor', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const disk = project(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })

    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })

    await shows(ui, 'repo')
    await shows(ui, 'main')
    await shows(ui, 'config.yaml')
    await shows(ui, 'README.md')
    await shows(ui, '+1')
    await shows(ui, 'M:1')

    await ui.press({ key: 'file:hooks/README.md' })
    // A press resolves once the work its onPress left running is done.
    expect(disk.toasts).toContain('Opened hooks/README.md.')
    expect(disk.runs).toContainEqual(['code', '-g', '/repo/hooks/README.md'])
    await ui.unmount()
  })

  test('a click on a folder closes or opens it, and a new edit inside opens it again', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    project(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })
    const isShown = async (text: string) => (await ui.find({ type: 'Text', text })) !== undefined

    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })
    await shows(ui, 'config.yaml')

    await ui.press({ key: 'dir:hooks' })
    expect(await isShown('config.yaml')).toBe(false)

    await ui.press({ key: 'dir:docs' })
    await shows(ui, 'guide.md')

    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'b', new_string: 'c' })
    await shows(ui, 'config.yaml')
    await shows(ui, 'guide.md')
    await ui.unmount()
  })

  test('on Windows, an edit shows in the tree and a click opens it', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const shim = '@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"%~dp0..\\Code.exe" "%~dp0..\\resources\\app\\out\\cli.js" %*\r\n'
    const disk = project(on, {}, 'C:\\repo', {
      env: { PATH: 'C:\\Windows;C:\\VSCode\\bin' },
      files: { 'C:\\VSCode\\bin\\code.cmd': shim },
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })

    await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\hooks\\README.md', old_string: 'a', new_string: 'b' })

    await shows(ui, 'repo')
    await shows(ui, 'config.yaml')
    await shows(ui, 'README.md')
    await shows(ui, 'M:1')

    await ui.press({ key: 'file:hooks/README.md' })
    expect(disk.toasts).toContain('Opened hooks/README.md.')
    // VS Code's code.cmd needs a shell, so the plugin runs what it runs, by argument vector.
    const launched = disk.runs.filter(argv => argv[0] !== 'git')
    expect(launched.map(argv => argv.slice(0, 3))).toEqual([
      ['C:\\VSCode\\bin\\..\\Code.exe', 'C:\\VSCode\\bin\\..\\resources\\app\\out\\cli.js', '-g'],
    ])
    expect(launched[0]?.at(-1)?.endsWith('C:\\repo/hooks/README.md')).toBe(true)
    expect(disk.runEnvs).toEqual([{ ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' }])
    await ui.unmount()
  })

  test('a file that resolves outside the project is never opened', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const disk = project(on, { '/repo/hooks/README.md': '/etc/passwd' })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })

    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })
    await shows(ui, 'README.md')
    await ui.press({ key: 'file:hooks/README.md' })

    expect(disk.toasts.some(text => text.includes('not a file in this project'))).toBe(true)
    expect(disk.runs.some(argv => argv[0] !== 'git')).toBe(false)
    await ui.unmount()
  })

  test('a git call that times out keeps the last badges', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const disk = project(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })
    await shows(ui, 'M:1')

    disk.isGitStuck = true
    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/config.yaml', old_string: 'a', new_string: 'b' })

    await shows(ui, 'config.yaml')
    await shows(ui, 'M:1')
    await ui.unmount()
  })

  test('a short pane folds the tree into one line naming the turn\'s file', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    project(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps(30) })

    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })

    await shows(ui, 'editing hooks/README.md')
    expect(await ui.find({ type: 'Text', text: 'config.yaml' })).toBeUndefined()
    await ui.unmount()
  })

  test('once the turn is handed back, the tree points at the last file, not a live one', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    project(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps(30) })

    await $.turn.start({ text: 'fix it', turnId: 't1' })
    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/README.md', old_string: 'a', new_string: 'b' })
    await shows(ui, 'editing hooks/README.md')
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })

    await shows(ui, 'last hooks/README.md')
    await ui.unmount()
  })

  test('/mochi files turns the tree off and on, and is saved', async ($, on) => {
    mock.clock(on)
    const saved = new Map<string, unknown>()
    on('store.set', ($, e) => {
      saved.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.get', ($, e) => ({ value: saved.get(e.key) }))
    project(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })
    await shows(ui, 'files')

    const off = await $.command.run(mochiCommand('files off'))
    expect(off.text).toBe('File tree off.')
    expect(saved.get('treeOn')).toBe(false)

    const flipped = await $.command.run(mochiCommand('files'))
    expect(flipped.text).toBe('File tree on.')
    expect(saved.get('treeOn')).toBe(true)
    await ui.unmount()
  })
})
