import { describe, expect, test } from 'claude-code/testing'

import { launchersFor, shimCandidates, shimLauncher } from '../hooks/editor'

const FILE = '/repo/hooks/a.ts'
const FALLBACKS = [['code', '-g', FILE], ['open', '-a', 'Visual Studio Code', FILE], ['open', '-t', FILE]]

describe('editor launchers', () => {
  test('no editor set: VS Code\'s command, the VS Code app, then the desktop opener', async () => {
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
    expect(launchersFor({ EDITOR: '.\\code.exe' }, FILE)).toEqual(FALLBACKS)
    expect(launchersFor({ EDITOR: 'bin\\zed' }, FILE)).toEqual(FALLBACKS)
  })

  test('never a bare opener that would launch the file by its type', async () => {
    for (const argv of launchersFor({ VISUAL: 'cursor' }, FILE)) {
      expect(argv.length > 2 || (argv[0] !== 'open' && argv[0] !== 'xdg-open')).toBe(true)
      if (argv[0] === 'open') expect(['-a', '-t']).toContain(argv[1])
    }
  })

  test('VS Code set explicitly is tried once', async () => {
    expect(launchersFor({ EDITOR: 'code --wait' }, FILE)).toEqual(FALLBACKS)
  })

  test('the path is always the last argument, alone', async () => {
    for (const argv of launchersFor({ VISUAL: 'code' }, FILE)) expect(argv.at(-1)).toBe(FILE)
  })
})

const WIN_FILE = 'C:\\repo\\hooks\\a.ts'
const VS_CODE_SHIM = [
  '@echo off',
  'setlocal',
  'set VSCODE_DEV=',
  'set ELECTRON_RUN_AS_NODE=1',
  '"%~dp0..\\Code.exe" "%~dp0..\\resources\\app\\out\\cli.js" %*',
  'IF %ERRORLEVEL% NEQ 0 EXIT /b %ERRORLEVEL%',
  'endlocal',
].join('\r\n')

describe('editor launchers on Windows', () => {
  test('no desktop opener, and an absolute Windows editor is run as set', async () => {
    expect(launchersFor({}, WIN_FILE, { isWindows: true })).toEqual([])
    expect(launchersFor({ VISUAL: 'C:\\Tools\\zed.exe' }, WIN_FILE, { isWindows: true })).toEqual([['C:\\Tools\\zed.exe', WIN_FILE]])
  })

  test('a bare editor name is never run on Windows, which looks in the working folder first', async () => {
    expect(launchersFor({ VISUAL: 'zed', EDITOR: 'cursor' }, WIN_FILE, { isWindows: true })).toEqual([])
  })

  test('shims are looked for in absolute PATH folders, then VS Code\'s install folders', async () => {
    const candidates = shimCandidates({
      VISUAL: 'cursor --wait',
      PATH: 'C:\\Windows;.;bin;"C:\\Program Files\\Microsoft VS Code\\bin"',
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
    })
    expect(candidates).toEqual([
      'C:\\Windows\\cursor.cmd',
      'C:\\Program Files\\Microsoft VS Code\\bin\\cursor.cmd',
      'C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd',
      'C:\\Windows\\code.cmd',
      'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd',
    ])
    expect(shimCandidates({ EDITOR: 'vim' })).toEqual([])
  })

  test('a VS Code shim becomes its exe on its CLI script, the path last', async () => {
    const shimPath = 'C:\\Program Files\\Microsoft VS Code\\bin\\code.cmd'
    expect(shimLauncher(VS_CODE_SHIM, shimPath, WIN_FILE)).toEqual([
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files\\Microsoft VS Code\\resources\\app\\out\\cli.js',
      '-g',
      WIN_FILE,
    ])
  })

  test('a shim of any other shape is never guessed at', async () => {
    const shimPath = 'C:\\bin\\code.cmd'
    expect(shimLauncher('@echo off\r\nstart "" "%1"', shimPath, WIN_FILE)).toBe(undefined)
    expect(shimLauncher('"%APPDATA%\\x.exe" "%~dp0cli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
    expect(shimLauncher('"..\\x.exe" "..\\cli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
    expect(shimLauncher('"%~dp0x.bat" "%~dp0cli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
    // A planted shim naming a program of its own is refused, however it climbs to it.
    expect(shimLauncher('"%~dp0..\\evil.exe" "%~dp0x\\cli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
    expect(shimLauncher('"%~dp0..\\..\\..\\Code.exe" "%~dp0cli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
    expect(shimLauncher('"%~dp0Code.exe" "%~dp0notcli.js" %*', shimPath, WIN_FILE)).toBe(undefined)
  })
})
