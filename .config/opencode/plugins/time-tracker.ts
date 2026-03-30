import { access, appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

type ActiveEntry = {
  id: string
  label: string
  startedAt: string
  directory: string
  worktree: string
  agent: string
  sessionID: string
  parentSessionID?: string
  lineageRootSessionID?: string
  lastActivityAt?: string
  idleAt?: string
  sessionFiles?: string[]
  recentHints?: string[]
}

type TrackerState = {
  entries: Record<string, ActiveEntry>
}

type CompletedEntry = ActiveEntry & {
  endedAt: string
  durationMs: number
  note?: string
  scope: string
  changedFiles: string[]
  category: string
}

type TimeTrackerConfig = {
  idleThresholdMinutes: number
  categories: Record<string, string[]>
}

const DEFAULT_CONFIG: TimeTrackerConfig = {
  idleThresholdMinutes: 15,
  categories: {
    docs: ["readme", "docs", "notes", ".md", ".mdx", ".txt"],
    frontend: [".tsx", ".jsx", ".css", ".scss", ".html"],
    code: [".ts", ".js", ".py", ".go", ".rb", ".rs", ".java"],
    config: ["config", ".github", ".json", ".yaml", ".yml", ".toml", ".ini", ".env"],
    research: [".pdf", ".doc", ".pptx"],
    writing: ["blog", "post", "article"],
    debugging: ["test", ".spec.", ".test."],
    infra: ["docker", "kubernetes", "terraform", ".tf"],
  },
}

const CONFIG_DIR = path.join(process.env.HOME || "~", ".config/opencode")
const DATA_DIR = path.join(process.env.HOME || "~", ".local/share/opencode/time-tracker")
const CONFIG_FILE = path.join(CONFIG_DIR, "time-tracker.config.json")
const ACTIVE_FILE = path.join(DATA_DIR, "time-tracker-active.json")
const CSV_FILE = path.join(DATA_DIR, "time-tracker.csv")
const LEGACY_ACTIVE_FILE = path.join(CONFIG_DIR, "time-tracker-active.json")
const LEGACY_CSV_FILE = path.join(CONFIG_DIR, "time-tracker.csv")
const CSV_HEADER = [
  "id",
  "label",
  "startedAt",
  "endedAt",
  "durationMs",
  "durationHuman",
  "directory",
  "worktree",
  "scope",
  "agent",
  "sessionID",
  "category",
  "changedFiles",
  "note",
]

let config: TimeTrackerConfig = DEFAULT_CONFIG
const MAX_RECENT_HINTS = 20

function isoNow() {
  return new Date().toISOString()
}

function elapsedMs(startedAt: string, endedAt: string) {
  return Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
}

function formatDuration(durationMs: number) {
  const totalMinutes = Math.round(durationMs / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (!hours) return `${minutes}m`
  if (!minutes) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function dayKey(value: string) {
  return value.slice(0, 10)
}

function normalizeCell(value: string) {
  return value.replace(/\r?\n/g, " ").trim()
}

function csvEscape(value: string | number | undefined) {
  const normalized = normalizeCell(String(value ?? ""))
  if (!/[",]/.test(normalized)) return normalized
  return `"${normalized.replace(/"/g, '""')}"`
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  return String((error as { code?: unknown }).code)
}

function parseCsvLine(line: string) {
  const cells: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"'
        i += 1
        continue
      }
      if (char === '"') {
        inQuotes = false
        continue
      }
      current += char
      continue
    }

    if (char === ',') {
      cells.push(current)
      current = ""
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    current += char
  }

  cells.push(current)
  return cells
}

function scopeFor(directory: string, worktree: string) {
  const relative = path.relative(worktree, directory)
  if (!relative || relative === ".") return "."
  return relative
}

function normalizeTrackedFile(file: string, worktree: string) {
  const candidate = path.isAbsolute(file) ? path.relative(worktree, file) : file
  return candidate.replace(/\\/g, "/").replace(/^\.\//, "")
}

function isInScope(file: string, scope: string) {
  return scope === "." || file === scope || file.startsWith(`${scope}/`)
}

function matchFilePattern(file: string, pattern: string) {
  if (pattern.startsWith(".")) return file.endsWith(pattern)
  return file.includes(pattern)
}

function categoryKeywords(category: string, patterns: string[]) {
  return [...new Set([
    category.toLowerCase(),
    ...patterns
      .map((pattern) => pattern.toLowerCase().trim())
      .filter((pattern) => pattern && !pattern.startsWith("."))
      .map((pattern) => pattern.replace(/[^a-z0-9]+/g, " ").trim())
      .filter(Boolean),
  ])]
}

function bestCategory(scores: Map<string, number>) {
  const ranked = [...scores.entries()].filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1])
  if (ranked.length === 0) return { category: undefined, mixed: false }
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return { category: undefined, mixed: true }
  return { category: ranked[0][0], mixed: false }
}

function categorizeFiles(files: string[]) {
  if (files.length === 0) return { category: undefined, mixed: false }

  const scores = new Map<string, number>()
  for (const [category, patterns] of Object.entries(config.categories)) {
    scores.set(category, 0)
    for (const file of files.map((value) => value.toLowerCase())) {
      if (patterns.some((pattern) => matchFilePattern(file, pattern.toLowerCase()))) {
        scores.set(category, (scores.get(category) || 0) + 1)
      }
    }
  }

  return bestCategory(scores)
}

function categorizeText(texts: string[]) {
  const normalized = texts.map((text) => text.toLowerCase().trim()).filter(Boolean)
  if (normalized.length === 0) return { category: undefined, mixed: false }

  const scores = new Map<string, number>()
  for (const [category, patterns] of Object.entries(config.categories)) {
    scores.set(category, 0)
    const keywords = categoryKeywords(category, patterns)
    for (const text of normalized) {
      if (keywords.some((keyword) => keyword && text.includes(keyword))) {
        scores.set(category, (scores.get(category) || 0) + 1)
      }
    }
  }

  return bestCategory(scores)
}

function inferCategory(input: { files: string[]; hints: string[]; label: string; note?: string }) {
  const fileMatch = categorizeFiles(input.files)
  if (fileMatch.category) return fileMatch.category

  const hintMatch = categorizeText(input.hints)
  if (hintMatch.category) return hintMatch.category

  const labelMatch = categorizeText([input.label, input.note || ""])
  if (labelMatch.category) return labelMatch.category

  if (fileMatch.mixed || hintMatch.mixed || labelMatch.mixed) return "mixed"
  return "uncategorized"
}

function appendHints(active: ActiveEntry, values: string[]) {
  const next = [...(active.recentHints || []), ...values.map((value) => value.trim()).filter(Boolean)]
  active.recentHints = [...new Set(next)].slice(-MAX_RECENT_HINTS)
}

function extractStrings(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap((item) => extractStrings(item))
  if (value && typeof value === "object") return Object.values(value).flatMap((item) => extractStrings(item))
  return []
}

function extractMessageHints(message: { summary?: { title?: string; body?: string } }, parts: Array<{ type?: string; text?: string }>) {
  return [
    message.summary?.title,
    message.summary?.body,
    ...parts.filter((part) => part.type === "text" || part.type === "reasoning").map((part) => part.text || ""),
  ].filter(Boolean) as string[]
}

function sessionFilesFromDiff(diff: Array<{ file: string }>, worktree: string, scope: string) {
  return [...new Set(
    diff
      .map((entry) => normalizeTrackedFile(entry.file, worktree))
      .filter((file) => file && isInScope(file, scope))
  )].sort()
}

function emptyTrackerState(): TrackerState {
  return {
    entries: {},
  }
}

function normalizeTrackerState(value: unknown): TrackerState {
  if (!value || typeof value !== "object") return emptyTrackerState()

  if ("entries" in value) {
    const candidate = value as Partial<TrackerState>
    return {
      entries: candidate.entries && typeof candidate.entries === "object" ? candidate.entries : {},
    }
  }

  if ("sessionID" in value) {
    const entry = value as ActiveEntry
    return {
      entries: entry.sessionID ? { [entry.sessionID]: entry } : {},
    }
  }

  return emptyTrackerState()
}

function sessionLabel(sessionID: string) {
  return sessionID.slice(0, 8)
}

function activeEntries(state: TrackerState) {
  return Object.values(state.entries)
}

function activeEntriesForWorktree(state: TrackerState, worktree: string) {
  return activeEntries(state).filter((entry) => entry.worktree === worktree)
}

function relatedForkEntries(state: TrackerState, entry: ActiveEntry) {
  return activeEntries(state).filter((candidate) => {
    if (candidate.sessionID === entry.sessionID) return false
    return candidate.lineageRootSessionID && candidate.lineageRootSessionID === entry.lineageRootSessionID
  })
}

function summarize(entries: CompletedEntry[]) {
  const byLabel = new Map<string, number>()
  let totalMs = 0

  for (const entry of entries) {
    totalMs += entry.durationMs
    byLabel.set(entry.label, (byLabel.get(entry.label) || 0) + entry.durationMs)
  }

  const lines = [...byLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, durationMs]) => `- ${label}: ${formatDuration(durationMs)}`)

  return {
    totalMs,
    lines,
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8")
    const parsed = JSON.parse(raw)
    config = {
      ...DEFAULT_CONFIG,
      ...parsed,
      categories: {
        ...DEFAULT_CONFIG.categories,
        ...(parsed.categories || {}),
      },
    }
  } catch (error) {
    if (errorCode(error) !== "ENOENT") {
      console.error("Failed to load time tracker config:", error)
    }
  }
}

