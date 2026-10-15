import { describe, expect, test } from 'claude-code/testing'

import type { TreeEntry, TreeSnapshot } from '../types'
import {
  MAX_TOUCHED, anchorOf, ancestorsOf, badgeOf, diskSpelling, expandedDirs, reachableFolders, isInside, isMissingListing, openFolders, parseGitStatus,
  parseNumstat, relativeTo, reopenFor, rowParts, safeText, toEntries, toggleFolder, touch, treeLine, treeRows, windowRows,
} from '../hooks/fileTree'
import type { TreeRow } from '../hooks/fileTree'

const dir = (name: string): TreeEntry => ({ name, isDir: true })
const file = (name: string): TreeEntry => ({ name, isDir: false })

const snapshot = (over: Partial<TreeSnapshot> = {}): TreeSnapshot => ({
  rootName: 'ft-ws',
  listings: {
    '': [dir('.git'), dir('docs'), dir('hooks'), file('.gitignore'), file('debug.log')],
    hooks: [file('config.yaml'), file('README.md'), file('run-hook.ps1')],
  },
  marks: { 'hooks/README.md': 'M' },
  added: { 'hooks/README.md': 1 },
  ...over,
})

const keys = (rows: readonly TreeRow[]): readonly string[] => rows.map(row => row.key)

