import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin, TestBody } from 'claude-code/testing'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Finder = { find: (q: { type: string; text: string }) => Promise<unknown> }

const PANE = { component: 'Pane', requestId: 'mochi-crew' } as const
const paneProps = (bodyRows = 60) => ({
  title: 'Mochi',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows },
  view: {},
} as const)

/** What sits beneath the plugin in a session: the engine's own answers to what Mochi and the meter pass on. */
type EngineOptions = { kind?: 'bearer' | 'api-key'; env?: Readonly<Record<string, string>>; model?: () => string }

const engine = (on: On, { kind = 'api-key', env = {}, model = () => 'claude-opus-5-5' }: EngineOptions = {}) => {
  const commands: string[] = []
  on('env.get', ($, e) => ({ value: env[e.name] }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('session.model', () => ({ value: model() }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind } }))
  return commands
}

const start = async ($: $) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

const measureEvent = (over: { tokens?: number; percent?: number; limits?: { kind: string; percentUsed: number }[]; usd?: number } = {}) => ({
  context: { tokens: over.tokens ?? 620_000, window: 1_000_000, percent: over.percent ?? 62 },
  rateLimits: over.limits ?? [],
  cost: over.usd === undefined ? undefined : { usd: over.usd },
  changed: ['context' as const],
})

const turnEvent = (read: number, write: number, input: number, agentId?: string) => ({
  answer: 'done',
  durationMs: 1000,
  isAborted: false,
  turnId: `turn-${read}-${write}-${agentId ?? 'main'}`,
  reason: 'answer' as const,
  ...(agentId === undefined ? {} : { agentId }),
  usage: { model: 'claude-opus-5-5', cache_read_input_tokens: read, cache_creation_input_tokens: write, input_tokens: input, output_tokens: 10 },
})

/**
 * A second plugin that reads Mochi's answering model back through `/probe`, as any plugin may read
 * another's state; the test's own `$` has no state noun.
 */
const PROBE: Plugin = {
  name: 'probe',
  register(on) {
    on('command.run', { command: 'probe' }, async $ => ({
      text: JSON.stringify((await $.state.get({ plugin: 'mochi-crew', key: 'meterResponseModel' })).value ?? null),
    }))
  },
}

const shows = async (ui: Finder, text: string) => expect(await ui.find({ type: 'Text', text })).toBeDefined()
const lacks = async (ui: Finder, text: string) => expect(await ui.find({ type: 'Text', text })).toBeUndefined()

