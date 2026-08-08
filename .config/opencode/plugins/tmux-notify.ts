import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Plugin } from "@opencode-ai/plugin"
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
  worktree: string
  worktreeName: string
  loaded?: boolean
  parentID?: string
  parentResolved?: boolean
  tmux?: TmuxContext
  notificationId?: string
  lastStatus?: string
  suppressIdleNotification?: boolean
  idleNotified?: boolean
}

type Notifier = ReturnType<typeof createNotifier>

const sessions = new Map<string, SessionState>()
const notificationToSession = new Map<string, string>()
let sharedNotifier: Notifier | undefined
let sharedNotifierStart: Promise<void> | undefined
let sharedNotifierStarted = false
let sharedNotifierListenersAttached = false
let activeInstances = 0
let notificationsDisabled = false
let notificationPermissionPrompted = false

function getWorktreeName(worktree: string) {
  return path.basename(worktree.replace(/\/$/, "")) || worktree
}

function getSessionState(sessionID: string, worktree: string) {
  const current = sessions.get(sessionID)
  if (current) return current

  const created: SessionState = {
    title: `Session ${sessionID.slice(0, 8)}`,
    worktree,
    worktreeName: getWorktreeName(worktree),
  }
  sessions.set(sessionID, created)
  return created
}

async function runCommand(command: string, args: string[]) {
  const { stdout } = await execFileAsync(command, args, { encoding: "utf8" })
  return String(stdout ?? "").trim()
}

