import { describe, expect, test } from 'claude-code/testing'

import { describePlaces, describeStatus, parseBadgeCommand } from '../hooks/badgeCommand'
import { PALETTE, findTint, hashString, hexToRgb16, pickTint, placeFor, tintForRgb } from '../hooks/badgePalette'
import { PLACE_IDS } from '../hooks/world'
import type { Rgb16 } from '../hooks/badgePalette'
import { newRecord, parseRecord, rememberSet, withoutPinned } from '../hooks/badgeRecords'
import { isTranscriptPath } from '../hooks/badge'
import { parseTabs } from '../hooks/badgeTerminal'
import { MAX_TITLE_LENGTH, decideTitle, latestAiTitle, sanitizeLabel, sanitizeTitle, stripBadge, topicFromTranscript } from '../hooks/badgeTitle'
import { findControllingTty, isTerminalTty, parseProcessTable, processTableArgv } from '../hooks/badgeTty'

const CLEAR_DARK: Rgb16 = [6447, 7462, 10000]
const plum = PALETTE[0]!
const MARKER = '0123456789abcdef0123456789abcdef'

describe('badge palette', () => {
  test('scales hex to the 16-bit channels Terminal stores', () => {
    expect(hexToRgb16('#2B1533')).toEqual([43 * 257, 21 * 257, 51 * 257])
    expect(hexToRgb16('#FFFFFF')).toEqual([65535, 65535, 65535])
  })

  test('finds tints by id or name, any case, and by their exact color', () => {
    expect(findTint('PLUM')?.id).toBe('plum')
    expect(findTint(' Harbor ')?.id).toBe('harbor')
    expect(findTint('teal')).toBeUndefined()
    expect(tintForRgb(hexToRgb16('#12291D'))?.id).toBe('pine')
    expect(tintForRgb(CLEAR_DARK)).toBeUndefined()
  })

  test('has eight distinct colors and emoji', () => {
    expect(new Set(PALETTE.map(tint => tint.hex)).size).toBe(8)
    expect(new Set(PALETTE.map(tint => tint.emoji)).size).toBe(8)
  })

  test('picks the same tint for the same session, and avoids tints other tabs wear', () => {
    expect(pickTint([], 'abc').id).toBe(PALETTE[hashString('abc') % PALETTE.length]!.id)
    expect(pickTint([CLEAR_DARK], 'abc').id).toBe(pickTint([], 'abc').id)
    expect(pickTint(PALETTE.slice(0, 7).map(tint => hexToRgb16(tint.hex)), 'any').id).toBe(PALETTE[7]!.id)
  })

  test('with every tint worn, picks the least worn, ties by hash', () => {
    const everyOnce = PALETTE.map(tint => hexToRgb16(tint.hex))
    expect(pickTint([...everyOnce, hexToRgb16(plum.hex)], 'sess').id).not.toBe('plum')
    expect(pickTint(everyOnce, 'sess').id).toBe(pickTint([], 'sess').id)
  })
})

describe('badge places', () => {
  test('every color has its own place, and every place has a color', () => {
    expect(new Set(PALETTE.map(tint => tint.place)).size).toBe(PALETTE.length)
    expect([...PALETTE.map(tint => tint.place)].sort()).toEqual([...PLACE_IDS].sort())
  })

  test('a place name finds its color', () => {
    expect(findTint('gym')?.id).toBe('graphite')
    expect(findTint(' Forest ')?.id).toBe('pine')
    expect(findTint('moon')).toBeUndefined()
  })

  test('the desk stands at the badge\'s place, and in the house while the badge is off or unset', () => {
    expect(placeFor('rust', true)).toBe('desert')
    expect(placeFor('rust', false)).toBe('house')
    expect(placeFor(undefined, true)).toBe('house')
    expect(placeFor('teal', true)).toBe('house')
  })

  test('/mochi place lists the places with this session\'s marked, and picks one by name', () => {
    expect(parseBadgeCommand('place')).toEqual({ kind: 'places' })
    expect(parseBadgeCommand('place beach')).toEqual({ kind: 'color', tint: findTint('harbor') })
    expect(parseBadgeCommand('place moon')).toEqual({ kind: 'unknown-color', name: 'moon' })
    expect(parseBadgeCommand('place next')).toEqual({ kind: 'next' })
    expect(describePlaces('harbor')).toContain('[beach]')
    expect(describePlaces('harbor')).toContain(' gym')
  })
})

