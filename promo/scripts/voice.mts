/**
 * Generates the voice-over with OpenAI's text-to-speech: one MP3 per scene in public/voice/.
 *
 * Reads the key from OPENAI_API_KEY only; never pass it as an argument or write it anywhere.
 * A line is regenerated only when its text, the voice, the model or the direction changed,
 * tracked by a hash in public/voice/manifest.json, so a re-run costs nothing.
 *
 * Run with: npm run voice
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SceneId } from '../src/narration.ts'
import { NARRATION, VOICE, VOICE_INSTRUCTIONS, VOICE_MODEL, voiceFile } from '../src/narration.ts'

const SPEECH_URL = 'https://api.openai.com/v1/audio/speech'
const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')
const MANIFEST_PATH = join(PUBLIC_DIR, 'voice', 'manifest.json')

type Manifest = Partial<Record<SceneId, string>>

const readManifest = (): Manifest => {
  if (!existsSync(MANIFEST_PATH)) return {}
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest
}

const fingerprint = (text: string): string =>
  createHash('sha256').update(JSON.stringify([VOICE_MODEL, VOICE, VOICE_INSTRUCTIONS, text])).digest('hex').slice(0, 16)

const speak = async (apiKey: string, text: string): Promise<Uint8Array> => {
  const response = await fetch(SPEECH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: VOICE_MODEL, voice: VOICE, input: text, instructions: VOICE_INSTRUCTIONS, response_format: 'mp3' }),
  })
  if (!response.ok) {
    // The body carries OpenAI's error message, never the key.
    throw new Error(`speech request failed: ${response.status} ${await response.text()}`)
  }
  return new Uint8Array(await response.arrayBuffer())
}

const main = async (): Promise<void> => {
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey === undefined || apiKey === '') throw new Error('OPENAI_API_KEY is not set')
  const manifest = readManifest()
  for (const scene of Object.keys(NARRATION) as SceneId[]) {
    const text = NARRATION[scene]
    const hash = fingerprint(text)
    const path = join(PUBLIC_DIR, voiceFile(scene))
    if (manifest[scene] === hash && existsSync(path)) {
      console.log(`${scene}: unchanged`)
      continue
    }
    writeFileSync(path, await speak(apiKey, text))
    manifest[scene] = hash
    // Saved after every line, so a failure part-way keeps what was already paid for.
    writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`${scene}: generated`)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