async function loadTrackerState() {
  try {
    const raw = await readFile(ACTIVE_FILE, "utf8")
    const parsed = JSON.parse(raw)
    return normalizeTrackerState(parsed)
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (await fileExists(LEGACY_ACTIVE_FILE)) {
        const raw = await readFile(LEGACY_ACTIVE_FILE, "utf8")
        const parsed = JSON.parse(raw)
        return normalizeTrackerState(parsed)
      }
      return emptyTrackerState()
    }
    throw error
  }
}

async function saveTrackerState(state: TrackerState) {
  await mkdir(DATA_DIR, { recursive: true })

  const tempFile = `${ACTIVE_FILE}.tmp`
  await writeFile(tempFile, `${JSON.stringify(state, null, 2)}\n`, "utf8")
  await rename(tempFile, ACTIVE_FILE)
}

async function appendCompletedEntry(entry: CompletedEntry) {
  await mkdir(DATA_DIR, { recursive: true })
  const exists = await fileExists(CSV_FILE)
  if (!exists) {
    await writeFile(CSV_FILE, `${CSV_HEADER.join(",")}\n`, "utf8")
  }

  const row = [
    entry.id,
    entry.label,
    entry.startedAt,
    entry.endedAt,
    entry.durationMs,
    formatDuration(entry.durationMs),
    entry.directory,
    entry.worktree,
    entry.scope,
    entry.agent,
    entry.sessionID,
    entry.category,
    entry.changedFiles.join(";"),
    entry.note,
  ]

  await appendFile(CSV_FILE, `${row.map(csvEscape).join(",")}\n`, "utf8")
}

