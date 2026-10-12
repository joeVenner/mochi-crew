import type { LimitWindow } from '../types'
import { windowLabel } from './meter'

/** Context fill (percent) worth a heads-up: compacting at a natural break beats auto-compact mid-task. */
export const CONTEXT_THRESHOLDS: readonly number[] = [80, 90]
/** Plan or spend window use (percent) worth a heads-up before the wall. */
export const LIMIT_THRESHOLDS: readonly number[] = [80, 95]

/** What the alerts are judged on, all from the latest measurement and cache totals. */
export type AlertFacts = {
  /** Context fill, undefined while unknown (before a response, right after a compact). */
  readonly contextPercent: number | undefined
  readonly limits: readonly LimitWindow[]
  readonly isCacheUnreported: boolean
}

/** One heads-up: `key` names the condition, so it fires once per crossing. */
export type Alert = { readonly key: string; readonly text: string }

/** The alerts to show now and the keys that count as raised afterwards. */
export type AlertCheck = { readonly due: readonly Alert[]; readonly raised: readonly string[] }

const CACHE_KEY = 'cache:unreported'
const isContextKey = (key: string): boolean => key.startsWith('context:')

const contextText = (percent: number, threshold: number): string =>
  threshold >= 90
    ? `Context at ${Math.round(percent)}%: auto-compact is close. Run /compact now to choose what it keeps.`
    : `Context at ${Math.round(percent)}%: a /compact at the next natural break keeps it cheap.`

const limitText = (window: LimitWindow): string =>
  window.kind === 'spend_limit'
    ? `Gateway spend limit at ${Math.round(window.percentUsed)}%.`
    : `${windowLabel(window.kind)} plan window at ${Math.round(window.percentUsed)}% used.`

const CACHE_TEXT =
  'No prompt caching reported after several turns: every turn is billed as uncached input. ' +
  'Behind a gateway, check that it forwards cache_control markers.'

/** How far below its threshold a figure must fall before that alert can fire again. */
export const REARM_MARGIN = 5

/**
 * Which heads-ups are due. A condition fires once when a figure reaches its threshold and
 * re-arms only after the figure falls `REARM_MARGIN` points below it (a compact, a plan
 * window's reset), so a figure hovering at the line does not toast over and over. A window
 * that disappears has reset, so its alerts re-arm. Crossing two thresholds at once shows
 * only the higher. An unknown context fill keeps its keys, so the figure coming back
 * unchanged does not fire again.
 */
export const checkAlerts = (raised: readonly string[], facts: AlertFacts): AlertCheck => {
  const holding: string[] = []
  const due: Alert[] = []
  /** Holds each threshold's key, and queues `text` when one of them is newly reached. */
  const judge = (prefix: string, value: number, thresholds: readonly number[], text: (top: number) => string): void => {
    let newlyReached: number | undefined
    for (const threshold of thresholds) {
      const key = `${prefix}:${threshold}`
      const wasRaised = raised.includes(key)
      if (value >= threshold) {
        holding.push(key)
        if (!wasRaised) newlyReached = threshold
      } else if (wasRaised && value >= threshold - REARM_MARGIN) {
        holding.push(key)
      }
    }
    if (newlyReached !== undefined) due.push({ key: `${prefix}:${newlyReached}`, text: text(newlyReached) })
  }

  if (facts.contextPercent === undefined) {
    holding.push(...raised.filter(isContextKey))
  } else {
    const percent = facts.contextPercent
    judge('context', percent, CONTEXT_THRESHOLDS, top => contextText(percent, top))
  }
  for (const window of facts.limits) judge(window.kind, window.percentUsed, LIMIT_THRESHOLDS, () => limitText(window))
  if (facts.isCacheUnreported) {
    holding.push(CACHE_KEY)
    if (!raised.includes(CACHE_KEY)) due.push({ key: CACHE_KEY, text: CACHE_TEXT })
  }

  return { due, raised: holding }
}
