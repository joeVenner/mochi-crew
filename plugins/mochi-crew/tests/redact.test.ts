import { describe, expect, test } from 'claude-code/testing'

import { MASK, REDACT_LIMIT, redactSecrets, safeDetail } from '../hooks/redact'

// Dummy, non-functional credentials only.
const CASES: ReadonlyArray<readonly [string, string, string]> = [
  ['bearer header', 'curl -H "Authorization: Bearer abc123def456ghi" https://api.example.com', `curl -H "Authorization: Bearer ${MASK}" https://api.example.com`],
  ['api key header', "curl -H 'x-api-key: test-key-000111' https://x.dev", `curl -H 'x-api-key: ${MASK}' https://x.dev`],
  ['url credentials', 'git clone https://user:hunter2@example.com/repo.git', `git clone https://${MASK}@example.com/repo.git`],
  ['env assignment', 'API_KEY=sk-test-123456789abcdefgh npm start', `API_KEY=${MASK} npm start`],
  ['quoted export', 'export GITHUB_TOKEN="ghp_dummyDummyDummyDummy1234"', `export GITHUB_TOKEN=${MASK}`],
  ['flag with space', 'mysql --password s3cretpw -u root', `mysql --password ${MASK} -u root`],
  ['flag with equals', 'deploy --token=abcdef123456', `deploy --token=${MASK}`],
  ['bare openai-style key', 'echo sk-test-123456789abcdefgh', `echo ${MASK}`],
  ['github token', 'gh auth login --with-token ghp_dummyDummyDummyDummy1234', `gh auth login --with-token ${MASK}`],
  ['aws key id', 'aws configure set aws_access_key_id AKIAABCDEFGHIJKLMNOP', `aws configure set aws_access_key_id ${MASK}`],
  ['cookie with several pairs', 'curl -H "Cookie: a=1; b=secret2" https://x', `curl -H "Cookie: ${MASK}" https://x`],
  ['digest header', 'curl -H "Authorization: Digest user=x response=abc" https://x', `curl -H "Authorization: ${MASK}" https://x`],
  ['password containing @', 'psql postgres://u:p@ss@host/db', `psql postgres://${MASK}@host/db`],
  ['curl -u', 'curl -u admin:hunter2 https://x', `curl -u admin:${MASK} https://x`],
  ['json password', `curl -d '{"user":"a","password":"abc"}' https://x`, `curl -d '{"user":"a","password":"${MASK}"}' https://x`],
  ['jwt', 'curl -d eyJhbGciOiJI.eyJzdWIiOiIx.SflKxwRJSMeKKF2Q', `curl -d ${MASK}`],
  ['stripe secret key', 'stripe login --api-key sk_live_1234567890abcdef', `stripe login --api-key ${MASK}`],
  ['stripe restricted key', 'const key = rk_test_1234567890abcdef', `const key = ${MASK}`],
  ['google api key', 'const maps = new Maps("AIzaSyA-dummyDummyDummyDummyDummy123456")', `const maps = new Maps("${MASK}")`],
  ['yaml password', 'password: hunter2', `password: ${MASK}`],
  ['indented yaml key in a diff', '+  db_password: hunter2 # prod', `+  db_password: ${MASK} # prod`],
  ['yaml list item', '- auth_token: abc123', `- auth_token: ${MASK}`],
  ['quoted yaml value', "  client_secret: 'abc def'", `  client_secret: '${MASK}'`],
  ['spaced assignment', 'const apiKey = "abc123"', `const apiKey = "${MASK}"`],
  ['unquoted spaced assignment', 'aws_secret_access_key = wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY', `aws_secret_access_key = ${MASK}`],
  ['quoted name and value', `{"api_key" : 'abc123'}`, `{"api_key" : '${MASK}'}`],
  ['object literal key', "connect({ password: 'pa55word' })", `connect({ password: '${MASK}' })`],
  ['password mid-sentence', 'I set password: hunter2 in the config', `I set password: ${MASK} in the config`],
  ['backticked password', 'use `db_password: hunter2` there', `use \`db_password: ${MASK}\` there`],
  ['token at the end of a joined reply', 'Done. The new token: abc123', `Done. The new token: ${MASK}`],
]

describe('redact', () => {
  for (const [name, input, expected] of CASES) {
    test(`masks a ${name}`, async () => {
      expect(redactSecrets(input)).toBe(expected)
    })
  }

  test('ordinary commands pass through unchanged', async () => {
    for (const command of ['git checkout feature/sk-add-user-avatar-upload', 'echo bearer authentication', 'npm test', 'git log --oneline -5', 'rg "token" src', 'ls ~/.ssh', 'git show 3f2a9c1d8e7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f', 'cat package.json', 'echo $HOME']) {
      expect(redactSecrets(command)).toBe(command)
    }
  })

  test('code that only names a secret passes through unchanged', async () => {
    for (const code of [
      'apiKey: string;', '  token: Token;', 'readonly password: string', 'if (token === undefined) return', 'const ok = token == other',
      'const onToken = (token) => token', 'const apiKey = process.env.API_KEY', 'password = getPassword()', 'author: "Ada"', 'primaryKey: true',
      'keys = [1, 2]', 'const token = null', 'connect({ password, user })', 'function f(token: Token) {}', 'the api key: sortKey in tables',
      'set the authMode: strict here',
    ]) {
      expect(redactSecrets(code)).toBe(code)
    }
  })

  test('a long line of names and separators is redacted fast', async () => {
    for (const huge of ['token.'.repeat(1_000), 'a_key '.repeat(1_000), `password:${' '.repeat(5_000)}`, '"a"'.repeat(2_000), 'key=key='.repeat(1_000)]) {
      const started = Date.now()
      redactSecrets(huge)
      expect(Date.now() - started).toBeLessThan(50)
    }
  })

  test('a huge command is redacted fast (it runs before the tool call)', async () => {
    for (const huge of ['a'.repeat(200_000), 'KEY'.repeat(70_000), 'QUJD'.repeat(50_000), `https://${'x'.repeat(200_000)}`]) {
      const started = Date.now()
      const shown = safeDetail(huge)
      expect(Date.now() - started).toBeLessThan(50)
      expect(shown.length).toBeLessThanOrEqual(28)
    }
    expect(REDACT_LIMIT).toBeLessThanOrEqual(2048)
  })

  test('safeDetail masks before shortening', async () => {
    expect(safeDetail('GITHUB_TOKEN=ghp_dummyDummyDummyDummy1234 gh pr list')).toBe(`GITHUB_TOKEN=${MASK} gh pr list`)
  })

  test('nothing secret survives shortening for the HUD', async () => {
    const shown = redactSecrets('curl -H "Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789" https://x').slice(0, 30)
    expect(shown).not.toContain('abcdef')
  })
})
