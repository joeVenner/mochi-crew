<div align="center">

<img src="docs/images/hero.png" alt="Mochi the pixel cat at home, with three kitten crewmates in role costumes" width="640">

# Mochi Crew

<sub><i>Mochi means "my cat" in Moroccan Darija.</i></sub>

**A pixel-art cat that lives in your Claude Code side pane and reacts to what your session is really doing.**

Mochi types when Claude edits, grabs a hammer when a command runs, thinks along while Claude works,
and waves when it's your turn. Subagents join as a crew of kittens in role costumes. Fixed bugs,
green tests and shipped turns earn XP, missions and badges. A session meter under the HUD shows
your model, context fill, prompt-cache hit rate, and plan limits or cost, and a file tree shows
where in the project Claude is working. With many sessions open, the session badge gives each
session its own place for Mochi's desk, color for its Terminal tab and emoji in its title.

[Install](#install) · [What it does](#what-it-does) · [The crew](#the-crew) · [Session meter](#session-meter) · [File tree](#file-tree) · [Session badge](#session-badge) · [Controls](#controls) · [Privacy](#privacy-and-safety) · [Development](#development)

</div>

---

## Install

In Claude Code:

```
/plugin marketplace add joeVenner/mochi-crew
/plugin install mochi-crew@mochi-crew
```

Or from a shell:

```bash
claude plugin marketplace add joeVenner/mochi-crew
claude plugin install mochi-crew@mochi-crew
```

The pane opens on its own when a session starts. Run `/mascot` to open it again.

### Updating

New releases bump the plugin's version. To pick one up:

```
/plugin marketplace update mochi-crew
```

Or turn on auto-update once: open `/plugin`, go to **Marketplaces**, select `mochi-crew`, and choose
**Enable auto-update**. If an install from inside a session fails on a machine without a GitHub SSH
key, set `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and try again.

> **Tip:** Mochi is drawn with half-block pixels. If your terminal adds extra line spacing,
> setting it to `1.0` keeps the pixel art solid.

## What it does

Everything Mochi does comes from a real event in your session. Nothing is random or simulated.

<img src="docs/images/moments.png" alt="Mochi typing at the desk, thinking, waving that it's your turn, facing a bug, and celebrating a finished edit" width="100%">

| You see | When |
|---|---|
| Mochi walks to the desk and types while code races on the monitor | Claude runs `Edit`, `Write` or `NotebookEdit` |
| A jump with a green check and confetti, or a red cross | the edit succeeds or fails |
| A hammer, or a magnifier for read-only commands (`rg`, `ls`, `git status`) | `Bash` |
| A magnifier or an antenna | `Read`, or `WebSearch` / `WebFetch` and MCP tools (`calling Figma · get screenshot`) |
| A thought cloud (Mochi never naps mid-turn) | Claude is working on your prompt |
| A wave and a "!" bubble, and `Your turn · took 42s` | Claude hands the turn back |
| A purple bug scuttles in; the next passing command squashes it | a `Bash` command fails |
| A kitten walks in wearing its role costume and shows what it is doing | Claude starts a subagent |
| The real sky out the window: dawn, day, dusk, night | always, by your local time |

### A life between tasks

When nothing is happening, Mochi lives a little: looks around, strolls, sips coffee, reads,
stretches, yawns, and eventually naps. Each routine plays as a short scene on a slow beat, so it
feels alive without being distracting.

<img src="docs/images/idle.png" alt="Mochi looking around, sipping coffee, reading, stretching, yawning and sleeping" width="100%">

## The crew

Every subagent joins as a kitten in a costume picked from its type. Its HUD row shows the call it
is running right now (`run npm test`, `look notes.md`, `edit app.ts`), or `thinking` between calls.

<img src="docs/images/crew.png" alt="Kittens in police, SWAT, lab, detective, architect, librarian, coder and builder costumes" width="100%">

| Type contains | Tag | Costume |
|---|---|---|
| security | `SEC` | SWAT helmet, visor, shield |
| review, verif, audit, lint | `AUD` | police cap and badge, clipboard |
| test | `TST` | goggles, lab coat, bubbling test tube |
| explore, search, research | `EXP` | deerstalker, trench coat, magnifier |
| plan, architect, design | `ARC` | hard hat, unrolling blueprint |
| guide, doc | `DOC` | bun, half-moon glasses, book |
| general, code, dev, engineer | `DEV` | glasses, tie, laptop |
| anything else | `WRK` | hard hat in its own color, hammer |

## The HUD

A quiet instrument panel under the room: dim labels, aligned numbers, thin bars in your theme's
accent color, and red or green only when something needs you.

```
▍ idle · reading
──────────────────────────────────────────
level     6  ━━━━━━━━━━━━━━━━━━━━━━━━  47/100
mood     90  ━━━━━━━━━━━━━━━━━━━━━━━━
energy   68  ━━━━━━━━━━━━━━━━━━━━━━━━
streak   x8  badges 4/6
──────────────────────────────────────────
next    Get the tests green  0/4
log     3 files · 5 turns · 4m 12s working
──────────────────────────────────────────
model   opus 5.5  plan
context  62  ━━━━━━━━━━━━━━━━━━━━━━━━  620k/1M
cache   91%  idle 2m
5h       34  ━━━━━━━━━━━━━━━━━━━━━━━━  7d 12%
p: pet  f: feed  d: dance  o: outfit  s: sound
```

In a short pane it folds into a compact layout, so the controls never scroll away. The meter
becomes one line there: `meter   ctx 62% · cache 91% · 5h 34%`.

### Progress that means something

XP rewards progress, not keystrokes:

| Event | XP |
|---|---|
| A clean edit | 10, plus a streak bonus up to 10 |
| Editing a file already edited this turn | 3, and the streak holds |
| The turn's first passing test run (also a subagent's) | 10, once per turn |
| A turn that changed something and ended in an answer | 10 |
| Squashing a bug (a failed command that later passes) | 15 |
| Hiring a subagent | 5 |
| Each session mission | 20 |

A test run only counts when the suite really ran and passed: `npm test || true`, `npm test | tee log`
and `pytest --collect-only` don't.

**Missions** (once per session): get the tests green, ship 3 turns, fix a failing command, delegate
to a subagent. **Badges** (kept across sessions): First Hire, Full Crew, On Fire, Night Owl,
Bug Squasher, Veteran.

## Session meter

The last group of the HUD reads your session the way your provider means it. It appears after
Claude's first reply.

| Row | Meaning |
|---|---|
| `model   opus 5.5  plan` | the session's model, shortened from any provider's id, and who serves it (`plan`, `api key`, `bedrock`, `vertex`, `foundry`, `gateway`) |
| `context  62  ━━━  620k/1M` | context used against the model's window. It turns red from 85%, where auto-compact is close, and reads `–` right after a compact |
| `cache   91%  idle 2m` | share of the main conversation's input served from the prompt cache (subagents keep caches of their own and are left out). `cold` shows only once the cache has certainly expired |
| `5h  34  ━━━  7d 12%` | on a Claude plan: the fullest usage window as a bar, the others as a note |
| `cost    $4.12 est` | on per-token billing (API key, Bedrock, Vertex, Foundry): the list-price estimate |

A toast appears once when context reaches 80% or 90%, when a plan or spend window reaches 80% or
95%, or when prompt caching is never reported after three turns. That last one usually means a
gateway is stripping `cache_control`, so every turn bills as uncached input. A toast fires again only
after the figure falls 5 points below its line.

`/mascot meter` prints the full report: every figure, token totals, and notes for your provider.

| | Plan | API key | Bedrock | Vertex | Microsoft Foundry | Gateway |
|---|---|---|---|---|---|---|
| Limit row | 5h and 7d | none | none | none | none (Azure quotas are per minute) | spend limit, if set |
| Cost | not billed (only in `/mascot meter`) | estimate; the Console is the bill | estimate; AWS bills | estimate; Google bills | estimate; Azure bills (CCU) | estimate |
| Default cache TTL | 1h (5m on usage credits) | 5m | 5m (1h varies by model) | 5m | 5m | depends on the gateway |

How the provider is detected: a `CLAUDE_CODE_USE_BEDROCK`, `_MANTLE`, `_VERTEX`, `_FOUNDRY` or
`_ANTHROPIC_AWS` flag set to `1`, `true`, `yes` or `on` comes first. A gateway spend-limit window
comes next, then 5h/7d plan windows, which mark a plan even behind a proxy. After that, a
non-Anthropic `ANTHROPIC_BASE_URL` marks a gateway and an API key marks Console billing. A sign-in
whose plan windows haven't arrived yet shows no dollars. On Foundry, Claude Code assumes a 200K window
for a deployment name it can't map to a model, and `/mascot meter` points that out.

Sources, as of October 2026: Claude Code's docs on
[prompt caching](https://code.claude.com/docs/en/prompt-caching),
[costs](https://code.claude.com/docs/en/costs),
[Microsoft Foundry](https://code.claude.com/docs/en/microsoft-foundry) and
[environment variables](https://code.claude.com/docs/en/env-vars); Microsoft Learn on
[Claude in Foundry](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models)
and [its quotas](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models-quotas-limits);
AWS on [Bedrock prompt caching](https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html).

## File tree

The bottom of the HUD shows the project as a tree, focused on this session's work: only the
folders that lead to files Claude edited are open, and the rest stay closed. Each folder lists the
edited files, and the folders holding them, first, so the session's work stays in view even in a
short pane.

```
──────────────────────────────────────────
files   mochi-crew  feat/file-tree
▸ docs
▾ plugins
  ▾ mochi-crew
    ▾ hooks
        editor.ts                 ?
      ● fileTree.ts          +12 M
      · register.tsx         +40 M
p: pet  f: feed  d: dance  o: outfit  s: sound  t: files
```

- `●` in the accent color is the file Claude is editing or reading now. It pulses while the turn
  runs.
- `·` marks files edited earlier in the session. A file a subagent edited is drawn in its kitten's
  hard-hat color.
- Badges come from git: `M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked, and
  `+N` lines added since the last commit (untracked files have no count). A folder shows its
  totals, such as `+52 M:2`. Files inside a folder git has never seen get no badge until one of
  them is added, so a large vendored folder costs nothing.
- **Click a folder to open or close it.** Your choice holds for the session, except that a
  new edit inside a folder you closed opens it again, so fresh work is never hidden.
- **Click a file to open it in your editor.** `$VISUAL` or `$EDITOR` is used when it names a
  windowed editor (VS Code, Cursor, Windsurf, Zed, Sublime, JetBrains). Otherwise it opens in VS
  Code: with `code`, or on macOS the VS Code app itself when `code` isn't on your PATH. On
  Windows, VS Code's `code.cmd` needs a shell, so Mochi runs what it runs, `Code.exe` on its
  CLI script, directly. Without VS Code, macOS's default text editor opens it. A file is
  never handed to the system opener, which could run it (a `.command` file, say). Terminal
  editors such as vim are never started, since the pane has no terminal to give them.

**Worktrees.** The repository's other git worktrees show as sections of their own under the
project: a subagent's under `.claude/worktrees/`, or one you added beside the repo with
`git worktree add ../x`. Each is one row with its branch and git's totals, read in that worktree:

```
▸ agent-a18f4a8f  fix/learn-mods-launch  +40 M:3
▾ ui  feat/console-surface               +12 M:1
  ▾ src
    ● panel.tsx                          +12 M
```

A section opens when Claude or a subagent edits a file in it, and you can open or close one
with a click. Its files appear there, not deep under `.claude/worktrees/` in the project. Up to 8
worktrees are shown. A closed section costs one `git status`, while an open one is read like the
project itself.

The tree takes only the rows the rest of the HUD leaves. In a short pane it folds into one line,
such as `files   editing hooks/fileTree.ts`. Turn it off with `t`, the `files` button, or
`/mascot files off`.

## Session badge

With several sessions open, each one gets its own color and place, so you can pick the right one
at a glance:

- **Place.** Mochi's desk stands somewhere different in each session: the house, a mountain, the
  gym, a forest, the beach, the desert, a space station or a library. The window shows the place
  (with your local sky), a prop stands in the bookshelf's spot when the pane is wide enough for
  one, and the floor takes the place's color. This works in every terminal, Windows Terminal included. Each place goes with one color:

  | Color | Place | | Color | Place |
  |---|---|---|---|---|
  | 🟣 plum | space | | 🟠 rust | desert |
  | 🔵 harbor | beach | | 🟡 moss | mountain |
  | 🟢 pine | forest | | 🟤 walnut | library |
  | 🔴 claret | house | | ⚫ graphite | gym |

  <img src="docs/images/places.png" alt="Mochi's desk in each place: house, mountain, gym, forest, beach, desert, space and library" width="100%">

- **Tab tint.** In macOS Terminal.app the session's tab gets a dark background from eight colors
  (plum, harbor, pine, claret, rust, moss, walnut, graphite). Mochi picks the color the fewest other
  open tabs wear, and a session keeps its color through `/clear` and `/resume`. When the session
  ends, Mochi re-applies the tab's profile (which also undoes other changes made to that tab), unless
  you recolored it yourself meanwhile. Over ssh, Mochi leaves your tabs alone.
- **Emoji title.** The tab title leads with the matching emoji: `✳ 🟣 SEO hub pages`. The topic is
  the one Claude Code generates from your first message, so it appears from your second prompt.
  Claude Code writes that topic once; change it with `/rename` or `/mochi badge title`. A
  `/rename` always wins and Mochi only adds the emoji.

The place and the title work in any terminal; the tint needs Terminal.app, as no other terminal
lets a plugin recolor an open tab. The first time, macOS may ask to let Claude Code control
Terminal: allow it for the tint. The emoji reaches the tab only while
`terminalTitleFromRename` is on, which is Claude Code's default. Turn the badge off for good with
`/mochi badge off`, which also brings Mochi back to the house.

## Controls

Focus the pane (`ctrl+x tab`, or click it) and press:

| Key | Action |
|---|---|
| `p` | pet (hearts float up) |
| `f` | feed (a fish, caught mid-air) |
| `d` | dance |
| `o` | next outfit |
| `s` | sound on or off |
| `t` | file tree on or off |
| `b` | next place for Mochi's desk (the session's color comes with it) |

