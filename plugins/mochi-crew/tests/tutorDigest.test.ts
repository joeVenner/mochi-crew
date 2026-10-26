import { describe, expect, test } from 'claude-code/testing'

import type { TouchedFile } from '../types'
import {
  DIFF_EXCLUDES,
  DIGEST_CAPS,
  MAX_DIGEST_CHARS,
  buildDigest,
  capHunks,
  diffArgs,
  isSecretPath,
  layoutSummary,
  logArgs,
  maskForModel,
  numstatArgs,
  orderDiffFiles,
  splitDiffByFile,
  toTranscriptRows,
  type DigestSources,
  type TranscriptRow,
} from '../hooks/tutorDigest'
import { MASK } from '../hooks/redact'

// Dummy, non-functional credentials only.
const DUMMY_KEY = 'sk-test-123456789abcdefgh'

const fileDiff = (path: string, hunks: readonly string[]): string =>
  [`diff --git a/${path} b/${path}`, 'index 1111111..2222222 100644', `--- a/${path}`, `+++ b/${path}`, ...hunks].join('\n')

const hunk = (start: number, lines: number, width = 40): string =>
  [`@@ -${start},${lines} +${start},${lines} @@`, ...Array.from({ length: lines }, (_, index) => `+${'x'.repeat(width)} ${start + index}`)].join('\n')

const SOURCES: DigestSources = {
  rootName: 'repo',
  branch: 'main',
  focus: 'recent',
  newFiles: [],
  rows: [],
  touched: [],
  added: {},
}

// The diff section's own text, up to the next section heading.
const diffSection = (text: string): string => {
  const from = text.indexOf('[diff]')
  if (from === -1) return ''
  const next = text.indexOf('\n\n[', from)
  return text.slice(from, next === -1 ? undefined : next)
}

const row = (role: 'user' | 'assistant', text: string, toolUses: TranscriptRow['toolUses'] = []): TranscriptRow => ({ role, text, toolUses })

