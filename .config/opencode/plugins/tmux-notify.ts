import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import type { Plugin } from "@opencode-ai/plugin"
import { createNotifier } from "notifier-hook"

const execFileAsync = promisify(execFile)
const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const opencodeDir = path.resolve(pluginDir, "..")
const setupScript = path.join(opencodeDir, "scripts", "setup-notifier-hook-bundle.mjs")

type TmuxContext = {
  socket: string
  session: string
  window: string
  pane: string
  clientTty: string
}

type SessionState = {
  title: string
  worktreeName: string
  parentID?: string
  tmux?: TmuxContext
  selectOpenCodeSession?: () => Promise<void>
  notificationId?: string
  lastStatus?: string
  suppressIdleNotification?: boolean
  idleNotified?: boolean
}

const sessions = new Map<string, SessionState>()
const notificationToSession = new Map<string, string>()
let sharedNotifier: ReturnType<typeof createNotifier> | undefined
let sharedNotifierStart: Promise<void> | undefined
let sharedNotifierStarted = false
let activeInstances = 0
let notificationsDisabled = false

function getWorktreeName(worktree: string) {
  return path.basename(worktree.replace(/\/$/, "")) || worktree
}

function getSessionState(sessionID: string, worktreeName: string) {
  const current = sessions.get(sessionID)
  if (current) return current

  const created: SessionState = {
    title: `Session ${sessionID.slice(0, 8)}`,
    worktreeName,
  }
  sessions.set(sessionID, created)
  return created
}

async function runCommand(command: string, args: string[]) {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" })
  return String(stdout ?? "").trim()
}

async function getTmuxContext(): Promise<TmuxContext | undefined> {
  const tmuxEnv = process.env.TMUX
  const tmuxPane = process.env.TMUX_PANE
  const socket = tmuxEnv?.split(",")[0]

  const target = tmuxPane || (await runCommand("ps", ["-o", "tty=", "-p", String(process.pid)])).trim()
  if (!socket || !target || target === "?") return undefined

  try {
    const [session, window, pane, clientTty] = await Promise.all([
      runCommand("tmux", ["-S", socket, "display-message", "-t", target, "-p", "#{session_name}"]),
      runCommand("tmux", ["-S", socket, "display-message", "-t", target, "-p", "#{window_index}"]),
      runCommand("tmux", ["-S", socket, "display-message", "-t", target, "-p", "#{pane_index}"]),
      runCommand("tmux", ["-S", socket, "display-message", "-t", target, "-p", "#{client_tty}"]),
    ])

    if (!session || !window || !pane || !clientTty) return undefined

    return { socket, session, window, pane, clientTty }
  } catch {
    return undefined
  }
}

async function activateGhostty() {
  try {
    await runCommand("open", ["-a", "Ghostty"])
  } catch {
    // If Ghostty isn't installed or can't be launched, tmux still gets a chance to switch.
  }
}

async function focusTmux(context: TmuxContext) {
  await activateGhostty()

  const targetWindow = `${context.session}:${context.window}`
  const targetPane = `${targetWindow}.${context.pane}`

  try {
    await runCommand("tmux", ["-S", context.socket, "switch-client", "-c", context.clientTty, "-t", targetPane])
  } catch (error) {
    console.warn("tmux-notify: switch-client failed", error)
  }
}

async function selectOpenCodeSession(client: any, sessionID: string) {
  const tui = client.tui as {
    selectSession?: (parameters: { sessionID: string }) => Promise<unknown>
    publish: (parameters: { body: { type: string; properties: { sessionID: string } } }) => Promise<unknown>
  }

  if (tui.selectSession) {
    await tui.selectSession({ sessionID })
    return
  }

  // OpenCode 1.17 exposed this as a generic TUI event before selectSession().
  await tui.publish({ body: { type: "tui.session.select", properties: { sessionID } } })
}

async function showNotification(
  notifier: ReturnType<typeof createNotifier>,
  sessionID: string,
  title: string,
  body: string,
  worktreeName: string,
  tmux?: TmuxContext,
) {
  if (notificationsDisabled) return

  const existing = sessions.get(sessionID)
  if (existing?.notificationId) {
    try {
      await notifier.dismiss(existing.notificationId)
    } catch {
      // If the previous notification is already gone, continue.
    }
  }

  const id = await notifier.show({
    title,
    body,
    sound: true,
    macos: {
      subtitle: worktreeName,
      thread_identifier: sessionID,
      interruption_level: "timeSensitive",
      sound_name: "Frog",
    },
  })

  const next = sessions.get(sessionID) ?? { title, worktreeName }
  next.title = title
  next.worktreeName = worktreeName
  next.notificationId = id
  next.tmux = tmux ?? next.tmux
  sessions.set(sessionID, next)
  notificationToSession.set(id, sessionID)
}

function notifySession(
  notifier: ReturnType<typeof createNotifier>,
  sessionID: string,
  title: string,
  body: string,
  worktreeName: string,
  tmux?: TmuxContext,
) {
  void showNotification(notifier, sessionID, title, body, worktreeName, tmux).catch((error) => {
    console.warn("tmux-notify: failed to show notification", error)
  })
}

function isMacOSNotificationPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UNErrorDomain error 1") || message.includes("not allowed for this application")
}

