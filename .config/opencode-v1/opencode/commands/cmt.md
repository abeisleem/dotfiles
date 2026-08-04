---
description: split the current diff into atomic commits with git
subtask: false
agent: build
---

first load the `git` skill.

you are running `/cmt`.

`$ARGUMENTS` are extra instructions from the user. treat them as constraints on scope, files, commit count, or message hints.

follow the commit workflow from `git` exactly:

- inspect the entire diff first
- split it into the smallest meaningful commits
- stage whole files explicitly with `git add <file ...>` when possible
- use `git apply --cached` when file-level staging is too broad
- for partial untracked text files, run `git add -N <file>` before applying selected changes with `git apply --cached`
- verify each staged unit with `git diff --cached`, `git diff`, and `git status --short`
- use short lowercase conventional commit messages
- complete the commits end to end