describe('tutorDigest', () => {
  test('maskForModel masks sk-, ghp_, AKIA, JWT, API_KEY= and auth headers', async () => {
    const text = [
      `echo ${DUMMY_KEY}`,
      'token ghp_dummyDummyDummyDummy1234',
      'aws AKIAABCDEFGHIJKLMNOP',
      'jwt eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2Q',
      'API_KEY=hunter2hunter2',
      'Authorization: Bearer abc123def456ghi',
    ].join('\n')
    const masked = maskForModel(text, 10_000)
    for (const secret of [DUMMY_KEY, 'ghp_dummy', 'AKIAABCD', 'eyJhbGciOiJI', 'hunter2', 'abc123def456ghi']) expect(masked.includes(secret)).toBe(false)
    expect(masked.split('\n').length).toBe(6)
    expect(masked.includes(MASK)).toBe(true)
  })

  test('maskForModel strips PEM private key blocks', async () => {
    const pem = ['before', '+-----BEGIN RSA PRIVATE KEY-----', '+MIIEdummydummydummy', '+-----END RSA PRIVATE KEY-----', 'after'].join('\n')
    expect(maskForModel(pem, 10_000)).toBe('before\n+[private key removed]\nafter')
    const unclosed = 'keep\n-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEdummy'
    expect(maskForModel(unclosed, 10_000)).toBe('keep\n[private key removed]')
  })

  test('maskForModel cuts a 5000-char line before redacting', async () => {
    const line = `${'a'.repeat(4_990)} ${DUMMY_KEY}`
    const started = Date.now()
    const masked = maskForModel(line, 10_000)
    expect(masked.length).toBe(300)
    expect(masked).toBe('a'.repeat(300))
    expect(Date.now() - started < 1_000).toBe(true)
    // Within the slice, a secret is still masked.
    expect(maskForModel(`x ${DUMMY_KEY}`, 10_000)).toBe(`x ${MASK}`)
  })

  test('maskForModel keeps newlines and replaces ANSI escapes', async () => {
    expect(maskForModel('one\n\u001b[31mred\u001b[0m\nthree', 1_000)).toBe('one\n?[31mred?[0m\nthree')
    expect(maskForModel('tab\there', 1_000)).toBe('tab?here')
  })

  test('maskForModel never exceeds its cap', async () => {
    const text = Array.from({ length: 200 }, (_, index) => `line ${index} ${'y'.repeat(index % 50)}`).join('\n')
    for (const cap of [0, 1, 7, 50, 199, 1_000, 3_333]) {
      const masked = maskForModel(text, cap)
      expect(masked.length <= cap).toBe(true)
      // Cut at a line boundary: every kept line is whole.
      if (cap >= 7) expect(text.startsWith(masked)).toBe(true)
    }
    expect(maskForModel('z'.repeat(500), 120).length).toBe(120)
  })

  test('isSecretPath flags .env.local, prod.pem, id_ed25519, credentials.json and spares env.ts, keyboard.ts', async () => {
    for (const path of ['.env.local', 'config/prod.pem', '/home/u/.ssh/id_ed25519', 'credentials.json', 'secrets/app.ts', 'node_modules/x/index.js', 'dist/app.js', 'web\\.npmrc', 'yarn.lock', 'app.min.js', 'state.tfstate.backup']) {
      expect(isSecretPath(path)).toBe(true)
    }
    for (const path of ['env.ts', 'hooks/keyboard.ts', 'src/environment.ts', 'README.md', 'distribution/a.ts', '']) {
      expect(isSecretPath(path)).toBe(false)
    }
  })

  test('DIFF_EXCLUDES covers env, keys, lockfiles and dist', async () => {
    for (const pattern of ['**/.env*', '**/*.pem', '**/*.key', '**/id_rsa*', '**/package-lock.json', '**/yarn.lock', '**/*.lock', '**/dist/**', '**/node_modules/**', '**/*secret*']) {
      expect(DIFF_EXCLUDES.includes(`:(exclude,glob)${pattern}`)).toBe(true)
    }
    expect(DIFF_EXCLUDES.every(spec => spec.startsWith(':(exclude,glob)'))).toBe(true)
    expect(diffArgs()).toEqual(['diff', '--no-color', '--no-ext-diff', '--no-textconv', '-U2', 'HEAD', '--', '.', ...DIFF_EXCLUDES])
    expect(numstatArgs()).toEqual(['diff', '--numstat', '--no-color', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.', ...DIFF_EXCLUDES])
    expect(logArgs()).toEqual(['log', '-n', '8', '--no-color', '--no-show-signature', '--format=%h%x09%s'])
  })

  test('splitDiffByFile splits on diff --git headers', async () => {
    const diff = [
      fileDiff('src/a.ts', [hunk(1, 2)]),
      'diff --git a/gone.ts b/gone.ts', 'deleted file mode 100644', 'index 1..0', '--- a/gone.ts', '+++ /dev/null', '@@ -1 +0,0 @@', '-old',
      'diff --git a/img.png b/img.png', 'index 1..2 100644', 'Binary files a/img.png and b/img.png differ',
      'diff --git a/with space.ts b/with space.ts', 'index 1..2 100644', '--- a/with space.ts\t', '+++ b/with space.ts\t', '@@ -1 +1 @@', '+y',
      '',
    ].join('\n')
    const files = splitDiffByFile(diff)
    expect(files.map(file => file.path)).toEqual(['src/a.ts', 'gone.ts', 'img.png', 'with space.ts'])
    expect(files[0]?.body.startsWith('@@ -1,2')).toBe(true)
    expect(files[0]?.body.includes('index ')).toBe(false)
    expect(files[2]?.body).toBe('Binary files a/img.png and b/img.png differ')
    expect(splitDiffByFile('')).toEqual([])
  })

  test('capHunks keeps whole hunks only', async () => {
    const body = [hunk(1, 5), hunk(20, 5), hunk(40, 5)].join('\n')
    expect(capHunks(body, body.length)).toBe(body)
    const one = hunk(1, 5)
    const cut = capHunks(body, one.length + 20)
    expect(cut).toBe(`${one}\n… (cut)`)
    expect(cut.length <= one.length + 20).toBe(true)
    expect(capHunks(body, 30)).toBe('')
  })

  test('orderDiffFiles puts touched files first, newest first', async () => {
    const touched: readonly TouchedFile[] = [{ path: 'b.ts' }, { path: 'wt.ts', worktree: '/other' }, { path: 'a.ts' }, { path: 'missing.ts' }]
    const ordered = orderDiffFiles(['big.ts', 'a.ts', 'small.ts', 'b.ts', 'wt.ts'], touched, { 'big.ts': 90, 'small.ts': 3, 'wt.ts': 50 })
    expect(ordered).toEqual(['a.ts', 'b.ts', 'big.ts', 'wt.ts', 'small.ts'])
  })

  test('layoutSummary folds to two levels with counts', async () => {
    const ls = ['README.md', 'hooks/a.ts', 'hooks/b.ts', 'plugins/mochi/x.ts', 'plugins/mochi/deep/y.ts', 'plugins/other/z.ts', ''].join('\0')
    expect(layoutSummary(ls, 1_000)).toBe('./ 1 file\nhooks/ 2 files\nplugins/mochi/ 2 files\nplugins/other/ 1 file')
    const short = layoutSummary(ls, 40)
    expect(short.length <= 40).toBe(true)
    expect(short.endsWith('more folders')).toBe(true)
    expect(layoutSummary('', 100)).toBe('')
  })

  test('toTranscriptRows keeps tool and path only, never result, text or command', async () => {
    const messages = [
      { role: 'user' as const, text: 'old', toolUses: [] },
      {
        role: 'assistant' as const,
        text: 'Editing now',
        toolUses: [
          { tool: 'Edit', input: { file_path: '/repo/src/a.ts', old_string: 'SENTINEL_INPUT' }, result: 'SENTINEL_RESULT', text: 'SENTINEL_TEXT' },
          { tool: 'Bash', input: { command: `cat .env SENTINEL_COMMAND ${DUMMY_KEY}` } },
          { tool: 'NotebookEdit', input: { notebook_path: 'nb/x.ipynb' } },
          { tool: 'Read', input: { file_path: '/home/u/.ssh/config' } },
        ],
        toolResults: ['SENTINEL_TOOLRESULT'],
      },
    ]
    const rows = toTranscriptRows(messages, '/repo', 1)
    expect(rows.length).toBe(1)
    expect(rows[0]?.toolUses).toEqual([{ tool: 'Edit', path: 'src/a.ts' }, { tool: 'Bash' }, { tool: 'NotebookEdit', path: 'nb/x.ipynb' }, { tool: 'Read' }])
    expect(JSON.stringify(rows).includes('SENTINEL')).toBe(false)
  })

  test('buildDigest stays under 16000 with a 1 MB diff', async () => {
    const files = Array.from({ length: 400 }, (_, index) => fileDiff(`src/f${index}.ts`, [hunk(1, 30, 60), hunk(100, 30, 60)]))
    const diff = files.join('\n')
    expect(diff.length > 1_000_000).toBe(true)
    const rows = Array.from({ length: 40 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', 'q'.repeat(2_000), [{ tool: 'Edit', path: `src/f${index}.ts` }]))
    const digest = buildDigest({
      ...SOURCES,
      focus: 'project',
      log: Array.from({ length: 8 }, (_, index) => `abc${index}\t${'subject '.repeat(30)}`).join('\n'),
      numstat: Array.from({ length: 400 }, (_, index) => `60\t0\tsrc/f${index}.ts`).join('\n'),
      diff,
      lsFiles: Array.from({ length: 5_000 }, (_, index) => `d${index % 300}/e${index % 7}/f${index}.ts`).join('\0'),
      newFiles: [{ path: 'new.ts', text: 'n'.repeat(5_000) }, { path: 'new2.ts', text: 'm\n'.repeat(500) }],
      rows,
    })
    expect(digest.text.length <= MAX_DIGEST_CHARS).toBe(true)
    expect(digest.isEmpty).toBe(false)
    for (const excerpt of Object.values(digest.excerpts)) expect(excerpt.length <= 2_000).toBe(true)
  })

  test('buildDigest never contains a tool-result sentinel', async () => {
    const messages = [
      { role: 'user' as const, text: 'please fix the login', toolUses: [] },
      {
        role: 'assistant' as const,
        text: 'Fixed it.',
        toolUses: [{ tool: 'Bash', input: { command: 'echo SENTINEL_COMMAND' }, result: 'SENTINEL_RESULT', text: 'SENTINEL_TEXT' }],
        toolResults: ['SENTINEL_TOOLRESULT'],
      },
    ]
    const digest = buildDigest({ ...SOURCES, rows: toTranscriptRows(messages, '/repo', 200) })
    expect(digest.text.includes('SENTINEL')).toBe(false)
    expect(digest.text.includes('please fix the login')).toBe(true)
    expect(digest.text.includes('Bash')).toBe(true)
  })

  test('buildDigest rolls unused budget into the diff', async () => {
    const diff = Array.from({ length: 20 }, (_, index) => fileDiff(`src/f${index}.ts`, [hunk(1, 20, 60)])).join('\n')
    const alone = diffSection(buildDigest({ ...SOURCES, diff }).text)
    expect(alone.length > DIGEST_CAPS.diff).toBe(true)
    const crowded = buildDigest({
      ...SOURCES,
      diff,
      rows: Array.from({ length: 12 }, (_, index) => row(index % 2 === 0 ? 'user' : 'assistant', `ask ${'w'.repeat(400)}`)),
      log: Array.from({ length: 8 }, (_, index) => `abc${index}\t${'subject '.repeat(12)}`).join('\n'),
    })
    expect(crowded.text.length <= MAX_DIGEST_CHARS).toBe(true)
    const crowdedDiff = diffSection(crowded.text)
    expect(crowdedDiff.length < alone.length).toBe(true)
    expect(crowdedDiff.length > DIGEST_CAPS.diff).toBe(true)
  })

  test('buildDigest marks a binary diff as one line', async () => {
    const diff = ['diff --git a/logo.png b/logo.png', 'index 1..2 100644', 'Binary files a/logo.png and b/logo.png differ'].join('\n')
    const digest = buildDigest({ ...SOURCES, diff })
    expect(digest.text.includes('file: logo.png (binary)')).toBe(true)
    expect(digest.text.includes('Binary files')).toBe(false)
    expect(digest.files).toEqual(['logo.png'])
  })

  test('buildDigest is empty with no repo and no messages', async () => {
    const digest = buildDigest({ rootName: 'repo', focus: 'recent', newFiles: [], rows: [], touched: [], added: {} })
    expect(digest.isEmpty).toBe(true)
    expect(digest.files).toEqual([])
    expect(digest.excerpts).toEqual({})
  })

  test('buildDigest adds layout only for the project focus', async () => {
    const lsFiles = ['hooks/a.ts', 'tests/a.test.ts'].join('\0')
    const project = buildDigest({ ...SOURCES, focus: 'project', lsFiles })
    expect(project.text.includes('[layout]\nhooks/ 1 file')).toBe(true)
    expect(project.isEmpty).toBe(false)
    for (const focus of ['recent', 'turn'] as const) {
      expect(buildDigest({ ...SOURCES, focus, lsFiles }).text.includes('[layout]')).toBe(false)
    }
  })

  test('buildDigest orders touched files first, keeps excerpts and masks diff secrets', async () => {
    const diff = [fileDiff('a.ts', [hunk(1, 2)]), fileDiff('b.ts', ['@@ -1 +1 @@', `+const key = '${DUMMY_KEY}'`])].join('\n')
    const digest = buildDigest({ ...SOURCES, diff, touched: [{ path: 'b.ts' }], added: { 'a.ts': 2, 'b.ts': 1 } })
    expect(digest.files.slice(0, 2)).toEqual(['b.ts', 'a.ts'])
    expect(digest.text.indexOf('file: b.ts') < digest.text.indexOf('file: a.ts')).toBe(true)
    expect(digest.text.includes(DUMMY_KEY)).toBe(false)
    expect(digest.excerpts['b.ts']?.includes(MASK)).toBe(true)
  })

  test('splitDiffByFile and the changed list decode git-quoted non-ASCII paths', async () => {
    const quoted = '"src/caf\\303\\251 \\"x\\".ts"'
    const diff = [`diff --git "a/src/caf\\303\\251 \\"x\\".ts" "b/src/caf\\303\\251 \\"x\\".ts"`, 'index 1..2 100644', `--- ${quoted.replace('"src', '"a/src')}`, `+++ ${quoted.replace('"src', '"b/src')}`, '@@ -1 +1 @@', '+y'].join('\n')
    expect(splitDiffByFile(diff).map(file => file.path)).toEqual(['src/café "x".ts'])
    const binary = ['diff --git "a/\\346\\227\\245.png" "b/\\346\\227\\245.png"', 'index 1..2 100644', 'Binary files "a/\\346\\227\\245.png" and "b/\\346\\227\\245.png" differ'].join('\n')
    expect(splitDiffByFile(binary).map(file => file.path)).toEqual(['日.png'])
    const digest = buildDigest({ ...SOURCES, numstat: `1\t0\t${quoted}` })
    expect(digest.text.includes('src/café "x".ts +1 -0')).toBe(true)
    expect(digest.files).toEqual(['src/café "x".ts'])
  })

  test('buildDigest drops secret-shaped paths that case-sensitive git excludes miss', async () => {
    const diff = [fileDiff('config/Credentials.json', ['@@ -1 +1 @@', '+{"user": "SENTINEL_LEAK"}']), fileDiff('src/a.ts', [hunk(1, 2)])].join('\n')
    const digest = buildDigest({ ...SOURCES, diff, numstat: '1\t0\tconfig/Credentials.json\n2\t0\tsrc/a.ts\n1\t0\tProd.PEM' })
    expect(digest.text.includes('SENTINEL_LEAK')).toBe(false)
    expect(digest.text.includes('Credentials')).toBe(false)
    expect(digest.text.includes('Prod.PEM')).toBe(false)
    expect(digest.files).toEqual(['src/a.ts'])
  })

  test('buildDigest shows two full new files and skips a secret one', async () => {
    const long = Array.from({ length: 80 }, (_, index) => `line ${index} ${'v'.repeat(30)}`).join('\n')
    // Short lines: only the 60-line rule can drop the ones past it.
    const short = Array.from({ length: 80 }, (_, index) => `L${index}`).join('\n')
    const digest = buildDigest({ ...SOURCES, newFiles: [{ path: '.env.local', text: `TOKEN=${DUMMY_KEY}` }, { path: 'src/one.ts', text: short }, { path: 'src/two.ts', text: long }, { path: 'src/three.ts', text: long }] })
    expect(digest.files).toEqual(['src/one.ts', 'src/two.ts'])
    expect(digest.text.includes('.env.local')).toBe(false)
    expect(digest.excerpts['src/one.ts']?.endsWith('\nL59')).toBe(true)
    expect(digest.text.includes('L60')).toBe(false)
    expect((digest.excerpts['src/two.ts']?.length ?? 0) > 900).toBe(true)
    for (const path of ['src/one.ts', 'src/two.ts']) expect((digest.excerpts[path]?.length ?? 0) < 1_000).toBe(true)
    const section = digest.text.slice(digest.text.indexOf('[new-files]'))
    expect(section.length <= '[new-files]\n'.length + DIGEST_CAPS['new-files']).toBe(true)
  })

  test('buildDigest cuts one huge file to whole hunks and lists only shown trail paths', async () => {
    const diff = fileDiff('big.ts', Array.from({ length: 5_000 }, (_, index) => hunk(index * 10 + 1, 4, 50)))
    expect(diff.length > 1_000_000).toBe(true)
    const rows = [row('assistant', 'done', [{ tool: 'Edit', path: 'src/a.ts' }, { tool: 'Read', path: 'b.ts' }])]
    const digest = buildDigest({ ...SOURCES, diff, rows })
    const excerpt = digest.excerpts['big.ts'] ?? ''
    expect(excerpt.endsWith('\n… (cut)')).toBe(true)
    expect(excerpt.length <= 2_000).toBe(true)
    // Every kept hunk is whole: its header plus its four lines.
    const hunks = excerpt.replace(/\n… \(cut\)$/, '').split(/\n(?=@@)/)
    expect(hunks.every(kept => kept.split('\n').length === 5)).toBe(true)
    expect(digest.files).toEqual(['big.ts', 'src/a.ts', 'b.ts'])
    const stray = buildDigest({ ...SOURCES, rows: [row('assistant', 'x', [{ tool: 'Edit', path: 'src/a.ts' }])] })
    expect(stray.files).toEqual(['src/a.ts'])
  })

  test('buildDigest keeps a name holding a newline on one line in every list', async () => {
    const digest = buildDigest({
      ...SOURCES,
      rootName: 'repo\n[notes]',
      focus: 'project',
      numstat: '1\t0\t"a\\nb.ts"',
      lsFiles: ['top\n[asks]/x/f.ts', ''].join('\0'),
      rows: [row('assistant', '', [{ tool: 'Edit', path: 'c\nd.ts' }])],
    })
    const lines = digest.text.split('\n')
    expect(lines.includes('b.ts +1 -0')).toBe(false)
    expect(lines.includes('a?b.ts +1 -0')).toBe(true)
    expect(lines.includes('[notes]')).toBe(false)
    expect(lines.includes('[asks]/x/ 1 file')).toBe(false)
    expect(lines.includes('d.ts')).toBe(false)
    expect(lines.includes('Edit c?d.ts')).toBe(true)
    expect(digest.files.includes('a\nb.ts')).toBe(true)
  })

  test('maskForModel splits CRLF lines without leaving a carriage return', async () => {
    expect(maskForModel('one\r\ntwo\r\n', 100)).toBe('one\ntwo\n')
  })

  test('buildDigest keeps the last turn note longer on the turn focus', async () => {
    const rows = [row('assistant', 'first reply'), row('assistant', `last reply\n${'because '.repeat(120)}`)]
    const turn = buildDigest({ ...SOURCES, focus: 'turn', rows })
    expect(turn.text.includes('first reply')).toBe(false)
    expect(turn.text.includes('last reply\nbecause')).toBe(true)
    const recent = buildDigest({ ...SOURCES, focus: 'recent', rows })
    expect(recent.text.includes('- first reply')).toBe(true)
  })
})