describe('badge tab lookup', () => {
  test('accepts only /dev/ttysNNN paths', () => {
    expect(isTerminalTty('/dev/ttys001')).toBe(true)
    expect(isTerminalTty('/dev/ttys01')).toBe(false)
    expect(isTerminalTty('/dev/ttys001"; do shell script "x')).toBe(false)
  })

  test('runs ps with no shell, and refuses a marker that is not hex', () => {
    expect(processTableArgv(MARKER)).toEqual(['/bin/ps', '-A', '-o', `pid=,ppid=,tty=,args=mochi-badge-${MARKER}`])
    expect(() => processTableArgv('x; rm -rf ~')).toThrow()
  })

  test('finds its own ps row by the marker and walks up to Claude Code\'s tty', () => {
    const text = [
      `                     mochi-badge-${MARKER}`,
      ` 1631 33356 ??       /bin/ps -A -o pid=,ppid=,tty=,args=mochi-badge-${MARKER}`,
      ` 1700 33356 ??       grep mochi-badge-${MARKER}`,
      ` 1701  4242 ??       /bin/ps -A x mochi-badge-${MARKER}`,
      '33356   783 ttys001  claude',
      '  783   777 ttys001  -zsh',
      '    1     0 ??       /sbin/launchd',
    ].join('\n')
    const { startPid, rows } = parseProcessTable(text, MARKER)
    expect(startPid).toBe(33356)
    expect(findControllingTty(startPid, rows)).toBe('/dev/ttys001')
  })

  test('answers nothing without its own row, a tty, a parent, or with a loop', () => {
    expect(parseProcessTable(' 5 1 ?? /bin/ps -A', MARKER).startPid).toBeUndefined()
    const own = `/bin/ps -A -o pid=,ppid=,tty=,args=mochi-badge-${MARKER}`
    expect(parseProcessTable(` 5 1 ?? ${own}\n 6 2 ?? ${own}`, MARKER).startPid).toBeUndefined()
    expect(findControllingTty(undefined, new Map())).toBeUndefined()
    expect(findControllingTty(5, parseProcessTable('5 1 ?? x', MARKER).rows)).toBeUndefined()
    expect(findControllingTty(5, parseProcessTable('5 6 ?? x\n6 5 ?? y', MARKER).rows)).toBeUndefined()
  })

  test('reads Terminal\'s tab list and skips malformed lines', () => {
    const text = [
      '/dev/ttys000\t6447,7462,10000\tClear Dark',
      '/dev/ttys001\t11051,5397,13107\tClear Dark',
      'garbage',
      '/dev/ttys002\t1,2\tBasic',
      '/dev/ttys003\t1,2,99999\tBasic',
      '/dev/ttys004\t1,,3\tBasic',
      '/dev/tty-evil\t1,2,3\tBasic',
    ].join('\n')
    expect(parseTabs(text)).toEqual([
      { tty: '/dev/ttys000', rgb: [6447, 7462, 10000], profile: 'Clear Dark' },
      { tty: '/dev/ttys001', rgb: [11051, 5397, 13107], profile: 'Clear Dark' },
    ])
  })
})

