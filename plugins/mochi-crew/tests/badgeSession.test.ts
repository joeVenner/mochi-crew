import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { PALETTE, hexToRgb16 } from '../hooks/badgePalette'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

// The test environment has timers; the hooks module's declarations leave them out.
declare function setTimeout(callback: () => void, ms: number): unknown

const TTY = '/dev/ttys001'
const TRANSCRIPT = '/Users/someone/.claude/projects/p/sess-1.jsonl'

/** The host beneath Mochi: what ps, osascript and grep answer, and every argv run. */
type Host = {
  readonly runs: string[][]
  sessionId: string
  /** The transcript's ai-title rows. */
  aiTitles: string
  /** The other tabs, as Terminal lists them. */
  otherTabs: string[]
  /** What the tint script answers: `missing` stands for a tab Terminal no longer has. */
  tintAnswer: string
  termProgram: string
  /** The whole transcript, as `fs.read` answers it. */
  transcript: string
  /** True for a machine with no `/usr/bin/grep`. */
  isGrepMissing: boolean
  /** SSH_CONNECTION, set for a session reached over ssh. */
  ssh: string | undefined
}

const host = (on: On, stored: Readonly<Record<string, unknown>> = {}): Host => {
  const machine: Host = { runs: [], sessionId: 'sess-1', aiTitles: '', otherTabs: [], tintAnswer: 'ok', termProgram: 'Apple_Terminal', transcript: '', isGrepMissing: false, ssh: undefined }
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } as never })
  mock.clock(on)
  mock.store(on, stored)
  on('env.get', ($, e) => ({ value: e.name === 'TERM_PROGRAM' ? machine.termProgram : e.name === 'SSH_CONNECTION' ? machine.ssh : undefined }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: machine.sessionId }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind: 'api-key' } }))
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', () => ({ value: { kind: 'file', size: machine.transcript.length, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', ($, e) => {
    machine.runs.push(['fs.read', e.path])
    return { value: machine.transcript as never }
  })
  on('classic.UserPromptSubmit', () => ({}))
  on('process.run', ($, e) => {
    const argv = [...e.argv]
    machine.runs.push(argv)
    if (argv[0] === '/bin/ps') {
      const marker = (argv[3] ?? '').split('args=')[1] ?? ''
      return ok([`  ${marker}`, ` 900   800 ??       /bin/ps -A -o pid=,ppid=,tty=,args=${marker}`, ' 800   700 ttys001  claude', ' 700     1 ttys001  -zsh'].join('\n'))
    }
    if (argv[0] === '/usr/bin/osascript') {
      const script = argv[2] ?? ''
      if (script.includes('set out to ""')) return ok([`${TTY}\t6447,7462,10000\tClear Dark`, ...machine.otherTabs].join('\n'))
      return ok(script.includes('set background color') ? machine.tintAnswer : 'ok')
    }
    if (argv[0] === '/usr/bin/grep') {
      if (machine.isGrepMissing) throw new Error('ENOENT: /usr/bin/grep')
      return machine.aiTitles ? ok(machine.aiTitles) : ok('', 1)
    }
    return ok('')
  })
  return machine
}

const tints = (machine: Host) => machine.runs.filter(argv => argv[0] === '/usr/bin/osascript' && (argv[2] ?? '').includes('set background color'))
const restores = (machine: Host) => machine.runs.filter(argv => argv[0] === '/usr/bin/osascript' && (argv[2] ?? '').includes('set current settings'))
const rgbOf = (id: string) => hexToRgb16(PALETTE.find(tint => tint.id === id)!.hex).map(String)

/** The tint runs behind session.start: wait until its osascript call lands. */
const settle = async (isDone: () => boolean): Promise<void> => {
  for (let tries = 0; tries < 200 && !isDone(); tries += 1) await new Promise<void>(resolve => setTimeout(() => resolve(), 5))
}

const start = async ($: $, machine: Host): Promise<void> => {
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await settle(() => tints(machine).length > 0)
}