describe('file tree paths', () => {
  test('relativeTo keeps paths inside the root and refuses the rest', async () => {
    expect(relativeTo('/repo', '/repo/hooks/a.ts')).toBe('hooks/a.ts')
    expect(relativeTo('/repo/', '/repo/a.ts')).toBe('a.ts')
    expect(relativeTo('/repo', 'hooks/./a.ts')).toBe('hooks/a.ts')
    expect(relativeTo('/repo', '/repo2/a.ts')).toBe(undefined)
    expect(relativeTo('/repo', '/repo/../etc/passwd')).toBe(undefined)
    expect(relativeTo('/repo', 'a/../../x')).toBe(undefined)
    expect(relativeTo('/repo', '/repo')).toBe(undefined)
  })

  test('relativeTo reads Windows paths under a Windows root', async () => {
    expect(relativeTo('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src/a.ts')
    expect(relativeTo('C:\\proj\\', 'c:/PROJ/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('C:\\proj', 'src\\.\\a.ts')).toBe('src/a.ts')
    expect(relativeTo('\\\\host\\share\\proj', '\\\\host\\share\\proj\\a.ts')).toBe('a.ts')
    expect(relativeTo('C:\\proj', 'C:\\proj2\\a.ts')).toBe(undefined)
    expect(relativeTo('C:\\proj', 'D:\\proj\\a.ts')).toBe(undefined)
    expect(relativeTo('C:\\proj', 'C:\\proj\\..\\secret.txt')).toBe(undefined)
    expect(relativeTo('C:\\proj', '..\\x')).toBe(undefined)
    expect(relativeTo('C:\\proj', 'D:x')).toBe(undefined)
    expect(relativeTo('C:\\proj', '\\other\\a.ts')).toBe(undefined)
    // Only a Windows root splits on a backslash: elsewhere it is part of a name.
    expect(relativeTo('/repo', '/repo/a\\b.ts')).toBe('a\\b.ts')
  })

  test('isInside reads Windows real paths, and only under a Windows root', async () => {
    expect(isInside('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe(true)
    expect(isInside('C:\\proj', 'C:\\proj')).toBe(false)
    expect(isInside('C:\\proj', 'C:\\project\\a.ts')).toBe(false)
    expect(isInside('C:\\proj', 'src\\a.ts')).toBe(false)
    expect(isInside('/repo', 'C:/repo/a.ts')).toBe(false)
  })

  test('isInside needs a real path strictly below the root', async () => {
    expect(isInside('/repo', '/repo/a/b.ts')).toBe(true)
    expect(isInside('/repo', '/repo')).toBe(false)
    expect(isInside('/repo', '/repository/a.ts')).toBe(false)
    expect(isInside('/repo', '/etc/passwd')).toBe(false)
    expect(isInside('', '/a')).toBe(false)
  })

  test('ancestors and the open folders', async () => {
    expect(ancestorsOf('a/b/c.ts')).toEqual(['', 'a', 'a/b'])
    expect(ancestorsOf('c.ts')).toEqual([''])
    expect([...expandedDirs(['a/b/c.ts', 'd/e.ts'])].sort()).toEqual(['', 'a', 'a/b', 'd'])
    // Nothing inside .git or node_modules is ever opened.
    expect([...expandedDirs(['.git/config', 'node_modules/x/y.js'])]).toEqual([''])
  })

  test('listings put folders first in a case-blind order', async () => {
    const entries = toEntries([
      { name: 'b.ts', kind: 'file' }, { name: 'Z', kind: 'dir' }, { name: 'a', kind: 'dir' }, { name: 'link', kind: 'other' },
    ])
    expect(entries).toEqual([dir('a'), dir('Z'), file('b.ts'), file('link')])
  })
})

describe('git parsing', () => {
  test('porcelain marks, renames skip their old path, untracked folders are ignored', async () => {
    const output = [' M hooks/a.ts', 'A  new.ts', ' D gone.ts', 'R  renamed.ts', 'old.ts', '?? notes/', '?? with space.md', ''].join('\0')
    expect(parseGitStatus(output)).toEqual({
      'hooks/a.ts': 'M', 'new.ts': 'A', 'gone.ts': 'D', 'renamed.ts': 'R', 'with space.md': '?',
    })
  })

  test('porcelain paths are cut to the session root when it is a subfolder', async () => {
    const output = [' M app/src/a.ts', ' M other/b.ts', ''].join('\0')
    expect(parseGitStatus(output, 'app/')).toEqual({ 'src/a.ts': 'M' })
  })

  test('numstat: added lines, binaries count 0, renames take the new path', async () => {
    const output = ['3\t1\thooks/a.ts', '-\t-\timg.png', '2\t0\t', 'old.ts', 'new.ts', ''].join('\0')
    expect(parseNumstat(output)).toEqual({ 'hooks/a.ts': 3, 'img.png': 0, 'new.ts': 2 })
    expect(parseNumstat('', '')).toEqual({})
  })
})

describe('tree rows', () => {
  test('only folders on the way to a touched file open; badges roll up', async () => {
    const rows = treeRows({ snapshot: snapshot(), focus: null, touched: [{ path: 'hooks/README.md' }] })
    expect(keys(rows)).toEqual(['hooks', 'hooks/README.md', 'hooks/config.yaml', 'hooks/run-hook.ps1', '.git', 'docs', '.gitignore', 'debug.log'])
    const hooks = rows.find(row => row.key === 'hooks')
    expect(hooks?.isOpen).toBe(true)
    expect(hooks === undefined ? '' : badgeOf(hooks)).toBe('+1 M:1')
    const readme = rows.find(row => row.key === 'hooks/README.md')
    expect(readme?.tone).toBe('touched')
    expect(readme === undefined ? '' : badgeOf(readme)).toBe('+1 M')
    expect(rows.find(row => row.key === '.git')?.tone).toBe('dim')
    expect(rows.find(row => row.key === 'docs')?.isOpen).toBe(false)
  })

  test('the live file is active, a subagent file carries its worker', async () => {
    const rows = treeRows({
      snapshot: snapshot(),
      focus: { path: 'hooks/README.md', kind: 'edit', since: 1 },
      touched: [{ path: 'hooks/config.yaml', workerId: 'w1' }],
    })
    expect(rows.find(row => row.key === 'hooks/README.md')).toMatchObject({ tone: 'active', activeKind: 'edit' })
    expect(rows.find(row => row.key === 'hooks/config.yaml')).toMatchObject({ tone: 'worker', workerId: 'w1' })
  })

  test('a folder not yet listed is drawn closed', async () => {
    const rows = treeRows({ snapshot: snapshot(), focus: { path: 'docs/a.md', kind: 'read', since: 1 }, touched: [] })
    expect(rows.find(row => row.key === 'docs')?.isOpen).toBe(false)
    expect(isMissingListing(snapshot(), ['docs/a.md'])).toBe(true)
    expect(isMissingListing(snapshot(), ['hooks/a.md'])).toBe(false)
    expect(isMissingListing(null, [])).toBe(true)
  })

  test('long folders fold their tail but keep touched files', async () => {
    const many = Array.from({ length: 20 }, (_, index) => file(`f${String(index).padStart(2, '0')}.ts`))
    const rows = treeRows({
      snapshot: snapshot({ listings: { '': many }, marks: {}, added: {} }),
      focus: null,
      touched: [{ path: 'f18.ts' }],
      maxPerDir: 5,
    })
    expect(keys(rows)).toEqual(['f18.ts', 'f00.ts', 'f01.ts', 'f02.ts', 'f03.ts', 'more:/'])
    expect(rows.at(-1)?.name).toBe('… 15 more')
  })

  test('edited files list first, so a short window still shows them', async () => {
    const many = Array.from({ length: 20 }, (_, index) => file(`f${String(index).padStart(2, '0')}.ts`))
    const rows = treeRows({
      snapshot: snapshot({ listings: { '': [dir('docs'), dir('src'), file('a.md')], src: many }, marks: {}, added: {} }),
      focus: { path: 'src/f19.ts', kind: 'edit', since: 1 },
      touched: [{ path: 'src/f07.ts' }, { path: 'a.md' }],
    })
    expect(keys(rows).slice(0, 3)).toEqual(['src', 'src/f07.ts', 'src/f19.ts'])
    expect(keys(rows).slice(-3)).toEqual(['more:src/', 'a.md', 'docs'])
    const shown = windowRows(rows, anchorOf(rows, [{ path: 'src/f07.ts' }, { path: 'a.md' }]), 4)
    expect(keys(shown.rows)).toEqual(['src/f07.ts', 'src/f19.ts'])
  })

  test('an edit under .git or node_modules never moves its folder up', async () => {
    const rows = treeRows({ snapshot: snapshot(), focus: null, touched: [{ path: '.git/hooks/x' }] })
    expect(keys(rows)).toEqual(['.git', 'docs', 'hooks', '.gitignore', 'debug.log'])
  })

  test('a file only read keeps its place', async () => {
    const rows = treeRows({ snapshot: snapshot(), focus: { path: 'hooks/run-hook.ps1', kind: 'read', since: 1 }, touched: [] })
    expect(keys(rows)).toEqual(['.git', 'docs', 'hooks', 'hooks/config.yaml', 'hooks/README.md', 'hooks/run-hook.ps1', '.gitignore', 'debug.log'])
  })

  test('a click closes an open folder and opens a closed one', async () => {
    const toggles = toggleFolder(toggleFolder({}, 'hooks', true), 'docs', false)
    expect(toggles).toEqual({ hooks: false, docs: true })
    const listings = { ...snapshot().listings, docs: [file('guide.md')] }
    const rows = treeRows({ snapshot: snapshot({ listings }), focus: null, touched: [{ path: 'hooks/README.md' }], toggles })
    expect(rows.find(row => row.key === 'hooks')?.isOpen).toBe(false)
    expect(keys(rows)).not.toContain('hooks/README.md')
    expect(rows.find(row => row.key === 'docs')?.isOpen).toBe(true)
    expect(keys(rows)).toContain('docs/guide.md')
    expect(toggleFolder(toggles, 'hooks', false)).toEqual({ hooks: true, docs: true })
  })

  test('toggles lie over the session\'s own open folders', async () => {
    const open = openFolders(new Set(['', 'hooks']), { hooks: false, docs: true })
    expect([...open].sort()).toEqual(['', 'docs'])
  })

  test('an edit inside a folder closed by hand opens it again; opened ones stay', async () => {
    const toggles = { src: false, 'src/lib': false, docs: false, notes: true }
    expect(reopenFor(toggles, 'src/lib/a.ts')).toEqual({ docs: false, notes: true })
    // Unchanged, the same object comes back, so the state is not rewritten.
    expect(reopenFor(toggles, 'a.ts')).toBe(toggles)
  })

  test('only folders the tree can reach are read: a closed parent hides what it holds', async () => {
    expect([...reachableFolders(new Set(['', 'docs', 'docs/api', 'src/lib']))].sort()).toEqual(['', 'docs', 'docs/api'])
  })

  test('closing the live file\'s folder keeps the window on that folder', async () => {
    const listings = { '': [dir('a'), dir('b'), dir('hooks')], hooks: [file('x.ts')] }
    const focus = { path: 'hooks/x.ts', kind: 'edit', since: 1 } as const
    const rows = treeRows({ snapshot: snapshot({ listings, marks: {}, added: {} }), focus, touched: [], toggles: { hooks: false } })
    expect(rows[anchorOf(rows, [], focus)]?.key).toBe('hooks')
    expect(rows[anchorOf(rows, [{ path: 'hooks/x.ts' }])]?.key).toBe('hooks')
  })

  test('a Windows path that differs from the disk only in case takes the disk\'s spelling', async () => {
    expect(diskSpelling('SRC/App.ts', 'src/App.ts')).toBe('src/App.ts')
    expect(diskSpelling('src/App.ts', undefined)).toBe('src/App.ts')
    // A link that lands elsewhere keeps the spelling the tool used.
    expect(diskSpelling('src/link.ts', 'vendor/real.ts')).toBe('src/link.ts')
  })

  test('node_modules and .git stay shut in any case', async () => {
    expect([...expandedDirs(['Node_Modules/pkg/a.js', '.GIT/x'])]).toEqual([''])
  })

  test('deleted files add no lines', async () => {
    const rows = treeRows({
      snapshot: snapshot({ marks: { 'hooks/README.md': 'D' }, added: { 'hooks/README.md': 5 } }),
      focus: null,
      touched: [{ path: 'hooks/README.md' }],
    })
    expect(rows.find(row => row.key === 'hooks')?.added).toBe(0)
  })
})

describe('tree window', () => {
  const rows = (count: number): readonly TreeRow[] =>
    Array.from({ length: count }, (_, index) => ({
      key: String(index), kind: 'file' as const, depth: 0, name: String(index), isOpen: false, tone: 'plain' as const, changes: 0, added: 0,
    }))

  test('everything fits: no cuts', async () => {
    expect(windowRows(rows(4), 2, 6)).toEqual({ rows: rows(4), above: 0, below: 0 })
  })

  test('the drawn lines (rows plus cut markers) never exceed the budget', async () => {
    for (const anchor of [0, 5, 10, 19]) {
      for (const budget of [3, 4, 5, 8]) {
        const shown = windowRows(rows(20), anchor, budget)
        const lines = shown.rows.length + Number(shown.above > 0) + Number(shown.below > 0)
        expect(lines <= budget).toBe(true)
        expect(shown.rows.some(row => row.key === String(anchor))).toBe(true)
        expect(shown.above + shown.rows.length + shown.below).toBe(20)
      }
    }
  })

  test('top, middle and end anchors', async () => {
    expect(windowRows(rows(20), 0, 5)).toMatchObject({ above: 0, below: 16 })
    expect(windowRows(rows(20), 10, 5)).toMatchObject({ above: 9, below: 8 })
    expect(windowRows(rows(20), 19, 5)).toMatchObject({ above: 16, below: 0 })
  })

  test('the anchor is the live row, else the latest touched one, else the top', async () => {
    const drawn = treeRows({ snapshot: snapshot(), focus: null, touched: [{ path: 'hooks/config.yaml' }, { path: 'hooks/README.md' }] })
    expect(drawn[anchorOf(drawn, [{ path: 'hooks/config.yaml' }, { path: 'hooks/README.md' }])]?.key).toBe('hooks/README.md')
    expect(anchorOf(drawn, [])).toBe(0)
  })
})

describe('touches and the folded line', () => {
  test('a touch moves the file last and records who touched it', async () => {
    const once = touch([], 'a.ts', undefined)
    expect(touch(once, 'a.ts', undefined)).toBe(once)
    expect(touch(touch(once, 'b.ts', 'w1'), 'a.ts', undefined)).toEqual([{ path: 'b.ts', workerId: 'w1' }, { path: 'a.ts' }])
    expect(touch(once, 'a.ts', 'w2')).toEqual([{ path: 'a.ts', workerId: 'w2' }])
  })

  test('the list keeps only the latest touches', async () => {
    let touched = touch([], 'f0', undefined)
    for (let index = 1; index <= MAX_TOUCHED + 5; index += 1) touched = touch(touched, `f${index}`, undefined)
    expect(touched.length).toBe(MAX_TOUCHED)
    expect(touched.at(-1)?.path).toBe(`f${MAX_TOUCHED + 5}`)
  })

  test('the folded line names the live file, else the last one', async () => {
    expect(treeLine({ path: 'a/b.ts', kind: 'edit', since: 0 }, [])).toBe('editing a/b.ts')
    expect(treeLine({ path: 'a/b.ts', kind: 'read', since: 0 }, [])).toBe('reading a/b.ts')
    expect(treeLine(null, [{ path: 'c.ts' }])).toBe('last c.ts')
    expect(treeLine(null, [])).toBe(null)
  })
})

describe('row layout', () => {
  const row = (over: Partial<TreeRow>): TreeRow => ({
    key: 'a', kind: 'file', depth: 0, name: 'a', isOpen: false, tone: 'plain', changes: 0, added: 0, ...over,
  })

  test('glyphs mark folders, the live file and touched files', async () => {
    expect(rowParts(row({ kind: 'dir', isOpen: true }), 40).glyph).toBe('▾ ')
    expect(rowParts(row({ kind: 'dir' }), 40).glyph).toBe('▸ ')
    expect(rowParts(row({ tone: 'active' }), 40).glyph).toBe('● ')
    expect(rowParts(row({ tone: 'worker', workerId: 'w' }), 40).glyph).toBe('● ')
    expect(rowParts(row({ tone: 'touched' }), 40).glyph).toBe('· ')
    expect(rowParts(row({ depth: 2 }), 40).indent).toBe('    ')
  })

  test('a long name is cut so the badge still fits', async () => {
    const parts = rowParts(row({ name: 'check-referential-integrity.ps1', mark: 'M', added: 3, changes: 1, depth: 1 }), 24)
    expect(parts.badge).toBe('+3 M')
    expect(parts.name.endsWith('…')).toBe(true)
    const width = parts.indent.length + parts.glyph.length + parts.name.length + 2 + parts.badge.length
    expect(width).toBe(24)
  })
})

describe('safe text', () => {
  test('escape sequences and bidi controls in names are drawn inert', async () => {
    expect(safeText('a\u001b]52;c;AAAA\u0007b')).toBe('a?]52;c;AAAA?b')
    expect(safeText('evil\u202egnp.js')).toBe('evil?gnp.js')
    expect(safeText('plain-name.ts')).toBe('plain-name.ts')
  })

  test('rows and the folded line show the safe form', async () => {
    const row: TreeRow = { key: 'x\u001b[2Jy', kind: 'file', depth: 0, name: 'x\u001b[2Jy', isOpen: false, tone: 'plain', changes: 0, added: 0 }
    expect(rowParts(row, 40).name).toBe('x?[2Jy')
    expect(treeLine(null, [{ path: 'a\u0007.ts' }])).toBe('last a?.ts')
  })
})
