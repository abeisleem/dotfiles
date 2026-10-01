import { Plugin } from "@opencode/plugin"
import { execFile } from "node:child_process"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"

type Input = {
  query?: string
  limit?: number
  chat?: string
  after?: string
  before?: string
  id?: string
  to?: string
  message?: string
  file?: string
  caption?: string
  replyTo?: string
}

const text = (description: string) => ({ type: "string" as const, minLength: 1, description })
const limit = { type: "integer" as const, minimum: 1, maximum: 200, description: "Maximum results (default 50)." }
const chat = text("Exact chat JID from chats/search results.")
const query = text("Search query.")
const filters = {
  chat,
  after: text("Only after this time: RFC3339 or YYYY-MM-DD."),
  before: text("Only before this time: RFC3339 or YYYY-MM-DD."),
  limit,
}
const recipient = {
  to: text("Exact recipient JID or international phone number; resolve names with chats or contacts_search first."),
  replyTo: text("Optional message ID to quote from this chat."),
}

const definitions = {
  status: {
    description: "Check local WhatsApp pairing status without connecting or starting pairing. Unpaired returns authenticated: false.",
    properties: {}, required: [], command: ["auth", "status"],
  },
  chats: {
    description: "List/search chats in the local WhatsApp sync database.",
    properties: { query, limit }, required: [], command: ["chats", "list"],
  },
  contacts_search: {
    description: "Search contacts in locally synced WhatsApp metadata.",
    properties: { query, limit }, required: ["query"], command: ["contacts", "search"],
  },
  messages_list: {
    description: "List locally synced messages, newest first. Use before/after to narrow results.",
    properties: filters, required: [], command: ["messages", "list"],
  },
  messages_search: {
    description: "Search locally synced messages (FTS5 syntax when available, otherwise LIKE).",
    properties: { ...filters, query }, required: ["query"], command: ["messages", "search"],
  },
  messages_show: {
    description: "Read one locally synced message by chat JID and message ID.",
    properties: { chat, id: text("Message ID.") }, required: ["chat", "id"], command: ["messages", "show"],
  },
  send_text: {
    description: "Send a WhatsApp text message once. Never automatically retry failures: delivery may have occurred. Resolve the intended recipient first.",
    properties: { ...recipient, message: text("Literal message text (backslash escapes are not expanded).") },
    required: ["to", "message"], command: ["send", "text"],
  },
  send_file: {
    description: "Send a local file via WhatsApp once (automatic image/video/audio/document detection). Never automatically retry failures: delivery may have occurred.",
    properties: { ...recipient, file: text("Absolute path to a file on the OpenCode host."), caption: text("Optional caption.") },
    required: ["to", "file"], command: ["send", "file"],
  },
} as const

export type Action = keyof typeof definitions

// Equals-form flags and a positional separator keep user text out of CLI option parsing.
export function buildArgs(action: Action, input: Input): string[] {
  const definition = definitions[action]
  if (!definition) throw new Error("Unknown WhatsApp action")
  for (const key of Object.keys(input)) {
    if (!(key in definition.properties)) throw new Error(`Unexpected input: ${key}`)
  }
  for (const key of definition.required) {
    if (input[key as keyof Input] === undefined) throw new Error(`Missing input: ${key}`)
  }
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (key === "limit") {
      if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 200) throw new Error("limit must be an integer from 1 to 200")
    } else if (typeof value !== "string" || !value.length || value.includes("\0")) {
      throw new Error(`${key} must be a nonempty string without NUL characters`)
    }
  }
  if (input.file && !isAbsolute(input.file)) throw new Error("file must be an absolute path on the OpenCode host")
  if (input.to && !/^(?:\+?[1-9]\d{5,14}|[\d:-]+@(?:s\.whatsapp\.net|g\.us|lid))$/.test(input.to)) {
    throw new Error("to must be an exact WhatsApp user/group JID or international phone number, not a display name")
  }
  const sending = action.startsWith("send_")
  const args = ["--json", `--timeout=${sending ? "90s" : "20s"}`, ...(sending ? ["--lock-wait=5s"] : ["--read-only"]), ...definition.command]
  if ("limit" in definition.properties) args.push(`--limit=${input.limit ?? 50}`)
  const positional = action === "contacts_search" || action === "messages_search"
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || key === "limit" || (key === "query" && positional)) continue
    args.push(`--${key === "replyTo" ? "reply-to" : key}=${value}`)
  }
  if (positional) args.push("--", input.query!)
  return args
}

export async function invoke(action: Action, input: Input, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new Error("wacli cancelled before starting.")
  const args = buildArgs(action, input)
  const binary = process.env.WACLI_BINARY || join(homedir(), ".local", "bin", "wacli")
  if (!isAbsolute(binary)) throw new Error("WACLI_BINARY must be an absolute executable path")
  const sending = action.startsWith("send_")
  const uncertain = sending ? " Delivery may have occurred; do not automatically retry. Check the conversation first." : ""
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, {
      encoding: "utf8", shell: false, signal,
      timeout: sending ? 100_000 : 25_000,
      killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code
        const reason = code === "ENOENT"
          ? `wacli executable not found at ${binary}; install wacli or set WACLI_BINARY to its absolute path.`
          : code === "ABORT_ERR" ? "wacli cancelled."
          : code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "wacli output exceeded 1 MiB; narrow the query or lower limit."
          : error.killed ? "wacli timed out or was terminated."
          : `wacli failed (${code ?? "unknown"}): ${(stderr.trim() || stdout.trim() || "No diagnostic output").slice(0, 4000)}`
        // Do not include error.message: execFile embeds the command and private message text.
        reject(new Error(reason + (code === "ENOENT" ? "" : uncertain)))
        return
      }
      try {
        const result = JSON.parse(stdout)
        if (result?.success === false) {
          reject(new Error(`wacli reported failure: ${JSON.stringify(result.error ?? "Unknown error").slice(0, 4000)}${uncertain}`))
          return
        }
        resolve(JSON.stringify(result))
      } catch {
        reject(new Error(`wacli returned invalid JSON.${uncertain}`))
      }
    })
    // No interactive input, including pairing, is possible through these tools.
    child.stdin?.end()
  })
}

export default Plugin.define({
  id: "abe.whatsapp",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.namespace({ name: "whatsapp", description: "Personal WhatsApp via wacli: read the local sync database and send messages. Reads reflect the last external sync; status checks local pairing, not live connectivity." })
      for (const [name, definition] of Object.entries(definitions)) {
        tools.add({
          name,
          description: definition.description,
          input: { type: "object", properties: definition.properties, required: [...definition.required], additionalProperties: false },
          options: { namespace: "whatsapp", codemode: true },
          async execute(input, context) {
            return { content: await invoke(name as Action, input as Input, context.signal) }
          },
        })
      }
    })
  },
})
