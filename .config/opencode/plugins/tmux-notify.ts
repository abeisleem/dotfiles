import { execFile } from "node:child_process"
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { connect, createServer, type Server } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

import { Plugin } from "@opencode-ai/plugin"
import { createNotifier } from "notifier-hook"

const execFileAsync = promisify(execFile)
const pluginDir = path.dirname(fileURLToPath(import.meta.url))
const opencodeDir = path.resolve(pluginDir, "..")
const setupScript = path.join(opencodeDir, "scripts", "setup-notifier-hook-bundle.mjs")
const permissionCategoryID = "opencode.permission"
const actionDirectory = path.join("/tmp", `opencode-notifier-${process.getuid?.() ?? "user"}`)
const actionSocketPath = path.join(actionDirectory, `actions-${process.pid}.sock`)

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
  notificationId?: string
  lastStatus?: string
  suppressIdleNotification?: boolean
  idleNotified?: boolean
}

type PendingPermission = {
  sessionID: string
  requestID: string
  reply: (response: "once" | "reject") => Promise<void>
}

type PermissionActionRecord = {
  socketPath: string
}

const sessions = new Map<string, SessionState>()
const notificationToSession = new Map<string, string>()
const notificationToPermission = new Map<string, PendingPermission>()
let sharedNotifier: ReturnType<typeof createNotifier> | undefined
let sharedNotifierStart: Promise<void> | undefined
let sharedNotifierStarted = false
let sharedNotifierCategories: Promise<void> | undefined
let sharedNotifierCategoriesRegistered = false
let sharedNotifierListenersAttached = false
let actionServer: Server | undefined
let actionServerStart: Promise<void> | undefined
let activeInstances = 0
let notificationsDisabled = false
let notificationPermissionPrompted = false

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

function permissionBody(request: any) {
  const patterns = Array.isArray(request?.resources)
    ? request.resources.filter((item: unknown) => typeof item === "string")
    : Array.isArray(request?.patterns)
      ? request.patterns.filter((item: unknown) => typeof item === "string")
      : []
  const metadata =
    request?.metadata && typeof request.metadata === "object" && !Array.isArray(request.metadata) ? (request.metadata as Record<string, unknown>) : {}
  const externalDirectory = [metadata.parentDir, metadata.filepath, ...patterns].filter((item): item is string => typeof item === "string" && item.length > 0)
  const details = [...new Set(externalDirectory.length > 0 ? externalDirectory : patterns)]
  const visibleDetails = details.slice(0, 3)
  const suffix = details.length > visibleDetails.length ? `\n+ ${details.length - visibleDetails.length} more` : ""

  const action = request?.action ?? request?.permission
  if (action === "external_directory") {
    return `Allow access to external directory:\n${visibleDetails.join("\n") || "Requested directory"}${suffix}`
  }

  return `Permission requested: ${action || "unknown"}${visibleDetails.length > 0 ? `\n${visibleDetails.join("\n")}${suffix}` : ""}`
}

async function replyToPermission(sessionID: string, requestID: string, reply: "once" | "reject") {
  const endpoint = `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply`
  await runCommand("opencode2", ["api", "post", endpoint, "--data", JSON.stringify({ reply })])
}

function actionRecordPath(notificationID: string) {
  return path.join(actionDirectory, `${notificationID}.json`)
}

async function savePermissionAction(notificationID: string) {
  const record: PermissionActionRecord = { socketPath: actionSocketPath }
  await writeFile(actionRecordPath(notificationID), JSON.stringify(record), { mode: 0o600 })
}

async function removePermissionAction(notificationID: string) {
  await rm(actionRecordPath(notificationID), { force: true })
}

async function forwardPermissionAction(socketPath: string, notificationID: string, actionID: string) {
  await new Promise<void>((resolve, reject) => {
    const socket = connect(socketPath)
    socket.once("error", reject)
    socket.once("connect", () => {
      socket.end(`${JSON.stringify({ notificationID, actionID })}\n`)
    })
    socket.once("close", () => resolve())
  })
}

async function handlePermissionAction(
  notifier: ReturnType<typeof createNotifier>,
  notificationID: string,
  actionID: string,
) {
  if (actionID !== "allow-once" && actionID !== "reject") return

  const pending = notificationToPermission.get(notificationID)
  if (pending) {
    notificationToPermission.delete(notificationID)
    try {
      await pending.reply(actionID === "allow-once" ? "once" : "reject")
      await removePermissionAction(notificationID)
      await notifier.dismiss(notificationID)
    } catch (error) {
      notificationToPermission.set(notificationID, pending)
      console.warn("tmux-notify: failed to reply to permission request", error)
    }
    return
  }

  try {
    const record = JSON.parse(await readFile(actionRecordPath(notificationID), "utf8")) as PermissionActionRecord
    if (!record.socketPath) return
    if (record.socketPath === actionSocketPath) return
    await forwardPermissionAction(record.socketPath, notificationID, actionID)
  } catch (error) {
    console.warn("tmux-notify: failed to forward permission action", error)
  }
}

