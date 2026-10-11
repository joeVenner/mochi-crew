import { shorten } from './mascot'

/** What a hidden value shows as. */
export const MASK = '••••'

/** A rule: what to find, and how to rewrite it with the secret part masked. */
type Rule = { pattern: RegExp; replace: string | ((match: string, ...groups: string[]) => string) }

const SECRET_NAME = '[A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|PWD|AUTH|CREDENTIALS?|COOKIE|SESSION)[A-Za-z0-9_]*'
const VALUE = `(?:"[^"]*"|'[^']*'|[^\\s;&|]+)`

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