async function getTmuxContext(worktree: string): Promise<TmuxContext | undefined> {
  try {
    const panes = await runCommand("tmux", ["list-panes", "-a", "-F", "#{pane_id}\t#{pane_current_command}\t#{pane_current_path}"])
    const pane = panes
      .split("\n")
      .map((line) => line.split("\t"))
      .find(([id, command, cwd]) => id && (command === "opencode2" || command === "opencode2.exe") && (cwd === worktree || worktree.startsWith(`${cwd}/`)))?.[0]
    if (!pane) return undefined

    const [socket, session, window, index, clientTty] = (
      await runCommand("tmux", ["display-message", "-t", pane, "-p", "#{socket_path}\t#{session_name}\t#{window_index}\t#{pane_index}\t#{client_tty}"])
    ).split("\t")
    if (!socket || !session || !window || !index || !clientTty) return undefined

    return { socket, session, window, pane: index, clientTty }
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

async function promptForNotificationPermission() {
  if (process.platform !== "darwin" || notificationPermissionPrompted) return
  notificationPermissionPrompted = true

  try {
    const response = await runCommand("osascript", [
      "-e",
      'display dialog "OpenCode notifications are disabled. Enable notifications for NotifierHook in System Settings." with title "OpenCode notifications" buttons {"Not now", "Open Notifications"} default button "Open Notifications" with icon caution',
    ])

    if (response.includes("Open Notifications")) {
      await runCommand("open", ["x-apple.systempreferences:com.apple.preference.notifications"])
    }
  } catch {
    // The user dismissed the dialog or System Settings could not be opened.
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

  const next = sessions.get(sessionID) ?? {
    title,
    worktree: worktreeName,
    worktreeName,
  }
  next.title = title
  next.worktreeName = worktreeName
  next.notificationId = id
  next.tmux = tmux ?? next.tmux
  sessions.set(sessionID, next)
  notificationToSession.set(id, sessionID)
}

function notifySession(notifier: Notifier, sessionID: string, title: string, body: string, worktreeName: string, tmux?: TmuxContext) {
  void showNotification(notifier, sessionID, title, body, worktreeName, tmux).catch((error) => {
    if (isMacOSNotificationPermissionError(error)) {
      notificationsDisabled = true
      void promptForNotificationPermission()
      return
    }

    console.warn("tmux-notify: failed to show notification", error)
  })
}

async function notifyTaskFinished(notifier: Notifier, sessionID: string, state: SessionState, worktreeName: string, syncInfo: () => Promise<void>) {
  if (state.suppressIdleNotification || state.idleNotified) return

  state.idleNotified = true
  await syncInfo()
  state.tmux = await getTmuxContext(state.worktree)
  notifySession(notifier, sessionID, state.title, "Task finished", worktreeName, state.tmux)
}

function isMacOSNotificationPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UNErrorDomain error 1") || message.includes("not allowed for this application")
}

async function ensureNotifierStarted(notifier: Notifier) {
  if (!sharedNotifierStarted) {
    sharedNotifierStart ??= notifier.start().finally(() => {
      sharedNotifierStart = undefined
    })
    await sharedNotifierStart
    sharedNotifierStarted = true
  }
}

async function killStaleNotifierDaemons() {
  if (process.platform !== "darwin") return
  try {
    const output = await runCommand("pgrep", ["-f", "notifier-hook-daemon"])
    for (const pid of output.split("\n").filter(Boolean)) {
      if (pid === String(process.pid)) continue
      try {
        const ppid = (await runCommand("ps", ["-o", "ppid=", "-p", pid])).trim()
        if (ppid === String(process.pid)) continue
        await runCommand("kill", ["-9", pid])
      } catch {
        // Already gone or not ours to reap.
      }
    }
  } catch {
    // pgrep found nothing.
  }
}

async function ensureNotifierBundle() {
  if (process.platform !== "darwin") return

  await execFileAsync(process.execPath, [setupScript], {
    cwd: opencodeDir,
    env: process.env,
  })
}

function normalizeStatus(event: any) {
  const status = event?.data?.status ?? event?.properties?.status
  if (!status) return undefined
  if (typeof status === "string") return status
  return status.type ?? status.status ?? status.state
}

export default Plugin.define({
  id: "abe.tmux-notify",
  setup: async (ctx) => {
    activeInstances += 1

    await killStaleNotifierDaemons().catch(() => {})

    await ensureNotifierBundle().catch((error) => {
      console.warn("tmux-notify: failed to prepare notifier bundle", error)
    })

    const notifier = (sharedNotifier ??= createNotifier({
      appName: "opencode",
    }))
    if (!sharedNotifierListenersAttached) {
      sharedNotifierListenersAttached = true
      notifier.on("error", (err) => console.warn("tmux-notify: notifier error", err))
      notifier.on("dismissed", (id, reason) => {
        const sessionID = notificationToSession.get(id)
        if (!sessionID) return
        const state = sessions.get(sessionID)
        if (state?.notificationId === id) state.notificationId = undefined
        notificationToSession.delete(id)
        if (reason === "default_action" && state) {
          void getTmuxContext(state.worktree)
            .then((context) => {
              const tmux = context ?? state.tmux
              if (tmux) return focusTmux(tmux)
            })
            .catch((error) => console.warn("tmux-notify: failed to focus notification source", error))
        }
      })
    }

    try {
      await ensureNotifierStarted(notifier)
      if (notifier.permission === "denied") {
        notificationsDisabled = true
        console.warn("tmux-notify: notifications unavailable (denied)")
        void promptForNotificationPermission()
      }
    } catch (error) {
      notificationsDisabled = true
      sharedNotifierStarted = false
      console.warn("tmux-notify: disabled because notifier failed to start", error)
    }

    const syncSessionInfo = async (sessionID: string, state: SessionState) => {
      try {
        const info = await ctx.session.get({ sessionID })
        state.title = info.title
        state.parentID = info.parentID
        state.parentResolved = true
        state.worktree = info.location.directory
      } catch {
        // A session may disappear before an event queued for it is handled.
      }
    }

    const controller = new AbortController()
    const task = (async () => {
      while (!controller.signal.aborted) {
        try {
          for await (const event of ctx.event.subscribe({
            signal: controller.signal,
          })) {
            const properties: any = event.data
            const sessionID = properties?.sessionID
            if (!sessionID) continue

            const worktree = event.location?.directory || "OpenCode"
            const worktreeName = getWorktreeName(worktree)
            const state = getSessionState(sessionID, worktree)
            const syncInfo = () => syncSessionInfo(sessionID, state)
            if (event.type === "session.forked") {
              state.parentID = properties.parentID
              state.parentResolved = true
              continue
            }
            if (event.type === "session.created" || event.type === "session.updated") {
              const info = properties.info
              if (info?.title) state.title = info.title
              if (info) {
                state.parentID = info.parentID
                state.parentResolved = true
              }
              state.worktree = worktree
              state.loaded = true
              state.tmux = await getTmuxContext(worktree)
              continue
            }
            if (event.type === "session.renamed") {
              if (properties.title) state.title = properties.title
              continue
            }
            if (!state.loaded || !state.parentResolved) {
              await syncInfo()
              state.loaded = true
            }
            if (!sharedNotifierStarted || notificationsDisabled || state.parentID) continue

            if (event.type === "session.execution.started") {
              state.suppressIdleNotification = false
              state.idleNotified = false
              continue
            }
            if (event.type === "session.execution.interrupted") {
              state.suppressIdleNotification = true
              continue
            }
            if (event.type === "session.execution.succeeded") {
              await notifyTaskFinished(notifier, sessionID, state, worktreeName, syncInfo)
              continue
            }
            if (event.type === "session.status") {
              const status = normalizeStatus(event)
              state.lastStatus = status
              if (status === "busy" || status === "pending") {
                state.suppressIdleNotification = false
                state.idleNotified = false
              } else if (status === "idle") {
                await notifyTaskFinished(notifier, sessionID, state, worktreeName, syncInfo)
              }
              continue
            }
            if (event.type === "session.idle") {
              await notifyTaskFinished(notifier, sessionID, state, worktreeName, syncInfo)
              continue
            }
            if (event.type === "session.error") {
              if (properties.error?.name === "MessageAbortedError") {
                state.suppressIdleNotification = true
              } else {
                await syncInfo()
                notifySession(notifier, sessionID, state.title, "Error", worktreeName, state.tmux)
              }
              continue
            }
            if (event.type === "permission.asked") {
              await syncInfo()
              state.tmux = await getTmuxContext(state.worktree)
              notifySession(notifier, sessionID, state.title, "Needs permission", worktreeName, state.tmux)
              continue
            }
            if (event.type === "question.asked") {
              await syncInfo()
              notifySession(notifier, sessionID, state.title, "Needs your input", worktreeName, state.tmux)
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) console.warn("tmux-notify: event stream failed; reconnecting", error)
        }

        if (!controller.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 1_000))
      }
    })()

    return async () => {
      controller.abort()
      await task
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
    }
  },
})
