import type { OutfitName } from '../types'

/**
 * Mochi's outfits: pixel overlays drawn over the cat. Each row is a pixel
 * row relative to the cat's top-left; `top` may be negative for hats.
 */
export type OutfitOverlay = { top: number; rows: readonly string[] }

export const OUTFITS: Readonly<Record<OutfitName, readonly OutfitOverlay[]>> = {
  classic: [],
  wizard: [{
    top: -3,
    rows: [
      '.......VV.......',
      '......VVYV......',
      '.....VVVVVV.....',
      '...VVVVVVVVVV...',
    ],
  }],
  pirate: [
    {
      top: -2,
      rows: [
        '....KKKKKKKK....',
        '...KKKKWWKKKK...',
        '..KKKKKKKKKKKK..',
      ],
    },
    // Eye patch strap across the face, over the right eye.
    { top: 3, rows: ['..KKKKKKKKKKKK..', '..........KK....'] },
  ],
  party: [{
    top: -3,
    rows: [
      '.......Y........',
      '......PP........',
      '.....YYYY.......',
      '....PPPPPP......',
    ],
  }],
  shades: [{ top: 3, rows: ['...KKKKKKKKKK...', '....WK....WK....'] }],
  crown: [{
    top: -2,
    rows: [
      '....Y..YY..Y....',
      '....YYYPYYYY....',
      '....YYYYYYYY....',
    ],
  }],
}

export const OUTFIT_NAMES: readonly OutfitName[] = ['classic', 'wizard', 'pirate', 'party', 'shades', 'crown']
export const DEFAULT_OUTFIT: OutfitName = 'classic'

export const isOutfitName = (value: unknown): value is OutfitName =>
  typeof value === 'string' && Object.hasOwn(OUTFITS, value)

/** What `/mascot tutor [action]` asks the tutor to do; `open` is the bare verb. */
export type TutorVerb = 'open' | 'start' | 'digest' | 'review' | 'cards' | 'stop' | 'reset'

/** The actions the unknown-action error suggests, in order; `open` is left out because a bare `tutor` already means it. */
export const TUTOR_VERBS: readonly Exclude<TutorVerb, 'open'>[] = ['start', 'digest', 'review', 'cards', 'stop', 'reset']

const isTutorVerb = (value: string): value is Exclude<TutorVerb, 'open'> =>
  (TUTOR_VERBS as readonly string[]).includes(value)

/** What `/mascot <args>` asks for. */
export type MascotCommand =
  | { kind: 'open' }
  | { kind: 'list' }
  | { kind: 'achievements' }
  | { kind: 'journal' }
  | { kind: 'missions' }
  | { kind: 'outfit'; name: OutfitName }
  | { kind: 'sound'; isOn: boolean }
  | { kind: 'react'; reaction: 'pet' | 'feed' | 'dance' }
  | { kind: 'meter' }
  /** Shows or hides the file tree; no `isOn` flips it. */
  | { kind: 'files'; isOn?: boolean }
  /** The tutor tab; a bare `tutor` only opens it and never starts a round. */
  | { kind: 'tutor'; action: TutorVerb }
  | { kind: 'error'; message: string }

export const MASCOT_USAGE = 'usage: /mascot [pet | feed | dance | journal | missions | achievements | meter | files [on|off] | tutor [start|digest|review|cards|stop|reset] | badge [on|off|color <name>|title <text>|auto] | place [<name>] | outfits | outfit <name> | sound on|off]'

/** Parses `/mascot` arguments; never throws, an unknown request is an `error` with usage. */
export const parseMascotCommand = (args: string): MascotCommand => {
  const [verb, value, ...rest] = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (verb === undefined) return { kind: 'open' }
  if (rest.length > 0) return { kind: 'error', message: MASCOT_USAGE }
  if (verb === 'outfits' && value === undefined) return { kind: 'list' }
  if (verb === 'achievements' && value === undefined) return { kind: 'achievements' }
  if (verb === 'journal' && value === undefined) return { kind: 'journal' }
  if (verb === 'missions' && value === undefined) return { kind: 'missions' }
  if (verb === 'meter' && value === undefined) return { kind: 'meter' }
  if (verb === 'files' && value === undefined) return { kind: 'files' }
  if (verb === 'files' && (value === 'on' || value === 'off')) return { kind: 'files', isOn: value === 'on' }
  if (verb === 'tutor') {
    // D.2 accepts any of the seven actions; `open` is also what the bare verb means, so both open the tab.
    if (value === undefined || value === 'open') return { kind: 'tutor', action: 'open' }
    if (isTutorVerb(value)) return { kind: 'tutor', action: value }
    return { kind: 'error', message: `unknown tutor action "${value}"; try: ${TUTOR_VERBS.join(', ')}` }
  }
  if ((verb === 'pet' || verb === 'feed' || verb === 'dance') && value === undefined) return { kind: 'react', reaction: verb }
  if (verb === 'outfit') {
    if (isOutfitName(value)) return { kind: 'outfit', name: value }
    return { kind: 'error', message: `unknown outfit "${value ?? ''}"; try: ${OUTFIT_NAMES.join(', ')}` }
  }
  if (verb === 'sound' && (value === 'on' || value === 'off')) return { kind: 'sound', isOn: value === 'on' }
  return { kind: 'error', message: MASCOT_USAGE }
}
