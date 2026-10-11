import type { TurnLedger, TurnOutcome } from '../types'

/** XP for editing a file already edited this turn: still work, but not new progress. */
export const XP_PER_REPEAT_EDIT = 3
/** XP for the turn's first passing test run. */
export const XP_PER_GREEN_TESTS = 10
/** XP for a turn that ended in an answer after at least one clean edit. */
export const XP_PER_SHIPPED_TURN = 10

export const FRESH_LEDGER: TurnLedger = { files: [], cleanEdits: 0, hasGreenTests: false }

/** Test runners, each matched at the start of one command in a shell line. */
const TEST_RUNNERS: readonly string[] = [
  '(npm|pnpm|yarn|bun) (run )?test',
  'npx (vitest|jest)',
  '(python3? -m )?pytest',
  'vitest',
  'jest',
  'go test',
  'cargo (test|nextest)',
  'mvn test',
  '(\\./)?gradlew? test',
  'rspec',
  'phpunit',
  'mix test',
  'dotnet test',
  'ctest',
  'claude plugin test',
]
// The runner must end the word: `pytest.ini` or `jest/` are file names, not runs.
const TEST_RUNNER = new RegExp(`^(${TEST_RUNNERS.join('|')})(?![\\w./-])`)
const LEADING_ENV = /^([A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/

// Flags that list, describe or build tests without running them.
const NOT_A_RUN = /(?:^|\s)(?:--collect-only|--co|--no-run|--help|-h|--listTests|--list|-list|--version|-V|--dry-run)(?=[\s=]|$)/

/** One shell command of a line, cleaned of a leading `(` and env assignments. */
const commandPart = (part: string): string =>
  part.trim().replace(/^\(+\s*/, '').replace(LEADING_ENV, '').replace(/\s+/g, ' ')

/**
 * True when a passing exit of this shell line means a test suite really ran and passed:
 * a runner at the start of one of its commands (`npm test`, `cd api && cargo test`,
 * `CI=1 pytest -q`), not one that merely names it (`cat pytest.ini`, `echo "npm test"`),
 * not in a list-only mode (`pytest --collect-only`, `cargo test --no-run`), and with only
 * `&&` after it — `npm test || true`, `npm test; echo done` and `npm test | tee log`
 * exit 0 whatever the tests did.
 *
 * Quoted and escaped separators do not split the line (see splitShellLine).
 */
export const isTestCommand = (command: string): boolean => {
  const { parts, separators } = splitShellLine(command)
  return parts.some((raw, index) => {
    const part = commandPart(raw)
    return TEST_RUNNER.test(part) && !NOT_A_RUN.test(part) && separators.slice(index).every(separator => separator === '&&')
  })
}

/** A shell line cut into its commands; `separators[i]` is what follows `parts[i]`. */
export type ShellLine = { parts: readonly string[]; separators: readonly string[] }

/**
 * Splits a shell line on `&&`, `||`, `;`, `|` and newlines that are not quoted or escaped,
 * so `echo "a; npm test"` stays one command and `jest -t "a && b"` stays whole. Unclosed
 * quotes run to the end of the line, as the shell would read them.
 */
export const splitShellLine = (line: string): ShellLine => {
  const parts: string[] = []
  const separators: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i] ?? ''
    if (quote !== undefined) {
      current += char
      // Inside double quotes a backslash escapes the next character; single quotes take it literally.
      if (quote === '"' && char === '\\' && i + 1 < line.length) current += line[++i] ?? ''
      else if (char === quote) quote = undefined
      continue
    }
    if (char === '\\' && i + 1 < line.length) {
      current += char + (line[++i] ?? '')
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    const pair = line.slice(i, i + 2)
    const separator = pair === '&&' || pair === '||' ? pair : char === ';' || char === '|' || char === '\n' ? char : undefined
    if (separator === undefined) {
      current += char
      continue
    }
    parts.push(current)
    separators.push(separator)
    current = ''
    i += separator.length - 1
  }
  parts.push(current)
  return { parts, separators }
}

/** Writes one finished edit into the turn's ledger; `isRepeat` when the file was already edited this turn. */
export const noteEdit = (ledger: TurnLedger, file: string, hasFailed: boolean): { ledger: TurnLedger; isRepeat: boolean } => {
  if (hasFailed) return { ledger, isRepeat: false }
  const isRepeat = ledger.files.includes(file)
  return {
    ledger: { ...ledger, cleanEdits: ledger.cleanEdits + 1, files: isRepeat ? ledger.files : [...ledger.files, file] },
    isRepeat,
  }
}

/** Marks the turn's tests green; `isFirst` only the first time, so reruns earn nothing more. */
export const noteGreenTests = (ledger: TurnLedger): { ledger: TurnLedger; isFirst: boolean } =>
  ledger.hasGreenTests ? { ledger, isFirst: false } : { ledger: { ...ledger, hasGreenTests: true }, isFirst: true }

/** The bonus a finished turn earns: only an answered turn that changed something. */
export const shippedBonus = (ledger: TurnLedger, outcome: TurnOutcome): number =>
  outcome === 'answer' && ledger.cleanEdits > 0 ? XP_PER_SHIPPED_TURN : 0

/**
 * A fresh ledger for the turn that just started, keeping the last turn's own ledger
 * (not older ones) until its completion settles it.
 */
export const beginLedger = (current: TurnLedger, turnId: string): TurnLedger => {
  if (current.turnId === turnId || current.settledTurnId === turnId) return current
  const { previous: _older, ...last } = current
  return { ...FRESH_LEDGER, turnId, ...(last.turnId === undefined ? {} : { previous: last }) }
}

/**
 * Settles the turn `turnId` once: its bonus, and its record dropped. The ledger may be
 * the turn's own or, when a newer turn already started, that one's `previous`; anything
 * else (a repeated or unknown completion) pays nothing and changes nothing.
 */
export const settleTurn = (ledger: TurnLedger, turnId: string, outcome: TurnOutcome): { ledger: TurnLedger; bonus: number } => {
  // The last turn first: it may complete after the newer one already settled (`turnId` unset).
  if (ledger.previous?.turnId === turnId) {
    const { previous: settled, ...current } = ledger
    return { ledger: current, bonus: shippedBonus(settled, outcome) }
  }
  if (ledger.settledTurnId === turnId) return { ledger, bonus: 0 }
  // Its own turn, or edits made before any turn.start was seen (a reload mid-turn).
  if (ledger.turnId === turnId || ledger.turnId === undefined) {
    const { previous } = ledger
    return {
      ledger: { ...FRESH_LEDGER, settledTurnId: turnId, ...(previous === undefined ? {} : { previous }) },
      bonus: shippedBonus(ledger, outcome),
    }
  }
  return { ledger, bonus: 0 }
}
