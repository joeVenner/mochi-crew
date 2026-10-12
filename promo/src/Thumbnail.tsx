import { PixelScene } from './PixelScene'
import type { TreeSnapshot, Turn, Worker } from './plugin'
import { HOME_X, anchorOf, gutter, hatOf, rowParts, treeRows, windowRows } from './plugin'
import { COLORS, PIXEL } from './theme'
import { Backdrop, HAT_COLORS, LINE_SIZE, Panel, Rule, StatusLine } from './ui'

const SCENE_WIDTH = 64
const SCALE = 9
const TREE_COLUMNS = 40
// A moment once the crew has walked in: Mochi, just petted, stands clear of the kittens.
const NOW = 4_000

const CREW: readonly Worker[] = [
  { id: 'agent-tests', type: 'test-engineer', description: 'cover the cart', file: 'src/cart.ts', doing: 'edit cart.ts', lastKind: 'edit', activeCalls: 1, joinedAt: 0 },
  { id: 'agent-sec', type: 'security-auditor', description: 'audit auth', doing: 'look auth.ts', lastKind: 'tool', activeCalls: 1, joinedAt: 600 },
]

const TURN: Turn = { phase: 'working', turnId: 'thumb', since: 0 }

const entry = (name: string, isDir = false) => ({ name, isDir })
const SNAPSHOT: TreeSnapshot = {
  rootName: 'shop',
  branch: 'main',
  listings: {
    '': [entry('docs', true), entry('src', true), entry('tests', true), entry('package.json')],
    src: [entry('cart.ts'), entry('checkout.ts'), entry('pricing.ts')],
  },
  marks: { 'src/checkout.ts': 'M', 'src/cart.ts': 'M' },
  added: { 'src/checkout.ts': 3, 'src/cart.ts': 12 },
}
const TOUCHED = [{ path: 'src/cart.ts', workerId: 'agent-tests' }]
const FOCUS = { path: 'src/checkout.ts', kind: 'edit' as const, since: 0 }

const FEATURES = ['reacts to your real session', 'subagents join as kittens', 'live file tree + session meter'] as const

/** The video's cover: the name and what it does on the left, the real pane on the right. */
export const Thumbnail = () => {
  const rows = treeRows({ snapshot: SNAPSHOT, focus: FOCUS, touched: TOUCHED })
  const shown = windowRows(rows, anchorOf(rows, TOUCHED), 7)
  return (
    <Backdrop>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 110px', gap: 70 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 30, color: COLORS.accent, letterSpacing: 4, marginBottom: 34 }}>FOR CLAUDE CODE</div>
          <div style={{ fontFamily: PIXEL, fontSize: 92, lineHeight: 1.25, color: COLORS.fur }}>MOCHI<br />CREW</div>
          <div style={{ marginTop: 36, fontSize: 44, lineHeight: 1.35, color: COLORS.text }}>A pixel cat that lives<br />in your terminal</div>
          <div style={{ marginTop: 46 }}>
            {FEATURES.map(feature => (
              <div key={feature} style={{ fontSize: 32, lineHeight: 1.75, color: COLORS.dim }}>
                <span style={{ color: COLORS.accent }}>{'▍ '}</span>{feature}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 46, display: 'inline-block', fontSize: 28, padding: '12px 24px', borderRadius: 12, border: `2px solid ${COLORS.border}`, color: COLORS.text }}>
            free · open source
          </div>
        </div>
        <Panel title="Mochi" style={{ width: SCENE_WIDTH * SCALE + 56 }}>
          <PixelScene
            now={NOW}
            width={SCENE_WIDTH}
            scale={SCALE}
            input={{ activity: { kind: 'idle', since: NOW - 300, fromX: HOME_X + 8 }, workers: CREW, outfit: 'classic', hour: 21, feeling: 'happy', reaction: { kind: 'pet', at: NOW - 700 }, bug: null, turn: TURN }}
          />
          <div style={{ marginTop: 16 }}>
            <StatusLine text="thinking · crew of 2" />
            <Rule width={TREE_COLUMNS} />
            <div style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre' }}>
              <span style={{ color: COLORS.dim }}>{gutter('files')}</span>
              <span style={{ fontWeight: 700 }}>shop</span>
              <span style={{ color: COLORS.dim }}>  main</span>
            </div>
            {shown.rows.map(row => {
              const parts = rowParts(row, TREE_COLUMNS)
              const workerColor = row.workerId === undefined ? undefined : HAT_COLORS[hatOf(row.workerId).text]
              const isActive = row.tone === 'active'
              const color = isActive ? COLORS.accent : workerColor ?? COLORS.text
              const lines = row.added > 0 ? `+${row.added}` : ''
              const mark = parts.badge.slice(lines.length).trim()
              return (
                <div key={row.key} style={{ fontSize: LINE_SIZE, lineHeight: 1.5, whiteSpace: 'pre' }}>
                  <span>{parts.indent}</span>
                  <span style={{ color: isActive || workerColor !== undefined ? color : COLORS.dim }}>{parts.glyph}</span>
                  <span style={{ color, fontWeight: isActive ? 700 : 400 }}>{parts.name}</span>
                  <span>{parts.badge === '' ? '' : '  '}</span>
                  <span style={{ color: COLORS.good }}>{lines}</span>
                  <span style={{ color: COLORS.dim }}>{lines !== '' && mark !== '' ? ` ${mark}` : mark}</span>
                </div>
              )
            })}
          </div>
        </Panel>
      </div>
    </Backdrop>
  )
}
