# Changelog

All notable changes to Mochi Crew are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