async function readCompletedEntries() {
  try {
    const raw = await readFile(CSV_FILE, "utf8")
    const lines = raw.split(/\r?\n/).filter(Boolean)
    if (lines.length <= 1) return []

    return lines.slice(1).map((line: string) => {
      const cells = parseCsvLine(line)
      return {
        id: cells[0] || "",
        label: cells[1] || "Untitled task",
        startedAt: cells[2] || "",
        endedAt: cells[3] || "",
        durationMs: Number(cells[4] || 0),
        directory: cells[6] || "",
        worktree: cells[7] || "",
        scope: cells[8] || ".",
        agent: cells[9] || "",
        sessionID: cells[10] || "",
        category: cells[11] || "uncategorized",
        changedFiles: (cells[12] || "").split(";").filter(Boolean),
        note: cells[13] || undefined,
      } satisfies CompletedEntry
    })
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      if (await fileExists(LEGACY_CSV_FILE)) {
        const raw = await readFile(LEGACY_CSV_FILE, "utf8")
        const lines = raw.split(/\r?\n/).filter(Boolean)
        if (lines.length <= 1) return []

        return lines.slice(1).map((line: string) => {
          const cells = parseCsvLine(line)
          return {
            id: cells[0] || "",
            label: cells[1] || "Untitled task",
            startedAt: cells[2] || "",
            endedAt: cells[3] || "",
            durationMs: Number(cells[4] || 0),
            directory: cells[6] || "",
            worktree: cells[7] || "",
            scope: cells[8] || ".",
            agent: cells[9] || "",
            sessionID: cells[10] || "",
            category: cells[11] || "uncategorized",
            changedFiles: (cells[12] || "").split(";").filter(Boolean),
            note: cells[13] || undefined,
          } satisfies CompletedEntry
        })
      }
      return []
    }
    throw error
  }
}

