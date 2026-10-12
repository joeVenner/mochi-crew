# Mochi Crew promo

The promo video, made with [Remotion](https://www.remotion.dev). It draws Mochi, the crew, the
session meter and the file tree with the plugin's own code (`sceneFor`, `meterRows`, `treeRows`, the HUD helpers), imported
through `src/plugin.ts`, so the video always shows what the plugin really draws.

This folder is not part of the plugin: the marketplace installs `plugins/mochi-crew` only.

```bash
cd promo
npm ci
npm run studio      # preview and scrub in the browser
npm run voice       # regenerate changed voice lines (needs OPENAI_API_KEY)
npm run render      # out/mochi-promo.mp4, 1920×1080, about 51 s
npm run thumbnail   # out/thumbnail.png, the video's 1920×1080 cover
npm run typecheck
```

Remotion ships its own ffmpeg and downloads its own headless browser on first use, and the two
Google Fonts (JetBrains Mono, Press Start 2P) load at render time, so rendering needs network. Remotion is free for individuals, non-profits and companies of up to 3 employees; larger companies need a
[company license](https://www.remotion.dev/license).

## Voice-over

The narration is one line per scene in `src/narration.ts`, spoken by OpenAI's
`gpt-4o-mini-tts-2025-12-15` (voice `coral`, with a delivery direction). `npm run voice` writes
`public/voice/<scene>.mp3` and regenerates only lines whose text, voice or direction changed. The
MP3s are committed, so rendering needs no key. Each scene lasts as long as its line needs, and the
Session beats land on the words that name them. The outro says the voice is AI-generated, as
OpenAI's usage policies require.

The script reads the key only from `OPENAI_API_KEY`. With the key in the macOS Keychain:

```bash
OPENAI_API_KEY="$(security find-generic-password -s com.aiagent.apikey.openai -a default -w)" npm run voice
```

| Scene | Minimum | Shows |
|---|---|---|
| Intro | 4 s | Mochi dances in, the name types out |
| Session | 8.5 s | a real turn: read, edit, test, pass; Mochi acts each step out |
| Crew | 5 s | three subagents walk in as kittens with their HUD rows |
| Meter | 6 s | the session meter fills; the providers it understands |
| Files | 8 s | the file tree opens where Claude works, badges land, a click opens the file in an editor |
| Outro | 5 s | the install commands from the README and the repository link |

Sounds are the plugin's own (`plugins/mochi-crew/sounds`).