Commands:

```
/mascot                        open the pane (/mochi works too, for every command below)
/mascot pet | feed | dance     interact without focusing the pane
/mascot journal                this session: turns and time, edits, commands, fixes, files
/mascot missions               this session's goals and progress
/mascot achievements           badges earned and how to earn the rest
/mascot meter                  the session meter in full, with notes for your provider
/mascot files [on|off]         show or hide the file tree (on by default)
/mascot badge                  this session's color and title
/mascot badge on|off           tint the tab and add the emoji title, or stop (on by default)
/mascot badge color <name>     plum, harbor, pine, claret, rust, moss, walnut, graphite
/mascot place [<name>]         list the places, or move Mochi (its color comes with it)
/mascot place next             the next place, as the pane's b key does
/mascot badge title <text>     pin this session's title; /mascot badge auto follows the topic again
/mascot outfits                list outfits
/mascot outfit <name>          classic, wizard, pirate, party, shades, crown
/mascot sound on|off           8-bit sound effects (off by default)
```

<img src="docs/images/outfits.png" alt="Mochi in the classic, wizard, pirate, party, shades and crown outfits" width="100%">

## Privacy and safety

- **Local only.** The mod makes no network requests. The session badge's title is handed to Claude
  Code the way a `/rename` is, and Claude Code handles it like any session name. The session
  meter reads figures Claude Code already has, plus the provider-selection and cache-TTL environment
  variables by name. It asks only whether the session uses a key or a sign-in, never for the
  credential itself.
