---
name: git
description: "git workflows for agents. use when handling commits, atomic split commits, selective staging, hunk-level staging with built-in git, branch pushes, or pull request creation with `gh`. triggers on: commit, pr, push, stage, hunk, selective staging, pull request, atomic commit."
---

# git

use this skill when the job is to turn a messy diff into clean commits or a clean pull request. prefer atomic commits, short lowercase conventional messages, and explicit staging over convenience.

## defaults

- use conventional prefixes: `feat` `fix` `refactor` `perf` `test` `docs` `chore` `build` `ci` `style` `revert`
- keep commit subjects short, lowercase, and direct; no trailing period
- add a scope only when it adds signal: `fix(auth): refresh session`
- stage only what you mean to commit; never use `git add -A`
- never use interactive `git add -p`
- use `git apply --cached` for partial text staging when whole-file staging is too broad
- binary files are whole-file only
- never force push
- prefer `gh` for github operations
- leave unrelated user changes alone

## commit message convention

- default format: `type(scope): subject` or `type: subject`
- prefer the smallest honest type; do not inflate `feat` when the change is really `fix`, `refactor`, or `chore`
- make the subject describe the shipped change, not the process
- good: `fix(cache): avoid stale reads`
- good: `refactor(router): split auth helpers`
- good: `docs: add local setup note`

## commit workflow

if the user provides extra instructions, treat them as constraints on scope, file selection, commit count, message hints, or exclusions.

1. inspect the entire change first
   - run `git status`, `git diff`, `git diff --staged`, and `git log --oneline -10`
   - reason about the full diff before staging anything
   - identify the smallest meaningful commit boundaries by intent, not by file count

2. decide how to split
   - separate independent bug fixes, refactors, tests, docs, formatting, and generated changes when they can stand alone
   - keep tightly coupled code and tests together when one without the other would be misleading or broken
   - if the diff is already one unit, make one commit

3. stage the next atomic unit
   - if whole files belong together, stage files explicitly with `git add <file ...>`
   - if a tracked text file mixes multiple concerns, stage only the intended changes with `git apply --cached`
   - if an untracked text file needs partial staging, run `git add -N <file>`, inspect the diff, then stage selected changes with `git apply --cached`
   - never use interactive `git add -p` or broad `git add -A`

4. use partial staging safely when needed
   - build the smallest valid diff containing only the intended text changes
   - when practical, check the patch with `git apply --cached --check` before applying it
   - apply selected changes to the index with `git apply --cached`
   - for untracked text files, run `git add -N <file>` first so git can produce and accept partial diffs
   - after every partial stage, inspect `git diff --cached`, `git diff`, and `git status --short`
   - if a patch fails, do not guess; re-read the current diff, rebuild the patch with enough context, and retry
   - if verification shows extra staged changes, unstage explicitly with `git restore --staged <file>` or reverse the cached patch, then retry
   - do not partially stage binary files

5. commit and continue
   - write a short lowercase conventional message
   - create exactly one atomic commit for the selected unit
   - re-check `git status` and the remaining diff
   - repeat until the requested work is committed

6. failure handling
   - if there is nothing to commit, do not create an empty commit
   - if a hook changes files or rejects the commit, inspect the new diff, fix the issue, and create a new commit instead of amending by default
   - ask only if ownership or grouping is genuinely ambiguous and the wrong split would be misleading

## pull request workflow

if the user provides extra instructions, treat them as constraints on commit scope, base branch, title, body, draft state, labels, reviewers, or other `gh` options.

1. run the commit workflow first for all intended uncommitted changes
2. inspect branch state with `git status`, `git branch --show-current`, tracking status, `git log`, and `git diff <base>...HEAD`
3. if the current branch is the default branch (e.g. `main`), create a new branch named `nxl/<short-descriptive-name>` before pushing (e.g. `nxl/fix-auth-refresh`, `nxl/add-usage-metrics`)
4. choose the base branch from arguments when provided; otherwise prefer the repo default or current tracking setup
5. push the branch with `git push -u origin <branch>` when needed; never force push
6. create the pull request with `gh pr create`
7. keep the PR title concise and aligned with the overall change set
8. keep the PR body short and useful; default shape:

```md
## summary
- ...
- ...

## testing
- ...
```

9. return the PR URL

## argument handling

- accept natural language arguments and explicit flags or key-value hints
- honor user-provided titles, scopes, prefixes, commit-count limits, base branches, draft requests, labels, and reviewer hints when they are safe
- if arguments conflict with atomicity, preserve correctness first and explain the tradeoff briefly

## staging backend

- use built-in git only; do not require external staging tools
