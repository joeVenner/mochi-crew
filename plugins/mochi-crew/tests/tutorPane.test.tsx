import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Finder = { find: (q: { type?: string; key?: string; text?: string }) => Promise<unknown> }

const SURFACES = ['terminal', 'desktop'] as const
const MAIN = { component: 'Pane', requestId: 'mochi-crew' } as const
const TAB = { component: 'Pane', requestId: 'mochi-tutor' } as const
const paneProps = (title: string, bodyRows = 40) => ({
  title,
  isFocused: false,
  bodyColumns: 44,
  placement: 'dock',
  scroll: { offset: 0, bodyRows },
  view: {},
} as const)

/** How the engine lists the tutor tab after it opens: shown and focused unless a test says otherwise. */
type TabPlace = { isFocused: boolean; isPlaced: boolean }

type EngineOptions = { saved?: Readonly<Record<string, unknown>>; tab?: TabPlace }

/**
 * What sits beneath the plugin in a session: the engine's answers to what Mochi passes on, a
 * store backed by a Map, and records of every open, close, toast, save and model call.
 */
const engine = (on: On, { saved = {}, tab = { isFocused: true, isPlaced: true } }: EngineOptions = {}) => {
  const store = new Map<string, unknown>(Object.entries(saved))
  const record = {
    commands: [] as string[],
    opened: [] as { id: string; title?: string; focus?: boolean }[],
    closed: [] as string[],
    toasts: [] as string[],
    saves: [] as string[],
    modelCalls: 0,
    place: tab,
  }
  on('env.get', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    record.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    record.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    record.opened.push({ id: e.id, ...(e.title === undefined ? {} : { title: e.title }), ...(e.focus === undefined ? {} : { focus: e.focus }) })
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', ($, e) => {
    record.closed.push(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: record.opened.some(pane => pane.id === 'mochi-tutor')
      ? [{ id: 'mochi-tutor', title: 'Tutor', isShown: record.place.isFocused, ...record.place }]
      : [],
  }))
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    record.saves.push(e.key)
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'test-session' }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('session.root', () => ({ value: '/repo' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind: 'api-key' as const } }))
  // Not a repository: git answers nothing, so the tree and the digest stay empty.
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('model.fork', () => {
    record.modelCalls += 1
    return { value: { isAnswered: false as const, reason: 'nothing-to-fork' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('model.complete', () => {
    record.modelCalls += 1
    return { value: { isAnswered: false as const, reason: 'api-error' as const, status: 500, error: 'unknown' as const, usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  return { record, store }
}

const start = async ($: $, isInteractive = true) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive })

const mochi = (args: string, command: 'mochi' | 'mascot' = 'mochi') => ({
  command,
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 120 },
} as const)

const shows = async (ui: Finder, text: string) => expect(await ui.find({ type: 'Text', text }), `shows ${text}`).toBeDefined()
const lacks = async (ui: Finder, text: string) => expect(await ui.find({ type: 'Text', text })).toBeUndefined()
const hasButton = async (ui: Finder, key: string) => expect(await ui.find({ type: 'Button', key })).toBeDefined()

const NOTICE = 'Model calls happen only when you press:'
const HOME = 'What should I quiz you on?'
const EMPTY_HOME = 'Nothing to quiz yet.'

/** A saved deck with one due card, as an earlier session's round left it. */
const STEM = 'Why does gitOutput pass --no-optional-locks to every git call?'
const savedDeck = {
  v: 1,
  projects: {
    '/repo': {
      level: 1,
      rounds: 2,
      streak: 0,
      deck: [{
        box: 1,
        dueRound: 2,
        question: {
          id: 'r1-q2',
          kind: 'choice',
          tag: 'why',
          topic: 'worktree locks',
          prompt: STEM,
          options: ['So a refresh never holds index.lock', 'It makes git faster', 'Worktrees need it'],
          answer: 0,
          why: ['A refresh runs every few seconds.', 'Speed is a side effect.', 'They do not.'],
        },
      }],
      mastered: [],
      recentMisses: ['worktree locks'],
      updatedAt: 1,
    },
  },
}

describe('tutor options', () => {
  test('the tutor loads with its /config picks and names the model in the notice', { options: { tutorModel: 'sonnet', tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on)
    await start($)
    expect(record.commands).toContain('mochi')
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, 'a digest (≤16k chars) to sonnet:')
    await ui.unmount()
  })

  test('a pick outside the options counts as unset', { options: { tutorModel: 'gpt-9' } }, async ($, on) => {
    mock.clock(on)
    engine(on)
    await start($)
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, 'to haiku:')
    await ui.unmount()
  })
})

describe('tutor tab', () => {
  test('the tutor button opens the tutor tab on the consent screen with no model call', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on)
    await start($)
    for (const surface of SURFACES) {
      const main = await $.ui.mount({ plugin: 'mochi-crew', surface, ...MAIN, props: paneProps('Mochi') })
      await main.press({ key: 'tutor' })
      await main.unmount()
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...TAB, props: paneProps('Tutor') })
      await shows(ui, NOTICE)
      await shows(ui, 'to haiku:')
      await hasButton(ui, 'consent')
      await hasButton(ui, 'decline')
      await ui.unmount()
    }
    expect(record.opened).toContainEqual({ id: 'mochi-tutor', title: 'Tutor', focus: true })
    // A focused tab needs no hint, and nothing was asked of a model.
    expect(record.toasts).toEqual([])
    expect(record.modelCalls).toBe(0)
  })

  test('an unfocused tab toasts how to reach it, and an unplaced one how to see it', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { tab: { isFocused: false, isPlaced: true } })
    await start($)
    const main = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...MAIN, props: paneProps('Mochi') })
    await main.press({ key: 'tutor' })
    expect(record.toasts).toEqual(['Tutor tab is open: press ctrl+x tab, or click it.'])
    record.place = { isFocused: false, isPlaced: false }
    await main.press({ key: 'tutor' })
    expect(record.toasts[1]).toBe('Tutor tab opened; widen the terminal to see it.')
    await main.unmount()
  })

  // One test per surface: consent is kept for the whole test, so a second pass would skip the notice.
  for (const surface of SURFACES) {
    test(`declining closes the tab and saves nothing (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record } = engine(on)
      await start($)
      await $.command.run(mochi('tutor'))
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...TAB, props: paneProps('Tutor') })
      await ui.press({ key: 'decline' })
      expect(record.closed).toContain('mochi-tutor')
      // The kit keeps drawing a closed pane; the screen says it is closed.
      await shows(ui, 'The tutor is closed.')
      expect(record.saves).not.toContain('tutorConsent')
      expect(record.modelCalls).toBe(0)
      await ui.unmount()
    })

    test(`accepting stores consent and a later open skips it (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record, store } = engine(on)
      await start($)
      const main = await $.ui.mount({ plugin: 'mochi-crew', surface, ...MAIN, props: paneProps('Mochi') })
      await main.press({ key: 'tutor' })
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...TAB, props: paneProps('Tutor') })
      await shows(ui, NOTICE)
      await ui.press({ key: 'consent' })
      expect(store.get('tutorConsent')).toBe(1)
      // No turn, edit or change yet: Home says so and offers no start.
      await shows(ui, EMPTY_HOME)
      expect(await ui.find({ type: 'Button', key: 'start:recent' })).toBeUndefined()
      await shows(ui, 'digest · no reply yet')
      await ui.press({ key: 'close' })
      expect(record.closed).toContain('mochi-tutor')
      await shows(ui, 'The tutor is closed.')
      await main.press({ key: 'tutor' })
      await lacks(ui, NOTICE)
      await shows(ui, EMPTY_HOME)
      expect(record.modelCalls).toBe(0)
      await main.unmount()
      await ui.unmount()
    })
  }

  test('a consent saved by an earlier session opens straight on Home', async ($, on) => {
    mock.clock(on)
    engine(on, { saved: { tutorConsent: 1 } })
    await start($)
    await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer' })
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await lacks(ui, NOTICE)
    await shows(ui, HOME)
    await hasButton(ui, 'start:recent')
    await hasButton(ui, 'start:project')
    await ui.unmount()
  })

  test('home offers the review and the digest toggle only when they apply', async ($, on) => {
    mock.clock(on)
    engine(on, { saved: { tutorConsent: 1, tutorProgress: savedDeck } })
    await start($)
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, 'LV 1 · 2 rounds')
    expect(await ui.find({ type: 'Button', key: 'review', text: 'review 1 missed' })).toBeDefined()
    // Before Claude's first reply there is nothing to fork, so switching to the digest changes nothing.
    expect(await ui.find({ type: 'Button', key: 'toggle-digest' })).toBeUndefined()
    await ui.unmount()
  })

  test('/mochi tutor returns neutral text with no question content', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on)
    await start($)
    const said: string[] = []
    const run = async (args: string, command: 'mochi' | 'mascot' = 'mochi') => {
      const text = (await $.command.run(mochi(args, command))).text ?? ''
      said.push(text)
      return text
    }
    expect(await run('tutor review')).toBe('No missed questions to review yet.')
    expect(await run('tutor start')).toBe('Tutor opened.')
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, NOTICE)
    await ui.press({ key: 'consent' })
    expect(await run('tutor')).toBe('Tutor opened.')
    expect(await run('tutor start', 'mascot')).toBe('Tutor round starting in its tab.')
    expect(await run('tutor stop')).toBe('Tutor stopped.')
    expect(await run('tutor reset')).toBe('Tutor progress for this project cleared.')
    expect(await run('tutor quiz')).toContain('unknown tutor action')
    await ui.unmount()
    expect(record.modelCalls).toBe(0)
    expect(said.join('\n')).not.toContain('gitOutput')
  })

  test('/mochi tutor review starts a round from the deck without saying what it asks', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 1, tutorProgress: savedDeck } })
    await start($)
    const text = (await $.command.run(mochi('tutor review'))).text ?? ''
    expect(text).toBe('Tutor round starting in its tab.')
    expect(text).not.toContain('gitOutput')
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, STEM)
    await shows(ui, 'from an earlier round')
    expect(record.modelCalls).toBe(0)
    await ui.unmount()
  })

  test('/mochi tutor reset forgets the deck', async ($, on) => {
    mock.clock(on)
    const { store } = engine(on, { saved: { tutorConsent: 1, tutorProgress: savedDeck } })
    await start($)
    expect((await $.command.run(mochi('tutor reset'))).text).toBe('Tutor progress for this project cleared.')
    expect((await $.command.run(mochi('tutor review'))).text).toBe('No missed questions to review yet.')
    expect(JSON.stringify(store.get('tutorProgress'))).not.toContain('r1-q2')
    // The consent saved earlier still holds.
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await lacks(ui, NOTICE)
    await ui.unmount()
  })

  test('/mochi tutor in -p says it needs an interactive session', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 1, tutorProgress: savedDeck } })
    await start($, false)
    for (const args of ['tutor', 'tutor start', 'tutor digest', 'tutor review', 'tutor stop', 'tutor reset']) {
      expect((await $.command.run(mochi(args))).text).toBe('Tutor needs an interactive session.')
    }
    expect(record.opened.some(pane => pane.id === 'mochi-tutor')).toBe(false)
    expect(record.saves).not.toContain('tutorProgress')
    expect(record.modelCalls).toBe(0)
  })

  for (const surface of SURFACES) {
    test(`the main HUD reads quizzing you while a round runs and a bug still wins (${surface})`, async ($, on) => {
      mock.clock(on)
      engine(on, { saved: { tutorConsent: 1, tutorProgress: savedDeck } })
      on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never, text: 'boom', isError: true }))
      await start($)
      const main = await $.ui.mount({ plugin: 'mochi-crew', surface, ...MAIN, props: paneProps('Mochi') })
      await main.press({ key: 'tutor' })
      const ui = await $.ui.mount({ plugin: 'mochi-crew', surface, ...TAB, props: paneProps('Tutor') })
      await shows(ui, 'LV 1 · 2 rounds')
      await lacks(main, 'quizzing you')
      // A review round needs no model call, so it puts a round on screen here.
      await ui.press({ key: 'review' })
      await shows(ui, STEM)
      await shows(main, 'quizzing you · q 1/1')
      await $.tool.call({ tool: 'Bash', command: 'npm test' })
      await shows(main, 'fighting a bug')
      await lacks(main, 'quizzing you')
      await main.unmount()
      await ui.unmount()
    })
  }
})

describe('tutor tab on mobile', () => {
  test('no Input is drawn on any tutor screen, and every screen has its buttons', async ($, on) => {
    mock.clock(on)
    engine(on, { saved: { tutorProgress: savedDeck } })
    await start($)
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'mobile', ...TAB, props: paneProps('Tutor') })
    await shows(ui, NOTICE)
    await hasButton(ui, 'consent')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'consent' })
    await shows(ui, 'LV 1 · 2 rounds')
    await hasButton(ui, 'review')
    await hasButton(ui, 'close')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'review' })
    await shows(ui, STEM)
    await hasButton(ui, 'opt:r1-q2:0')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.unmount()
  })
})
