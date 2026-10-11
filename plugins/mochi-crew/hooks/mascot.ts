import type { Gadget, MascotActivity, Worker } from '../types'
import { HOME_X, idleRoutine } from './behavior'

/** The last path segment, so a long absolute path fits a narrow pane. */
export const fileName = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

const LOOKING_COMMANDS = /^(rg|grep|egrep|find|fd|ls|tree|cat|head|tail|less|wc|stat|file|which|git\s+(log|diff|status|show|blame|grep))\b/

/** Read-only shell commands get the magnifier; anything that changes things gets the hammer. */
export const gadgetForCommand = (command: string): Gadget =>
  LOOKING_COMMANDS.test(command.trim()) ? 'magnifier' : 'hammer'

/** A command or query shortened for the one-line HUD. */
export const shorten = (text: string, max = 28): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`
}

const GADGET_VERBS: Readonly<Record<Gadget, string>> = {
  hammer: 'running',
  magnifier: 'looking at',
  antenna: 'searching',
}

/** Short verbs for a worker's note, so a narrow HUD keeps the detail. */
const GADGET_VERBS_SHORT: Readonly<Record<Gadget | 'edit', string>> = { hammer: 'run', magnifier: 'look', antenna: 'web', edit: 'edit' }

/** A worker's HUD note: the call running now, thinking between calls, or its task before its first call. */
export const workerNote = (worker: Worker): string => {
  if ((worker.activeCalls ?? 0) > 0 && worker.doing !== undefined) return worker.doing
  if (worker.doing !== undefined) return 'thinking'
  return shorten(worker.description)
}

/** The `mcp__<server>__<tool>` naming every MCP tool follows. */
const MCP_TOOL = /^mcp__(.+?)__(.+)$/
// Hosted connectors carry this prefix in their server key; the rest is the product name.
const HOSTED_PREFIX = /^claude_ai_/
// Server and tool names come from configuration: untrusted text, shown only as plain words.
const NOT_A_WORD = /[^A-Za-z0-9 ._-]/g

/**
 * A readable label for an MCP tool call, `Figma · get screenshot`, or undefined for a
 * tool that is not MCP. Names are configuration text: anything but plain word
 * characters is dropped before display.
 */
export const mcpToolLabel = (toolName: string): string | undefined => {
  const match = MCP_TOOL.exec(toolName)
  if (match === null) return undefined
  const words = (text: string) => text.replace(/_/g, ' ').replace(NOT_A_WORD, '').replace(/\s+/g, ' ').trim()
  const server = words((match[1] ?? '').replace(HOSTED_PREFIX, ''))
  const tool = words(match[2] ?? '')
  if (server === '' || tool === '') return undefined
  return `${server} · ${tool}`
}

/** A worker's HUD note for its latest tool call: `look util.ts`, `run npm test`, `edit app.ts`. */
export const workerDoing = (gadget: Gadget | 'edit', detail: string, verb?: string): string =>
  `${verb ?? GADGET_VERBS_SHORT[gadget]} ${shorten(detail)}`

// Plain `state · detail` lines, lowercase, no exclamation marks: the HUD is an instrument panel.
const ROUTINE_LABELS: Readonly<Record<string, string>> = {
  returning: 'idle · heading back',
  look: 'idle · looking around',
  wander: 'idle · strolling',
  stretch: 'idle · stretching',
  read: 'idle · reading',
  sip: 'idle · coffee break',
  wave: 'idle · waving',
  yawn: 'idle · yawning',
  sleep: 'idle · napping',
}

/**
 * What the status label under the scene says for an activity at `now`.
 *
 * @param isThinking Claude is mid-turn, so an idle Mochi is thinking along, not loafing
 */
export const activityLabel = (activity: MascotActivity, now: number, isThinking = false): string => {
  switch (activity.kind) {
    case 'idle':
      if (isThinking) return 'thinking'
      return ROUTINE_LABELS[idleRoutine(activity.fromX ?? HOME_X, now - activity.since)] ?? 'idle'
    case 'editing':
      return `editing ${fileName(activity.file)}`
    case 'using':
      return `${activity.verb ?? GADGET_VERBS[activity.gadget]} ${activity.detail}`
    case 'done':
      return activity.hasFailed ? `failed · ${fileName(activity.file)}` : `done · ${fileName(activity.file)}`
  }
}
