- strive to not use use jargon and speak coherently. state simply and concisely, like one human talking to another.

- if you need to install a package to the machine for any reason, defer to using `brew install` as a first option. after installation to complete the task, list them all at the end of your message and prompt the user to determine if they would like to uninstall any of them

## `agent-browser` instructions
- when using agent-browser against an authenticated site, derive a worktree-scoped named session with `agent-browser session id --scope worktree --prefix <site>`, then pass both `--session "$SESSION"` and `--restore` to every agent-browser command. A session name alone does not persist cookies or storage. Do not use the shared `default` session for authenticated work.
- if no authenticated state exists, launch the named restored session with `--headed` at the user-provided login URL and wait for the user to complete sign-in. Do not ask for, paste, or expose credentials. Before relying on a restored session, inspect `agent-browser --session "$SESSION" session info --json` and confirm that restore succeeded.
- do not use `agent-browser state clear <session>` for test cleanup: in this installed CLI version it cleared every saved state. Only clear browser state when the user explicitly approves deleting all saved authentication state.