async function fetchSessionLineage(client: any, sessionID: string, directory: string) {
  let currentID: string | undefined = sessionID
  let parentSessionID: string | undefined
  let lineageRootSessionID = sessionID

  while (currentID) {
    const result: { id?: string; parentID?: string | null } | undefined = await client.session.get(
      { sessionID: currentID, directory },
      { responseStyle: "data" }
    ).catch(() => undefined)

    if (!result) break

    lineageRootSessionID = result.id || currentID
    const nextParent: string | undefined = result.parentID || undefined
    if (currentID === sessionID) {
      parentSessionID = nextParent
    }
    currentID = nextParent
  }

  return {
    parentSessionID,
    lineageRootSessionID,
  }
}

function shouldPromptForGap(active: ActiveEntry): boolean {
  if (!active.lastActivityAt) return false

  const idleThresholdMs = config.idleThresholdMinutes * 60 * 1000
  const gap = elapsedMs(active.lastActivityAt, isoNow())
  return gap > idleThresholdMs
}

function formatTimestamp(iso: string) {
  const date = new Date(iso)
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function filterEntriesByRange(entries: CompletedEntry[], range: "today" | "week" | "all") {
  const now = new Date()
  const today = dayKey(now.toISOString())
  const weekStart = new Date(now)
  weekStart.setDate(now.getDate() - 6)
  const weekStartKey = dayKey(weekStart.toISOString())

  return entries.filter((entry: CompletedEntry) => {
    const entryDay = dayKey(entry.startedAt)
    if (range === "all") return true
    if (range === "today") return entryDay === today
    return entryDay >= weekStartKey
  })
}

function categorySummary(entries: CompletedEntry[]) {
  const byCategory = new Map<string, number>()
  for (const entry of entries) {
    byCategory.set(entry.category, (byCategory.get(entry.category) || 0) + entry.durationMs)
  }

  return [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([category, durationMs]) => `${category} ${formatDuration(durationMs)}`)
}

function formatActiveSummary(entry: ActiveEntry) {
  const duration = formatDuration(elapsedMs(entry.startedAt, isoNow()))
  const parent = entry.parentSessionID ? `, forked from ${sessionLabel(entry.parentSessionID)}` : ""
  return `- ${entry.label} (${duration}, session ${sessionLabel(entry.sessionID)}${parent}) in ${entry.directory}`
}

function effectiveEndedAt(entry: ActiveEntry, mode: "auto" | "actual" | "last-activity" | undefined, endedAt: string) {
  if (mode === "last-activity" && entry.lastActivityAt) return entry.lastActivityAt
  if (mode === "auto" && shouldPromptForGap(entry) && entry.lastActivityAt) return entry.lastActivityAt
  return endedAt
}

function stopPromptSummary(entry: ActiveEntry, endedAt: string) {
  const actualDuration = formatDuration(elapsedMs(entry.startedAt, endedAt))
  const lastActivityDuration = entry.lastActivityAt
    ? formatDuration(elapsedMs(entry.startedAt, entry.lastActivityAt))
    : "N/A"
  const lastActivityTime = entry.lastActivityAt
    ? formatTimestamp(entry.lastActivityAt)
    : "unknown"

  return {
    actualDuration,
    lastActivityDuration,
    lastActivityTime,
    line: `- ${entry.label} (${sessionLabel(entry.sessionID)}): last activity ${lastActivityTime}, actual ${actualDuration}, last-activity ${lastActivityDuration}`,
  }
}

function markdownForExport(input: {
  title: string
  range: "today" | "week" | "all"
  entries: CompletedEntry[]
  active: ActiveEntry[]
}) {
  const summary = summarize(input.entries)
  const categories = categorySummary(input.entries)
  const lines = [
    `# ${input.title}`,
    "",
    `- Generated: ${new Date().toISOString()}`,
    `- Range: ${input.range}`,
    `- Total tracked: ${formatDuration(summary.totalMs)}`,
    `- Entries: ${input.entries.length}`,
  ]

  if (categories.length > 0) {
    lines.push("", "## Categories", "")
    for (const category of categories) lines.push(`- ${category}`)
  }

  lines.push("", "## Entries", "")
  if (input.entries.length === 0) {
    lines.push("No completed entries in this range.")
  } else {
    for (const entry of input.entries) {
      lines.push(`### ${entry.label}`)
      lines.push(`- Duration: ${formatDuration(entry.durationMs)}`)
      lines.push(`- Category: ${entry.category}`)
      lines.push(`- Started: ${entry.startedAt}`)
      lines.push(`- Ended: ${entry.endedAt}`)
      lines.push(`- Directory: ${entry.directory}`)
      lines.push(`- Session: ${sessionLabel(entry.sessionID)}`)
      if (entry.changedFiles.length > 0) lines.push(`- Files: ${entry.changedFiles.join(", ")}`)
      if (entry.note) lines.push(`- Note: ${entry.note}`)
      lines.push("")
    }
  }

  if (input.active.length > 0) {
    lines.push("## Active Timers", "")
    for (const entry of input.active) lines.push(formatActiveSummary(entry))
    lines.push("")
  }

  return `${lines.join("\n").trim()}\n`
}

export const TimeTrackerPlugin: Plugin = async ({ client }) => {
  await loadConfig()

  return {
    event: async ({ event }: { event: any }) => {
      if (event.type === "session.updated") {
        const state = await loadTrackerState()
        const sessionID = event.properties?.sessionID
        if (sessionID) {
          const active = state.entries[sessionID]
          if (active) {
            const scope = scopeFor(active.directory, active.worktree)
            const diffs = event.properties?.info?.summary?.diffs
            if (Array.isArray(diffs)) {
              active.sessionFiles = sessionFilesFromDiff(diffs, active.worktree, scope)
            }
            active.lastActivityAt = isoNow()
          }
          await saveTrackerState(state)
        }
      }

      if (event.type === "session.diff") {
        const state = await loadTrackerState()
        const active = state.entries[event.properties?.sessionID]
        if (active) {
          const scope = scopeFor(active.directory, active.worktree)
          active.sessionFiles = sessionFilesFromDiff(event.properties?.diff || [], active.worktree, scope)
          active.lastActivityAt = isoNow()
          active.idleAt = undefined
          await saveTrackerState(state)
        }
      }

      if (event.type === "session.idle") {
        const state = await loadTrackerState()
        const active = state.entries[event.properties?.sessionID]
        if (active) {
          active.lastActivityAt = isoNow()
          active.idleAt = isoNow()
          await saveTrackerState(state)
        }
      }

      if (event.type === "chat.message" || event.type === "tui.command.execute") {
        const sessionID = event.properties?.sessionID || event.sessionID
        if (sessionID) {
          const state = await loadTrackerState()
          const active = state.entries[sessionID]
          if (active) {
            active.lastActivityAt = isoNow()
            active.idleAt = undefined
            await saveTrackerState(state)
          }
        }
      }
    },
    "chat.message": async (input, output) => {
      const state = await loadTrackerState()
      const active = state.entries[input.sessionID]
      if (!active) return

      active.lastActivityAt = isoNow()
      active.idleAt = undefined
      appendHints(active, extractMessageHints(output.message, output.parts as Array<{ type?: string; text?: string }>))
      await saveTrackerState(state)
    },
    "command.execute.before": async (input) => {
      const state = await loadTrackerState()
      const active = state.entries[input.sessionID]
      if (!active) return

      active.lastActivityAt = isoNow()
      active.idleAt = undefined
      appendHints(active, [input.command, input.arguments])
      await saveTrackerState(state)
    },
    "tool.execute.before": async (input, output) => {
      const state = await loadTrackerState()
      const active = state.entries[input.sessionID]
      if (!active) return

      active.lastActivityAt = isoNow()
      active.idleAt = undefined
      appendHints(active, [input.tool, ...extractStrings(output.args)])
      await saveTrackerState(state)
    },
    tool: {
      time_start: tool({
        description: "Start a timer for the current task",
        args: {
          label: tool.schema.string().trim().optional().describe("Short label for the task being timed"),
        },
        async execute(args, context) {
          const state = await loadTrackerState()
          const current = state.entries[context.sessionID]
          if (current) {
            const duration = formatDuration(elapsedMs(current.startedAt, isoNow()))
            return `A timer is already running for "${current.label}" (${duration} so far) in ${current.directory}. Stop it before starting a new one in this session.`
          }

          const sessionMeta = await fetchSessionLineage(client, context.sessionID, context.directory)

          const next: ActiveEntry = {
            id: crypto.randomUUID(),
            label: args.label && args.label.length > 0 ? args.label : "Untitled task",
            startedAt: isoNow(),
            directory: context.directory,
            worktree: context.worktree,
            agent: context.agent,
            sessionID: context.sessionID,
            parentSessionID: sessionMeta.parentSessionID,
            lineageRootSessionID: sessionMeta.lineageRootSessionID,
            lastActivityAt: isoNow(),
            sessionFiles: [],
            recentHints: args.label && args.label.length > 0 ? [args.label] : [],
          }

          state.entries[context.sessionID] = next
          const related = relatedForkEntries(state, next)
          await saveTrackerState(state)

          const suffix = related.length > 0
            ? ` ${related.length} other active fork timer${related.length === 1 ? " is" : "s are"} running in this lineage.`
            : ""
          return `Started timer for "${next.label}" in ${next.directory} at ${next.startedAt}.${suffix}`
        },
      }),
      time_stop: tool({
        description: "Stop the active timer and save the entry",
        args: {
          note: tool.schema.string().trim().optional().describe("Optional note about what was completed"),
          mode: tool.schema.enum(["auto", "actual", "last-activity"]).optional().describe("Stop mode: auto (ask if gap), actual (use now), last-activity (use last message time)"),
          all: tool.schema.boolean().optional().describe("Stop all active timers across all worktrees"),
        },
        async execute(args, context) {
          const state = await loadTrackerState()
          const active = state.entries[context.sessionID]
          const targets = args.all
            ? activeEntries(state)
            : active ? [active] : []

          if (targets.length === 0) {
            return args.all
              ? "No active timers are running."
              : "No active timer is running in this session."
          }

          const endedAt = isoNow()
          const promptTargets = targets.filter((entry) => shouldPromptForGap(entry))

          if (promptTargets.length > 0 && args.mode === undefined) {
            const promptMetadata = promptTargets.map((entry) => ({
              sessionID: entry.sessionID,
              label: entry.label,
              startedAt: entry.startedAt,
              lastActivityAt: entry.lastActivityAt,
            }))

            await context.ask({
              permission: "time-stop",
              patterns: ["actual", "last-activity", "cancel"],
              always: [],
              metadata: {
                all: Boolean(args.all),
                sessions: promptMetadata,
                endedAt,
              },
            })

            if (args.all) {
              const lines = promptTargets.map((entry) => stopPromptSummary(entry, endedAt).line)
              return `The following active timers have idle gaps:
${lines.join("\n")}

How should I stop all active timers?
- actual: Use now (${formatTimestamp(endedAt)}) for every timer
- last-activity: Use each timer's last activity when available
- cancel: Don't stop any timers

Enter your choice:`
            }

            const details = stopPromptSummary(promptTargets[0], endedAt)
            const promptText = `Timer for "${promptTargets[0].label}" started at ${formatTimestamp(promptTargets[0].startedAt)}.
Last activity was at ${details.lastActivityTime}. It's now ${formatTimestamp(endedAt)}.

How should I stop the timer?
- actual: Use now (${formatTimestamp(endedAt)}) - ${details.actualDuration}
- last-activity: Use last activity (${details.lastActivityTime}) - ${details.lastActivityDuration}
- cancel: Don't stop the timer

Enter your choice:`

            return promptText
          }
          const note = args.note && args.note.length > 0 ? args.note : undefined

          const completedEntries: CompletedEntry[] = []
          for (const entry of targets) {
            const actualEndedAt = effectiveEndedAt(entry, args.mode, endedAt)
            const scope = scopeFor(entry.directory, entry.worktree)
            const changedFiles = (entry.sessionFiles || []).filter((file) => isInScope(file, scope))
            const completed: CompletedEntry = {
              ...entry,
              endedAt: actualEndedAt,
              durationMs: elapsedMs(entry.startedAt, actualEndedAt),
              note,
              scope,
              changedFiles,
              category: inferCategory({
                files: changedFiles,
                hints: entry.recentHints || [],
                label: entry.label,
                note,
              }),
            }

            await appendCompletedEntry(completed)
            completedEntries.push(completed)
            delete state.entries[entry.sessionID]
          }

          await saveTrackerState(state)

          if (completedEntries.length > 1) {
            const totalDuration = completedEntries.reduce((sum, entry) => sum + entry.durationMs, 0)
            const categories = [...new Set(completedEntries.map((entry) => entry.category))].join(", ")
            const lines = [
              `Stopped ${completedEntries.length} active timers.`,
              `Total tracked: ${formatDuration(totalDuration)}.`,
            ]
            if (categories) lines.push(`Categories: ${categories}.`)
            if (note) lines.push(`Note: ${note}`)
            return lines.join(" ")
          }

          const completed = completedEntries[0]

          const summary = [
            `Stopped timer for "${completed.label}".`,
            `Duration: ${formatDuration(completed.durationMs)}.`,
            `Directory: ${completed.directory}.`,
            `Category: ${completed.category}.`,
          ]
          if (completed.changedFiles.length > 0) summary.push(`Files: ${completed.changedFiles.slice(0, 5).join(", ")}${completed.changedFiles.length > 5 ? ", ..." : ""}.`)
          if (completed.note) summary.push(`Note: ${completed.note}`)
          return summary.join(" ")
        },
      }),
      time_status: tool({
        description: "Show the current timer status",
        args: {
          all: tool.schema.boolean().optional().describe("Show all active timers across all worktrees"),
        },
        async execute(args, context) {
          const state = await loadTrackerState()
          const active = state.entries[context.sessionID]
          const allInWorktree = activeEntriesForWorktree(state, context.worktree)

          if (args.all) {
            const allTimers = activeEntries(state)
            if (allTimers.length === 0) {
              return `No active timers are running. Completed entries are stored in ${CSV_FILE}.`
            }

            const lines = [
              `Active timers across all worktrees (${allTimers.length}):`,
              ...allTimers.map(formatActiveSummary),
              `Completed entries are stored in ${CSV_FILE}.`,
            ]
            return lines.join("\n")
          }

          if (!active) {
            const others = allInWorktree.length
            const suffix = others > 0 ? ` ${others} other active timer${others === 1 ? " is" : "s are"} running in this worktree; use the all view to inspect them.` : ""
            return `No active timer is running in this session.${suffix} Completed entries are stored in ${CSV_FILE}.`
          }

          const duration = formatDuration(elapsedMs(active.startedAt, isoNow()))
          const lastActivity = active.lastActivityAt
            ? `Last activity: ${formatTimestamp(active.lastActivityAt)}.`
            : "No activity recorded."
          const related = relatedForkEntries(state, active)
          const forkNote = related.length > 0
            ? ` ${related.length} related fork timer${related.length === 1 ? " is" : "s are"} also active.`
            : ""

          return `Active timer: "${active.label}" in ${active.directory}, started at ${formatTimestamp(active.startedAt)} (${duration} elapsed). ${lastActivity}${forkNote} Completed entries are stored in ${CSV_FILE}.`
        },
      }),
      time_report: tool({
        description: "Summarize tracked time for today, this week, or all time",
        args: {
          range: tool.schema.enum(["today", "week", "all"]).default("today").describe("Time range to summarize"),
        },
        async execute(args) {
          const entries = await readCompletedEntries()
          const state = await loadTrackerState()
          const filtered = filterEntriesByRange(entries, args.range)

          if (filtered.length === 0) {
            const activeSuffix = activeEntries(state).length > 0 ? ` Active timers: ${activeEntries(state).length}.` : ""
            return `No tracked entries for ${args.range}. CSV path: ${CSV_FILE}.${activeSuffix}`
          }

          const summary = summarize(filtered)
          const categoryLine = categorySummary(filtered).join(", ")

          const lines = [
            `Time report for ${args.range}:`,
            `Total: ${formatDuration(summary.totalMs)}`,
            `CSV: ${CSV_FILE}`,
            ...summary.lines,
          ]

          if (categoryLine) lines.push(`Categories: ${categoryLine}`)
          if (activeEntries(state).length > 0) lines.push(`Active timers: ${activeEntries(state).length}`)
          return lines.join("\n")
        },
      }),
      time_export: tool({
        description: "Export tracked time to a markdown report",
        args: {
          range: tool.schema.enum(["today", "week", "all"]).default("today").describe("Time range to export"),
          outputPath: tool.schema.string().trim().optional().describe("Optional markdown output path"),
          title: tool.schema.string().trim().optional().describe("Optional report title"),
          includeActive: tool.schema.boolean().optional().describe("Include currently active timers in the report"),
        },
        async execute(args, context) {
          const entries = await readCompletedEntries()
          const state = await loadTrackerState()
          const filtered = filterEntriesByRange(entries, args.range)
          const active = args.includeActive ? activeEntriesForWorktree(state, context.worktree) : []
          const fileName = `time-report-${args.range}-${dayKey(isoNow())}.md`
          const outputPath = args.outputPath && args.outputPath.length > 0
            ? (path.isAbsolute(args.outputPath) ? args.outputPath : path.join(context.directory, args.outputPath))
            : path.join(context.directory, fileName)
          const title = args.title && args.title.length > 0 ? args.title : `Time Report (${args.range})`
          const markdown = markdownForExport({
            title,
            range: args.range,
            entries: filtered,
            active,
          })

          await mkdir(path.dirname(outputPath), { recursive: true })
          await writeFile(outputPath, markdown, "utf8")
          return `Exported ${filtered.length} tracked entr${filtered.length === 1 ? "y" : "ies"} to ${outputPath}.`
        },
      }),
      time_config: tool({
        description: "Show or update time tracker configuration",
        args: {
          action: tool.schema.enum(["show", "list-categories", "add-category"]).optional().describe("Action to perform"),
          categoryName: tool.schema.string().trim().optional().describe("Category name (for add-category)"),
          categoryPatterns: tool.schema.string().trim().optional().describe("Comma-separated patterns (for add-category)"),
        },
        async execute(args) {
          if (args.action === "show" || !args.action) {
            return `Time Tracker Config:
- idleThresholdMinutes: ${config.idleThresholdMinutes}
- CSV file: ${CSV_FILE}
- Categories: ${Object.keys(config.categories).join(", ")}`
          }

          if (args.action === "list-categories") {
            const lines = Object.entries(config.categories).map(
              ([name, patterns]) => `  ${name}: ${patterns.join(", ")}`
            )
            return `Categories:\n${lines.join("\n")}`
          }

          if (args.action === "add-category" && args.categoryName && args.categoryPatterns) {
            const patterns = args.categoryPatterns.split(",").map((p) => p.trim())
            config.categories[args.categoryName] = patterns

            try {
              const raw = await readFile(CONFIG_FILE, "utf8")
              const parsed = JSON.parse(raw)
              const nextConfig = {
                ...DEFAULT_CONFIG,
                ...parsed,
                categories: config.categories,
              }
              await writeFile(CONFIG_FILE, `${JSON.stringify(nextConfig, null, 2)}\n`)
              return `Added category "${args.categoryName}" with patterns: ${patterns.join(", ")}. Config saved.`
            } catch (error) {
              return `Added category "${args.categoryName}" with patterns: ${patterns.join(", ")}. Note: Could not save to ${CONFIG_FILE}.`
            }
          }

          return "Invalid arguments. Use: time_config show, time_config list-categories, or time_config add-category <name> <patterns>"
        },
      }),
    },
  }
}
