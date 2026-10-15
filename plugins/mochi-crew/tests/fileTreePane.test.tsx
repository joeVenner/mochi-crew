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
}

type Disk = {
  /** Every command the plugin ran, as argv. */
  runs: string[][]
  toasts: string[]
  /** Set to make git status and diff time out from now on. */
  isGitStuck: boolean
}

/**
 * The project as the engine would answer for it: a repo at /repo with one changed file. `realPaths`
 * overrides where a path resolves, to stand in for a symbolic link; `root` spells the repo another
 * way (a Windows drive), its listings the same.
 */
const project = (on: On, realPaths: Readonly<Record<string, string>> = {}, root = '/repo'): Disk => {
  const disk: Disk = { runs: [], toasts: [], isGitStuck: false }
  // A macOS test host reads a `C:\` path as relative and puts its own folder in front.
  const listingOf = (path: string) => LISTINGS[`/repo${path.slice(path.indexOf(root) + root.length).replace(/\\/g, '/')}`] ?? []
  on('session.root', () => ({ value: root }))
  on('env.get', () => ({ value: undefined }))
  on('fs.list', ($, e) => ({ value: listingOf(e.path) }))
  on('fs.stat', ($, e) => ({ value: { kind: 'file', size: 0, mtimeMs: 0, isLink: false, realPath: realPaths[e.path] ?? e.path } as never }))
  on('process.run', ($, e) => {
    disk.runs.push([...e.argv])
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } as never })
    const [program] = e.argv
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

  test('on Windows, an edit shows in the tree and a click opens it', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const disk = project(on, {}, 'C:\\repo')
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: paneProps() })

    await $.tool.call({ tool: 'Edit', file_path: 'C:\\repo\\hooks\\README.md', old_string: 'a', new_string: 'b' })

    await shows(ui, 'repo')
    await shows(ui, 'config.yaml')
    await shows(ui, 'README.md')
    await shows(ui, 'M:1')

    await ui.press({ key: 'file:hooks/README.md' })
    expect(disk.toasts).toContain('Opened hooks/README.md.')
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