- **Local commands, no shell.** The file tree lists folders on the way to edited files and runs
  `git status`, `git diff --numstat`, `git branch` and `git worktree list` in the project (and
  `git status` and `git diff` in its worktrees), without taking git's index lock and with the
  repository's fsmonitor command turned off. File and branch names are drawn with control
  characters masked. Clicking a file runs your editor with that file's path. Commands run by
  argument list, never through a shell, and only for files that resolve inside the project or
  inside a worktree git lists for it. The session badge runs `ps` to find this session's tab,
  `osascript` to read and set Terminal.app tab colors (with every value passed as an argument,
  never as script text), and `grep` to read Claude Code's topic from the session transcript (on
  Windows, which has no `grep`, it reads that file instead). Titles it sets are drawn from that
  topic or your own words, with control characters removed.
- **Secrets are masked on screen.** Commands shown in the HUD have tokens, auth headers, URL
  credentials and secret-looking env vars or flags replaced with `••••`. This affects the display
  only; your commands run unchanged.
- **Never in the way.** Every hook passes the tool call through untouched, even if Mochi's own
  bookkeeping fails, and all scoring happens after the result is already on its way back.
- **What is saved.** Level, XP, outfit, sound setting, the file tree switch, mood, energy and
  badges persist in Claude Code's per-plugin store. So do the session badge switch and, for the 300
  most recent sessions, each one's color, a title you pinned and the last few titles Mochi set,
  which include Claude Code's topic for that session. The session journal, missions, meter and the
  tree's touched files reset every session.

