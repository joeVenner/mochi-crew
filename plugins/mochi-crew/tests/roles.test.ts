import { describe, expect, test } from 'claude-code/testing'

import type { Worker } from '../types'
import { ROLE_INFO, roleFor } from '../hooks/roles'
import { sceneFor } from '../hooks/sprite'
import { roleOffsetX } from '../hooks/workerArt'

describe('roles', () => {
  test('subagent types map to the costume their job suggests', async () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['code-reviewer', 'police'],
      ['verifier', 'police'],
      ['security-auditor', 'swat'],
      ['test-engineer', 'lab'],
      ['Explore', 'detective'],
      ['Plan', 'architect'],
      ['general-purpose', 'nerd'],
      ['claude-code-guide', 'librarian'],
      ['statusline-setup', 'builder'],
      ['mystery-bot', 'builder'],
    ]
    for (const [type, role] of cases) expect([type, roleFor(type)]).toEqual([type, role])
  })

  test('every role has a three-letter HUD tag and a title', async () => {
    for (const info of Object.values(ROLE_INFO)) {
      expect(info.tag).toMatch(/^[A-Z]{3}$/)
      expect(info.title.length).toBeGreaterThan(0)
    }
  })

  test('police patrol a small beat; other roles hold still', async () => {
    const beats = new Set(Array.from({ length: 20 }, (_, tick) => roleOffsetX('police', tick)))
    expect(beats.size).toBeGreaterThan(2)
    for (const value of beats) expect(Math.abs(value)).toBeLessThanOrEqual(2)
    expect(roleOffsetX('nerd', 7)).toBe(0)
  })

  test('each costume draws differently, and every costume animates', async () => {
    const draw = (type: string, tick: number) => {
      const worker: Worker = { id: 'w1', type, description: 'x', joinedAt: 0 }
      return sceneFor({ activity: { kind: 'idle', since: 0 }, tick, workers: [worker], now: 0, outfit: 'classic', width: 52, hour: 12, feeling: 'okay', reaction: null, bug: null, turn: null }).pixels
    }
    const types = ['code-reviewer', 'security-auditor', 'test-engineer', 'Explore', 'Plan', 'general-purpose', 'claude-code-guide', 'mystery']
    // Standing (now far past the walk-in) at tick 1; hash each frame to compare costumes.
    const hash = (pixels: Int32Array) => pixels.reduce((h, p) => (h * 31 + p) | 0, 7)
    const atRest = (type: string, tick: number) => {
      const worker: Worker = { id: 'w1', type, description: 'x', joinedAt: 0 }
      return hash(sceneFor({ activity: { kind: 'idle', since: 0 }, tick, workers: [worker], now: 60_000, outfit: 'classic', width: 52, hour: 12, feeling: 'okay', reaction: null, bug: null, turn: null }).pixels)
    }
    expect(new Set(types.map(type => atRest(type, 1))).size).toBe(types.length)
    for (const type of types) {
      const frames = new Set([0, 1, 2, 3, 4, 5].map(tick => atRest(type, tick)))
      expect([type, frames.size > 1]).toEqual([type, true])
    }
    expect(draw('Plan', 1).length).toBe(52 * 32)
  })
})
