# Changelog

All notable changes to Mochi Crew are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.8.0] - 2026-10-27

### Added

- Mochi Tutor: press `q` in the pane (or run `/mochi tutor`) for a quiz tab where Mochi asks you
  about this project and Claude's recent changes, so you understand the code you ship. Pick recent
  changes, the last turn or the big picture. Rounds mix multiple-choice questions, with a reason for
  every option, and questions you answer in your own words and get checked, plus hints, up to two
  follow-up questions each, and a summary that says what to read next. Missed questions come back
  in later rounds, answers earn Mochi's XP, and a tutor level adapts per project. A round reuses
  the session's own conversation while Claude is working or within 5 minutes of its last reply,
  when the prompt cache is surely warm; otherwise a capped digest goes to `tutorModel` (haiku by
  default, or sonnet or opus). `tutorContext` (`auto`, `digest` or `session`) changes that in
  `/config`. `/mochi tutor start`, `digest`, `review`, `stop` and `reset` work from the prompt.

### Changed

- Privacy: the tutor is the first feature that sends data to a model. It runs only when you press,
  and a first-use notice says what a round sends: all uncommitted changes in the folder, removed
  lines included, with Claude's files first. One yes covers every project, `/mochi tutor reset`
  takes it back along with the project's progress, and the notice asks again when an update
  changes what it describes. The README's Privacy section says exactly what is sent.
- The HUD's secret masking also covers spaced and YAML `name: value` secrets, `name = value`
  assignments, and Stripe and Google keys. File and branch names in the tree, and tutor text, have
  zero-width, direction-mark and tag characters replaced as well as control characters.

### Security

- Tutor digests never diff or read files meant for secrets: `.env*`, keys, certificates and key
  stores, secret- and credential-named files, Terraform state and variables, `.npmrc`, `.netrc`,
  `.pgpass`, `.pypirc`, Docker and Kubernetes logins, `.aws/`, `.ssh/`, `.gnupg/` and more, plus lock
  and minified files. Changes are listed first with rename and copy detection, and only paths whose
  old and new names both pass are diffed, by literal path, so `git mv .env notes.txt` stays out. A
  new file is read only when it is a regular file, not a link, at most 200 KB and inside the
  project. Tutor git output is capped at 1 MB, and diff prefixes are fixed whatever your git
  config says.
- Everything Mochi adds to a request, typed answers included, has private-key blocks removed and
  common secret patterns masked, diff lines and file names too. Masking works by pattern and can
  miss an unusual secret. The digest, grading and follow-ups never include tool output or command
  text, and model replies are drawn as plain text with control and invisible characters replaced.

## [1.7.0] - 2026-10-22

### Added

- A `place` button in the pane, beside `outfit`: press `b` (or click it) to move Mochi to the
  next place, and the session's color follows. `/mochi place next` does the same from the prompt.
  With the badge off it says so and changes nothing.

## [1.6.0] - 2026-10-22

### Added

- Places for the session badge: Mochi's desk now stands somewhere different in each session, the
  house, a mountain, the gym, a forest, the beach, the desert, a space station or a library. The
  window shows the place under your local sky (space keeps its stars), a prop stands in the
  bookshelf's spot and the floor line takes the place's color. Each place goes with one badge color,
  so the pane tells sessions apart in every terminal, Windows Terminal included. `/mochi place`
  lists them and `/mochi place <name>` moves Mochi; color names and place names both work in
  `/mochi badge color`.

### Changed

- Outside Terminal.app, `/mochi badge color` and `on` now say that tab colors need macOS
  Terminal.app and that Mochi's place and the title show the color, instead of reporting a tab
  that could not be painted.

## [1.5.2] - 2026-10-22

### Fixed

- After `/restart`, `/mochi badge color` and `on` said no Terminal.app tab could be painted, and
  the tab no longer followed color changes. `/restart` ends the session and then carries it on in
  the same process, and the badge kept treating it as ended. A prompt, a command or a new start now
  brings it back.

## [1.5.1] - 2026-10-22

### Fixed

