import { describe, expect, mock, test } from 'claude-code/testing'
import type { Plugin, TestBody } from 'claude-code/testing'
import { isCodeDiff } from '../hooks/tutorCode'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]
type Found = { key: string | undefined; text: string }
type Finder = { find: (q: { type?: string; key?: string; text?: string | RegExp }) => Promise<Found | undefined> }

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

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }
type ApiError = 'rate_limit' | 'overloaded' | 'server_error' | 'unknown'
/** What a model stub answers: a reply, a failure, or (`after`) the same once the mocked clock has moved that far. */
type ModelAnswer =
  | { isAnswered: true; text: string; usage: Usage }
  | { isAnswered: false; reason: 'api-error'; status: number | null; error: ApiError; usage: Usage }
  | { isAnswered: false; reason: 'empty-reply' | 'aborted'; usage: Usage }
type ForkAnswer = ModelAnswer | { isAnswered: false; reason: 'nothing-to-fork' }
type Planned<T> = { answer: T; after?: number }

type Message = { role: 'user' | 'assistant'; text: string; toolUses: { tool_use_id: string; tool: string; input: Record<string, unknown>; result?: unknown; text?: string }[] }

type EngineOptions = {
  saved?: Readonly<Record<string, unknown>>
  tab?: TabPlace
  /** Git's stdout per subcommand (`log`, `diff`, `numstat`, `name-status`, `ls-files`); any other is not a repository. */
  git?: Readonly<Record<string, string>>
  messages?: readonly Message[]
  /** Files on disk by absolute path; any other read fails as missing. */
  files?: Readonly<Record<string, string>>
  /** Store keys whose save fails. */
  failingSaves?: readonly string[]
  /** Symbolic links by absolute path, each to where it lands. */
  links?: Readonly<Record<string, string>>
  /** Each call takes the next answer; the last one repeats. */
  forks?: readonly Planned<ForkAnswer>[]
  completes?: readonly Planned<ModelAnswer>[]
  /** The engine refuses to send any completion (a blocked model alias): the plugin's call rejects. */
  isCompleteRefused?: boolean
  clock?: ReturnType<typeof mock.clock>
}

const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
/** A fork served from a warm cache, and one that re-read the whole chat. */
const WARM_FORK: Usage = { input_tokens: 100, output_tokens: 900, cache_read_input_tokens: 148_000, cache_creation_input_tokens: 1_000 }
const COLD_FORK: Usage = { input_tokens: 100, output_tokens: 900, cache_read_input_tokens: 0, cache_creation_input_tokens: 148_000 }
const DIGEST_CALL: Usage = { input_tokens: 9_000, output_tokens: 800, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/**
 * What sits beneath the plugin in a session: the engine's answers to what Mochi passes on, a
 * store backed by a Map, git and the models as each test plans them, and records of every
 * open, close, toast, save, git argv and model request.
 */
const engine = (on: On, { saved = {}, tab = { isFocused: true, isPlaced: true }, git = {}, messages = [], files = {}, links = {}, failingSaves = [], forks, completes, isCompleteRefused = false, clock }: EngineOptions = {}) => {
  const store = new Map<string, unknown>(Object.entries(saved))
  const record = {
    commands: [] as string[],
    opened: [] as { id: string; title?: string; focus?: boolean }[],
    closed: [] as string[],
    toasts: [] as string[],
    saves: [] as string[],
    modelCalls: 0,
    forkPrompts: [] as string[],
    completeRequests: [] as { model: string; prompt: string; system?: string }[],
    gitCalls: [] as (readonly string[])[],
    reads: [] as string[],
    logs: [] as string[],
    place: tab,
    /** When set, the next `session.root` waits this long on the mocked clock and then throws. */
    rootFault: undefined as number | undefined,
    /** How long each git call takes, on the mocked clock. */
    gitDelay: 0,
  }
  on('env.get', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    record.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', ($, e) => {
    record.logs.push(e.text)
    return { value: undefined }
  })
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
    if (failingSaves.includes(e.key)) throw new Error('disk full')
    record.saves.push(e.key)
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('session.id', () => ({ value: 'test-session' }))
  on('turn.complete', ($, e) => ({ text: e.answer, usage: e.usage }))
  on('session.root', async () => {
    const fault = record.rootFault
    if (fault === undefined) return { value: '/repo' }
    record.rootFault = undefined
    if (clock !== undefined) await clock.sleep(fault)
    throw new Error('the root moved')
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind: 'api-key' as const } }))
  on('session.messages', () => ({ value: messages as never }))
  on('fs.read', ($, e) => {
    record.reads.push(e.path)
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text as never }
  })
  on('fs.list', () => ({ value: [] }))
  on('fs.stat', ($, e) => {
    const target = links[e.path]
    const landed = target ?? e.path
    const text = files[landed]
    return { value: { kind: text === undefined ? 'dir' : 'file', size: text?.length ?? 0, mtimeMs: 0, isLink: target !== undefined, realPath: landed } as never }
  })
  on('process.run', async ($, e) => {
    if (record.gitDelay > 0 && clock !== undefined) await clock.sleep(record.gitDelay)
    const args = e.argv.slice(4)
    if (e.argv[0] === 'git') record.gitCalls.push(args)
    const verb = args[0] === 'diff' && args.includes('--numstat') ? 'numstat'
      : args[0] === 'diff' && args.includes('--name-status') ? 'name-status'
      : args[0] ?? ''
    const stdout = git[verb]
    // Without a planned answer, not a repository: the tree and the digest stay empty.
    return stdout === undefined
      ? { value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }
      : { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const take = <T,>(planned: readonly Planned<T>[], index: number): Planned<T> | undefined => planned[Math.min(index, planned.length - 1)]
  const answerAfter = async <T,>(planned: Planned<T> | undefined, fallback: T): Promise<T> => {
    if (planned?.after !== undefined && clock !== undefined) await clock.sleep(planned.after)
    return planned?.answer ?? fallback
  }
  on('model.fork', async ($, e) => {
    const index = record.forkPrompts.length
    record.modelCalls += 1
    record.forkPrompts.push(e.prompt)
    const answer: ForkAnswer = await answerAfter(forks === undefined ? undefined : take(forks, index), { isAnswered: false, reason: 'nothing-to-fork' })
    return { value: answer }
  })
  on('model.complete', async ($, e) => {
    const index = record.completeRequests.length
    record.modelCalls += 1
    record.completeRequests.push({ model: e.model, prompt: e.prompt, ...(e.system === undefined ? {} : { system: e.system }) })
    if (isCompleteRefused) throw new Error(`model ${e.model} is blocked`)
    const answer: ModelAnswer = await answerAfter(completes === undefined ? undefined : take(completes, index), { isAnswered: false, reason: 'api-error', status: 500, error: 'unknown', usage: ZERO })
    return { value: answer }
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
      expect(store.get('tutorConsent')).toBe(2)
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
    engine(on, { saved: { tutorConsent: 2 } })
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
    engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
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
    expect(await run('tutor reset')).toBe('Tutor progress for this project and the data notice consent cleared.')
    expect(await run('tutor quiz')).toContain('unknown tutor action')
    await ui.unmount()
    expect(record.modelCalls).toBe(0)
    expect(said.join('\n')).not.toContain('gitOutput')
  })

  test('/mochi tutor review starts a round from the deck without saying what it asks', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
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

  test('/mochi tutor reset forgets the deck and the consent', async ($, on) => {
    mock.clock(on)
    const { store, record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
    await start($)
    expect((await $.command.run(mochi('tutor reset'))).text).toBe('Tutor progress for this project and the data notice consent cleared.')
    expect((await $.command.run(mochi('tutor review'))).text).toBe('No missed questions to review yet.')
    expect(JSON.stringify(store.get('tutorProgress'))).not.toContain('r1-q2')
    expect(store.get('tutorConsent')).toBe(0)
    // The notice shows again, and a start waits on it with no model call.
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor opened.')
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, NOTICE)
    expect(record.modelCalls).toBe(0)
    await ui.unmount()
  })

  test('/mochi tutor reset says so when the cleared consent could not be saved', async ($, on) => {
    mock.clock(on)
    engine(on, { saved: { tutorConsent: 2 }, failingSaves: ['tutorConsent'] })
    await start($)
    expect((await $.command.run(mochi('tutor reset'))).text).toBe('Tutor progress for this project and the data notice consent cleared (could not save it for next time).')
    // Cleared for this process all the same.
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, NOTICE)
    await ui.unmount()
  })

  test('a consent to the older notice shows the notice again', async ($, on) => {
    mock.clock(on)
    const { store } = engine(on, { saved: { tutorConsent: 1 } })
    await start($)
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, NOTICE)
    await ui.press({ key: 'consent' })
    expect(store.get('tutorConsent')).toBe(2)
    await lacks(ui, NOTICE)
    await ui.unmount()
  })

  test('/mochi tutor in -p says it needs an interactive session', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
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
      engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
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

// ── writing and playing rounds ──

/** A choice question as the model writes it: the right option first, before the local shuffle. */
const choiceQ = (i: number) => ({
  kind: 'choice',
  tag: 'why',
  topic: `topic ${i}`,
  prompt: `Question ${i}: why does the tutor read git this way?`,
  options: [`right answer ${i}`, `wrong answer ${i}a`, `wrong answer ${i}b`],
  answer: 0,
  why: ['Because that is the reason.', 'Not that one.', 'Nor that one.'],
  hint: `Think about step ${i}.`,
})
const EXPLAIN_STEM = 'In your own words: how does the digest stay small?'
const explainQ = {
  kind: 'explain',
  tag: 'how',
  topic: 'digest size',
  prompt: EXPLAIN_STEM,
  reference: 'Each section has a cap and the diff takes what is left.',
  keyPoints: ['each section is capped', 'the diff is cut last'],
}
/** A reply with `count` questions, the explain one last. */
const quiz = (count: number): string => JSON.stringify({ v: 1, questions: [...Array.from({ length: count - 1 }, (_, i) => choiceQ(i)), explainQ] })
const FIRST_STEM = 'Question 0: why does the tutor read git'

const reply = (text: string, usage: Usage = WARM_FORK) => ({ answer: { isAnswered: true as const, text, usage } })
const failing = (status: number, error: ApiError) => ({ answer: { isAnswered: false as const, reason: 'api-error' as const, status, error, usage: ZERO } })

const COMMITS = 'abc1234\tadd the tutor tab\ndef5678\tread linked worktrees\n'

/** Claude has answered once in a 10k-token chat: the next round can fork while the cache is warm. */
const warmUp = async ($: $) => {
  await $.session.measure({ context: { tokens: 10_000, window: 200_000, percent: 5 }, rateLimits: [], cost: undefined, changed: ['context'] })
  await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't1', reason: 'answer', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 9_000, cache_creation_input_tokens: 100 } })
}

