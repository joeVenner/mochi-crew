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
}

const host = (on: On, stored: Readonly<Record<string, unknown>> = {}): Host => {
  const machine: Host = { runs: [], sessionId: 'sess-1', aiTitles: '', otherTabs: [], tintAnswer: 'ok', termProgram: 'Apple_Terminal' }
  const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } as never })
  mock.clock(on)
  mock.store(on, stored)
  on('env.get', ($, e) => ({ value: e.name === 'TERM_PROGRAM' ? machine.termProgram : undefined }))
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
    if (argv[0] === '/usr/bin/grep') return machine.aiTitles ? ok(machine.aiTitles) : ok('', 1)
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

describe('session badge', () => {
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
    expect((await $.command.run(mochi('badge color teal'))).text).toContain('No color named "teal"')
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

  test('outside Terminal.app it runs no osascript and still titles the session', async ($, on) => {
    const machine = host(on)
    machine.termProgram = 'iTerm.app'
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
    machine.aiTitles = '{"type":"ai-title","aiTitle":"Topic"}'
    expect((await prompt($, machine)).sessionTitle).toMatch(/^\S+ Topic$/)
    expect(machine.runs.some(argv => argv[0] === '/usr/bin/osascript' || argv[0] === '/bin/ps')).toBe(false)
  })
})