describe('badge titles', () => {
  test('cleans control characters, quotes and length', () => {
    expect(sanitizeTitle('  "SEO hub\u0007 pages."  ')).toBe('SEO hub pages')
    expect(sanitizeTitle('\u001b]0;evil\u0007')).toBe(']0;evil')
    expect(sanitizeTitle('   ')).toBeUndefined()
    expect(Array.from(sanitizeTitle('x'.repeat(80)) ?? '').length).toBe(MAX_TITLE_LENGTH)
    expect(sanitizeTitle('Terminal session theme and background titles')).toBe('Terminal session theme and background titles')
  })

  test('removes bidi, C1, zero-width and blank look-alikes, and keeps compound emoji', () => {
    expect(sanitizeLabel('main‮gnp.exe', 48)).toBe('main gnp.exe')
    expect(sanitizeLabel('x\u009B31m', 48)).toBe('x 31m')
    expect(sanitizeLabel('ㅤ⠀️', 48)).toBeUndefined()
    expect(sanitizeLabel('👩‍💻 pairing', 48)).toBe('👩‍💻 pairing')
  })

  test('stays fast on huge hostile input', () => {
    const started = Date.now()
    sanitizeTitle(`"${'.'.repeat(200_000)}x`)
    expect(Date.now() - started).toBeLessThan(200)
  })

  test('strips only a leading palette emoji', () => {
    expect(stripBadge('🟣 SEO hub pages')).toBe('SEO hub pages')
    expect(stripBadge('SEO 🟣 hub')).toBe('SEO 🟣 hub')
    expect(stripBadge('🚀 launch')).toBe('🚀 launch')
  })

  test('reads the ai-title row, skipping torn lines', () => {
    expect(latestAiTitle('{"type":"ai-title","aiTitle":"First"}\n{"type":"ai-title","aiTi')).toBe('First')
    expect(latestAiTitle('{"type":"user","aiTitle":"no"}')).toBeUndefined()
  })

  test('accepts only transcript paths of Claude Code\'s shape', () => {
    expect(isTranscriptPath('/Users/a/.claude/projects/-Users-a-x/0f1e.jsonl')).toBe(true)
    expect(isTranscriptPath('/Users/a/.claude/projects/../../etc/x.jsonl')).toBe(false)
    expect(isTranscriptPath('/tmp/x.jsonl')).toBe(false)
  })

  test('accepts Windows transcript paths too', () => {
    expect(isTranscriptPath('C:\\Users\\a\\.claude\\projects\\C--Users-a-x\\0f1e.jsonl')).toBe(true)
    expect(isTranscriptPath('D:/Users/a/.claude/projects/p/0f1e.jsonl')).toBe(true)
    expect(isTranscriptPath('C:\\Users\\a\\.claude\\projects\\..\\..\\x.jsonl')).toBe(false)
    expect(isTranscriptPath('relative\\projects\\p\\x.jsonl')).toBe(false)
  })

  test('finds the first topic row in a whole transcript, with Windows line endings too', () => {
    const transcript = ['{"type":"user","message":"hi"}', '{"type":"ai-title","aiTitle":"Fix login","sessionId":"s"}', '{"type":"ai-title","aiTitle":"Later"}'].join('\r\n')
    expect(topicFromTranscript(transcript)).toBe('Fix login')
    expect(topicFromTranscript('{"type":"user"}\n')).toBeUndefined()
    expect(topicFromTranscript(`{"type":"ai-title","aiTitle":"${'x'.repeat(20_000)}"}`)).toBeUndefined()
  })

  const base = { current: undefined, recentSet: [] as string[], pinned: undefined, aiTitle: undefined, tint: plum, isOff: false }

  test('waits for a topic, then mirrors it with the emoji', () => {
    expect(decideTitle(base)).toEqual({ pinned: undefined })
    expect(decideTitle({ ...base, aiTitle: 'SEO hub pages' })).toEqual({ title: '🟣 SEO hub pages', pinned: undefined })
    expect(decideTitle({ ...base, current: '🟣 Same', recentSet: ['🟣 Same'], aiTitle: 'Same' }).title).toBeUndefined()
  })

  test('a /rename wins, keeps its words, and is pinned with the emoji added', () => {
    const name = 'Refactor the marketplace pin guards and the detail page install section.'
    expect(decideTitle({ ...base, current: name, recentSet: ['🟣 Old'], aiTitle: 'Topic' })).toEqual({ title: `🟣 ${name}`, pinned: name })
    expect(decideTitle({ ...base, current: `🟣 ${name}`, recentSet: [`🟣 ${name}`], pinned: name, aiTitle: 'Other' }).title).toBeUndefined()
  })

  test('a dropped write or a forgotten badge title is Mochi\'s own, not a rename', () => {
    expect(decideTitle({ ...base, current: '🟣 First', recentSet: ['🟣 First', '🟣 Second'], aiTitle: 'Second' })).toEqual({ title: '🟣 Second', pinned: undefined })
    expect(decideTitle({ ...base, current: '🟢 Fix login', aiTitle: 'Fix login' })).toEqual({ title: '🟣 Fix login', pinned: undefined })
  })

  test('an unusable rename keeps the earlier pin', () => {
    expect(decideTitle({ ...base, current: '🚀', recentSet: ['🟣 x'], pinned: 'kept' }).pinned).toBe('kept')
  })

  test('off takes the emoji back out of its own title only', () => {
    expect(decideTitle({ ...base, isOff: true, current: '🟣 Topic', recentSet: ['🟣 Topic'] }).title).toBe('Topic')
    expect(decideTitle({ ...base, isOff: true, current: 'Mine', recentSet: ['🟣 Topic'] }).title).toBeUndefined()
  })
})