async function ensureNotifierStarted(notifier: ReturnType<typeof createNotifier>) {
  if (sharedNotifierStarted) return
  sharedNotifierStart ??= notifier.start().finally(() => {
    sharedNotifierStart = undefined
  })
  await sharedNotifierStart
  sharedNotifierStarted = true
}

async function ensureNotifierBundle() {
  if (process.platform !== "darwin") return

  await execFileAsync(process.execPath, [setupScript], {
    cwd: opencodeDir,
    env: process.env,
  })
}

function suppressIdleAfterInterrupt(sessionID: string) {
  const state = sessions.get(sessionID)
  if (!state) return

  state.suppressIdleNotification = true
}

function normalizeStatus(event: any) {
  const status = event?.properties?.status
  if (!status) return undefined
  if (typeof status === "string") return status
  return status.type ?? status.status ?? status.state
}

export default (async ({ client, directory, worktree }) => {
  activeInstances += 1
  const worktreeName = getWorktreeName(worktree || directory)

  await ensureNotifierBundle().catch((error) => {
    console.warn("tmux-notify: failed to prepare notifier bundle", error)
  })

  const notifier = sharedNotifier ??= createNotifier({ appName: "opencode" })

  if (!sharedNotifierStarted) {
    notifier.on("error", (err) => {
      console.warn("tmux-notify: notifier error", err)
    })

    notifier.on("dismissed", (id, reason) => {
      const sessionID = notificationToSession.get(id)
      if (!sessionID) return

      const state = sessions.get(sessionID)
      if (state?.notificationId === id) {
        state.notificationId = undefined
      }

      notificationToSession.delete(id)

      if (reason !== "default_action") return
      if (!state?.tmux) return

      void focusTmux(state.tmux).then(async () => {
        await state.selectOpenCodeSession?.()
      }).catch((error) => {
        console.warn("tmux-notify: failed to focus notification source", error)
      })
    })
  }

  try {
    await ensureNotifierStarted(notifier)

    if (notifier.permission === "denied") {
      notificationsDisabled = true
      console.warn("tmux-notify: notifications unavailable (denied)")
    }
  } catch (error) {
    if (isMacOSNotificationPermissionError(error)) {
      notificationsDisabled = true
      console.warn("tmux-notify: macOS notification permission is not available; notifications disabled")
      return {
        event: async () => {},
        dispose: async () => {},
      }
    }

    sharedNotifierStarted = false
    console.warn("tmux-notify: disabled because notifier failed to start", error)
  }

  return {
    event: async ({ event }: { event: any }) => {
      const sessionID = event?.properties?.sessionID
      if (!sessionID) return

      const state = getSessionState(sessionID, worktreeName)

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = event?.properties?.info
        if (info?.title) state.title = info.title
        state.parentID = info?.parentID
        state.tmux = state.tmux ?? (await getTmuxContext())
        state.selectOpenCodeSession = () => selectOpenCodeSession(client, sessionID)
        sessions.set(sessionID, state)
        return
      }

      if (!sharedNotifierStarted) return
      if (notificationsDisabled) return
      if (state.parentID) return

      if (event.type === "session.status") {
        const status = normalizeStatus(event)
        state.lastStatus = status

        if (status === "busy" || status === "pending") {
          state.suppressIdleNotification = false
          state.idleNotified = false
          return
        }

        if (status === "idle") {
          if (state.suppressIdleNotification) return
          if (state.idleNotified) return
          state.idleNotified = true
          state.tmux = state.tmux ?? (await getTmuxContext())
          sessions.set(sessionID, state)
          notifySession(notifier, sessionID, `opencode · ${state.title}`, "Task finished", worktreeName, state.tmux)
        }
        return
      }

      if (event.type === "session.idle") {
        if (state.suppressIdleNotification) return
        if (state.idleNotified) return
        state.idleNotified = true
        state.tmux = state.tmux ?? (await getTmuxContext())
        sessions.set(sessionID, state)
        notifySession(notifier, sessionID, `opencode · ${state.title}`, "Task finished", worktreeName, state.tmux)
        return
      }

      if (event.type === "session.error") {
        if (event?.properties?.error?.name === "MessageAbortedError") {
          suppressIdleAfterInterrupt(sessionID)
          return
        }

        state.tmux = state.tmux ?? (await getTmuxContext())
        sessions.set(sessionID, state)
        notifySession(notifier, sessionID, `opencode · ${state.title}`, "Error", worktreeName, state.tmux)
        return
      }

      if (event.type === "permission.asked") {
        state.tmux = state.tmux ?? (await getTmuxContext())
        sessions.set(sessionID, state)
        notifySession(notifier, sessionID, `opencode · ${state.title}`, "Needs permission", worktreeName, state.tmux)
        return
      }

      if (event.type === "question.asked") {
        state.tmux = state.tmux ?? (await getTmuxContext())
        sessions.set(sessionID, state)
        notifySession(notifier, sessionID, `opencode · ${state.title}`, "Needs your input", worktreeName, state.tmux)
        return
      }

      if (event.type === "session.next.interrupt.requested") {
        suppressIdleAfterInterrupt(sessionID)
      }
    },
    dispose: async () => {
      activeInstances = Math.max(0, activeInstances - 1)
      sessions.clear()
      notificationToSession.clear()

      if (activeInstances === 0 && sharedNotifierStarted) {
        try {
          await notifier.quit()
          sharedNotifierStarted = false
        } catch {
          // Ignore shutdown errors.
        }
      }
    },
  }
}) satisfies Plugin
