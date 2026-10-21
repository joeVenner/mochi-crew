import { PALETTE, findTint } from './badgePalette'
import type { Tint } from './badgePalette'
import type { BadgeRecord } from './badgeRecords'

/** What follows `/mochi badge`. */
export type BadgeCommand =
  | { readonly kind: 'status' }
  | { readonly kind: 'switch'; readonly isOn: boolean }
  | { readonly kind: 'color'; readonly tint: Tint }
  | { readonly kind: 'unknown-color'; readonly name: string }
  | { readonly kind: 'title'; readonly text: string }
  | { readonly kind: 'auto' }
  | { readonly kind: 'help' }

export const BADGE_USAGE = [
  'usage: /mochi badge [on | off | color <name> | title <text> | auto]',
  '  /mochi badge                 this session\'s color and title',
  '  /mochi badge on|off          tint the tab and add the emoji title, or stop (saved)',
  `  /mochi badge color <name>    ${PALETTE.map(tint => tint.id).join(', ')}`,
  '  /mochi badge title <text>    pin a title (shown from your next prompt)',
  '  /mochi badge auto            follow Claude Code\'s topic again',
].join('\n')

/** Parses `/mochi badge` arguments; never throws, an unknown request is `help`. */
export const parseBadgeCommand = (args: string): BadgeCommand => {
  const trimmed = args.trim()
  if (!trimmed) return { kind: 'status' }
  const [word = '', name] = trimmed.split(/\s+/)
  const remainder = trimmed.slice(word.length).trim()
  switch (word.toLowerCase()) {
    case 'on':
    case 'off':
      return remainder ? { kind: 'help' } : { kind: 'switch', isOn: word.toLowerCase() === 'on' }
    case 'color':
    case 'colour': {
      if (!name) return { kind: 'help' }
      const tint = findTint(name)
      return tint ? { kind: 'color', tint } : { kind: 'unknown-color', name }
    }
    case 'title':
      return remainder ? { kind: 'title', text: remainder } : { kind: 'auto' }
    case 'auto':
      return { kind: 'auto' }
    default:
      return { kind: 'help' }
  }
}

/** The first line of `/mochi badge`: color, title source and which tab it paints. */
export const describeStatus = (record: BadgeRecord, isOn: boolean, tty: string | undefined): string => {
  const tint = findTint(record.tint)
  const color = `${tint?.emoji ?? ''} ${tint?.name ?? record.tint}${isOn ? '' : ' (badge off)'}`
  const topic = record.pinned ? `title pinned: ${record.pinned}` : 'title follows Claude Code\'s topic'
  const where = tty ? `tab ${tty}` : 'no Terminal.app tab found, so title only'
  return `${color} · ${topic} · ${where}`
}