async function ensureActionServer(notifier: ReturnType<typeof createNotifier>) {
  if (actionServer) return
  actionServerStart ??= (async () => {
    await mkdir(actionDirectory, { recursive: true, mode: 0o700 })
    await chmod(actionDirectory, 0o700)
    await rm(actionSocketPath, { force: true })

    await new Promise<void>((resolve, reject) => {
      const server = createServer((socket) => {
        let payload = ""
        socket.setEncoding("utf8")
        socket.on("data", (chunk) => {
          payload += chunk
        })
        socket.on("end", () => {
          try {
            const { notificationID, actionID } = JSON.parse(payload) as { notificationID?: string; actionID?: string }
            if (notificationID && actionID) void handlePermissionAction(notifier, notificationID, actionID)
          } catch {
            // Ignore malformed local relay messages.
          }
        })
      })
      server.once("error", reject)
      server.listen(actionSocketPath, () => {
        server.off("error", reject)
        actionServer = server
        resolve()
      })
    })
  })().finally(() => {
    actionServerStart = undefined
  })
  await actionServerStart
}

function dismissPermissionNotification(notifier: ReturnType<typeof createNotifier>, sessionID: string, requestID: string) {
  for (const [notificationID, pending] of notificationToPermission) {
    if (pending.sessionID !== sessionID || pending.requestID !== requestID) continue

    notificationToPermission.delete(notificationID)
    notificationToSession.delete(notificationID)
    void removePermissionAction(notificationID)
    const state = sessions.get(sessionID)
    if (state?.notificationId === notificationID) state.notificationId = undefined
    void notifier.dismiss(notificationID).catch(() => {
      // The notification may already have been removed by macOS.
    })
  }
}

async function showNotification(
  notifier: ReturnType<typeof createNotifier>,
  sessionID: string,
  title: string,
  body: string,
  worktreeName: string,
  tmux?: TmuxContext,
  permission?: PendingPermission,
) {
  if (notificationsDisabled) return

  const existing = sessions.get(sessionID)
  if (existing?.notificationId) {
    notificationToPermission.delete(existing.notificationId)
    void removePermissionAction(existing.notificationId)
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
      ...(permission ? { category_identifier: permissionCategoryID } : {}),
    },
  })

  const next = sessions.get(sessionID) ?? { title, worktreeName }
  next.title = title
  next.worktreeName = worktreeName
  next.notificationId = id
  next.tmux = tmux ?? next.tmux
  sessions.set(sessionID, next)
  notificationToSession.set(id, sessionID)
  if (permission) {
    await savePermissionAction(id)
    notificationToPermission.set(id, permission)
  }
}

function notifySession(
  notifier: ReturnType<typeof createNotifier>,
  sessionID: string,
  title: string,
  body: string,
  worktreeName: string,
  tmux?: TmuxContext,
  permission?: PendingPermission,
) {
  void showNotification(notifier, sessionID, title, body, worktreeName, tmux, permission).catch((error) => {
    if (isMacOSNotificationPermissionError(error)) {
      notificationsDisabled = true
      void promptForNotificationPermission()
      return
    }

    console.warn("tmux-notify: failed to show notification", error)
  })
}

function isMacOSNotificationPermissionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes("UNErrorDomain error 1") || message.includes("not allowed for this application")
}

async function ensureNotifierStarted(notifier: ReturnType<typeof createNotifier>) {
  if (!sharedNotifierStarted) {
    sharedNotifierStart ??= notifier.start().finally(() => {
      sharedNotifierStart = undefined
    })
    await sharedNotifierStart
    sharedNotifierStarted = true
  }

  if (sharedNotifierCategoriesRegistered) return
  sharedNotifierCategories ??= notifier
    .registerCategories([
      {
        id: permissionCategoryID,
        actions: [
          { id: "allow-once", title: "Allow once" },
          { id: "reject", title: "Reject", destructive: true },
        ],
      },
    ])
    .then(() => {
      sharedNotifierCategoriesRegistered = true
    })
    .finally(() => {
      sharedNotifierCategories = undefined
    })
  await sharedNotifierCategories
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
  const status = event?.data?.status ?? event?.properties?.status
  if (!status) return undefined
  if (typeof status === "string") return status
  return status.type ?? status.status ?? status.state
}

