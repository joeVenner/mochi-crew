import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadPixel } from '@remotion/google-fonts/PressStart2P'

import type { Tone } from './plugin'

export const FPS = 30
export const WIDTH = 1920
export const HEIGHT = 1080

/** When each scene's voice line starts, in seconds from the scene's start. */
export const VOICE_LEAD_SECONDS = 0.3

/** Sound effects sit under the narration. */
export const EFFECT_VOLUME = 0.35

/** Frames for a span in seconds, so scene timings read in seconds. */
export const seconds = (value: number): number => Math.round(value * FPS)

export const MONO = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily
export const PIXEL = loadPixel('normal', { weights: ['400'], subsets: ['latin'] }).fontFamily

/** A night room around a terminal: the colors of the plugin's own scene and HUD. */
export const COLORS = {
  background: '#120e1a',
  glow: '#2a1f3d',
  panel: '#1a1523',
  border: '#3a3248',
  text: '#ece8f4',
  dim: '#8a8399',
  fur: '#b9a7d6',
  accent: '#d97757',
  track: '#454a55',
  alert: '#ef5350',
  good: '#66bb6a',
} as const

/** How each HUD tone is drawn, matching the terminal's dim labels and accent bars. */
export const TONE_COLORS: Readonly<Record<Tone, string>> = {
  label: COLORS.dim,
  dim: COLORS.dim,
  value: COLORS.text,
  strong: COLORS.text,
  accent: COLORS.accent,
  track: COLORS.track,
  alert: COLORS.alert,
}
