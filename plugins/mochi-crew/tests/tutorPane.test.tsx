import { describe, expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type $ = Parameters<TestBody>[0]
type On = Parameters<TestBody>[1]

/** What sits beneath the plugin in a session: the engine's own answers to what Mochi passes on. */
const engine = (on: On) => {
  const commands: string[] = []
  on('env.get', () => ({ value: undefined }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true as const } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.authorize', () => ({ value: { handle: 'test-handle', kind: 'api-key' as const } }))
  return { commands }
}

const start = async ($: $, isInteractive = true) => $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive })

describe('tutor options', () => {
  test('the tutor loads with its /config picks', { options: { tutorModel: 'sonnet', tutorContext: 'digest' } }, async ($, on) => {
    mock.clock(on)
    const { commands } = engine(on)
    await start($)
    expect(commands).toContain('mochi')
  })

  test('a pick outside the options counts as unset and still loads', { options: { tutorModel: 'gpt-9' } }, async ($, on) => {
    mock.clock(on)
    const { commands } = engine(on)
    await start($)
    expect(commands).toContain('mascot')
  })
})