/** The tab on Home with consent given, mounted on `surface`. */
const tutorTab = async <S extends 'terminal' | 'desktop' | 'mobile' = 'desktop'>($: $, surface: S = 'desktop' as S) => {
  await $.command.run(mochi('tutor'))
  return $.ui.mount({ plugin: 'mochi-crew', surface, ...TAB, props: paneProps('Tutor') })
}

/** Presses `n` (or `finish`), and whatever answers each question: the right option, or wrong at `wrongAt`; explain by reveal and "I had it". */
const answerAll = async (ui: Finder & { press: (t: { key: string }) => Promise<unknown> }, wrongAt?: number) => {
  for (let step = 0; step < 8; step++) {
    if (await ui.find({ type: 'Text', text: 'Round done' })) return
    const option = await ui.find({ type: 'Button', text: step === wrongAt ? 'wrong answer' : 'right answer' })
    if (option?.key !== undefined) {
      await ui.press({ key: option.key })
    } else {
      await ui.press({ key: 'reveal' })
      await ui.press({ key: 'self:right' })
    }
    await ui.press({ key: 'next' })
  }
}

/** Reads one of Mochi's atoms back through `/probe <key>`, as another plugin may. */
const PROBE: Plugin = {
  name: 'probe',
  register(on) {
    on('command.run', { command: 'probe' }, async ($, e) => ({
      text: JSON.stringify(e.args.trim() === 'tutor'
        ? (await $.state.get({ plugin: 'mochi-crew', key: 'tutor' })).value ?? null
        : (await $.state.get({ plugin: 'mochi-crew', key: 'tutorSession' })).value ?? null),
    }))
  },
}
const probe = async ($: $, key: 'tutor' | 'tutorSession'): Promise<unknown> =>
  JSON.parse((await $.command.run({ command: 'probe', args: key, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })).text ?? 'null')

