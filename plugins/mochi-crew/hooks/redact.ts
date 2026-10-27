import { shorten } from './mascot'

/** What a hidden value shows as. */
export const MASK = '••••'

/** A rule: what to find, and how to rewrite it with the secret part masked. */
type Rule = { pattern: RegExp; replace: string | ((match: string, ...groups: unknown[]) => string) }

const SECRET_NAME = '[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|AUTH|CREDENTIALS?|COOKIE|SESSION)[A-Za-z0-9_]*'
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s;&|]+)`

// A name holding one of these is taken to name a secret; `author` is not an auth value.
const SECRET_WORD = /key|secret|token|passw(?:or)?d|pwd|credential|auth(?!or)/i
// Names that are a secret wherever they stand; `key` and `auth` are too common in code
// (`primaryKey`, `authMode`) to be trusted away from a key line.
const STRONG_SECRET_WORD = /secret|token|passw(?:or)?d|pwd|credential/i
// A bare `pass` only as the name's last word (`db_pass`, `smtpPass`), never `compass` or `bypass`.
const PASS_NAME = /(?:^|[_.-])(?:pass|Pass|PASS)$|[a-z0-9]Pass$/
// Unquoted values that are a type, a keyword or an empty value, never a secret.
const PLAIN_VALUE = /^(?:string|number|boolean|bigint|symbol|object|unknown|any|never|void|undefined|null|true|false|none|nil|~)$/i
// A value read from somewhere else names no secret itself, and masking it hides the lesson.
const LOOKED_UP = /^(?:process\.env|import\.meta\.env|os\.environ|os\.getenv|env\b|ENV\b)|\(/
// What may stand before a YAML key at the start of a line: indent, a diff marker, a list dash.
const LINE_START = /^[ \t]*[+\- ]?[ \t]*(?:-[ \t]+)?$/

/**
 * `name: value` and `name = value` in config and code, when the name says it is secret: YAML
 * `password: hunter2`, `const apiKey = "…"`, `"api_key" : '…'`. Only the value is masked. A `:`
 * with an unquoted value masks only a value that ends there (at a space, the line's end, a `#`
 * or a backtick), so a type annotation (`token: Token;`) is left alone; for a `key` or `auth`
 * name, only on a key line too. Chat text is joined onto one line before masking, so a strong
 * name is masked mid-sentence (`I set password: hunter2`).
 */