## Development

```bash
cd plugins/mochi-crew
claude plugin validate .   # manifest and hooks
claude plugin test .       # the test suite
```

Type-checking (`npx -y -p typescript@5.6.3 tsc -p .`) uses the engine type definitions that Claude
Code writes to `.claude-plugin/types/` when it loads the plugin, so load it once (install it, or
start Claude Code with `--plugin-dir plugins/mochi-crew`) before running `tsc`.

The promo video lives in [`promo/`](promo/README.md), a Remotion project that draws Mochi with the
plugin's own renderer, plus a cover still (`npm run thumbnail`). It is not part of what the
marketplace installs.

### Releasing

This repository is itself a Claude Code plugin marketplace: `.claude-plugin/marketplace.json` at the
root lists the plugin in `plugins/mochi-crew`. Users keep a cached copy and receive a new one only
when the plugin's version changes, so for every release:

1. Bump `version` in `plugins/mochi-crew/.claude-plugin/plugin.json` (the only place it is set).
2. Run `claude plugin validate .` from the repository root.
3. Merge to `main`. Users get it with `/plugin marketplace update mochi-crew`, or automatically if
   they turned on auto-update.

The logic is pure and unit-tested in `hooks/*.ts`. `hooks/register.tsx` only wires engine events,
state and the pane.

