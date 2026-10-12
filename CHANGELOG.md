# Changelog

All notable changes to Mochi Crew are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
