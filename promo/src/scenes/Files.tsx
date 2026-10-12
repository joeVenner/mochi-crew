import { Html5Audio, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'

import doneSound from '../../../plugins/mochi-crew/sounds/done.wav'
import { PixelScene } from '../PixelScene'
import type { MascotActivity, TouchedFile, TreeFocus, TreeRow, TreeSnapshot, Turn, Worker } from '../plugin'
import { HOME_X, activityLabel, anchorOf, deskX, gutter, hatOf, rowParts, treeRows, windowRows } from '../plugin'
import { COLORS, EFFECT_VOLUME, seconds } from '../theme'
import { Backdrop, Caption, HAT_COLORS, LINE_SIZE, Panel, Rule, StatusLine } from '../ui'

const SCENE_WIDTH = 56
const SCALE = 7
/** Cells the tree is laid out in, as the pane's body would be. */
const TREE_COLUMNS = 44
/** Rows the tree may take, as the HUD would leave them in a tall pane. */
const TREE_BUDGET = 9
const LINE_HEIGHT = LINE_SIZE * 1.5
/** Wide enough for the tree's cells at the pane's text size. */
const PANE_WIDTH = 760
// The live row's pulse: the plugin's 4 ticks of 180 ms.
const PULSE_MS = 4 * 180

/**
 * When each beat lands, in seconds from the scene's start, from the pauses in the line (plus its
 * 0.3 s lead): the read and edit under "shows exactly where Claude is working" (1.2–4.4 s), the
 * click on "Click a file" (4.8 s), the editor on "opens in your editor" (6.0 s).
 */
const AT = { read: 1.3, edit: 2.6, edited: 3.6, worker: 3.8, workerEdited: 4.5, point: 4.3, click: 4.95, opened: 5.9 } as const

const ms = (secondsIn: number): number => secondsIn * 1000

const entry = (name: string, isDir = false) => ({ name, isDir })

/** A small shop's repository as the plugin would list it: folders first, case-blind order. */
const LISTINGS: TreeSnapshot['listings'] = {
  '': [entry('.github', true), entry('docs', true), entry('src', true), entry('tests', true), entry('.gitignore'), entry('package.json'), entry('README.md')],
  src: [entry('api', true), entry('cart.ts'), entry('checkout.ts'), entry('pricing.ts')],
  tests: [entry('cart.test.ts'), entry('checkout.test.ts')],
}

/** A test engineer the turn hired, editing the cart while Claude fixes checkout. */
const WORKER: Worker = { id: 'agent-tests', type: 'test-engineer', description: 'cover the cart edge cases', file: 'src/cart.ts', doing: 'edit cart.ts', lastKind: 'edit', activeCalls: 1, joinedAt: ms(AT.worker) }

/** What the plugin's snapshot holds at `now`: badges appear as each edit lands. */
const snapshotAt = (now: number): TreeSnapshot => {
  const isCheckoutEdited = now >= ms(AT.edited)
  const isCartEdited = now >= ms(AT.workerEdited)
  return {
    rootName: 'shop',
    branch: 'fix/checkout',
    listings: LISTINGS,
    marks: { ...(isCheckoutEdited ? { 'src/checkout.ts': 'M' as const } : {}), ...(isCartEdited ? { 'src/cart.ts': 'M' as const } : {}) },
    added: { ...(isCheckoutEdited ? { 'src/checkout.ts': 3 } : {}), ...(isCartEdited ? { 'src/cart.ts': 12 } : {}) },
  }
}

const focusAt = (now: number): TreeFocus | null => {
  if (now >= ms(AT.edit)) return { path: 'src/checkout.ts', kind: 'edit', since: ms(AT.edit) }
  if (now >= ms(AT.read)) return { path: 'tests/checkout.test.ts', kind: 'read', since: ms(AT.read) }
  return null
}

const touchedAt = (now: number): readonly TouchedFile[] => [
  ...(now >= ms(AT.edited) ? [{ path: 'src/checkout.ts' }] : []),
  ...(now >= ms(AT.workerEdited) ? [{ path: 'src/cart.ts', workerId: WORKER.id }] : []),
]

const activityAt = (now: number): MascotActivity => {
  const desk = deskX(SCENE_WIDTH)
  if (now >= ms(AT.edited)) return { kind: 'done', file: 'src/checkout.ts', hasFailed: false, at: ms(AT.edited), x: desk }
  if (now >= ms(AT.edit)) return { kind: 'editing', file: 'src/checkout.ts', tool: 'Edit', since: ms(AT.edit), fromX: HOME_X }
  if (now >= ms(AT.read)) return { kind: 'using', gadget: 'magnifier', detail: 'checkout.test.ts', since: ms(AT.read), fromX: HOME_X, verb: 'reading' }
  return { kind: 'idle', since: 0, fromX: HOME_X }
}

const TURN: Turn = { phase: 'working', turnId: 'promo', since: 0 }

/** One tree row drawn as the pane draws it: indent, glyph, name, then the git badge. */
const TreeLine = ({ row, isPulseLit, isPressed }: { readonly row: TreeRow; readonly isPulseLit: boolean; readonly isPressed: boolean }) => {
  const parts = rowParts(row, TREE_COLUMNS)
  const workerColor = row.workerId === undefined ? undefined : HAT_COLORS[hatOf(row.workerId).text]
  const isActive = row.tone === 'active'
  const glyphColor = isActive ? (isPulseLit ? COLORS.accent : COLORS.track) : workerColor ?? COLORS.dim
  const nameColor = isActive ? COLORS.accent : workerColor ?? (row.tone === 'dim' ? COLORS.dim : COLORS.text)
  const lines = row.added > 0 ? `+${row.added}` : ''
  const mark = parts.badge.slice(lines.length).trim()
  return (
    <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre', background: isPressed ? COLORS.border : 'transparent', borderRadius: 6 }}>
      <span style={{ color: COLORS.dim }}>{parts.indent}</span>
      <span style={{ color: glyphColor }}>{parts.glyph}</span>
      <span style={{ color: nameColor, fontWeight: isActive ? 700 : 400 }}>{parts.name}</span>
      <span>{parts.badge === '' ? '' : '  '}</span>
      <span style={{ color: COLORS.good }}>{lines}</span>
      <span>{lines !== '' && mark !== '' ? ' ' : ''}</span>
      <span style={{ color: COLORS.dim }}>{mark}</span>
    </div>
  )
}

/** The mouse pointer, drawn as a plain arrow. */
const Pointer = ({ x, y, scale }: { readonly x: number; readonly y: number; readonly scale: number }) => (
  <svg width={34} height={46} viewBox="0 0 17 23" style={{ position: 'absolute', left: x, top: y, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
    <path d="M1 1 L1 18 L5.5 14 L8.5 21 L11.5 19.8 L8.6 13 L14.5 13 Z" fill={COLORS.text} stroke={COLORS.background} strokeWidth={1.2} strokeLinejoin="round" />
  </svg>
)

/** The fixed file as the editor shows it, the three added lines marked. */
const CODE: readonly { readonly text: string; readonly isAdded?: boolean }[] = [
  { text: "import { charge } from './api/payments'" },
  { text: "import { totalOf } from './pricing'" },
  { text: '' },
  { text: 'export async function checkout(cart, clock) {' },
  { text: '  const total = totalOf(cart)' },
  { text: '  const deadline = clock.now() + TIMEOUT_MS', isAdded: true },
  { text: '  const receipt = await charge(total, { deadline })', isAdded: true },
  { text: '  if (receipt.expired) throw new CheckoutTimeout()', isAdded: true },
  { text: '  return receipt' },
  { text: '}' },
]

/**
 * The file tree under the HUD: the folders Claude works in open up, the live file pulses, a
 * kitten's file takes its hat color, git badges land, and a click opens the file in an editor.
 */
export const Files = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const now = (frame / fps) * 1000
  const activity = activityAt(now)
  const focus = focusAt(now)
  const touched = touchedAt(now)
  const rows = treeRows({ snapshot: snapshotAt(now), focus, touched })
  const shown = windowRows(rows, anchorOf(rows, touched), TREE_BUDGET)
  const isPulseLit = Math.floor(now / PULSE_MS) % 2 === 0
  const workers = now >= ms(AT.worker) ? [WORKER] : []

  // The pointer glides onto the checkout row, then clicks it.
  const targetIndex = shown.rows.findIndex(row => row.key === 'src/checkout.ts')
  const glide = spring({ frame: frame - seconds(AT.point), fps, config: { damping: 18, mass: 0.9 } })
  const pointerX = interpolate(glide, [0, 1], [700, 160])
  // The tip lands mid-row on the file's name; an `↑ n more` line sits above the rows when cut.
  const targetLine = targetIndex + (shown.above > 0 ? 1 : 0)
  const pointerY = interpolate(glide, [0, 1], [560, targetLine * LINE_HEIGHT + LINE_HEIGHT * 0.5])
  const press = frame >= seconds(AT.click) && frame < seconds(AT.click) + 6
  const isPressed = frame >= seconds(AT.click) && frame < seconds(AT.click + 0.5)
  const editorIn = spring({ frame: frame - seconds(AT.opened), fps, config: { damping: 16 } })
  // The pane starts centred and makes room as the editor opens beside it.
  const paneLeft = interpolate(editorIn, [0, 1], [(1920 - PANE_WIDTH) / 2, 150])
  const toastOpacity = interpolate(frame - seconds(AT.click + 0.15), [0, 6, 50, 60], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <Backdrop>
      <Caption title="A live map of your project" subtitle="see where Claude works, and click any file to open it" />
      <div style={{ position: 'absolute', top: 250, left: paneLeft, display: 'flex', gap: 60, alignItems: 'flex-start' }}>
        <Panel title="Mochi" style={{ width: PANE_WIDTH }}>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <PixelScene
              now={now}
              width={SCENE_WIDTH}
              scale={SCALE}
              input={{ activity, workers, outfit: 'classic', hour: 21, feeling: 'happy', reaction: null, bug: null, turn: TURN }}
            />
          </div>
          <div style={{ marginTop: 16 }}>
            <StatusLine text={activityLabel(activity, now, true)} />
            <Rule width={TREE_COLUMNS} />
            <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre' }}>
              <span style={{ color: COLORS.dim }}>{gutter('files')}</span>
              <span style={{ fontWeight: 700 }}>shop</span>
              <span style={{ color: COLORS.dim }}>  fix/checkout</span>
            </div>
            <div style={{ position: 'relative' }}>
              {shown.above > 0 ? <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, color: COLORS.dim }}>  ↑ {shown.above} more</div> : null}
              {shown.rows.map(row => (
                <TreeLine key={row.key} row={row} isPulseLit={isPulseLit} isPressed={isPressed && row.key === 'src/checkout.ts'} />
              ))}
              {shown.below > 0 ? <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, color: COLORS.dim }}>  ↓ {shown.below} more</div> : null}
              {frame >= seconds(AT.point) && targetIndex >= 0 ? <Pointer x={pointerX} y={pointerY} scale={press ? 0.85 : 1} /> : null}
            </div>
          </div>
        </Panel>
        <div style={{ width: 900, opacity: editorIn, transform: `translateX(${interpolate(editorIn, [0, 1], [80, 0])}px)` }}>
          <Panel title="src/checkout.ts">
            <div style={{ fontSize: LINE_SIZE - 4, lineHeight: 1.75, whiteSpace: 'pre' }}>
              {CODE.map((line, index) => (
                <div key={index} style={{ background: line.isAdded === true ? 'rgba(102,187,106,0.14)' : 'transparent' }}>
                  <span style={{ color: COLORS.track }}>{String(index + 12).padStart(3)}  </span>
                  <span style={{ color: line.isAdded === true ? COLORS.good : COLORS.dim }}>{line.isAdded === true ? '+ ' : '  '}</span>
                  <span style={{ color: COLORS.text }}>{line.text}</span>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <div style={{ position: 'absolute', bottom: 70, right: 90, opacity: toastOpacity }}>
        <div style={{ fontSize: 28, padding: '14px 30px', borderRadius: 12, background: COLORS.panel, border: `2px solid ${COLORS.border}`, color: COLORS.text }}>
          Opened src/checkout.ts.
        </div>
      </div>
      <Sequence from={seconds(AT.edited)} durationInFrames={seconds(0.5)}>
        <Html5Audio src={doneSound} volume={EFFECT_VOLUME} />
      </Sequence>
    </Backdrop>
  )
}
