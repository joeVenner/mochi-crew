import { describe, expect, test } from 'claude-code/testing'

import type { TreeEntry, TreeSnapshot } from '../types'
import {
  MAX_TOUCHED, anchorOf, ancestorsOf, badgeOf, expandedDirs, isInside, isMissingListing, parseGitStatus,
  parseNumstat, relativeTo, toEntries, touch, treeLine, treeRows, windowRows,
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
    expect(keys(rows)).toEqual(['.git', 'docs', 'hooks', 'hooks/config.yaml', 'hooks/README.md', 'hooks/run-hook.ps1', '.gitignore', 'debug.log'])
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
    expect(keys(rows)).toEqual(['f00.ts', 'f01.ts', 'f02.ts', 'f03.ts', 'f04.ts', 'f18.ts', 'more:'])
    expect(rows.at(-1)?.name).toBe('… 14 more')
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