describe('badge records and commands', () => {
  test('accepts a well-formed record and cleans its titles', () => {
    expect(parseRecord({ tint: 'pine', pinned: 'x', aiTitle: 'not kept', extra: true })).toEqual({ tint: 'pine', recentSet: [], pinned: 'x' })
    expect(parseRecord({ tint: 'teal' })).toBeUndefined()
    expect(parseRecord(null)).toBeUndefined()
    const record = parseRecord({ tint: 'plum', pinned: '\u001b]0;evil\u0007', recentSet: ['🟣 a', 7, '\u0007'] })
    expect(record?.pinned).toBe(']0;evil')
    expect(record?.recentSet).toEqual(['🟣 a'])
  })

  test('remembers the last three titles it set', () => {
    let record = newRecord('plum')
    for (const title of ['a', 'b', 'c', 'd', 'c']) record = rememberSet(record, title)
    expect(record.recentSet).toEqual(['b', 'd', 'c'])
    expect(withoutPinned({ ...record, pinned: 'x' }).pinned).toBeUndefined()
  })

  test('reads each /mochi badge subcommand', () => {
    expect(parseBadgeCommand('')).toEqual({ kind: 'status' })
    expect(parseBadgeCommand('on')).toEqual({ kind: 'switch', isOn: true })
    expect(parseBadgeCommand(' OFF ')).toEqual({ kind: 'switch', isOn: false })
    expect(parseBadgeCommand('off now')).toEqual({ kind: 'help' })
    expect(parseBadgeCommand('color Pine')).toEqual({ kind: 'color', tint: findTint('pine') })
    expect(parseBadgeCommand('colour teal')).toEqual({ kind: 'unknown-color', name: 'teal' })
    expect(parseBadgeCommand('color')).toEqual({ kind: 'help' })
    expect(parseBadgeCommand('title  SEO   hubs ')).toEqual({ kind: 'title', text: 'SEO   hubs' })
    expect(parseBadgeCommand('title')).toEqual({ kind: 'auto' })
    expect(parseBadgeCommand('dance')).toEqual({ kind: 'help' })
  })

  test('names the color, the title source and the tab', () => {
    expect(describeStatus(newRecord('pine'), true, '/dev/ttys004')).toBe('🟢 Pine · forest · title follows Claude Code\'s topic · tab /dev/ttys004')
    expect(describeStatus({ ...newRecord('plum'), pinned: 'Mine' }, false, undefined)).toContain('space (badge off) · title pinned: Mine · no Terminal.app tab, so the place and title show it')
  })
})