const assignedSecret = (match: string, ...groups: unknown[]): string => {
  // replace passes the groups (an unmatched one undefined), then the offset and the whole text.
  const [lead = '', quote = '', name = '', before = '', separator = '', after = ''] = groups.slice(0, 6).map(group => (typeof group === 'string' ? group : ''))
  const [value, offset, whole] = groups.slice(6, 9)
  if (typeof value !== 'string' || typeof offset !== 'number' || typeof whole !== 'string' || !(SECRET_WORD.test(name) || PASS_NAME.test(name))) return match
  const head = `${lead}${quote}${name}${quote}${before}${separator}${after}`
  if (/^["'`]/.test(value)) return `${head}${value[0]}${MASK}${value[0]}`
  if (PLAIN_VALUE.test(value) || LOOKED_UP.test(value)) return match
  if (separator === '=') return `${head}${MASK}`
  const lineStart = whole.lastIndexOf('\n', offset) + 1
  const isKeyLine = LINE_START.test(whole.slice(lineStart, offset + lead.length))
  const next = whole[offset + match.length]
  const isValueEnd = next === undefined || next === '#' || next === '`' || /\s/.test(next)
  return isValueEnd && (isKeyLine || STRONG_SECRET_WORD.test(name) || PASS_NAME.test(name)) ? `${head}${MASK}` : match
}

/** Ordered: the specific shapes first, so a generic rule never half-masks a known token. */
const RULES: readonly Rule[] = [
  // Credentials inside a URL: https://user:pass@host
  // Anchored to a scheme's start so a long word is not rescanned from every position; the
  // password runs to the last @ before the path, so one containing "@" is masked whole.
  { pattern: /(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@:]+:[^\s/]*@/gi, replace: `$1${MASK}@` },
  // curl/wget-style user:password flags.
  { pattern: /(\s(?:-u|--user|--proxy-user)(?:\s+|=))([^\s:'"]+):(\S+)/g, replace: `$1$2:${MASK}` },
  // JSON-style secret fields: "password": "…", "api_key":"…"
  { pattern: /("(?:password|passwd|secret|token|api_?key|access_?token|client_?secret)"\s*:\s*)"[^"]*"/gi, replace: `$1"${MASK}"` },
  // Authorization-style headers: "Authorization: Bearer x", "x-api-key: x", "Cookie: x"
  { pattern: /\b(authorization|proxy-authorization|x-api-key|api-key|x-auth-token|cookie)(\s*:\s*)(?:(bearer|basic|token)\s+)?[^"'\n]+/gi, replace: (_match, name, separator, scheme) =>
      `${name}${separator}${scheme === undefined || scheme === '' ? '' : `${scheme} `}${MASK}` },
  // A bare "Bearer <token>" anywhere else.
  { pattern: /\b(bearer)\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi, replace: `$1 ${MASK}` },
  // Well-known token shapes.
  // Stripe secret and restricted keys: sk_live_…, rk_test_…
  { pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g, replace: MASK },
  // Google API keys.
  { pattern: /\bAIza[0-9A-Za-z_-]{35}/g, replace: MASK },
  // A key has digits; a branch name like feature/sk-add-user-avatar does not.
  { pattern: /\b(sk|pk|rk)-(?=[A-Za-z0-9_-]*\d)(?:[a-z]+-)?[A-Za-z0-9_-]{16,}/g, replace: MASK },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: MASK },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, replace: MASK },
  { pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: MASK },
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, replace: MASK },
  // NAME=value where the name says it is secret: API_KEY=…, export GITHUB_TOKEN="…"
  { pattern: new RegExp(`\\b(${SECRET_NAME})=${VALUE}`, 'gi'), replace: `$1=${MASK}` },
  // Flags that take a secret: --password x, --token=x, -p'x' is left alone (too ambiguous).
  { pattern: /(--(?:password|passwd|token|api-key|apikey|secret|auth|auth-token|access-token|client-secret))(=|\s+)("[^"]*"|'[^']*'|\S+)/gi, replace: `$1$2${MASK}` },
  // Last, being the widest: a secret-named key given a value, spaced or quoted. The name is
  // matched as one whole identifier and checked in code, which keeps the pattern linear.
  // `=` followed by `=` or `>` is a comparison or an arrow, not an assignment.
  { pattern: /(^|[^A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]+)\2([ \t]*)(:|=(?![=>]))([ \t]*)("[^"\n]*"|'[^'\n]*'|`[^`\n]*`|[^\s,;&|(){}[\]<>"'`=][^\s,;&|)}\]"'`]*)?/g, replace: assignedSecret },
]

/** Only this much of a command is ever redacted and shown; keeps the regexes cheap on huge inputs. */
export const REDACT_LIMIT = 1024

/**
 * Masks what looks like a secret in text shown on screen (a shell command, a query),
 * before it is shortened, so a cut can never leave half a token visible. Display only:
 * the tool call itself is never changed.
 */
export const redactSecrets = (text: string): string =>
  RULES.reduce(
    (redacted, rule) =>
      typeof rule.replace === 'string' ? redacted.replace(rule.pattern, rule.replace) : redacted.replace(rule.pattern, rule.replace),
    text,
  )

/**
 * Text that is safe and short enough for the HUD: cut to REDACT_LIMIT, secrets masked,
 * then shortened to `max`. Runs before a tool call starts, so it must stay cheap.
 */
export const safeDetail = (text: string, max?: number): string => shorten(redactSecrets(text.slice(0, REDACT_LIMIT)), max)
