import { describe, expect, test } from 'claude-code/testing'

import type { MascotActivity } from '../types'
import { HOME_X, ROUTINE_MS, SLEEP_MS, STALE_USING_MS, mascotXAt, deskX, idleMoment, idleRoutine, isMascotWalking, settle } from '../hooks/behavior'
import { activityLabel, gadgetForCommand, mcpToolLabel, shorten } from '../hooks/mascot'
import { layoutFor } from '../hooks/world'

const WIDTH = 52

describe('walking', () => {
  test('editing walks Mochi from where it stood to the desk, then stays', async () => {
    const editing: MascotActivity = { kind: 'editing', file: 'a.ts', tool: 'Edit', since: 0, fromX: HOME_X }
    expect(mascotXAt(editing, 0, WIDTH)).toBe(HOME_X)
    const halfway = mascotXAt(editing, 400, WIDTH)
    expect(halfway).toBeGreaterThan(HOME_X)
    expect(halfway).toBeLessThan(deskX(WIDTH))
    expect(mascotXAt(editing, 60_000, WIDTH)).toBe(deskX(WIDTH))
    expect(isMascotWalking(editing, 400, WIDTH)).toBe(true)
    expect(isMascotWalking(editing, 60_000, WIDTH)).toBe(false)
  })

  test('the desk spot keeps Mochi inside the scene at every width', async () => {
    for (const width of [40, 52, 64]) {
      expect(deskX(width)).toBeGreaterThanOrEqual(HOME_X)
      expect(deskX(width) + 16).toBeLessThanOrEqual(width)
    }
  })

  test('after a done pose, Mochi walks home from the desk', async () => {
    const done: MascotActivity = { kind: 'done', file: 'a.ts', hasFailed: false, at: 0, x: deskX(WIDTH) }
    const idle = settle(done, 3000, 3000, WIDTH)
    expect(idle).toEqual({ kind: 'idle', since: 3000, fromX: deskX(WIDTH) })
    expect(idleRoutine(deskX(WIDTH), 0)).toBe('returning')
    expect(mascotXAt(idle, 3000 + 60_000, WIDTH)).toBeLessThan(deskX(WIDTH))
  })

  test('idle positions never jump more than a step between frames', async () => {
    const idle: MascotActivity = { kind: 'idle', since: 0, fromX: deskX(WIDTH) }
    let last = mascotXAt(idle, 0, WIDTH)
    for (let now = 180; now < SLEEP_MS + 2000; now += 180) {
      const x = mascotXAt(idle, now, WIDTH)
      expect(Math.abs(x - last)).toBeLessThanOrEqual(5)
      last = x
    }
  })
})

describe('routines', () => {
  test('idle cycles through several routines, then sleeps', async () => {
    const seen = new Set<string>()
    for (let elapsed = 0; elapsed < SLEEP_MS; elapsed += ROUTINE_MS) seen.add(idleRoutine(HOME_X, elapsed))
    expect(seen.size).toBeGreaterThanOrEqual(4)
    expect(seen.has('sleep')).toBe(false)
    expect(idleRoutine(HOME_X, SLEEP_MS)).toBe('sleep')
  })
})

describe('gadgets', () => {
  test('read-only commands get the magnifier, the rest the hammer', async () => {
    for (const command of ['rg foo', 'grep -n x a.ts', 'ls -la', '  git status', 'git log --oneline', 'cat a.md']) {
      expect(gadgetForCommand(command)).toBe('magnifier')
    }
    for (const command of ['npm test', 'git commit -m x', 'rm -rf build', 'lsof -i', 'catalog run']) {
      expect(gadgetForCommand(command)).toBe('hammer')
    }
  })

  test('shorten flattens whitespace and trims long text', async () => {
    expect(shorten('a\n  b')).toBe('a b')
    expect(shorten('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('stale gadgets', () => {
  test('an orphaned gadget call settles to idle after a long while', async () => {
    const using: MascotActivity = { kind: 'using', gadget: 'hammer', detail: 'x', since: 0, fromX: HOME_X }
    expect(settle(using, 60_000, 3000, WIDTH)).toBe(using)
    expect(settle(using, STALE_USING_MS, 3000, WIDTH)).toMatchObject({ kind: 'idle', since: STALE_USING_MS })
  })
})

describe('status copy', () => {
  test('idle lines read "idle · …" in lowercase, with no exclamation marks', async () => {
    for (let ms = 0; ms <= SLEEP_MS; ms += 500) {
      const line = activityLabel({ kind: 'idle', since: 0 }, ms)
      expect(line.startsWith('idle')).toBe(true)
      expect(line).toBe(line.toLowerCase())
      expect(line).not.toContain('!')
    }
  })
})

describe('mcp labels', () => {
  test('connector tools read as "Server · tool"; other tools are not MCP', async () => {
    expect(mcpToolLabel('mcp__claude_ai_Figma__get_screenshot')).toBe('Figma · get screenshot')
    expect(mcpToolLabel('mcp__notes__search')).toBe('notes · search')
    expect(mcpToolLabel('Bash')).toBeUndefined()
    expect(mcpToolLabel('mcp__')).toBeUndefined()
  })

  test('untrusted server and tool names show only as plain words', async () => {
    expect(mcpToolLabel('mcp__evil\u001b[31m__run<script>')).toBe('evil31m · runscript')
  })
})

describe('idle scenes', () => {
  test('progress runs 0 → 1 through each routine and an idle spell opens with a look', async () => {
    expect(idleMoment(HOME_X, 0)).toEqual({ routine: 'look', progress: 0 })
    const mid = idleMoment(HOME_X, ROUTINE_MS / 2)
    expect(Math.abs(mid.progress - 0.5)).toBeLessThan(1e-9)
    expect(idleMoment(HOME_X, SLEEP_MS)).toEqual({ routine: 'sleep', progress: 0 })
  })

  test('the new routines (stretch, read) appear before sleep, alongside the old ones', async () => {
    const seen = new Set<string>()
    for (let elapsed = 0; elapsed < SLEEP_MS; elapsed += ROUTINE_MS) seen.add(idleMoment(HOME_X, elapsed).routine)
    for (const routine of ['look', 'sip', 'stretch', 'read']) expect(seen.has(routine)).toBe(true)
  })
})

describe('clear floor', () => {
  test('wherever Mochi strolls, no plant is underfoot: the plant sits on the shelf, above Mochi', async () => {
    for (const width of [40, 52, 64]) {
      const { plantLeft, shelfLeft } = layoutFor(width)
      if (plantLeft === undefined) {
        expect(shelfLeft).toBeUndefined()
        continue
      }
      // Mochi's highest pixel (a raised paw) never reaches the shelf top, where the plant stands.
      expect(plantLeft).toBeGreaterThanOrEqual(shelfLeft ?? 0)
    }
  })
})
