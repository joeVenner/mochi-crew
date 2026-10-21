import type { TintId } from '../types'

/**
 * A session color: a dark Terminal.app tab background and the colored emoji that
 * names it in the tab title. Every tint is dark enough for Claude Code's dark theme
 * text and diffs to stay readable on it.
 */
export type Tint = {
  readonly id: TintId
  readonly name: string
  readonly emoji: string
  /** The tab background. */
  readonly hex: string
}

/** Terminal.app's color: three 16-bit channels. */
export type Rgb16 = readonly [number, number, number]

export const DEFAULT_TINT: Tint = { id: 'plum', name: 'Plum', emoji: '🟣', hex: '#2B1533' }

export const PALETTE: readonly Tint[] = [
  DEFAULT_TINT,
  { id: 'harbor', name: 'Harbor', emoji: '🔵', hex: '#12233F' },
  { id: 'pine', name: 'Pine', emoji: '🟢', hex: '#12291D' },
  { id: 'claret', name: 'Claret', emoji: '🔴', hex: '#34151C' },
  { id: 'rust', name: 'Rust', emoji: '🟠', hex: '#35200F' },
  { id: 'moss', name: 'Moss', emoji: '🟡', hex: '#282712' },
  { id: 'walnut', name: 'Walnut', emoji: '🟤', hex: '#2B1F17' },
  { id: 'graphite', name: 'Graphite', emoji: '⚫', hex: '#222326' },
]

/** Scales each 8-bit channel to 16 bits (x 257), the way Terminal.app stores it. */
export const hexToRgb16 = (hex: string): Rgb16 => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [((value >> 16) & 255) * 257, ((value >> 8) & 255) * 257, (value & 255) * 257]
}

export const isSameRgb = (a: Rgb16, b: Rgb16): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

/** Finds a tint by id or name, ignoring case. */
export const findTint = (name: string | undefined): Tint | undefined => {
  if (!name) return undefined
  const wanted = name.trim().toLowerCase()
  return PALETTE.find(tint => tint.id === wanted || tint.name.toLowerCase() === wanted)
}

export const tintForRgb = (rgb: Rgb16): Tint | undefined => PALETTE.find(tint => isSameRgb(hexToRgb16(tint.hex), rgb))

/** FNV-1a: a small stable hash, so a session id always gets the same tie-break. */
export const hashString = (text: string): number => {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/**
 * Picks the tint the fewest other tabs wear. The open tabs are the registry: their
 * backgrounds are read straight from Terminal, so two sessions never have to agree
 * through a shared file. Ties go to the session id's hash.
 */
export const pickTint = (otherTabColors: readonly Rgb16[], sessionId: string): Tint => {
  const counts = new Map<TintId, number>(PALETTE.map(tint => [tint.id, 0]))
  for (const rgb of otherTabColors) {
    const worn = tintForRgb(rgb)
    if (worn) counts.set(worn.id, (counts.get(worn.id) ?? 0) + 1)
  }
  const start = hashString(sessionId) % PALETTE.length
  const [first = DEFAULT_TINT, ...rest] = [...PALETTE.slice(start), ...PALETTE.slice(0, start)]
  return rest.reduce((best, tint) => ((counts.get(tint.id) ?? 0) < (counts.get(best.id) ?? 0) ? tint : best), first)
}