- The session badge's emoji title now shows on Windows. It looked for the topic only in
  `/`-rooted transcript paths and with `grep`, so a Windows session never got one; it now accepts
  `C:\` paths and reads the transcript file where `grep` is missing.

## [1.5.0] - 2026-10-21

### Added

- A session badge, so you can tell many sessions apart. In macOS Terminal.app each session's tab
  gets its own dark tint, picked as the color the fewest other open tabs wear, and kept through
  `/clear` and `/resume`; the tab goes back to its profile when the session ends. In any
  terminal, the tab title leads with the matching color emoji in front of Claude Code's topic, and
  a `/rename` keeps its words. `/mochi badge` shows the color and title, `color <name>`, `title
  <text>` and `auto` change them, and `on|off` switches the badge for good (on by default).

## [1.4.0] - 2026-10-16

### Added

- The file tree shows the repository's other git worktrees as sections of their own, each with
  its branch and git's badges read in that worktree. A subagent's edits in its worktree land there,
  not deep under `.claude/worktrees/`, and a worktree beside the repo (`git worktree add ../x`) is
  no longer left out. A section opens when work happens in it, or with a click.

## [1.3.0] - 2026-10-15

### Added

- Click a folder in the file tree to open or close it. The choice holds for the session; a new
  edit inside a closed folder opens it again.

### Changed

- Clicking a file in the tree opens VS Code even when its `code` command isn't on PATH: on macOS
  through the VS Code app, before falling back to the default text editor. On Windows, where
  `code` is a `.cmd` script that can't run without a shell, Mochi reads the script and runs
  `Code.exe` on VS Code's CLI the same way (also for Cursor, Windsurf, VSCodium and Insiders).

### Fixed

- On Windows, files Claude edits now show in the file tree, and clicking one opens it. Paths with
  `\` separators and a drive letter were never matched to the project.

### Security

- On Windows, an editor's `.cmd` script is used only when it runs VS Code or one of its forks,
  and never from inside the project (`npm run` puts `node_modules\.bin` on PATH). `$VISUAL` and
  `$EDITOR` must be full paths there, since Windows looks for a bare name in the working folder
  first.

## [1.2.1] - 2026-10-13

### Added

- `promo/`: a Remotion project that renders a promo video, drawing Mochi, the crew, the session
  meter and the file tree with the plugin's own code, with an OpenAI text-to-speech voice-over. It
  is not part of the installed plugin.
- `npm run thumbnail` in `promo/`: a 1920×1080 cover still for the video, drawn with the plugin's
  own scene and file tree.

### Changed

- The file tree lists edited files, and the folders holding them, first in each folder, so a short
  pane is far less likely to cut the file Claude is editing behind a `↓ N more` line. A file
  Claude only reads keeps its place.

## [1.2.0] - 2026-10-12

### Added

- File tree at the bottom of Mochi's HUD, focused on the session: only the folders that lead to
  edited files are open. The file Claude is editing or reading is marked and pulses while the turn
  runs. Files a subagent edited take its kitten's hat color.
- Git badges in the tree: modified, added, deleted, renamed and untracked files, plus lines added.
  Folders show their totals.
- Click a file in the tree to open it in your editor: a windowed `$VISUAL`/`$EDITOR`, else VS Code,
  else macOS's default text editor. Files are never launched by their type.
- `/mascot files [on|off]`, the `t` key and a `files` button toggle the tree; the choice is saved.
  A short pane folds it into one line naming the file in hand.

### Changed

- The HUD keeps one row for the file tree's line, so a pane folds to its compact layout one row
  sooner.

## [1.1.0] - 2026-10-12

### Added

- Session meter in Mochi's HUD: the model and who serves it, a context fill bar, the prompt-cache
  hit rate with idle time, and the fullest plan window (Claude plans) or a cost estimate (per-token
  providers). It reads each figure correctly for a Claude plan, an API key, Amazon Bedrock, Google
  Cloud's Agent Platform, Microsoft Foundry and gateways.
- Meter toasts, once per crossing: context at 80/90%, plan or spend windows at 80/95%, and prompt
  caching that is never reported.
- `/mascot meter`: the full report with provider notes, including a Foundry 200K-window check.
- A short pane folds the meter into one summary line, so the controls stay in view.
- `/mochi`, an alias of `/mascot` for every subcommand.

## [1.0.0] - 2026-10-11

### Added

- Initial public release of Mochi Crew, the pixel-art cat companion.
