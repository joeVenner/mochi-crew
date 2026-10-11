import type { AgentStatus } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { activityLabel, fileName } from '../hooks/mascot'

/** A typed `/mascot <args>` as the person would run it from the composer. */
const mascotCommand = (args: string) => ({
  command: 'mascot',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const)

/** The status line under the mascot, found by the text it shows. */
const statusShows = async (ui: { find: (q: { type: string; text: string }) => Promise<unknown> }, text: string) =>
  expect(await ui.find({ type: 'Text', text })).toBeDefined()

/**
 * Waits until `/mascot journal`'s all-time line shows `expected` (scoring finishes just after
 * a call returns, as the HUD's own `find` waits for): on the terminal the HUD draws level
 * and XP as pixels, so tests read the same stats from the journal.
 */
const journalShows = async ($: Parameters<TestBody>[0], expected: string) => {
  let text = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    text = (await $.command.run(mascotCommand('journal'))).text ?? ''
    // Each command run is a round trip through the engine, which lets pending scoring settle.
    if (text.includes(expected)) return
  }
  expect(text).toContain(expected)
}

/** Total XP, all within level 1 in these tests. */
const xpIs = ($: Parameters<TestBody>[0], xp: number) => journalShows($, `LV 1 · ${xp} XP ·`)

const PANE = { component: 'Pane', requestId: 'mochi-crew' } as const
const PANE_PROPS = {
  title: 'Mochi',
  isFocused: false,
  bodyColumns: 30,
  placement: 'dock',
  // Tall enough for the full HUD; the compact layout has its own test.
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

describe('labels', () => {
  test('fileName keeps only the last path segment', async () => {
    expect(fileName('/a/b/register.tsx')).toBe('register.tsx')
    expect(fileName('notes.md')).toBe('notes.md')
    expect(fileName('/a/b/')).toBe('b')
  })

  test('activityLabel covers every activity', async () => {
    expect(activityLabel({ kind: 'idle', since: 0 }, 0)).toBe('idle · looking around')
    expect(activityLabel({ kind: 'idle', since: 0 }, 10 * 60_000)).toBe('idle · napping')
    expect(activityLabel({ kind: 'editing', file: '/x/y.ts', tool: 'Edit', since: 0 }, 0)).toBe('editing y.ts')
    expect(activityLabel({ kind: 'using', gadget: 'hammer', detail: 'npm test', since: 0 }, 0)).toBe('running npm test')
    expect(activityLabel({ kind: 'done', file: '/x/y.ts', hasFailed: false, at: 0 }, 0)).toBe('done · y.ts')
    expect(activityLabel({ kind: 'done', file: '/x/y.ts', hasFailed: true, at: 0 }, 0)).toBe('failed · y.ts')
  })
})

describe('pane', () => {
  test('starts idle on every surface', async ($, on) => {
    mock.clock(on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...PANE, props: PANE_PROPS })
      await statusShows(ui, 'idle · looking around')
      await ui.unmount()
    }
  })

  test('an Edit shows the file it finished', async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })

    await statusShows(ui, 'done · app.ts')
    await ui.unmount()
  })

  test('a denied Write shows trouble and still reaches the engine', async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'Write' }, () => ({ deny: 'read-only repo' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    const ran = await $.tool.call({ tool: 'Write', file_path: '/repo/notes.md', content: 'x' })

    expect(ran.deny).toBe('read-only repo')
    await statusShows(ui, 'failed · notes.md')
    await ui.unmount()
  })
})