| File | Responsibility |
|---|---|
| `register.tsx` | hooks, state, animation ticker, pane and HUD, session meter and file tree wiring |
| `canvas.ts` · `world.ts` · `sprite.ts` · `workerArt.ts` | pixel canvas, the room and its places, Mochi, the kittens |
| `behavior.ts` | walking, idle routines, sleep |
| `crew.ts` · `roles.ts` | subagent workers and their costumes |
| `turn.ts` · `progress.ts` · `game.ts` | turns, fair per-turn XP, levels |
| `journal.ts` · `missions.ts` · `achievements.ts` | session journal, missions, badges |
| `care.ts` · `events.ts` | mood and reactions, bugs and quips |
| `hud.ts` · `mascot.ts` · `redact.ts` | HUD layout, labels, secret masking |
| `fileTree.ts` · `editor.ts` | file tree: git parsing, the focused tree and its window; the editor launcher |
| `meter.ts` · `meterRows.ts` · `meterAlerts.ts` · `meterReport.ts` | session meter: provider detection and figures, HUD rows, alerts, `/mascot meter` |
| `badge.ts` · `badgePalette.ts` · `badgeTitle.ts` · `badgeTty.ts` · `badgeTerminal.ts` · `badgeRecords.ts` · `badgeCommand.ts` | session badge: lifecycle, colors, titles, finding the tab, Terminal.app, saved records, `/mascot badge` |

## License

[MIT](LICENSE) © joeVenner

Mochi Crew is an independent community project. It is not affiliated with or endorsed by Anthropic.
Claude and Claude Code are trademarks of Anthropic.
