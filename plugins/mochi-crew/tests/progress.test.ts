import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_STATS, XP_PER_EDIT, applyEdit } from '../hooks/game'
import { FRESH_LEDGER, XP_PER_SHIPPED_TURN, beginLedger, isTestCommand, noteEdit, noteGreenTests, settleTurn, shippedBonus, splitShellLine } from '../hooks/progress'

describe('progress', () => {
  test('test runners are recognised, other commands are not', async () => {
    for (const command of ['npm test', 'npm run test -- --watch=false', 'pnpm test', 'bun test', 'pytest -q', 'cd api && cargo test', 'go test ./...', 'npx vitest run', 'claude plugin test .', 'CI=1 python -m pytest', './gradlew test', 'npm ci && npm test', 'false || npm test', 'npm test && echo ok']) {
      expect(isTestCommand(command)).toBe(true)
    }
    for (const command of ['npm run build', 'ls tests', 'cat test.ts', 'git commit -m "test"', 'echo latest', 'npm run lint', 'cat pytest.ini', 'ls vitest.config.ts', 'grep -rn jest src', 'git log --grep=jest', 'echo "npm test"', 'rg pytest',
      // The exit no longer reflects the tests, or nothing ran.
      'npm test || true', 'npm test; echo done', 'npm test | tee log', 'pytest --collect-only', 'pytest --co -q', 'cargo test --no-run', 'npm test -- --help', 'npx jest --listTests', 'go test -list .']) {
      expect(isTestCommand(command)).toBe(false)
    }
  })

  test('quoted and escaped separators never split a command', async () => {
    expect(splitShellLine('echo "a; b" && npm test')).toEqual({ parts: ['echo "a; b" ', ' npm test'], separators: ['&&'] })
    expect(splitShellLine("grep 'x|y' f | wc -l")).toEqual({ parts: ["grep 'x|y' f ", ' wc -l'], separators: ['|'] })
    expect(splitShellLine('echo a\\;b; ls')).toEqual({ parts: ['echo a\\;b', ' ls'], separators: [';'] })
    expect(splitShellLine('echo "say \\"hi\\"; ok"')).toEqual({ parts: ['echo "say \\"hi\\"; ok"'], separators: [] })
    expect(splitShellLine('a || b\nc')).toEqual({ parts: ['a ', ' b', 'c'], separators: ['||', '\n'] })
    // An unclosed quote runs to the end, as the shell reads it.
    expect(splitShellLine('echo "a; npm test').parts).toHaveLength(1)
  })

  test('test detection respects quotes', async () => {
    // A runner quoted inside another command is not a run.
    expect(isTestCommand('echo "a; npm test"')).toBe(false)
    expect(isTestCommand("git commit -m 'fix; npm test'")).toBe(false)
    // A quoted filter with separators in it keeps the run whole, and the exit still counts.
    expect(isTestCommand('npx jest -t "a && b"')).toBe(true)
    expect(isTestCommand("pytest -k 'x or y; z'")).toBe(true)
  })

  test('a file edited again in the same turn is a repeat; failures are not counted', async () => {
    const first = noteEdit(FRESH_LEDGER, '/a.ts', false)
    expect(first.isRepeat).toBe(false)
    const again = noteEdit(first.ledger, '/a.ts', false)
    expect(again.isRepeat).toBe(true)
    expect(again.ledger).toEqual({ files: ['/a.ts'], cleanEdits: 2, hasGreenTests: false })
    expect(noteEdit(FRESH_LEDGER, '/a.ts', true)).toEqual({ ledger: FRESH_LEDGER, isRepeat: false })
  })

  test('green tests pay once per turn', async () => {
    const first = noteGreenTests(FRESH_LEDGER)
    expect(first.isFirst).toBe(true)
    expect(noteGreenTests(first.ledger).isFirst).toBe(false)
  })

  test('only an answered turn with a clean edit ships', async () => {
    const edited = noteEdit(FRESH_LEDGER, '/a.ts', false).ledger
    expect(shippedBonus(edited, 'answer')).toBe(XP_PER_SHIPPED_TURN)
    expect(shippedBonus(edited, 'aborted')).toBe(0)
    expect(shippedBonus(edited, 'error')).toBe(0)
    expect(shippedBonus(FRESH_LEDGER, 'answer')).toBe(0)
  })

  test('a turn settles once', async () => {
    const edited = noteEdit(beginLedger(FRESH_LEDGER, 't1'), '/a.ts', false).ledger
    const settled = settleTurn(edited, 't1', 'answer')
    expect(settled).toEqual({ ledger: { ...FRESH_LEDGER, settledTurnId: 't1' }, bonus: XP_PER_SHIPPED_TURN })
    expect(settleTurn(settled.ledger, 't1', 'answer').bonus).toBe(0)
  })

  test("a late completion settles the last turn's ledger and leaves the new turn's alone", async () => {
    const t1 = noteEdit(beginLedger(FRESH_LEDGER, 't1'), '/a.ts', false).ledger
    const t2 = noteEdit(beginLedger(t1, 't2'), '/b.ts', false).ledger
    expect(t2.previous?.turnId).toBe('t1')
    const late = settleTurn(t2, 't1', 'answer')
    expect(late.bonus).toBe(XP_PER_SHIPPED_TURN)
    expect(late.ledger).toEqual({ files: ['/b.ts'], cleanEdits: 1, hasGreenTests: false, turnId: 't2' })
    expect(settleTurn(late.ledger, 't1', 'answer')).toEqual({ ledger: late.ledger, bonus: 0 })
    // Only the last turn waits: an older unsettled one is dropped, never nested.
    expect(beginLedger(t2, 't3').previous?.previous).toBeUndefined()
    // A repeated start of the same turn changes nothing.
    expect(beginLedger(t2, 't2')).toBe(t2)
  })

  test('the last turn completing after the newer one settled still pays, and clears', async () => {
    const t1 = noteEdit(beginLedger(FRESH_LEDGER, 't1'), '/a.ts', false).ledger
    const t2 = noteEdit(beginLedger(t1, 't2'), '/b.ts', false).ledger
    const t2Done = settleTurn(t2, 't2', 'answer')
    expect(t2Done.bonus).toBe(XP_PER_SHIPPED_TURN)
    const t1Done = settleTurn(t2Done.ledger, 't1', 'answer')
    expect(t1Done.bonus).toBe(XP_PER_SHIPPED_TURN)
    expect(t1Done.ledger.previous).toBeUndefined()
    // Either one completing again pays nothing.
    expect(settleTurn(t1Done.ledger, 't1', 'answer').bonus).toBe(0)
    expect(settleTurn(t1Done.ledger, 't2', 'answer').bonus).toBe(0)
  })

  test('a late or replayed start of a settled turn changes nothing', async () => {
    const settled = settleTurn(noteEdit(beginLedger(FRESH_LEDGER, 't1'), '/a.ts', false).ledger, 't1', 'answer').ledger
    expect(beginLedger(settled, 't1')).toBe(settled)
  })

  test('a repeat edit earns a little and neither grows nor breaks the combo', async () => {
    const once = applyEdit(EMPTY_STATS, false)
    expect(applyEdit(once, false, true)).toEqual({ xp: XP_PER_EDIT + 3, edits: 2, combo: 1 })
  })
})