describe('animation', () => {
  test('the pane draws a Raster on the terminal and the HUD elsewhere', async ($, on) => {
    mock.clock(on)
    const terminal = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    expect(await terminal.find({ type: 'Raster' })).toBeDefined()
    await terminal.unmount()

    const desktop = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: PANE_PROPS })
    expect(await desktop.find({ type: 'Raster' })).toBeUndefined()
    expect(await desktop.find({ type: 'Text', text: 'level' })).toBeDefined()
    await desktop.unmount()
  })

  test('Mochi settles back to idle after the done pose', async ($, on) => {
    const clock = mock.clock(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.tool.call({ tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' })
    await statusShows(ui, 'done · a.ts')

    await clock.advance(3500)
    await statusShows(ui, 'idle · looking around')
    await ui.unmount()
  })
})

describe('game hud', () => {
  test('seven clean edits level Mochi up with a toast', async ($, on) => {
    mock.clock(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    for (let i = 0; i < 7; i += 1) {
      await $.tool.call({ tool: 'Edit', file_path: `/repo/f${i}.ts`, old_string: 'a', new_string: 'b' })
    }

    // Level and combo are drawn in the pixel status panel; the journal reads the same stats.
    await journalShows($, 'All-time   LV 2 · 110 XP · 7 edits')
    expect(toasts.some(text => text.includes('LV 2'))).toBe(true)
    await ui.unmount()
  })
})

describe('workers', () => {
  test('a subagent joins as a worker, edits, and leaves when it ends', async ($, on) => {
    const clock = mock.clock(on)
    let status: AgentStatus = 'running'
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'w1' }))
    on('agent.list', () => ({
      value: [{ id: 'w1', type: 'Explore', description: 'scan repo', status }],
    }))
    // What the worker's HUD line said while each call was still running.
    const seenDuring: string[] = []
    let pane: { find: (q: { type: string; text: string }) => Promise<unknown> } | undefined
    const noteWhileRunning = async (text: string) => {
      if (await pane?.find({ type: 'Text', text }) !== undefined) seenDuring.push(text)
    }
    on('tool.call', { tool: 'Edit' }, async () => {
      await noteWhileRunning('edit util.ts')
      return { result: {} as never, text: 'edited' }
    })
    on('tool.call', { tool: 'Read' }, async () => {
      await noteWhileRunning('look notes.md')
      return { result: {} as never, text: 'read' }
    })
    on('tool.call', { tool: 'Bash' }, async () => {
      await noteWhileRunning('run npm run build')
      return { result: {} as never, text: 'ok' }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    pane = ui

    await $.agent.spawn({
      tool_use_id: 'toolu_test_1',
      prompt: 'scan',
      subagentType: 'Explore',
      description: 'scan repo',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await statusShows(ui, 'Explorer')
    await statusShows(ui, 'scan repo')
    // 5 for the hire + 20 for the "Delegate to a subagent" mission.
    await xpIs($, 25)

    // A subagent's own tool calls carry its agentId; a test raises one the same way.
    const workerEdit = { tool: 'Edit', file_path: '/repo/deep/util.ts', old_string: 'a', new_string: 'b', agentId: 'w1' } as const
    await $.tool.call(workerEdit)
    // The main cat stayed idle: the edit was the worker's.
    await statusShows(ui, 'idle · looking around')

    // Its read-only calls show too, still without moving Mochi.
    const workerRead = { tool: 'Read', file_path: '/repo/docs/notes.md', agentId: 'w1' } as const
    await $.tool.call(workerRead)
    const workerBash = { tool: 'Bash', command: 'npm run build', agentId: 'w1' } as const
    await $.tool.call(workerBash)
    await statusShows(ui, 'idle · looking around')
    // Each call showed while it ran; once done, the worker is back to thinking.
    expect(seenDuring).toEqual(['edit util.ts', 'look notes.md', 'run npm run build'])
    await statusShows(ui, 'thinking')
    expect(await ui.find({ type: 'Text', text: 'run npm run build' })).toBeUndefined()

    status = 'completed'
    await clock.advance(5000)
    expect(await ui.find({ type: 'Text', text: 'Explorer' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('turns', () => {
  test('Mochi thinks while Claude works and hands the turn back with its length', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.turn.start({ text: 'fix the bug', turnId: 't1' })
    await statusShows(ui, 'thinking')
    // Even a turn longer than Mochi's nap timer keeps Mochi awake.
    await clock.advance(5 * 60_000)
    await statusShows(ui, 'thinking')
    expect(await ui.find({ type: 'Text', text: 'napping' })).toBeUndefined()

    const answered = await $.turn.complete({ answer: 'Fixed it.', durationMs: 42_000, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(answered.text).toBe('Fixed it.')
    await statusShows(ui, 'Your turn · took 42s')
    expect(await ui.find({ type: 'Text', text: 'thinking' })).toBeUndefined()
    await ui.unmount()
  })

  test('an interrupted turn says so', async ($, on) => {
    mock.clock(on)
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await $.turn.complete({ answer: '', durationMs: 3_000, isAborted: true, turnId: 't2', reason: 'aborted' })
    await statusShows(ui, 'Interrupted · your turn · took 3s')
    await ui.unmount()
  })

  test("a subagent's finished run walks its worker out without waiting for a poll", async ($, on) => {
    const clock = mock.clock(on)
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'w9' }))
    // The status poll still says running, so only turn.complete can send the worker home.
    on('agent.list', () => ({ value: [{ id: 'w9', type: 'Plan', description: 'plan it', status: 'running' as AgentStatus }] }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await $.agent.spawn({
      tool_use_id: 'toolu_test_9',
      prompt: 'plan',
      subagentType: 'Plan',
      description: 'plan it',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await statusShows(ui, 'Architect')

    await $.turn.complete({ answer: 'plan', durationMs: 9_000, isAborted: false, turnId: 't9', reason: 'answer', agentId: 'w9' })
    await clock.advance(2000)
    expect(await ui.find({ type: 'Text', text: 'Architect' })).toBeUndefined()
    // A subagent's turn is not the main loop's: no "your turn" line.
    expect(await ui.find({ type: 'Text', text: 'Your turn' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('journal', () => {
  test('the session journal follows real turns, edits and failing commands', async ($, on) => {
    mock.clock(on)
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never, text: 'boom', isError: true }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    const empty = await $.command.run(mascotCommand('journal'))
    expect(empty.text).toContain('nothing yet')

    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/app.ts', old_string: 'a', new_string: 'b' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.turn.complete({ answer: 'ok', durationMs: 20_000, isAborted: false, turnId: 't1', reason: 'answer' })

    await statusShows(ui, '1 file · 1 turn · 20s working')
    const report = await $.command.run(mascotCommand('journal'))
    // An answered turn after a clean edit shipped a change.
    expect(report.text).toContain('Turns      1 (1 shipped) · 20s of Claude working')
    expect(report.text).toContain('Edits      1')
    expect(report.text).toContain('Commands   1 (1 failed, 0 fixed)')
    expect(report.text).toContain('app.ts')
    await ui.unmount()
  })
})

describe('fair xp', () => {
  test('re-editing a file pays little; a shipped turn pays once; green tests once per turn', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never, text: 'ok' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    const edit = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

    await $.turn.start({ text: 'go', turnId: 't1' })
    await $.tool.call(edit)
    await $.tool.call(edit)
    await xpIs($, 13)
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    // +10 green tests once, +20 for the "Get the tests green" mission once.
    await xpIs($, 43)
    const done = { answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' } as const
    await $.turn.complete(done)
    await $.turn.complete(done)
    await xpIs($, 53)

    // The repeated completion counted the turn once in the journal too.
    expect((await $.command.run(mascotCommand('journal'))).text).toContain('Turns      1 (1 shipped) ·')

    // A new turn starts a fresh ledger: the same file is new work again.
    await $.turn.start({ text: 'more', turnId: 't2' })
    await $.tool.call(edit)
    await xpIs($, 65)
    await ui.unmount()
  })
})

describe('turn boundaries', () => {
  test('a prompt queued right behind a turn neither loses its shipped bonus nor its own ledger', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    const edit = { tool: 'Edit', file_path: '/repo/a.ts', old_string: 'a', new_string: 'b' } as const

    await $.turn.start({ text: 'one', turnId: 't1' })
    await $.tool.call(edit)
    // The edit is scored after its result returns; in a session the model's reply comes later still.
    await clock.advance(10)
    // Both hooks do their bookkeeping after returning, so the queued turn's start can be
    // processed before the last turn's completion. Force that worst order.
    await $.turn.start({ text: 'two', turnId: 't2' })
    await clock.advance(10)
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await clock.advance(10)
    // 10 for the edit + 10 shipped.
    await xpIs($, 20)
    // t2 is running, so t1's late hand-back must not put "Your turn" on screen.
    expect(await ui.find({ type: 'Text', text: 'Your turn' })).toBeUndefined()
    // The second turn's ledger is its own: a.ts is new work again (10 + combo 2).
    await $.tool.call(edit)
    await xpIs($, 32)
    await ui.unmount()
  })
})

describe('compact hud', () => {
  test('a short pane folds workers into one line and drops the journal line', async ($, on) => {
    mock.clock(on)
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'c1' }))
    on('agent.list', () => ({ value: [{ id: 'c1', type: 'Explore', description: 'scan', status: 'running' as AgentStatus }] }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({
      plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 18 } },
    })
    await $.agent.spawn({
      tool_use_id: 'toolu_test_c1',
      prompt: 'scan',
      subagentType: 'Explore',
      description: 'scan',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await $.turn.complete({ answer: 'ok', durationMs: 2000, isAborted: false, turnId: 'tc', reason: 'answer' })

    await statusShows(ui, 'EXP')
    expect(await ui.find({ type: 'Text', text: 'Explorer' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: 'log ' })).toBeUndefined()
    // What matters at a glance stays: whose turn it is, level, mission, controls.
    await statusShows(ui, 'Your turn')
    await statusShows(ui, 'level')
    await statusShows(ui, 'mood')
    await statusShows(ui, 'next')
    expect(await ui.find({ type: 'Button' })).toBeDefined()
    await ui.unmount()
  })
})

describe('privacy', () => {
  test('a secret in a command is masked on screen; the command itself runs untouched', async ($, on) => {
    mock.clock(on)
    // Up front, where the HUD's shortening would not cut it off. A dummy token.
    const command = 'GITHUB_TOKEN=ghp_dummyDummyDummyDummy1234 gh pr list'
    const received: string[] = []
    let shownDuring = ''
    let pane: { findAll: (q: { type: string }) => Promise<unknown[]> } | undefined
    on('tool.call', { tool: 'Bash' }, async ($, e) => {
      received.push(e.command)
      const texts = (await pane?.findAll({ type: 'Text' })) ?? []
      shownDuring = JSON.stringify(texts)
      return { result: {} as never, text: 'boom', isError: true }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    pane = ui as never

    await $.tool.call({ tool: 'Bash', command })

    expect(received).toEqual([command])
    expect(shownDuring).toContain('running GITHUB_TOKEN=•••• gh pr list')
    expect(shownDuring).not.toContain('ghp_')
    // The bug it released is labelled from the masked command too.
    expect(JSON.stringify(await ui.findAll({ type: 'Text' }))).not.toContain('ghp_')
    await ui.unmount()
  })
})

describe('lost turns', () => {
  // Time passes with no pane open (no ticker), so the long waits stay cheap; the first
  // animation step after the pane opens does the check. Busy turns: tests/turn.test.ts.
  const openPaneAfter = async (
    $: Parameters<TestBody>[0],
    clock: { advance: (ms: number) => Promise<unknown> },
    quietMs: number,
  ) => {
    await clock.advance(quietMs)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await clock.advance(400)
    return ui
  }

  test('a turn quiet for 29 minutes is still thinking', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: 'go', turnId: 'slow' })
    const ui = await openPaneAfter($, clock, 29 * 60_000)
    await statusShows(ui, 'thinking')
    await ui.unmount()
  })

  test('a command still running after 40 minutes keeps its turn alive', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    let finishBuild: (() => void) | undefined
    on('tool.call', { tool: 'Bash' }, async () => {
      await new Promise<void>(resolve => { finishBuild = resolve })
      return { result: {} as never, text: 'built' }
    })
    await $.turn.start({ text: 'build it', turnId: 'build' })
    const build = $.tool.call({ tool: 'Bash', command: 'make release' })
    const ui = await openPaneAfter($, clock, 40 * 60_000)
    // The hammer pose has long settled (orphan guard), but the call is still running.
    await statusShows(ui, 'thinking')
    finishBuild?.()
    await build
    await ui.unmount()
  })

  test('a late start of a turn already handed back leaves it handed back', async ($, on) => {
    mock.clock(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await $.turn.complete({ answer: '', durationMs: 500, isAborted: true, turnId: 'quick', reason: 'aborted' })
    await $.turn.start({ text: 'x', turnId: 'quick' })
    await statusShows(ui, 'Interrupted')
    expect(await ui.find({ type: 'Text', text: 'thinking' })).toBeUndefined()
    await ui.unmount()
  })

  test('a turn whose completion never comes stops "thinking" after 30 quiet minutes', async ($, on) => {
    const clock = mock.clock(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    await $.turn.start({ text: 'go', turnId: 'lost' })
    const ui = await openPaneAfter($, clock, 31 * 60_000)
    expect(await ui.find({ type: 'Text', text: 'thinking' })).toBeUndefined()
    // Dropped, not completed: no made-up "Your turn" line.
    expect(await ui.find({ type: 'Text', text: 'Your turn' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('delegated commands', () => {
  test("a subagent's green tests pay the turn's bonus once; its failures journal but never spawn Mochi's bug", async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('turn.start', ($, e) => ({ turnId: e.turnId }))
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'tester' }))
    on('agent.list', () => ({ value: [{ id: 'tester', type: 'test-engineer', description: 'run tests', status: 'running' as AgentStatus }] }))
    let isFailing = true
    on('tool.call', { tool: 'Bash' }, () =>
      isFailing ? { result: {} as never, text: 'boom', isError: true } : { result: {} as never, text: 'ok' },
    )
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await $.turn.start({ text: 'test it', turnId: 'td' })
    await $.agent.spawn({
      tool_use_id: 'toolu_test_td',
      prompt: 'run the tests',
      subagentType: 'test-engineer',
      description: 'run tests',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    // 5 for the hire + 20 for the "Delegate to a subagent" mission.
    await xpIs($, 25)

    const workerTests = { tool: 'Bash', command: 'npm test', agentId: 'tester' } as const
    await $.tool.call(workerTests)
    expect(await ui.find({ type: 'Text', text: 'fighting a bug' })).toBeUndefined()
    isFailing = false
    await $.tool.call(workerTests)
    // +10 green tests (once this turn) +20 "Get the tests green" mission.
    await xpIs($, 55)
    // Mochi's own passing run in the same turn adds nothing more.
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await xpIs($, 55)
    await journalShows($, 'Commands   3 (1 failed, 0 fixed) · 2 green test runs')
    await ui.unmount()
  })
})

describe('returning workers', () => {
  test('a resumed subagent walks back in on its next call, without paying a second hire', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'again' }))
    on('agent.list', () => ({ value: [{ id: 'again', type: 'Explore', description: 'map it', status: 'running' as AgentStatus }] }))
    on('turn.complete', ($, e) => ({ text: e.answer }))
    on('tool.call', { tool: 'Read' }, () => ({ result: {} as never, text: 'read' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    await $.agent.spawn({
      tool_use_id: 'toolu_test_again',
      prompt: 'map',
      subagentType: 'Explore',
      description: 'map it',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await statusShows(ui, 'Explorer')
    // Its first run ends: the worker walks out.
    await $.turn.complete({ answer: 'done', durationMs: 1000, isAborted: false, turnId: 'r1', reason: 'answer', agentId: 'again' })
    await clock.advance(2000)
    expect(await ui.find({ type: 'Text', text: 'Explorer' })).toBeUndefined()

    // Resumed: its next call brings it back on stage.
    const resumedRead = { tool: 'Read', file_path: '/repo/next.md', agentId: 'again' } as const
    await $.tool.call(resumedRead)
    await clock.advance(400)
    await statusShows(ui, 'Explorer')
    // Hired once: 5 XP + the 20-XP delegate mission, and one subagent in the journal.
    await xpIs($, 25)
    await journalShows($, 'Subagents  1')
    await ui.unmount()
  })
})

describe('hud fit', () => {
  test('a pane that fits a quiet HUD folds the crew once three workers would push the keys away', async ($, on) => {
    mock.clock(on)
    let next = 0
    on('agent.spawn', () => ({ model: 'haiku', agentId: `fit${(next += 1)}` }))
    on('agent.list', () => ({
      value: [1, 2, 3].map(n => ({ id: `fit${n}`, type: 'Explore', description: 'scan', status: 'running' as AgentStatus })),
    }))
    // Scene (16 rows) + the 10 fixed HUD rows + the hire quip's bubble + one worker row.
    const ui = await $.ui.mount({
      plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: { ...PANE_PROPS, scroll: { offset: 0, bodyRows: 28 } },
    })
    const spawn = (n: number) => $.agent.spawn({
      tool_use_id: `toolu_test_fit${n}`,
      prompt: 'scan',
      subagentType: 'Explore',
      description: 'scan',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await spawn(1)
    // One worker row fits: shown in full.
    await statusShows(ui, 'Explorer')
    await spawn(2)
    await spawn(3)
    // Three would overflow (plus the hire quip): folded into one crew row.
    await statusShows(ui, 'EXP EXP EXP')
    expect(await ui.find({ type: 'Text', text: 'Explorer' })).toBeUndefined()
    await ui.unmount()
  })
})

describe('mcp tools', () => {
  test('a connector call shows Mochi calling it; the call itself passes through untouched', async ($, on) => {
    mock.clock(on)
    let shownDuring = ''
    let pane: { findAll: (q: { type: string }) => Promise<unknown[]> } | undefined
    const seen: string[] = []
    on('tool.call', async ($, e) => {
      seen.push(e.tool)
      shownDuring = JSON.stringify((await pane?.findAll({ type: 'Text' })) ?? [])
      return { result: {} as never, text: 'ok' }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    pane = ui as never

    const figma = { tool: 'mcp__claude_ai_Figma__get_screenshot', nodeId: '1:2' } as const
    await $.tool.call(figma as never)

    expect(seen).toEqual(['mcp__claude_ai_Figma__get_screenshot'])
    expect(shownDuring).toContain('calling Figma · get screenshot')
    await statusShows(ui, 'idle')
    await ui.unmount()
  })
})

describe('/mascot command', () => {
  test('switching outfit is saved to the store and listed as current', async ($, on) => {
    mock.clock(on)
    // A store of the test's own, so it can see exactly what the mod saved.
    const saved = new Map<string, unknown>()
    on('store.set', ($, e) => {
      saved.set(e.key, e.value)
      return { value: undefined }
    })
    on('store.get', ($, e) => ({ value: saved.get(e.key) }))
    const switched = await $.command.run(mascotCommand('outfit pirate'))
    expect(switched.text).toBe('Mochi is now wearing: pirate')
    expect(saved.get('outfit')).toBe('pirate')
    const listed = await $.command.run(mascotCommand('outfits'))
    expect(listed.text).toContain('[pirate]')
  })

  test('sound plays only after it is switched on', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const played: string[] = []
    on('audio.play', ($, e) => {
      if (typeof e.clip.asset === 'string') played.push(e.clip.asset)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const edit = { tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' } as const

    await $.tool.call(edit)
    expect(played).toEqual([])

    await $.command.run(mascotCommand('sound on'))
    await $.tool.call(edit)
    expect(played).toContain('sounds/done.wav')
  })
})

describe('resilience: concurrency and failures', () => {
  test('concurrent edits never lose XP', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await Promise.all(
      ['a', 'b', 'c', 'd'].map(name =>
        $.tool.call({ tool: 'Edit', file_path: `/r/${name}.ts`, old_string: 'a', new_string: 'b' }),
      ),
    )

    // 10 + 12 + 14 + 16 whatever order they finish in: a lost update would show less.
    await xpIs($, 52)
    expect((await $.command.run(mascotCommand('journal'))).text).toContain('All-time   LV 1 · 52 XP · 4 edits')
    await ui.unmount()
  })

  test('a tool call that throws still leaves Mochi out of "Working on…"', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('tool.call', { tool: 'Write' }, () => {
      throw new Error('disk on fire')
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.tool.call({ tool: 'Write', file_path: '/r/hot.ts', content: 'x' }).catch(() => undefined)

    expect(await ui.find({ type: 'Text', text: 'editing hot.ts' })).toBeUndefined()
    await ui.unmount()
  })

  test('a failing agent list keeps workers on stage and the scene alive', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'w9' }))
    on('agent.list', () => {
      throw new Error('engine busy')
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.agent.spawn({
      tool_use_id: 'toolu_test_9',
      prompt: 'scan',
      subagentType: 'Explore',
      description: 'scan repo',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: false,
      fork: false,
    })
    await clock.advance(5000)

    await statusShows(ui, 'Explorer')
    await ui.unmount()
  })
})

describe('gadget tools', () => {
  test('Bash shows the hammer while it runs, then Mochi goes back to idling', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let labelDuringCall: unknown
    // Hooks first, then the first $ call; the hook reads the drawing once it is mounted.
    let drawing: { find: (q: { type: string; text: string }) => Promise<unknown> } | undefined
    on('tool.call', { tool: 'Bash' }, async () => {
      labelDuringCall = await drawing?.find({ type: 'Text', text: 'running npm test' })
      return { result: {} as never, text: 'ok' }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    drawing = ui

    await $.tool.call({ tool: 'Bash', command: 'npm test' })

    expect(labelDuringCall).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'running' })).toBeUndefined()
    await ui.unmount()
  })

  test("a subagent's Read never moves Mochi", async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let labelDuringCall: unknown = 'unset'
    // Hooks first, then the first $ call; the hook reads the drawing once it is mounted.
    let drawing: { find: (q: { type: string; text: string }) => Promise<unknown> } | undefined
    on('tool.call', { tool: 'Read' }, async () => {
      labelDuringCall = await drawing?.find({ type: 'Text', text: 'looking at' })
      return { result: {} as never, text: 'contents' }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })
    drawing = ui
    const workerRead = { tool: 'Read', file_path: '/r/a.ts', agentId: 'w1' } as const

    await $.tool.call(workerRead)

    expect(labelDuringCall).toBeUndefined()
    await ui.unmount()
  })
})

describe('pane buttons', () => {
  test('pressing Pet raises mood and toasts', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await ui.press({ key: 'pet' })

    expect(toasts.some(text => text.includes('Mochi liked that'))).toBe(true)
    // Mood is a pixel bar on the terminal; the toast states the new value.
    expect(toasts.some(text => /\(mood \d+, energy \d+\)/.test(text))).toBe(true)
    await ui.unmount()
  })

  test('Outfit cycles to the next outfit', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await ui.press({ key: 'outfit' })
    const listed = await $.command.run(mascotCommand('outfits'))

    expect(listed.text).toContain('[wizard]')
    await ui.unmount()
  })
})

describe('bug battle', () => {
  test('a failing command releases a bug; the next passing one squashes it for a badge', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let isFailing = true
    on('tool.call', { tool: 'Bash' }, () =>
      isFailing ? { result: {} as never, text: 'boom', isError: true } : { result: {} as never, text: 'ok' },
    )
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await statusShows(ui, 'fighting a bug · npm test')

    isFailing = false
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    expect(await ui.find({ type: 'Text', text: 'fighting a bug' })).toBeUndefined()
    const list = await $.command.run(mascotCommand('achievements'))
    expect(list.text).toContain('[x] Bug Squasher')
    await ui.unmount()
  })
})

describe('resilience: races and slow devices', () => {
  const SPAWN_INPUT = {
    tool_use_id: 'toolu_test_h',
    prompt: 'go',
    subagentType: 'code-reviewer',
    description: 'review',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'claude-opus-5-5',
    background: false,
    fork: false,
  } as const

  test('two passing commands at once squash the bug and pay out only once', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let isFailing = true
    on('tool.call', { tool: 'Bash' }, () =>
      isFailing ? { result: {} as never, text: 'boom', isError: true } : { result: {} as never, text: 'ok' },
    )
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    isFailing = false
    await Promise.all([$.tool.call({ tool: 'Bash', command: 'npm test' }), $.tool.call({ tool: 'Bash', command: 'npm run lint' })])

    // 15 for the one squash + 10 for the turn's first green test run, plus the
    // "Fix a failing command" and "Get the tests green" missions (20 each): each paid once.
    await xpIs($, 65)
    await ui.unmount()
  })

  test('a speech bubble clears itself after a few seconds', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    // A terminal that accepts frames, so the animation ticker keeps running as in a real pane.
    on('ui.blit', () => ({ value: {} }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...PANE, props: PANE_PROPS })

    await $.command.run(mascotCommand('pet'))
    await statusShows(ui, '“')
    await clock.advance(6000)

    expect(await ui.find({ type: 'Text', text: '“' })).toBeUndefined()
    await ui.unmount()
  })

  test('a hanging audio device never holds up a subagent spawn', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    let plays = 0
    on('audio.play', () => {
      plays += 1
      // The first play (switching sound on) answers; every later one hangs forever.
      return plays === 1 ? { value: undefined } : new Promise<never>(() => undefined)
    })
    on('agent.spawn', () => ({ model: 'haiku', agentId: 'w7' }))

    await $.command.run(mascotCommand('sound on'))
    const started = await $.agent.spawn(SPAWN_INPUT)

    expect(started.agentId).toBe('w7')
  })
})
