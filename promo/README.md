# Mochi Crew promo

The promo video, made with [Remotion](https://www.remotion.dev). It draws Mochi, the crew and the
session meter with the plugin's own code (`sceneFor`, `meterRows`, the HUD helpers), imported
through `src/plugin.ts`, so the video always shows what the plugin really draws.

This folder is not part of the plugin: the marketplace installs `plugins/mochi-crew` only.

```bash
cd promo
npm ci
npm run studio      # preview and scrub in the browser
npm run render      # out/mochi-promo.mp4, 1920×1080, 28.5 s
npm run typecheck
```

Remotion ships its own ffmpeg and downloads its own headless browser on first use, and the two
Google Fonts (JetBrains Mono, Press Start 2P) load at render time, so rendering needs network. Remotion is free for individuals, non-profits and companies of up to 3 employees; larger companies need a
[company license](https://www.remotion.dev/license).

| Scene | Length | Shows |
|---|---|---|
| Intro | 4 s | Mochi dances in, the name types out |
| Session | 8.5 s | a real turn: read, edit, test, pass; Mochi acts each step out |
| Crew | 5 s | three subagents walk in as kittens with their HUD rows |
| Meter | 6 s | the session meter fills; the providers it understands |
| Outro | 5 s | the install commands from the README and the repository link |

Sounds are the plugin's own (`plugins/mochi-crew/sounds`).
