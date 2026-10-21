/**
 * Terminal.app, driven through `osascript`. Every value reaches AppleScript as an
 * `on run argv` argument, never pasted into the script's text, and the tty is checked
 * against `/dev/ttysNNN` first.
 */

import type { EngineInterface } from 'claude-code'

import type { Rgb16 } from './badgePalette'
import { isTerminalTty } from './badgeTty'

export type TabInfo = { readonly tty: string; readonly rgb: Rgb16; readonly profile: string }

export type RestoreOutcome = 'ok' | 'changed' | 'missing'

const OSASCRIPT = '/usr/bin/osascript'
const TIMEOUT_MS = 10_000

// Each script first checks Terminal is running: a `tell` would launch it otherwise.
// `tab` is Terminal's own class inside its tell block, so the separator is made before it.
const READ_TABS_SCRIPT = `on run argv
  set sep to character id 9
  set out to ""
  if application "Terminal" is not running then return out
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        try
          set c to background color of t
          set out to out & (tty of t) & sep & (item 1 of c) & "," & (item 2 of c) & "," & (item 3 of c) & sep & (name of current settings of t) & linefeed
        end try
      end repeat
    end repeat
  end tell
  return out
end run`

const TINT_SCRIPT = `on run argv
  set targetTty to item 1 of argv
  set rgb to {(item 2 of argv) as integer, (item 3 of argv) as integer, (item 4 of argv) as integer}
  if application "Terminal" is not running then return "missing"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTty then
          set background color of t to rgb
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`

// Restores only a tab still wearing this session's tint: a color the person chose
// since, or a tty a new tab took over, is left alone. Re-applying the whole profile
// brings back what a bare color copy would not (Clear Dark's transparency).
const RESTORE_SCRIPT = `on run argv
  set targetTty to item 1 of argv
  set profileName to item 2 of argv
  set expected to {(item 3 of argv) as integer, (item 4 of argv) as integer, (item 5 of argv) as integer}
  if application "Terminal" is not running then return "missing"
  tell application "Terminal"
    set profile to settings set profileName
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is targetTty then
          if (background color of t) is not expected then return "changed"
          set current settings of t to profile
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "missing"
end run`

/** Reads READ_TABS_SCRIPT's output: one `tty<TAB>r,g,b<TAB>profile` line per tab. */
export const parseTabs = (text: string): TabInfo[] => {
  const tabs: TabInfo[] = []
  for (const line of text.split('\n')) {
    const [tty = '', color = '', ...profileParts] = line.split('\t')
    const parts = color.split(',').map(part => part.trim())
    const [red, green, blue] = parts.map(Number)
    const profile = profileParts.join('\t').trim()
    const isWellFormed = parts.length === 3 && parts.every(part => /^\d+$/.test(part))
    if (isTerminalTty(tty.trim()) && isWellFormed && red !== undefined && green !== undefined && blue !== undefined && Math.max(red, green, blue) <= 65535 && profile) {
      tabs.push({ tty: tty.trim(), rgb: [red, green, blue], profile })
    }
  }
  return tabs
}

async function runScript($: EngineInterface, script: string, args: readonly string[]): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run([OSASCRIPT, '-e', script, ...args], { timeoutMs: TIMEOUT_MS })
  if (exitCode !== 0) throw new Error(`osascript exited ${exitCode}: ${stderr.trim().slice(0, 200)}`)
  return stdout.trim()
}

export async function readTabs($: EngineInterface): Promise<TabInfo[]> {
  return parseTabs(await runScript($, READ_TABS_SCRIPT, []))
}

/** Tints one tab; false when no tab has that tty any more. */
export async function tintTab($: EngineInterface, tty: string, rgb: Rgb16): Promise<boolean> {
  if (!isTerminalTty(tty)) throw new Error(`refusing to tint ${JSON.stringify(tty)}: not a /dev/ttysNNN path`)
  return (await runScript($, TINT_SCRIPT, [tty, ...rgb.map(String)])) === 'ok'
}

/**
 * Puts a tab back on its profile, provided it still wears `tint`. `changed`: the person
 * or another session recolored it, so it was left alone.
 */
export async function restoreTab($: EngineInterface, tty: string, profile: string, tint: Rgb16): Promise<RestoreOutcome> {
  if (!isTerminalTty(tty)) throw new Error(`refusing to restore ${JSON.stringify(tty)}: not a /dev/ttysNNN path`)
  const outcome = await runScript($, RESTORE_SCRIPT, [tty, profile, ...tint.map(String)])
  return outcome === 'ok' || outcome === 'changed' ? outcome : 'missing'
}