const prompt = ($: $, machine: Host, sessionTitle?: string) =>
  $.classic.UserPromptSubmit({ prompt: 'go', session_id: machine.sessionId, transcript_path: TRANSCRIPT, session_title: sessionTitle })

const mochi = (args: string) => ({ command: 'mochi', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const)

const WINDOWS_TRANSCRIPT = 'C:\\Users\\someone\\.claude\\projects\\C--repo\\sess-1.jsonl'

describe('session badge', () => {
  test('on Windows it reads the topic from the transcript file, once, and titles the session', async ($, on) => {
    const machine = host(on)
    machine.termProgram = ''
    await $.session.start({ cwd: 'C:\\repo', surface: 'terminal', isInteractive: true })
    const ask = (sessionTitle?: string) =>
      $.classic.UserPromptSubmit({ prompt: 'go', session_id: machine.sessionId, transcript_path: WINDOWS_TRANSCRIPT, session_title: sessionTitle })

    expect((await ask()).sessionTitle).toBeUndefined()
    machine.transcript = '{"type":"user"}\r\n{"type":"ai-title","aiTitle":"Fix login"}\r\n'
    const titled = await ask()
    expect(titled.sessionTitle).toMatch(/^\S+ Fix login$/)
    expect((await ask(titled.sessionTitle)).sessionTitle).toBeUndefined()

    const reads = machine.runs.filter(argv => argv[0] === 'fs.read')
    expect(reads.length).toBe(2)
    expect(machine.runs.some(argv => ['/usr/bin/grep', '/bin/ps', '/usr/bin/osascript'].includes(argv[0] ?? ''))).toBe(false)
  })

  test('where grep is missing it falls back to reading the transcript', async ($, on) => {
    const machine = host(on)
    machine.termProgram = 'xterm'
    machine.isGrepMissing = true
    machine.transcript = '{"type":"ai-title","aiTitle":"Topic"}\n'
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    expect((await prompt($, machine)).sessionTitle).toMatch(/^\S+ Topic$/)
  })

  test('tints its own tab, with no shell, in a color no other tab wears', async ($, on) => {
    const machine = host(on)
    machine.otherTabs = PALETTE.slice(1).map((tint, index) => `/dev/ttys10${index}\t${hexToRgb16(tint.hex).join(',')}\tClear Dark`)
    await start($, machine)
    expect(tints(machine)[0]?.slice(3)).toEqual([TTY, ...rgbOf('plum')])
    expect(machine.runs.some(argv => argv[0] === '/bin/sh')).toBe(false)
  })

  test('sets the emoji title once Claude Code has a topic, and keeps a /rename', async ($, on) => {
    const machine = host(on)
    await start($, machine)
    expect((await prompt($, machine)).sessionTitle).toBeUndefined()
    machine.aiTitles = '{"type":"ai-title","aiTitle":"SEO hub pages"}'
    const titled = await prompt($, machine)
    expect(titled.sessionTitle).toMatch(/^\S+ SEO hub pages$/)
    expect((await prompt($, machine, 'my own name')).sessionTitle).toMatch(/^\S+ my own name$/)
  })

  test('keeps the tint through /clear and /resume, and restores the profile on exit', async ($, on) => {
    const machine = host(on, { 'badge:session:resumed-1': { tint: 'moss' } })
    await start($, machine)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    await $.session.end({ reason: 'resume', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    expect(restores(machine).length).toBe(0)

    machine.sessionId = 'resumed-1'
    await prompt($, machine)
    expect(tints(machine).at(-1)?.slice(4)).toEqual(rgbOf('moss'))

    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'resumed-1', resume: { id: 'resumed-1' } })
    expect(restores(machine).at(-1)?.slice(3)).toEqual([TTY, 'Clear Dark', ...rgbOf('moss')])
  })

  test('after /restart ends the session and carries it on in the same process, the tab still paints', async ($, on) => {
    const machine = host(on)
    await start($, machine)
    await $.session.end({ reason: 'other', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    expect(restores(machine).length).toBe(1)

    // No session.start may follow: the same session goes on.
    const colored = await $.command.run(mochi('badge color moss'))
    expect(colored.text).not.toContain('could be painted')
    expect(tints(machine).at(-1)?.slice(4)).toEqual(rgbOf('moss'))

    // And when it does start again, the start repaints too.
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    await settle(() => tints(machine).length > 2)
    expect(tints(machine).at(-1)?.slice(4)).toEqual(rgbOf('moss'))
  })

  test('/clear hands the color on to the new session id', async ($, on) => {
    const machine = host(on)
    await start($, machine)
    const before = tints(machine).at(-1)?.slice(4)
    await $.session.end({ reason: 'clear', sessionId: 'sess-1', resume: { id: 'sess-1' } })
    machine.sessionId = 'cleared-2'
    await prompt($, machine)
    const status = await $.command.run(mochi('badge'))
    expect(tints(machine).at(-1)?.slice(4)).toEqual(before)
    expect(status.text).toContain(PALETTE.find(tint => rgbOf(tint.id).join() === before?.join())?.name ?? 'missing')
  })

  test('/mochi badge color repaints, and off restores the tab, is saved, and strips the emoji', async ($, on) => {
    const machine = host(on)
    await start($, machine)
    expect((await $.command.run(mochi('badge color pine'))).text).toContain('Pine')
    expect(tints(machine).at(-1)?.slice(4)).toEqual(rgbOf('pine'))

    machine.aiTitles = '{"type":"ai-title","aiTitle":"Topic"}'
    const titled = await prompt($, machine)
    expect((await $.command.run(mochi('badge off'))).text).toContain('Badge off')
    expect(restores(machine).length).toBe(1)
    expect((await prompt($, machine, titled.sessionTitle)).sessionTitle).toBe('Topic')
    expect((await $.command.run(mochi('badge color teal'))).text).toContain('No color or place named "teal"')
  })

  test('/mochi place picks a place and paints its color', async ($, on) => {
    const machine = host(on)
    await start($, machine)
    const moved = await $.command.run(mochi('place gym'))
    expect(moved.text).toContain('Graphite · gym')
    expect(tints(machine).at(-1)?.slice(4)).toEqual(rgbOf('graphite'))
    expect((await $.command.run(mochi('place'))).text).toContain('[gym]')
  })

  test('outside Terminal.app, a color change says the place and title show it', async ($, on) => {
    const machine = host(on)
    machine.termProgram = ''
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    const moved = await $.command.run(mochi('place forest'))
    expect(moved.text).toContain('Tab colors need macOS Terminal.app; here Mochi\'s place and the title show it.')
    expect(moved.text).not.toContain('could be painted')
  })

  test('a saved off switch keeps a new session untinted', async ($, on) => {
    const machine = host(on, { badgeOn: false })
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    machine.aiTitles = '{"type":"ai-title","aiTitle":"Topic"}'
    expect((await prompt($, machine)).sessionTitle).toBeUndefined()
    expect(tints(machine).length).toBe(0)
  })

  test('a tab that cannot be painted is tried once, not on every prompt', async ($, on) => {
    const machine = host(on)
    machine.tintAnswer = 'missing'
    await start($, machine)
    for (let index = 0; index < 3; index += 1) await prompt($, machine)
    expect(tints(machine).length).toBe(1)
  })

  for (const place of ['iTerm.app', 'ssh'] as const) test(`in ${place} it runs no osascript and still titles the session`, async ($, on) => {
    const machine = host(on)
    if (place === 'ssh') machine.ssh = '10.0.0.2 51000 10.0.0.9 22'
    else machine.termProgram = place
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    machine.aiTitles = '{"type":"ai-title","aiTitle":"Topic"}'
    expect((await prompt($, machine)).sessionTitle).toMatch(/^\S+ Topic$/)
    expect(machine.runs.some(argv => argv[0] === '/usr/bin/osascript' || argv[0] === '/bin/ps')).toBe(false)
  })
})