describe('tutor rounds', () => {
  for (const surface of SURFACES) {
    test(`warm session forks once and never completes (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [reply(quiz(5))] })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await shows(ui, 'session · warm')
      await ui.press({ key: 'start:recent' })
      await shows(ui, FIRST_STEM)
      expect(record.forkPrompts).toHaveLength(1)
      expect(record.completeRequests).toHaveLength(0)
      const prompt = record.forkPrompts[0] ?? ''
      expect(prompt).toContain('[Mochi Tutor: a side request from the Mochi mod')
      expect(prompt).toContain('add the tutor tab')
      // Commit subjects come from the one log call; the fork reads no diff.
      expect(record.gitCalls.filter(args => args[0] === 'diff')).toEqual([])
      await shows(ui, 'q 1/5')
      await ui.unmount()
    })
  }

  for (const surface of SURFACES) {
    test(`answering every question shows the summary, adds the XP and saves progress (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record, store } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [reply(quiz(5))] })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      await shows(ui, FIRST_STEM)
      // One miss: 4 right at 5 XP, no perfect bonus.
      await answerAll(ui, 1)
      await shows(ui, 'Round done · 4/5 · +20 XP')
      await shows(ui, '1 call · fork · 148k cached')
      expect((store.get('stats') as { xp: number }).xp).toBe(20)
      const progress = store.get('tutorProgress') as { projects: Record<string, { rounds: number; deck: { question: { topic: string } }[] }> }
      expect(progress.projects['/repo']?.rounds).toBe(1)
      expect(progress.projects['/repo']?.deck.map(card => card.question.topic)).toEqual(['topic 1'])
      expect(record.modelCalls).toBe(1)
      // `n` goes back Home with this round counted.
      await ui.press({ key: 'next' })
      await shows(ui, 'LV 1 · 1 round')
      await ui.unmount()
    })
  }

  test('a perfect round dances and says the perfect quip, at the XP cap', async ($, on) => {
    mock.clock(on)
    const { record, store } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(5))] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await answerAll(ui)
    // 25 from five clean answers plus the 10 bonus, capped at 35.
    await shows(ui, 'Round done · 5/5 · +35 XP')
    expect((store.get('stats') as { xp: number }).xp).toBe(35)
    // The dance's care change is saved like any other.
    expect(record.saves).toContain('care')
    const main = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...MAIN, props: paneProps('Mochi') })
    expect(await main.find({ type: 'Text', text: /Perfect round\.|You really know this code\./ })).toBeDefined()
    await main.unmount()
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`cold session completes once with haiku and never forks (${surface})`, async ($, on) => {
      const clock = mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [reply(quiz(5), DIGEST_CALL)] })
      await start($)
      await warmUp($)
      await clock.advance(61 * 60_000)
      const ui = await tutorTab($, surface)
      await shows(ui, 'digest · cache cold')
      await ui.press({ key: 'start:recent' })
      await shows(ui, FIRST_STEM)
      expect(record.forkPrompts).toHaveLength(0)
      expect(record.completeRequests).toHaveLength(1)
      expect(record.completeRequests[0]?.model).toBe('haiku')
      expect(record.completeRequests[0]?.prompt).toContain('add the tutor tab')
      await ui.unmount()
    })
  }

  test('tutorModel option sonnet reaches the digest request', { options: { tutorModel: 'sonnet', tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [reply(quiz(5), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await shows(ui, 'digest · set in /config')
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    expect(record.completeRequests.map(request => request.model)).toEqual(['sonnet'])
    expect(record.forkPrompts).toHaveLength(0)
    await ui.unmount()
  })

  test('nothing-to-fork falls back to one digest call', { plugins: [PROBE] }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ answer: { isAnswered: false, reason: 'nothing-to-fork' } }], completes: [reply(quiz(5), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    expect(record.forkPrompts).toHaveLength(1)
    expect(record.completeRequests).toHaveLength(1)
    // Two calls were asked for, one was made: nothing to fork sends nothing.
    expect((await probe($, 'tutorSession') as { usage: { calls: number } }).usage.calls).toBe(1)
    await ui.unmount()
  })

  test('invalid fork reply falls back once; invalid digest shows the error with no third call', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [reply('Sure! Here are some questions.')], completes: [reply('{"v":1,"questions":[]}', DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, "the reply wasn't a quiz")
    expect(record.modelCalls).toBe(2)
    await hasButton(ui, 'retry')
    // The digest failed, so there is no digest to try instead.
    expect(await ui.find({ type: 'Button', key: 'try-digest' })).toBeUndefined()
    await ui.unmount()
  })

  test('fork rate_limit shows the error without a digest call', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [failing(429, 'rate_limit')], completes: [reply(quiz(5), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'rate-limited (429). Try again in a bit.')
    expect(record.completeRequests).toHaveLength(0)
    await hasButton(ui, 'try-digest')
    await ui.press({ key: 'try-digest' })
    await shows(ui, FIRST_STEM)
    expect(record.completeRequests).toHaveLength(1)
    await ui.unmount()
  })

  test('a fork miss latches the digest until Claude responds again', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [reply(quiz(5), COLD_FORK)], completes: [reply(quiz(5), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    // Ending at once still reports the spend.
    await ui.press({ key: 'end' })
    await shows(ui, 'The cache had lapsed: this round re-read 148k tokens at full price.')
    await ui.press({ key: 'next' })
    await shows(ui, 'digest · last fork missed the cache')
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    expect(record.forkPrompts).toHaveLength(1)
    expect(record.completeRequests).toHaveLength(1)
    await ui.press({ key: 'end' })
    await ui.press({ key: 'next' })
    await $.turn.complete({ answer: 'ok', durationMs: 1000, isAborted: false, turnId: 't2', reason: 'answer' })
    await shows(ui, 'session · warm')
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`stopping a slow fork returns home and the late reply changes nothing but spend (${surface})`, async ($, on) => {
      const clock = mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5)), after: 30_000 }], clock })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      await shows(ui, 'Mochi is reading the chat…')
      await shows(ui, 'stopping only hides the reply')
      await clock.advance(12_000)
      await shows(ui, '12s')
      await ui.press({ key: 'cancel' })
      await shows(ui, 'cancelled')
      await shows(ui, HOME)
      await clock.advance(30_000)
      await lacks(ui, FIRST_STEM)
      await shows(ui, HOME)
      // The late reply was paid for, so this session's spend shows it.
      await shows(ui, '148k cached')
      expect(record.modelCalls).toBe(1)
      await ui.unmount()
    })
  }

  test('the fork watchdog falls back to the digest after 60s', { plugins: [PROBE] }, async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5)), after: 90_000 }], completes: [reply(quiz(5), DIGEST_CALL)], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await clock.advance(59_000)
    expect(record.completeRequests).toHaveLength(0)
    await clock.advance(1_000)
    await shows(ui, FIRST_STEM)
    expect(record.completeRequests).toHaveLength(1)
    // The fork's late reply lands on nothing: the digest's round stays, its spend is the session's.
    await clock.advance(30_000)
    await shows(ui, FIRST_STEM)
    const session = await probe($, 'tutorSession') as { usage: { calls: number; cacheRead: number } }
    expect(session.usage).toMatchObject({ calls: 2, cacheRead: 148_000 })
    const round = (await probe($, 'tutor') as { round: { source: string; usage: { calls: number } } }).round
    expect(round).toMatchObject({ source: 'digest', usage: { calls: 1 } })
    await ui.unmount()
  })

  for (const surface of SURFACES) {
    test(`cancelling a digest returns home (${surface})`, { options: { tutorContext: 'digest' } }, async ($, on) => {
      const clock = mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [{ ...reply(quiz(5), DIGEST_CALL), after: 30_000 }], clock })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      await shows(ui, 'Mochi is reading the diff…')
      await shows(ui, 'digest · haiku · ≤45s')
      await ui.press({ key: 'cancel' })
      await shows(ui, 'cancelled')
      await clock.advance(30_000)
      await lacks(ui, FIRST_STEM)
      await shows(ui, HOME)
      expect(record.completeRequests).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('a rejected tutor model shows model-refused', { options: { tutorModel: 'opus', tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    // Beneath the plugin, the engine refuses to send the request at all.
    engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, isCompleteRefused: true })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'the tutor model "opus" isn\'t allowed here; pick another in /config.')
    await ui.unmount()
  })

  test('the digest masks secrets, skips .env, never sends tool results and passes no-textconv', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const diff = [
      'diff --git a/hooks/tutor.ts b/hooks/tutor.ts',
      '--- a/hooks/tutor.ts',
      '+++ b/hooks/tutor.ts',
      '@@ -1,2 +1,3 @@',
      ' export const one = 1',
      '+const API_KEY=sk-test-123456789abcdef',
      ' export const two = 2',
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
      '@@ -0,0 +1 @@',
      '+DATABASE_PASSWORD=hunter2-plain',
      '',
    ].join('\n')
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: { log: COMMITS, 'rev-parse': '\n', 'name-status': 'M\0hooks/tutor.ts\0M\0.env\0', diff, numstat: '1\t0\thooks/tutor.ts\n1\t0\t.env\n' },
      messages: [
        { role: 'user', text: 'Add the tutor tab please', toolUses: [] },
        { role: 'assistant', text: 'Done.', toolUses: [{ tool_use_id: 'u1', tool: 'Bash', input: { command: 'cat secrets.txt' }, result: { stdout: 'TOOL-RESULT-SENTINEL' }, text: 'TOOL-RESULT-SENTINEL' }] },
      ],
      completes: [reply(quiz(5), DIGEST_CALL)],
    })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    const prompt = record.completeRequests[0]?.prompt ?? ''
    expect(prompt).toContain('hooks/tutor.ts')
    expect(prompt).toContain('Add the tutor tab please')
    expect(prompt).not.toContain('sk-test-123456789abcdef')
    expect(prompt).not.toContain('hunter2-plain')
    expect(prompt).not.toContain('.env')
    expect(prompt).not.toContain('TOOL-RESULT-SENTINEL')
    expect(prompt).not.toContain('cat secrets.txt')
    const diffs = record.gitCalls.filter(args => args[0] === 'diff' && args.includes('-U2'))
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toContain('--no-textconv')
    expect(diffs[0]).toContain('--no-ext-diff')
    expect(diffs[0]).toContain(':(literal)hooks/tutor.ts')
    expect(diffs[0]).not.toContain(':(literal).env')
    await ui.unmount()
  })

  test('the digest never diffs a file renamed from .env, and skips the diff when nothing is allowed', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    // What git would print for the renamed file if it were asked: its content must never be asked for.
    const diff = ['diff --git a/config.txt b/config.txt', 'new file mode 100644', '--- /dev/null', '+++ b/config.txt', '@@ -0,0 +1 @@', '+API_TOKEN=renamed-env-content', ''].join('\n')
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: { log: COMMITS, 'rev-parse': '\n', 'name-status': 'R100\0.env\0config.txt\0', diff, numstat: '1\t0\tconfig.txt\n' },
      completes: [reply(quiz(5), DIGEST_CALL)],
    })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    const prompt = record.completeRequests[0]?.prompt ?? ''
    expect(prompt).not.toContain('renamed-env-content')
    expect(prompt).not.toContain('config.txt')
    // The tree's own numstat reads run unscoped; only the tutor's step two is `--relative`.
    expect(record.gitCalls.filter(args => args[0] === 'diff' && args.includes('--relative'))).toEqual([])
    expect(record.gitCalls.some(args => args.includes('--name-status'))).toBe(true)
    await ui.unmount()
  })

  test('the digest reads at most two new touched files and never a secret-looking one', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: {
        log: COMMITS,
        'rev-parse': '\n',
        branch: 'main\n',
        worktree: 'worktree /repo\0HEAD 1\0branch refs/heads/main\0\0',
        status: '?? notes.ts\0?? .env.local\0?? extra.ts\0?? more.ts\0',
      },
      files: {
        '/repo/notes.ts': 'export const NOTE_MARKER = 1\n',
        '/repo/extra.ts': 'export const EXTRA_MARKER = 2\n',
        '/repo/more.ts': 'export const MORE_MARKER = 3\n',
        '/repo/.env.local': 'SECRET_TOKEN=env-file-content\n',
      },
      completes: [reply(quiz(5), DIGEST_CALL)],
    })
    on('tool.call', { tool: 'Write' }, () => ({ result: {} as never, text: 'written' }))
    await start($)
    await warmUp($)
    // Oldest first: the digest takes the newest two that are not secret-looking.
    for (const file of ['notes.ts', 'extra.ts', 'more.ts', '.env.local']) await $.tool.call({ tool: 'Write', file_path: `/repo/${file}`, content: 'x' })
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    const prompt = record.completeRequests[0]?.prompt ?? ''
    expect(record.reads).not.toContain('/repo/.env.local')
    expect(record.reads.filter(path => path.endsWith('.ts'))).toEqual(['/repo/more.ts', '/repo/extra.ts'])
    expect(prompt).toContain('MORE_MARKER')
    expect(prompt).toContain('EXTRA_MARKER')
    expect(prompt).not.toContain('NOTE_MARKER')
    expect(prompt).not.toContain('env-file-content')
    await ui.unmount()
  })

  test('the digest never reads a new file that is a link, lands outside the project or is large', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: {
        log: COMMITS,
        'rev-parse': '\n',
        branch: 'main\n',
        worktree: 'worktree /repo\0HEAD 1\0branch refs/heads/main\0\0',
        status: '?? notes.ts\0?? big.ts\0',
      },
      files: {
        '/home/u/.ssh/id_rsa': 'LINKED_KEY_CONTENT\n',
        '/repo/big.ts': `export const BIG_MARKER = 1\n${'x'.repeat(200_001)}`,
      },
      links: { '/repo/notes.ts': '/home/u/.ssh/id_rsa' },
      completes: [reply(quiz(5), DIGEST_CALL)],
    })
    on('tool.call', { tool: 'Write' }, () => ({ result: {} as never, text: 'written' }))
    await start($)
    await warmUp($)
    for (const file of ['notes.ts', 'big.ts']) await $.tool.call({ tool: 'Write', file_path: `/repo/${file}`, content: 'x' })
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    const prompt = record.completeRequests[0]?.prompt ?? ''
    expect(record.reads).not.toContain('/home/u/.ssh/id_rsa')
    expect(record.reads).not.toContain('/repo/notes.ts')
    expect(record.reads).not.toContain('/repo/big.ts')
    expect(prompt).not.toContain('LINKED_KEY_CONTENT')
    expect(prompt).not.toContain('BIG_MARKER')
    await ui.unmount()
  })

  test('a due card is replayed third in a new round, and the model writes one fewer', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck }, forks: [reply(quiz(5))] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    expect(record.forkPrompts[0]).toContain('Write exactly 4 questions')
    for (let step = 0; step < 2; step++) {
      const option = await ui.find({ type: 'Button', text: 'right answer' })
      await ui.press({ key: option?.key ?? '' })
      await ui.press({ key: 'next' })
    }
    await shows(ui, 'q 3/5')
    await shows(ui, STEM)
    await shows(ui, 'from an earlier round')
    await ui.unmount()
  })

  test('session end mid-round drops the late reply and keeps progress', { options: { tutorContext: 'digest' } }, async ($, on) => {
    const clock = mock.clock(on)
    const { store } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck }, git: { log: COMMITS }, completes: [{ ...reply(quiz(5), DIGEST_CALL), after: 30_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the diff…')
    const ended = $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    await clock.settle()
    await clock.advance(30_000)
    await ended
    await lacks(ui, FIRST_STEM)
    await lacks(ui, 'Mochi is reading')
    await shows(ui, 'LV 1 · 2 rounds')
    expect(JSON.stringify(store.get('tutorProgress'))).toContain('r1-q2')
    await ui.unmount()
  })

  test('review round from the deck makes zero model calls and moves the card up', async ($, on) => {
    mock.clock(on)
    const { record, store } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck } })
    await start($)
    const ui = await tutorTab($)
    await ui.press({ key: 'review' })
    await shows(ui, STEM)
    const right = await ui.find({ type: 'Button', text: 'So a refresh never holds index.lock' })
    await ui.press({ key: right?.key ?? '' })
    await ui.press({ key: 'next' })
    // A review round earns half and no bonus: floor(5 / 2).
    await shows(ui, 'Round done · 1/1 · +2 XP')
    await shows(ui, 'no model call')
    expect(record.modelCalls).toBe(0)
    const project = (store.get('tutorProgress') as { projects: Record<string, { rounds: number; deck: { box: number; dueRound: number }[] }> }).projects['/repo']
    expect(project?.rounds).toBe(3)
    expect(project?.deck).toEqual([expect.objectContaining({ box: 2, dueRound: 5 })])
    await ui.unmount()
  })

  test('retrying missed questions replays them locally for no XP', async ($, on) => {
    mock.clock(on)
    const { record, store } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(5))] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await answerAll(ui, 0)
    await shows(ui, '+20 XP')
    await ui.press({ key: 'retry-missed' })
    await shows(ui, FIRST_STEM)
    await shows(ui, 'q 1/1')
    await answerAll(ui)
    await shows(ui, 'Round done · 1/1 · +0 XP')
    expect((store.get('stats') as { xp: number }).xp).toBe(20)
    expect(record.modelCalls).toBe(1)
    await ui.unmount()
  })

  test('a second start while one is written is turned away', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5)), after: 30_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor opened.')
    expect(record.toasts).toContain('Mochi is already writing one.')
    await clock.advance(30_000)
    await shows(ui, FIRST_STEM)
    expect(record.modelCalls).toBe(1)
    await ui.unmount()
  })

  test('/mochi tutor stop cancels a round being written, and ends one on screen', { options: { tutorContext: 'digest' } }, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [{ ...reply(quiz(5), DIGEST_CALL), after: 30_000 }, reply(quiz(5), DIGEST_CALL)], clock })
    await start($)
    await warmUp($)
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor round starting in its tab.')
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(ui, 'Mochi is reading the diff…')
    expect((await $.command.run(mochi('tutor stop'))).text).toBe('Tutor stopped.')
    await shows(ui, 'cancelled')
    await clock.advance(30_000)
    await lacks(ui, FIRST_STEM)
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor round starting in its tab.')
    await shows(ui, FIRST_STEM)
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    expect((await $.command.run(mochi('tutor stop'))).text).toBe('Tutor stopped.')
    // Scored on what was answered: one right, the rest unanswered.
    await shows(ui, 'Round done · 1/1 · +5 XP')
    await ui.unmount()
  })
})

