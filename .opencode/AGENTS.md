## Cortx server

- When referring to the user's server, `cortx`, `cortx-server`, and `cortex` mean the same headless Ubuntu host on the user's Tailscale network, not the local Mac.
- Its local operations repo is `/Users/abe/repos/cortx-server`. For related work, read that repo's `AGENTS.md`, then `SERVER-STATE.md` for recorded setup and the relevant sections of `SERVER-OPERATIONS.md` for access and procedures; replayable changes live in `scripts/`.
- The documented SSH entry point from the Mac is `ssh cortx-server` with Tailscale connected. Consult the operations repo for current endpoints and service details rather than guessing from these aliases.
- Recorded state is an orientation map, not proof of live state: verify relevant settings before changes. Follow the operations repo's documentation-update rules when changing the host; do not run setup scripts merely to orient yourself.
