import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'

import type { Tone, Worker } from './plugin'
import { ROLE_INFO, gutter, hatOf, roleFor, workerNote } from './plugin'
import { COLORS, MONO, PIXEL, TONE_COLORS } from './theme'

/** The terminal's named colors a hat uses, as the pane's own palette draws them. */
export const HAT_COLORS: Readonly<Record<string, string>> = { yellow: '#ffd54f', cyan: '#4dd0e1', magenta: '#f06292', green: '#66bb6a' }

/** Text size of every pane and terminal line. */
export const LINE_SIZE = 26

/** A run of HUD text in one tone. */
export type Cell = { readonly text: string; readonly tone: Tone }

/** The night backdrop with a soft lavender glow behind the action. */
export const Backdrop = ({ children }: { readonly children: ReactNode }) => (
  <AbsoluteFill style={{ background: `radial-gradient(ellipse at 50% 45%, ${COLORS.glow} 0%, ${COLORS.background} 70%)`, fontFamily: MONO, color: COLORS.text }}>
    {children}
  </AbsoluteFill>
)

/**
 * A scene that fades in and out at its edges, so cuts between scenes read as one piece.
 * Sits inside a `Sequence`, whose duration sets where the fade-out starts.
 */
export const Fade = ({ children, frames = 10 }: { readonly children: ReactNode; readonly frames?: number }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const opacity = interpolate(frame, [0, frames, durationInFrames - frames, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>
}

/** A rounded side box with its title in the border, like Claude Code's own panes. */
export const Panel = ({ title, children, style }: { readonly title: string; readonly children: ReactNode; readonly style?: CSSProperties }) => (
  <div style={{ position: 'relative', border: `2px solid ${COLORS.border}`, borderRadius: 14, background: COLORS.panel, padding: '34px 28px 24px', boxShadow: '0 30px 80px rgba(0,0,0,0.45)', ...style }}>
    <div style={{ position: 'absolute', top: -17, left: 24, padding: '0 10px', background: COLORS.panel, color: COLORS.fur, fontSize: LINE_SIZE, fontWeight: 700 }}>{title}</div>
    {children}
  </div>
)

/** One HUD line: monospace cells, never wrapped, exactly as the pane lays them out. */
export const HudLine = ({ cells }: { readonly cells: readonly Cell[] }) => (
  <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre', overflow: 'hidden' }}>
    {cells.map((cell, index) => (
      <span key={index} style={{ color: TONE_COLORS[cell.tone] }}>{cell.text}</span>
    ))}
  </div>
)

/** The status line under the room: an accent marker, then what Mochi is doing. */
export const StatusLine = ({ text }: { readonly text: string }) => (
  <HudLine cells={[{ text: '▍ ', tone: 'accent' }, { text, tone: 'value' }]} />
)

/** A thin rule between HUD groups. */
export const Rule = ({ width }: { readonly width: number }) => <HudLine cells={[{ text: '─'.repeat(width), tone: 'track' }]} />

/** A worker's HUD row as the pane writes it: tag in its hat color, role, then its latest call. */
export const WorkerLine = ({ worker }: { readonly worker: Worker }) => {
  const role = ROLE_INFO[roleFor(worker.type)]
  return (
    <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre' }}>
      <span style={{ color: HAT_COLORS[hatOf(worker.id).text] }}>{gutter(role.tag)}</span>
      <span>{role.title}</span>
      <span style={{ color: COLORS.dim }}> · {workerNote(worker)}</span>
    </div>
  )
}

/** A headline over the action, in the pixel font, rising in as its scene starts. */
export const Caption = ({ title, subtitle, top = 90 }: { readonly title: string; readonly subtitle?: string; readonly top?: number }) => {
  const frame = useCurrentFrame()
  const rise = interpolate(frame, [0, 14], [24, 0], { extrapolateRight: 'clamp' })
  const opacity = interpolate(frame, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', top, left: 0, right: 0, textAlign: 'center', transform: `translateY(${rise}px)`, opacity }}>
      <div style={{ fontFamily: PIXEL, fontSize: 40, color: COLORS.text, letterSpacing: 1 }}>{title}</div>
      {subtitle === undefined ? null : <div style={{ marginTop: 22, fontSize: 30, color: COLORS.dim }}>{subtitle}</div>}
    </div>
  )
}

/** The part of `text` a typist has reached `frame` frames after starting, at `perFrame` characters. */
export const typed = (text: string, frame: number, perFrame = 1.2): string => text.slice(0, Math.max(0, Math.floor(frame * perFrame)))
