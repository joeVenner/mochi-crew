import { describe, expect, test } from 'claude-code/testing'

import { launchersFor } from '../hooks/editor'

const FILE = '/repo/hooks/a.ts'
const FALLBACKS = [['code', '-g', FILE], ['open', '-t', FILE]]

describe('editor launchers', () => {
  test('no editor set: VS Code, then the desktop opener', async () => {
    expect(launchersFor({}, FILE)).toEqual(FALLBACKS)
  })

  test('a windowed editor goes first, without the flags it was set with', async () => {
    expect(launchersFor({ VISUAL: 'cursor --wait' }, FILE)[0]).toEqual(['cursor', '-g', FILE])
    expect(launchersFor({ EDITOR: '/usr/local/bin/zed -w' }, FILE)[0]).toEqual(['/usr/local/bin/zed', FILE])
    expect(launchersFor({ VISUAL: 'subl', EDITOR: 'cursor' }, FILE).slice(0, 2)).toEqual([['subl', FILE], ['cursor', '-g', FILE]])
  })

  test('terminal editors and unknown programs are never run', async () => {
    expect(launchersFor({ VISUAL: 'vim', EDITOR: 'nano' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: 'emacs -nw' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: 'rm -rf' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: '   ' }, FILE)).toEqual(FALLBACKS)
  })

  test('prototype names and relative executables are refused', async () => {
    expect(launchersFor({ EDITOR: 'constructor' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: '__proto__' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: './code' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: 'bin/zed' }, FILE)).toEqual(FALLBACKS)
  })

  test('never a bare opener that would launch the file by its type', async () => {
    for (const argv of launchersFor({ VISUAL: 'cursor' }, FILE)) {
      expect(argv.length > 2 || (argv[0] !== 'open' && argv[0] !== 'xdg-open')).toBe(true)
    }
  })

  test('VS Code set explicitly is tried once', async () => {
    expect(launchersFor({ EDITOR: 'code --wait' }, FILE)).toEqual(FALLBACKS)
  })

  test('the path is always the last argument, alone', async () => {
    for (const argv of launchersFor({ VISUAL: 'code' }, FILE)) expect(argv.at(-1)).toBe(FILE)
  })
})