// ── grading and follow-ups ──

const GRADE_CALL: Usage = { input_tokens: 400, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ASK_CALL: Usage = { input_tokens: 700, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const GRADE_NOTE = 'You named the caps; the diff is cut last.'
const grade = (points: readonly boolean[], note = GRADE_NOTE) => reply(JSON.stringify({ v: 1, points, note }), GRADE_CALL)
const ASK_REPLY = 'Because a refresh runs every few seconds.'

/** Answers the choices before the explain question (the last in `quiz`), leaving its field on screen. */
const toExplain = async (ui: Finder & { press: (t: { key: string }) => Promise<unknown> }) => {
  for (let step = 0; step < 8; step++) {
    if (await ui.find({ type: 'Text', text: EXPLAIN_STEM })) return
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    await ui.press({ key: 'next' })
  }
}

/** The key of the field on screen, or '' when there is none. */
const fieldKey = async (ui: Finder): Promise<string> => (await ui.find({ type: 'Input' }))?.key ?? ''

describe('tutor grading and follow-ups', () => {
  for (const surface of SURFACES) {
    test(`typing an answer calls the grader with the masked text and shows the points (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [grade([true, false])] })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      await toExplain(ui)
      const key = await fieldKey(ui)
      expect(key).toMatch(/^answer:/)
      await ui.input({ key, text: 'each section is capped, API_KEY=sk-test-123456789abcdef' })
      expect(record.completeRequests).toHaveLength(1)
      const request = record.completeRequests[0]
      expect(request?.model).toBe('haiku')
      expect(request?.system).toContain("You grade a learner's short answer")
      expect(request?.prompt).toContain('<answer>each section is capped')
      expect(request?.prompt).toContain('1. each section is capped')
      expect(request?.prompt).not.toContain('sk-test-123456789abcdef')
      expect(record.forkPrompts).toHaveLength(1)
      // Half the key points: partly, 3 XP, the points marked and the grader's note.
      await shows(ui, '◐ partly')
      await shows(ui, '+3 XP')
      await shows(ui, 'you said')
      await shows(ui, '✓ ')
      await shows(ui, GRADE_NOTE)
      await shows(ui, 'ref')
      await lacks(ui, "couldn't check automatically")
      // The grade's spend is the round's too: a fork and a grade.
      await ui.press({ key: 'next' })
      await shows(ui, '2 calls · fork')
      await ui.unmount()
    })
  }

  test('a failed grade offers self-grading', async ($, on) => {
    mock.clock(on)
    // A reply that is no grade, then an API error: both leave the grading to the learner.
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3)), reply(quiz(3))], completes: [reply('I think it is fine.', GRADE_CALL), failing(500, 'server_error')] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    await ui.input({ key: await fieldKey(ui), text: 'every section has its own cap' })
    await shows(ui, "couldn't check automatically. How did you do?")
    await shows(ui, 'every section has its own cap')
    await ui.press({ key: 'self:partial' })
    await shows(ui, '◐ partly')
    await ui.press({ key: 'next' })
    await ui.press({ key: 'next' })
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    await ui.input({ key: await fieldKey(ui), text: 'every section has its own cap' })
    await shows(ui, "couldn't check automatically. How did you do?")
    expect(record.completeRequests).toHaveLength(2)
    await ui.unmount()
  })

  test('a too-short answer makes no call', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [grade([true, true])] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    await ui.input({ key: await fieldKey(ui), text: ' x  y ' })
    expect(record.toasts).toContain('type an answer, or press r to see it')
    expect(record.completeRequests).toHaveLength(0)
    await shows(ui, EXPLAIN_STEM)
    expect(await fieldKey(ui)).toMatch(/^answer:/)
    await ui.unmount()
  })

  test('cancelling a grade hands it to the learner and the late grade changes nothing but spend', { plugins: [PROBE] }, async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [{ ...grade([true, true]), after: 10_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    const typed = ui.input({ key: await fieldKey(ui), text: 'every section has its own cap' })
    await clock.settle()
    await shows(ui, 'checking your answer…')
    await hasButton(ui, 'cancel')
    await ui.press({ key: 'cancel' })
    await shows(ui, "couldn't check automatically. How did you do?")
    await clock.advance(10_000)
    await typed
    await shows(ui, "couldn't check automatically. How did you do?")
    await lacks(ui, GRADE_NOTE)
    await lacks(ui, '✓ solid')
    expect(record.completeRequests).toHaveLength(1)
    // The fork and the dropped grade both count for the session.
    expect((await probe($, 'tutorSession') as { usage: { calls: number } }).usage.calls).toBe(2)
    await ui.unmount()
  })

  test('a start during a grade or mid-round says why it waits', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [{ ...grade([true, true]), after: 10_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    // A question on screen: its answers would be lost, so the round is finished first.
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor opened.')
    expect(record.toasts).toContain('Finish or end this round first.')
    await toExplain(ui)
    const typed = ui.input({ key: await fieldKey(ui), text: 'every section has its own cap' })
    await clock.settle()
    await shows(ui, 'checking your answer…')
    expect((await $.command.run(mochi('tutor start'))).text).toBe('Tutor opened.')
    expect(record.toasts).toContain('Mochi is checking your answer.')
    expect(record.toasts).not.toContain('Mochi is already writing one.')
    await clock.advance(10_000)
    await typed
    await shows(ui, GRADE_NOTE)
    // No second round was asked for, and the grade landed on the round it belonged to.
    expect(record.forkPrompts).toHaveLength(1)
    expect(record.completeRequests).toHaveLength(1)
    await ui.unmount()
  })

  test('typed text survives a redraw', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [grade([true, true])] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    const key = await fieldKey(ui)
    await ui.input({ key, text: 'half typed', kind: 'change' })
    // Well past several 180 ms ticks, each redrawing every pane.
    await clock.advance(2_000)
    // The kit reads what the hook drew, not the field's buffer: what keeps the typing is the
    // same key and no `value` prop, which would replace it on every redraw.
    const field = await ui.find({ type: 'Input' })
    expect(field?.key).toBe(key)
    expect(field?.props).not.toHaveProperty('value')
    expect(field?.props).not.toHaveProperty('onInput')
    // An edit reaches no handler: no call, no toast, the question still up.
    expect(record.completeRequests).toHaveLength(0)
    expect(record.toasts).toEqual([])
    await shows(ui, EXPLAIN_STEM)
    // Enter after the redraws still submits the whole text.
    await ui.input({ key, text: 'half typed, then finished' })
    expect(record.completeRequests[0]?.prompt).toContain('<answer>half typed, then finished</answer>')
    await ui.unmount()
  })
})

describe('tutor follow-ups and model text', () => {
  for (const surface of SURFACES) {
    test(`a follow-up makes one capped call and the field disappears after two (${surface})`, async ($, on) => {
      mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(5))], completes: [reply(ASK_REPLY, ASK_CALL), reply('The index lock is held only briefly.', ASK_CALL)] })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      const option = await ui.find({ type: 'Button', text: 'right answer' })
      await ui.press({ key: option?.key ?? '' })
      await shows(ui, '(2 left)')
      const key = await fieldKey(ui)
      expect(key).toMatch(/^ask:/)
      await ui.input({ key, text: `why not a lock file? ${'and more '.repeat(80)}` })
      expect(record.completeRequests).toHaveLength(1)
      const request = record.completeRequests[0]
      expect(request?.model).toBe('haiku')
      expect(request?.system).toContain('You are Mochi, a patient coding tutor')
      expect(request?.prompt).toContain('<ask>why not a lock file?')
      expect(request?.prompt.length).toBeLessThanOrEqual(6_000)
      // The ask is cut to 400 inside its tags; a fork round sends no diff excerpt.
      expect((/<ask>([\s\S]*)<\/ask>/.exec(request?.prompt ?? '')?.[1] ?? '').length).toBeLessThanOrEqual(400)
      expect(request?.prompt).not.toContain('kind="excerpt"')
      expect(record.forkPrompts).toHaveLength(1)
      await shows(ui, 'mochi')
      await shows(ui, ASK_REPLY)
      await shows(ui, '(1 left)')
      await ui.input({ key: await fieldKey(ui), text: 'and then?' })
      // The second call carries the first exchange.
      expect(record.completeRequests[1]?.prompt).toContain(ASK_REPLY)
      await shows(ui, 'The index lock is held only briefly.')
      await shows(ui, 'out of follow-ups for this question')
      expect(await ui.find({ type: 'Input' })).toBeUndefined()
      await hasButton(ui, 'next')
      expect(record.completeRequests).toHaveLength(2)
      await ui.unmount()
    })
  }

  test('a failed follow-up says so and keeps the count', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(5))], completes: [failing(500, 'server_error'), reply(' \n\t\t ', ASK_CALL), reply(ASK_REPLY, ASK_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    await ui.input({ key: await fieldKey(ui), text: 'why?' })
    expect(record.toasts).toEqual(["Mochi couldn't answer that one."])
    await shows(ui, '(2 left)')
    // A blank reply, tabs included, is no reply either and costs no follow-up.
    await ui.input({ key: await fieldKey(ui), text: 'why?' })
    expect(record.toasts).toHaveLength(2)
    await shows(ui, '(2 left)')
    // A blank ask makes no call.
    await ui.input({ key: await fieldKey(ui), text: '   ' })
    expect(record.completeRequests).toHaveLength(2)
    await ui.input({ key: await fieldKey(ui), text: 'why?' })
    await shows(ui, ASK_REPLY)
    await shows(ui, '(1 left)')
    await ui.unmount()
  })

  test('cancelling a follow-up keeps the count and drops the late reply', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(5))], completes: [{ ...reply(ASK_REPLY, ASK_CALL), after: 10_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    const asked = ui.input({ key: await fieldKey(ui), text: 'why?' })
    await clock.settle()
    await shows(ui, 'Mochi is thinking…')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'cancel' })
    await shows(ui, '(2 left)')
    await clock.advance(10_000)
    await asked
    await lacks(ui, ASK_REPLY)
    await shows(ui, '(2 left)')
    expect(record.toasts).toEqual([])
    await ui.unmount()
  })

  test('a digest round sends the diff excerpt of the question\'s file with a follow-up', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const diff = [
      'diff --git a/hooks/tutor.ts b/hooks/tutor.ts',
      '--- a/hooks/tutor.ts',
      '+++ b/hooks/tutor.ts',
      '@@ -1,2 +1,3 @@',
      ' export const one = 1',
      '+export const capped = 16_000',
      ' export const two = 2',
      '',
    ].join('\n')
    const onFile = JSON.stringify({ v: 1, questions: [0, 1, 2].map(i => ({ ...choiceQ(i), file: 'hooks/tutor.ts' })) })
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: { log: COMMITS, 'rev-parse': '\n', 'name-status': 'M\0hooks/tutor.ts\0', diff, numstat: '1\t0\thooks/tutor.ts\n' },
      completes: [reply(onFile, DIGEST_CALL), reply(ASK_REPLY, ASK_CALL)],
    })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    await ui.input({ key: await fieldKey(ui), text: 'where is the cap set?' })
    const prompt = record.completeRequests[1]?.prompt ?? ''
    expect(prompt).toContain('<data kind="excerpt">')
    expect(prompt).toContain('export const capped = 16_000')
    await shows(ui, ASK_REPLY)
    await ui.unmount()
  })

  test('model text with ANSI and a markdown link renders as plain text with no Link', async ($, on) => {
    mock.clock(on)
    const hostile = {
      ...choiceQ(0),
      prompt: 'Question 0: why \u001b[31mred\u001b[0m and [the docs](https://evil.example/x)?',
    }
    const round = JSON.stringify({ v: 1, questions: [hostile, choiceQ(1), explainQ] })
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      forks: [reply(round)],
      completes: [
        reply('See [this link](https://evil.example/y) and \u001b]8;;https://evil.example\u0007here\u001b]8;;\u0007.', ASK_CALL),
        grade([true, true], 'Good \u001b[1mjob\u001b[0m, see [docs](https://evil.example/z).'),
      ],
    })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, '[the docs](https://evil.example/x)')
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    await ui.input({ key: await fieldKey(ui), text: 'why?' })
    await shows(ui, '[this link](https://evil.example/y)')
    await ui.press({ key: 'next' })
    await ui.press({ key: (await ui.find({ type: 'Button', text: 'right answer' }))?.key ?? '' })
    await ui.press({ key: 'next' })
    await ui.input({ key: await fieldKey(ui), text: 'each section is capped and the diff goes last' })
    await shows(ui, '✓ solid')
    await shows(ui, '[docs](https://evil.example/z)')
    expect(record.completeRequests).toHaveLength(2)
    for (const type of ['Link', 'Markdown', 'Code']) expect(await ui.find({ type })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /\u001b|\u0007/ })).toBeUndefined()
    await ui.unmount()
  })

  test('open file shows on the terminal only for a file the session touched in its own checkout', async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const questions = [
      { ...choiceQ(0), file: 'hooks/tutor.ts' },
      { ...choiceQ(1), file: 'hooks/other.ts' },
      explainQ,
    ]
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(JSON.stringify({ v: 1, questions }))] })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/hooks/tutor.ts', old_string: 'a', new_string: 'b' })
    await warmUp($)
    const ui = await tutorTab($, 'terminal')
    await ui.press({ key: 'start:recent' })
    await ui.press({ key: (await ui.find({ type: 'Button', text: 'right answer' }))?.key ?? '' })
    await hasButton(ui, 'open-file')
    await ui.press({ key: 'open-file' })
    expect(record.toasts.some(text => text.includes('hooks/tutor.ts'))).toBe(true)
    await ui.unmount()
    // The same feedback on the desktop has no button, the file being the same.
    const desk = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor') })
    await shows(desk, 'see')
    expect(await desk.find({ type: 'Button', key: 'open-file' })).toBeUndefined()
    // The model named a file the session never touched: it was dropped by the allowlist, so no button.
    await desk.press({ key: 'next' })
    await desk.unmount()
    const term = await $.ui.mount({ plugin: 'mochi-crew', surface: 'terminal', ...TAB, props: paneProps('Tutor') })
    await term.press({ key: (await term.find({ type: 'Button', text: 'right answer' }))?.key ?? '' })
    await shows(term, '✓ right')
    expect(await term.find({ type: 'Button', key: 'open-file' })).toBeUndefined()
    await term.unmount()
  })
  test('open file stays away for a path the session touched only in a linked worktree', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never, text: 'edited' }))
    const questions = [{ ...choiceQ(0), file: 'hooks/tutor.ts' }, choiceQ(1), explainQ]
    const { record } = engine(on, {
      saved: { tutorConsent: 2 },
      git: {
        log: COMMITS,
        'rev-parse': '\n',
        branch: 'main\n',
        worktree: 'worktree /repo\0HEAD 1\0branch refs/heads/main\0\0worktree /side\0HEAD 2\0branch refs/heads/side\0\0',
        // The same relative path is changed in this checkout too, so the digest lets the model name it.
        'name-status': 'M\0hooks/tutor.ts\0',
        diff: ['diff --git a/hooks/tutor.ts b/hooks/tutor.ts', '--- a/hooks/tutor.ts', '+++ b/hooks/tutor.ts', '@@ -1 +1 @@', '-export const one = 1', '+export const one = 2', ''].join('\n'),
        numstat: '1\t1\thooks/tutor.ts\n',
      },
      completes: [reply(JSON.stringify({ v: 1, questions }), DIGEST_CALL)],
    })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/side/hooks/tutor.ts', old_string: 'a', new_string: 'b' })
    await warmUp($)
    const ui = await tutorTab($, 'terminal')
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    await ui.press({ key: (await ui.find({ type: 'Button', text: 'right answer' }))?.key ?? '' })
    await shows(ui, '✓ right')
    // The file is the question's own, so it is named; the session never touched this checkout's copy.
    await shows(ui, 'hooks/tutor.ts')
    expect(await ui.find({ type: 'Button', key: 'open-file' })).toBeUndefined()
    expect(record.toasts.some(text => text.includes('hooks/tutor.ts'))).toBe(false)
    await ui.unmount()
  })
})

describe('tutor explain on mobile', () => {
  test('an explain question completes with buttons only and no grade call', async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [grade([true, true])] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($, 'mobile')
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await hasButton(ui, 'reveal')
    await ui.press({ key: 'reveal' })
    await shows(ui, 'ref')
    await shows(ui, 'How did you do?')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'self:right' })
    await shows(ui, '✓ solid')
    // No follow-ups on mobile either.
    await lacks(ui, 'left)')
    expect(await ui.find({ type: 'Input' })).toBeUndefined()
    await ui.press({ key: 'next' })
    await shows(ui, 'Round done · 3/3')
    expect(record.completeRequests).toHaveLength(0)
    expect(record.modelCalls).toBe(1)
    await ui.unmount()
  })
})

describe('tutor races', () => {
  test('a review asked for as a follow-up starts never strands the follow-up', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck }, forks: [reply(quiz(5))], completes: [{ ...reply(ASK_REPLY, ASK_CALL), after: 5_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    const option = await ui.find({ type: 'Button', text: 'right answer' })
    await ui.press({ key: option?.key ?? '' })
    const asked = ui.input({ key: await fieldKey(ui), text: 'why?' })
    const reviewed = $.command.run(mochi('tutor review'))
    await clock.settle()
    await clock.advance(5_000)
    await asked
    await reviewed
    // The follow-up was asked and answered; the review waited its turn.
    await lacks(ui, 'Mochi is thinking…')
    await shows(ui, ASK_REPLY)
    expect(record.completeRequests).toHaveLength(1)
    await ui.unmount()
  })

  test('a start and a review pressed together leave one round on screen', async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { saved: { tutorConsent: 2, tutorProgress: savedDeck }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5)), after: 5_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    const started = ui.press({ key: 'start:recent' })
    const reviewed = ui.press({ key: 'review' })
    await clock.settle()
    await clock.advance(5_000)
    await started
    await reviewed
    await lacks(ui, 'Mochi is reading')
    expect((await ui.find({ type: 'Text', text: FIRST_STEM })) ?? (await ui.find({ type: 'Text', text: STEM }))).toBeDefined()
    await ui.unmount()
  })

  test('a doubled Enter on an answer sends one grade and shows it', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, forks: [reply(quiz(3))], completes: [{ ...grade([true, true]), after: 2_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await toExplain(ui)
    const key = await fieldKey(ui)
    const first = ui.input({ key, text: 'every section has its own cap' })
    const second = ui.input({ key, text: 'every section has its own cap' })
    await clock.settle()
    await clock.advance(2_000)
    await first
    await second
    expect(record.completeRequests).toHaveLength(1)
    await shows(ui, GRADE_NOTE)
    await lacks(ui, 'checking your answer…')
    await ui.unmount()
  })

  test('x while a digest reads git sends no digest call', { options: { tutorContext: 'digest' } }, async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [reply(quiz(5), DIGEST_CALL)], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    record.gitDelay = 1_000
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the diff…')
    await ui.press({ key: 'cancel' })
    await shows(ui, 'cancelled')
    await clock.advance(5_000)
    expect(record.completeRequests).toHaveLength(0)
    await shows(ui, HOME)
    await ui.unmount()
  })

  test('x while a fork round reads the log sends no fork', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [reply(quiz(5))], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    record.gitDelay = 1_000
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the chat…')
    await ui.press({ key: 'cancel' })
    await clock.advance(5_000)
    expect(record.forkPrompts).toHaveLength(0)
    expect(record.modelCalls).toBe(0)
    await shows(ui, HOME)
    await ui.unmount()
  })

  test('a stopped round that fails later leaves the next round alone', { options: { tutorContext: 'digest' } }, async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [{ ...reply(quiz(5), DIGEST_CALL), after: 20_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    // The first round's first read fails, but only once it was stopped and a second round began.
    record.rootFault = 10_000
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the diff…')
    await ui.press({ key: 'cancel' })
    await shows(ui, 'cancelled')
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the diff…')
    await clock.advance(10_000)
    expect(record.logs.some(line => line.includes('could not write a round'))).toBe(true)
    await shows(ui, 'Mochi is reading the diff…')
    await lacks(ui, 'cancelled')
    await clock.advance(10_000)
    await shows(ui, FIRST_STEM)
    expect(record.completeRequests).toHaveLength(1)
    await ui.unmount()
  })

  test('a reply that lands after session end counts in neither conversation', { plugins: [PROBE], options: { tutorContext: 'digest' } }, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, completes: [{ ...reply(quiz(5), DIGEST_CALL), after: 30_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the diff…')
    const ended = $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    await clock.settle()
    await clock.advance(30_000)
    await ended
    const session = await probe($, 'tutorSession') as { usage: { calls: number; input: number } }
    expect(session.usage.calls).toBe(0)
    await ui.unmount()
  })

  test('a cold fork that answers after session end leaves the next conversation unlatched', { plugins: [PROBE] }, async ($, on) => {
    const clock = mock.clock(on)
    engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5), COLD_FORK), after: 30_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the chat…')
    const ended = $.session.end({ reason: 'clear', sessionId: 's', resume: { id: 's' } })
    await clock.settle()
    await clock.advance(30_000)
    await ended
    expect(await probe($, 'tutorSession')).toMatchObject({ usage: { calls: 0 }, isForkSuspect: false })
    await ui.unmount()
  })

  test('stopping a fork that never answers lets its round go', async ($, on) => {
    const clock = mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: { log: COMMITS }, forks: [{ ...reply(quiz(5)), after: 1_000_000 }], clock })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, 'Mochi is reading the chat…')
    await ui.press({ key: 'cancel' })
    await clock.settle()
    // The round stopped waiting at once, though the fork has not answered.
    expect(record.logs).toContain('mochi-crew: tutor dropped a stale reply')
    expect(record.completeRequests).toHaveLength(0)
    await clock.advance(1_000_000)
    await shows(ui, HOME)
    await ui.unmount()
  })
})

// ── code cards ──

/** A stored card's code, as a round of an earlier session cut it: one hunk around line 2. */
const CARD_DIFF = ['@@ -1,2 +1,3 @@', ' export const one = 1', '+export const capped = 16_000', ' export const two = 2'].join('\n')
const CODE_STEM = 'Why is the digest capped at 16 000 characters?'
const codeDeck = {
  v: 1,
  projects: {
    '/repo': {
      ...savedDeck.projects['/repo'],
      deck: [{
        box: 1,
        dueRound: 2,
        question: {
          id: 'r1-q3',
          kind: 'choice',
          tag: 'why',
          topic: 'digest cap',
          prompt: CODE_STEM,
          options: ['So one call stays cheap', 'Git cannot print more', 'The tab is narrow'],
          answer: 0,
          why: ['A digest round sends it whole.', 'It can.', 'The tab scrolls.'],
          file: 'hooks/tutor.ts',
          code: { file: 'hooks/tutor.ts', diff: CARD_DIFF, focusLine: 2 },
        },
      }],
    },
  },
}

/** The frame around a card's header and body, read back as plain props. */
const frameOf = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }) => (await ui.find({ key: 'frame' }))?.props

describe('tutor code cards', () => {
  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`a stored code card is drawn as a diff inside a framed card (${surface})`, async ($, on) => {
      mock.clock(on)
      expect(isCodeDiff(CARD_DIFF)).toBe(true)
      const { record } = engine(on, { saved: { tutorConsent: 2, tutorProgress: codeDeck } })
      await start($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'review' })
      await shows(ui, CODE_STEM)
      const code = await ui.find({ type: 'Code' })
      expect(code?.props).toMatchObject({ format: 'diff', source: CARD_DIFF, path: 'hooks/tutor.ts', wrap: 'truncate-end' })
      await shows(ui, 'hooks/tutor.ts · line 2')
      expect(await frameOf(ui)).toMatchObject({ borderStyle: 'round', borderColor: 'claude' })
      // The options sit outside the frame, one per row.
      await ui.press({ key: (await ui.find({ type: 'Button', text: 'So one call stays cheap' }))?.key ?? '' })
      await shows(ui, '✓ right')
      expect(await frameOf(ui)).toMatchObject({ borderStyle: 'round', borderColor: 'success' })
      expect(await ui.find({ type: 'Code' })).toBeDefined()
      expect(record.modelCalls).toBe(0)
      await ui.unmount()
    })
  }

  test('a short pane draws the code card as its caption only', async ($, on) => {
    mock.clock(on)
    engine(on, { saved: { tutorConsent: 2, tutorProgress: codeDeck } })
    await start($)
    await $.command.run(mochi('tutor'))
    const ui = await $.ui.mount({ plugin: 'mochi-crew', surface: 'desktop', ...TAB, props: paneProps('Tutor', 7) })
    await ui.press({ key: 'review' })
    await shows(ui, 'code: hooks/tutor.ts line 2 · make the pane taller to see it')
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    await ui.unmount()
  })

  /** A changed file whose one hunk holds a secret, as git prints it before the digest masks it. */
  const SECRET_DIFF = [
    'diff --git a/hooks/tutor.ts b/hooks/tutor.ts',
    '--- a/hooks/tutor.ts',
    '+++ b/hooks/tutor.ts',
    '@@ -1,2 +1,5 @@',
    ' export const one = 1',
    '+const API_KEY=sk-test-123456789abcdef',
    '+export const capped = 16_000',
    '+export const floor = 0',
    ' export const two = 2',
    '',
  ].join('\n')
  const CHANGED = { log: COMMITS, 'rev-parse': '\n', 'name-status': 'M\0hooks/tutor.ts\0', numstat: '3\t0\thooks/tutor.ts\n', diff: SECRET_DIFF }
  const LINE_STEM = 'Which line sets the digest cap?'
  const anchoredQ = { ...choiceQ(0), at: { file: 'hooks/tutor.ts', quote: 'export const one = 1' } }
  const lineQ = {
    kind: 'line',
    tag: 'what',
    topic: 'digest cap',
    prompt: LINE_STEM,
    at: { file: 'hooks/tutor.ts' },
    options: ['export const capped = 16_000', 'export const floor = 0', 'export const two = 2'],
    answer: 0,
    why: ['It names the cap.', 'That is the floor.', 'That one was already there.'],
  }
  const codeQuiz = (questions: readonly unknown[]): string => JSON.stringify({ v: 2, questions })

  for (const surface of ['terminal', 'desktop', 'mobile'] as const) {
    test(`a digest round draws its code card from the masked excerpt it sent (${surface})`, { options: { tutorContext: 'digest' } }, async ($, on) => {
      mock.clock(on)
      const { record } = engine(on, { saved: { tutorConsent: 2 }, git: CHANGED, completes: [reply(codeQuiz([anchoredQ, choiceQ(1), choiceQ(2), explainQ]), DIGEST_CALL)] })
      await start($)
      await warmUp($)
      const ui = await tutorTab($, surface)
      await ui.press({ key: 'start:recent' })
      await shows(ui, FIRST_STEM)
      const source = String((await ui.find({ type: 'Code' }))?.props.source ?? '')
      expect(source.startsWith('@@ -1,2 +1,5 @@')).toBe(true)
      expect(source).toContain(' export const one = 1')
      expect(source).toContain('+const API_KEY=')
      // The planted secret was masked before it was sent, and the card draws what was sent.
      expect(source).not.toContain('sk-test-123456789abcdef')
      expect(record.completeRequests[0]?.prompt ?? '').not.toContain('sk-test-123456789abcdef')
      await shows(ui, 'hooks/tutor.ts · line 1')
      expect(record.completeRequests).toHaveLength(1)
      await ui.unmount()
    })
  }

  test('a line question is graded locally with no model call', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { record } = engine(on, { saved: { tutorConsent: 2 }, git: CHANGED, completes: [reply(codeQuiz([lineQ, choiceQ(1), choiceQ(2), explainQ]), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, LINE_STEM)
    expect(String((await ui.find({ type: 'Code' }))?.props.source ?? '')).toContain('+export const capped = 16_000')
    // Each option is the hunk's own line, labelled by its number.
    const right = await ui.find({ type: 'Button', text: /^L3 +export const capped = 16_000/ })
    expect(await ui.find({ type: 'Button', text: /^L5 +export const two = 2/ })).toBeDefined()
    await ui.press({ key: right?.key ?? '' })
    await shows(ui, '✓ right')
    await shows(ui, 'It names the cap.')
    expect(record.completeRequests).toHaveLength(1)
    expect(record.modelCalls).toBe(1)
    await ui.unmount()
  })

  test('a digest anchor that quotes no line of the excerpt keeps its question without a card', { options: { tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const invented = { ...anchoredQ, at: { file: 'hooks/tutor.ts', quote: 'export const invented = 42' } }
    const notSent = { ...lineQ, at: { file: 'hooks/elsewhere.ts' } }
    engine(on, { saved: { tutorConsent: 2 }, git: CHANGED, completes: [reply(codeQuiz([invented, notSent, choiceQ(1), choiceQ(2), explainQ]), DIGEST_CALL)] })
    await start($)
    await warmUp($)
    const ui = await tutorTab($)
    await ui.press({ key: 'start:recent' })
    await shows(ui, FIRST_STEM)
    expect(await ui.find({ type: 'Code' })).toBeUndefined()
    // The line question on a file the digest never held was dropped whole.
    await shows(ui, 'q 1/4')
    await ui.unmount()
  })
})
