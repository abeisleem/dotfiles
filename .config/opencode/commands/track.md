---
description: Track time with start, stop, status, today, week, or export
agent: build
model: opencode/gpt-5-nano
---

Parse the first argument as the subcommand. Infer the intention when there are typos, for example, treat `statis` as `status`.

Raw arguments: `$ARGUMENTS`

Supported subcommands:

- `help`
  Show the available `/track` subcommands, flags, and a few short examples.
  Do not call any tools.

- `start [label...]`
  Use the `time_start` tool.
  The remaining arguments are the label. If no label is provided, infer a short one from the current task.

- `stop [--all] [--actual|--last-activity|--auto] [note...]`
  Use the `time_stop` tool.
  By default, stop only the current session's timer.
  Flags:
  - `--all` -> stop all active timers across all worktrees
  - `--actual` -> mode `actual`
  - `--last-activity` -> mode `last-activity`
  - `--auto` -> mode `auto`
  Any remaining text becomes the note.

- `status [--all]`
  Use the `time_status` tool.
  If `--all` is present, pass `all: true`.

- `today`
  Use the `time_report` tool with `range: "today"`.

- `week`
  Use the `time_report` tool with `range: "week"`.

- `export [--range today|week|all] [--output path.md] [--title "..."] [--include-active]`
  Use the `time_export` tool.
  Defaults:
  - `range`: `today`
  - `outputPath`: omitted
  - `title`: omitted
  - `includeActive`: `false` unless `--include-active` is present

If the subcommand is missing, `help`, or invalid, explain the supported `/track` usage briefly.

Examples:
- `/track help`
- `/track start refactor auth flow`
- `/track stop --last-activity fixed export formatting`
- `/track stop --all --actual end of day`
- `/track status --all`
- `/track export --range week --include-active --output weekly-report.md`

Reply concisely after the tool call.

Command input: $ARGUMENTS
