/**
 * The voice-over: one line per scene, spoken by OpenAI's text-to-speech. `npm run voice` turns
 * these into `public/voice/<scene>.mp3`; the video sizes each scene to fit its line.
 * Change a line here, run `npm run voice` again, and only that line is regenerated.
 */

export type SceneId = 'intro' | 'session' | 'crew' | 'meter' | 'outro'

export const NARRATION: Readonly<Record<SceneId, string>> = {
  intro: 'Meet Mochi. A pixel cat that lives right in your Claude Code side pane.',
  session: 'Every move comes from your real session. Claude reads, Mochi grabs the magnifier. Claude edits, Mochi types. Tests pass? Confetti.',
  crew: 'Start a subagent, and a kitten walks in, dressed for the job.',
  meter: 'And a built-in meter keeps an eye on your model, context, cache, and plan limits. On any provider.',
  outro: 'Mochi Crew. Free, open source, and one command away.',
}

/** The pinned model snapshot, so a regenerated line sounds like the others. */
export const VOICE_MODEL = 'gpt-4o-mini-tts-2025-12-15'
export const VOICE = 'coral'

/** How the lines are delivered: the model follows this as a direction to the speaker. */
export const VOICE_INSTRUCTIONS = [
  'Voice: warm, bright and playful, like a friendly game trailer narrator.',
  'Tone: cozy and delighted, with a smile in the voice; never salesy.',
  'Pacing: lively but clear, with short natural pauses at full stops.',
  'Emphasis: light lift on "Mochi", "Confetti" and "one command away".',
].join(' ')

/** Where each line's audio lives, relative to `public/`. */
export const voiceFile = (scene: SceneId): string => `voice/${scene}.mp3`