export default Plugin.define({
  id: "abe.tmux-notify",
  setup: async (ctx) => {
    activeInstances += 1

    await ensureNotifierBundle().catch((error) => {
      console.warn("tmux-notify: failed to prepare notifier bundle", error)
    })

    const notifier = sharedNotifier ??= createNotifier({ appName: "opencode" })
    await ensureActionServer(notifier).catch((error) => {
      console.warn("tmux-notify: failed to start permission action relay", error)
    })

    if (!sharedNotifierListenersAttached) {
      sharedNotifierListenersAttached = true
      notifier.on("error", (err) => console.warn("tmux-notify: notifier error", err))
      notifier.on("action", (notificationID, actionID) => {
        void handlePermissionAction(notifier, notificationID, actionID)
      })
      notifier.on("dismissed", (id, reason) => {
        const sessionID = notificationToSession.get(id)
        if (!sessionID) return
        const state = sessions.get(sessionID)
        if (state?.notificationId === id) state.notificationId = undefined
        notificationToSession.delete(id)
        if (notificationToPermission.delete(id)) void removePermissionAction(id)
        if (reason === "default_action" && state?.tmux) {
          void focusTmux(state.tmux).catch((error) => console.warn("tmux-notify: failed to focus notification source", error))
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

    const controller = new AbortController()
    const task = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const properties: any = event.data
        const sessionID = properties?.sessionID
        if (!sessionID) continue

        const worktreeName = getWorktreeName(event.location?.directory || "OpenCode")
        const state = getSessionState(sessionID, worktreeName)
        if (event.type === "session.created" || event.type === "session.updated") {
          const info = properties.info
          if (info?.title) state.title = info.title
          state.parentID = info?.parentID
          state.tmux = state.tmux ?? (await getTmuxContext())
          sessions.set(sessionID, state)
          continue
        }
        if (!sharedNotifierStarted || notificationsDisabled || state.parentID) continue

        if (event.type === "permission.replied") {
          dismissPermissionNotification(notifier, sessionID, properties.requestID)
          continue
        }
        if (event.type === "session.status") {
          const status = normalizeStatus(event)
          state.lastStatus = status
          if (status === "busy" || status === "pending") {
            state.suppressIdleNotification = false
            state.idleNotified = false
          } else if (status === "idle" && !state.suppressIdleNotification && !state.idleNotified) {
            state.idleNotified = true
            state.tmux = state.tmux ?? (await getTmuxContext())
            sessions.set(sessionID, state)
            notifySession(notifier, sessionID, state.title, "Task finished", worktreeName, state.tmux)
          }
          continue
        }
        if (event.type === "session.idle") {
          if (!state.suppressIdleNotification && !state.idleNotified) {
            state.idleNotified = true
            state.tmux = state.tmux ?? (await getTmuxContext())
            sessions.set(sessionID, state)
            notifySession(notifier, sessionID, state.title, "Task finished", worktreeName, state.tmux)
          }
          continue
        }
        if (event.type === "session.error") {
          if (properties.error?.name === "MessageAbortedError") suppressIdleAfterInterrupt(sessionID)
          else notifySession(notifier, sessionID, state.title, "Error", worktreeName, state.tmux)
          continue
        }
        if (event.type === "permission.asked") {
          state.tmux = state.tmux ?? (await getTmuxContext())
          sessions.set(sessionID, state)
          notifySession(notifier, sessionID, state.title, permissionBody(properties), worktreeName, state.tmux, {
            sessionID,
            requestID: properties.id,
            reply: (response) => replyToPermission(sessionID, properties.id, response),
          })
          continue
        }
        if (event.type === "question.asked") {
          notifySession(notifier, sessionID, state.title, "Needs your input", worktreeName, state.tmux)
        }
      }
    })().catch((error) => {
      if (!controller.signal.aborted) console.warn("tmux-notify: event stream failed", error)
    })

    return async () => {
      controller.abort()
      await task
      activeInstances = Math.max(0, activeInstances - 1)
      sessions.clear()
      notificationToSession.clear()
      for (const notificationID of notificationToPermission.keys()) void removePermissionAction(notificationID)
      notificationToPermission.clear()
      if (activeInstances === 0 && sharedNotifierStarted) {
        try {
          await notifier.quit()
          sharedNotifierStarted = false
          sharedNotifierCategoriesRegistered = false
          await new Promise<void>((resolve) => actionServer?.close(() => resolve()) ?? resolve())
          actionServer = undefined
          await rm(actionSocketPath, { force: true })
        } catch {
          // Ignore shutdown errors.
        }
      }
    }
  },
})