const mascot = (args: string) => ({
  command: 'mascot',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const)

describe('session meter in the pane', () => {
  test('starting registers Mochi and starts the meter, both from the one session.start hook', async ($, on) => {
    mock.clock(on)
    const commands = engine(on)
    await start($)
    expect(commands).toContain('mascot')
    expect(commands).toContain('mochi')
    await $.session.measure(measureEvent())
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await shows(ui, 'opus 5.5')
    await ui.unmount()
  })

  test('no meter rows before the first measurement', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await lacks(ui, 'opus 5.5')
    await ui.unmount()
  })

  test('an API key session shows model, context, cache and cost on every surface', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent({ usd: 4.12 }))
    await $.turn.complete(turnEvent(0, 40_000, 500))
    await $.turn.complete(turnEvent(40_000, 2_000, 500))
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...PANE, props: paneProps() })
      await shows(ui, 'opus 5.5')
      await shows(ui, ' 62  ')
      await shows(ui, '48%')
      await shows(ui, '$4.12')
      // Mochi's own HUD is still there.
      await shows(ui, 'level   ')
      await ui.unmount()
    }
  })

  test('idle time keeps counting on the desktop, where no animation ticker runs', async ($, on) => {
    const clock = mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent())
    await $.turn.complete(turnEvent(10, 10, 10))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await lacks(ui, '  idle 2m')
    await clock.advance(2 * 60_000 + 1_000)
    await shows(ui, '  idle 2m')
    await ui.unmount()
  })

  test('subagent turns stay out of the cache rate', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent())
    await $.turn.complete(turnEvent(90, 0, 10))
    await $.turn.complete(turnEvent(0, 0, 1_000_000, 'agent-1'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await shows(ui, '90%')
    await ui.unmount()
  })

  test('a subscription shows its plan window and no dollars', async ($, on) => {
    mock.clock(on)
    engine(on, { kind: 'bearer' })
    await start($)
    await $.session.measure(measureEvent({ usd: 9.99, limits: [{ kind: 'five_hour', percentUsed: 34 }] }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await shows(ui, '5h      ')
    await lacks(ui, '$9.99')
    await ui.unmount()
  })

  test('a short pane folds the meter into one summary line', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent({ usd: 1 }))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps(8) })
    await shows(ui, 'ctx 62% · $1.00 est')
    await lacks(ui, 'opus 5.5')
    await ui.unmount()
  })

  test('/mascot meter reports with provider notes', async ($, on) => {
    mock.clock(on)
    engine(on, { env: { CLAUDE_CODE_USE_FOUNDRY: '1' } })
    await start($)
    await $.session.measure(measureEvent({ usd: 1.5 }))
    await $.turn.complete(turnEvent(900, 50, 50))
    // The meter counts a turn just after the turn's hook returns, as Mochi's own bookkeeping does.
    let text = ''
    for (let attempt = 0; attempt < 50 && !text.includes('over 1 turn'); attempt += 1) {
      text = (await $.command.run(mascot('meter'))).text ?? ''
    }
    expect(text).toContain('Session meter')
    expect(text).toContain('Microsoft Foundry (Azure)')
    expect(text).toContain('90% of input read from cache over 1 turn')
  })

  test('/mochi answers exactly like /mascot', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent())
    const viaMochi = (await $.command.run({ ...mascot('meter'), command: 'mochi' })).text ?? ''
    const viaMascot = (await $.command.run(mascot('meter'))).text ?? ''
    expect(viaMochi).toContain('Session meter')
    expect(viaMochi).toBe(viaMascot)
    expect((await $.command.run({ ...mascot('bogus'), command: 'mochi' })).text).toContain('usage:')
  })

  test('context crossing 80% toasts once', async ($, on) => {
    mock.clock(on)
    engine(on)
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    await start($)
    await $.session.measure(measureEvent({ tokens: 810_000, percent: 81 }))
    await $.session.measure(measureEvent({ tokens: 830_000, percent: 83 }))
    expect(toasts.filter(text => text.startsWith('Context')).length).toBe(1)
  })

  test('a /clear empties the meter', async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.session.measure(measureEvent())
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await lacks(ui, 'opus 5.5')
    await ui.unmount()
  })

  test('the answering model is kept from the last main turn until a /clear', { plugins: [PROBE] }, async ($, on) => {
    mock.clock(on)
    let model = 'claude-opus-5-5'
    engine(on, { model: () => model })
    await start($)
    const answeredBy = async (): Promise<unknown> => JSON.parse((await $.command.run({ ...mascot(''), command: 'probe' })).text ?? 'undefined')
    // The meter counts a turn just after the turn's hook returns; each command run lets it settle.
    const becomes = async (expected: string | null) => {
      for (let attempt = 0; attempt < 50 && (await answeredBy()) !== expected; attempt += 1) await $.command.run(mascot('meter'))
      expect(await answeredBy()).toBe(expected)
    }
    expect(await answeredBy()).toBeNull()
    await $.turn.complete(turnEvent(10, 10, 10))
    await becomes('claude-opus-5-5')
    // A /model switch moves the session's model, never the one that answered.
    model = 'claude-sonnet-5'
    await $.session.measure(measureEvent())
    // The meter already reads the new model (its row says so) while the answering one stays put.
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...PANE, props: paneProps() })
    await shows(ui, 'sonnet 5')
    await ui.unmount()
    expect(await answeredBy()).toBe('claude-opus-5-5')
    // A subagent's turn answers for the subagent, not for the conversation.
    await $.turn.complete(turnEvent(20, 20, 20, 'agent-1'))
    await $.command.run(mascot('meter'))
    expect(await answeredBy()).toBe('claude-opus-5-5')
    await $.turn.complete(turnEvent(30, 30, 30))
    await becomes('claude-sonnet-5')
    await $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    expect(await answeredBy()).toBeNull()
  })

  test('a failing meter read never stops Mochi from starting', async ($, on) => {
    mock.clock(on)
    const commands = engine(on, {
      model: () => {
        throw new Error('model lookup failed')
      },
    })
    await start($)
    expect(commands).toContain('mascot')
  })
})
