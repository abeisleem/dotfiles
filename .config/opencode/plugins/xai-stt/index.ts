import { Plugin } from "@opencode/plugin"
import { readFile, writeFile, stat } from "node:fs/promises"
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path"

const DEFAULT_STT_URL = "https://api.x.ai/v1/stt"
const DEFAULT_MODEL = "grok-voice-transcribe-2.0"
const MAX_BYTES = 500 * 1024 * 1024

const AUDIO_EXT = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".opus",
  ".flac",
  ".aac",
  ".mp4",
  ".m4a",
  ".mkv",
])

type PluginOptions = {
  apiKey?: string
  baseURL?: string
  model?: string
}

type SttInput = {
  path: string
  output?: string
  language?: string
  model?: string
}

type SttWord = {
  text: string
  start: number
  end: number
  speaker?: number
}

type SttResult = {
  text?: string
  language?: string
  duration?: number
  words?: SttWord[]
}

function resolveApiKey(options: PluginOptions): string | undefined {
  const fromOptions = typeof options.apiKey === "string" ? options.apiKey.trim() : ""
  if (fromOptions) return fromOptions
  return process.env.XAI_API_KEY?.trim() || undefined
}

function resolveAudioPath(input: string, root: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith("file://")) {
    return resolve(new URL(trimmed).pathname)
  }
  if (isAbsolute(trimmed)) return resolve(trimmed)
  return resolve(root, trimmed)
}

function defaultOutputPath(audioPath: string): string {
  const dir = dirname(audioPath)
  const name = basename(audioPath, extname(audioPath))
  return join(dir, `${name}-transcript.md`)
}

function mimeFor(audioPath: string): string {
  switch (extname(audioPath).toLowerCase()) {
    case ".mp3":
      return "audio/mpeg"
    case ".wav":
      return "audio/wav"
    case ".ogg":
      return "audio/ogg"
    case ".opus":
      return "audio/opus"
    case ".flac":
      return "audio/flac"
    case ".aac":
      return "audio/aac"
    case ".mp4":
      return "audio/mp4"
    case ".m4a":
      return "audio/mp4"
    case ".mkv":
      return "video/x-matroska"
    default:
      return "application/octet-stream"
  }
}

function timestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
}

function speakerSections(words: SttWord[]): string {
  if (!words.length || !words.some((w) => w.speaker != null)) return ""
  const lines: string[] = []
  let cur: number | undefined
  let buf: string[] = []
  let start = 0

  const flush = () => {
    if (!buf.length) return
    lines.push(`**Speaker ${cur}** [${timestamp(start)}]\n${buf.join(" ")}\n`)
  }

  for (const w of words) {
    if (w.speaker !== cur && buf.length) {
      flush()
      buf = []
      start = w.start ?? 0
      cur = w.speaker
    } else if (!buf.length) {
      start = w.start ?? 0
      cur = w.speaker
    }
    buf.push(w.text)
  }
  flush()
  return lines.join("\n")
}

function renderMarkdown(args: {
  audioPath: string
  model: string
  result: SttResult
}): string {
  const speakers = speakerSections(args.result.words ?? []).trim()
  const body =
    speakers ||
    (args.result.text?.trim()
      ? `_(No speaker labels in the API response; undiarized text.)_\n\n${args.result.text.trim()}`
      : "(empty)")
  return `# Transcript

- **Source:** \`${args.audioPath}\`
- **STT:** ${args.model} (xAI)
- **Duration:** ${args.result.duration ?? "unknown"}s
- **Language:** ${args.result.language ?? "unknown"}
- **Speakers:** numbered (Speaker 0, 1, …). Filename / title order is **not** identity. Names belong in the summary.

---

${body}
`
}

export default Plugin.define({
  id: "abe.xai-stt",
  async setup(ctx) {
    const options = (ctx.options ?? {}) as PluginOptions
    const root = ctx.location.directory

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "xai",
        description: "xAI speech-to-text",
      })
      editor.add({
        name: "stt",
        description:
          "Transcribe an audio file with xAI STT. Always diarizes (Speaker 0, 1, …). Writes <name>-transcript.md beside the audio (or output). Path may be inside or outside the workspace. Needs XAI_API_KEY on the OpenCode server. Does not write the Granola summary — /stt does that next.",
        input: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "Audio file path. Absolute or relative to the project. wav, mp3, m4a, mp4, ogg, flac, aac, opus, mkv.",
            },
            output: {
              type: "string",
              description: "Optional markdown path. Default: <audio-basename>-transcript.md next to the audio.",
            },
            language: {
              type: "string",
              description: "Language code for number/currency formatting. Default en.",
            },
            model: {
              type: "string",
              description: "grok-voice-transcribe-2.0 (default) or grok-voice-transcribe-1.0",
            },
          },
          required: ["path"],
          additionalProperties: false,
        },
        options: { namespace: "xai", codemode: true },
        async execute(raw, context) {
          const input = raw as SttInput
          const apiKey = resolveApiKey(options)
          if (!apiKey) {
            return {
              content:
                "Missing XAI_API_KEY. `opencode service set env XAI_API_KEY '…'` then `opencode service restart`. Do not paste the key into chat.",
            }
          }

          const audioPath = resolveAudioPath(input.path, root)
          const ext = extname(audioPath).toLowerCase()
          if (!AUDIO_EXT.has(ext)) {
            return { content: `Unsupported audio extension "${ext}". Use: ${[...AUDIO_EXT].join(", ")}` }
          }

          let info
          try {
            info = await stat(audioPath)
          } catch {
            return { content: `Audio file not found: ${audioPath}` }
          }
          if (!info.isFile()) return { content: `Not a file: ${audioPath}` }
          if (info.size > MAX_BYTES) {
            return { content: `File is ${info.size} bytes; xAI STT max is 500 MB.` }
          }

          const model = input.model?.trim() || options.model || DEFAULT_MODEL
          const language = input.language?.trim() || "en"
          const endpoint = options.baseURL?.trim() || DEFAULT_STT_URL
          const outputPath = input.output
            ? resolveAudioPath(input.output, root)
            : defaultOutputPath(audioPath)

          await context.progress({ status: "uploading audio to xAI STT" })

          const bytes = await readFile(audioPath)
          const form = new FormData()
          form.append("model", model)
          form.append("language", language)
          form.append("format", "true")
          form.append("diarize", "true")
          form.append(
            "file",
            new File([new Uint8Array(bytes)], basename(audioPath), { type: mimeFor(audioPath) }),
          )

          const response = await fetch(endpoint, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}` },
            body: form,
            signal: context.signal,
          })

          const rawBody = await response.text()
          if (!response.ok) {
            return { content: `xAI STT failed (${response.status}): ${rawBody.slice(0, 2000)}` }
          }

          let result: SttResult
          try {
            result = JSON.parse(rawBody) as SttResult
          } catch {
            return { content: `xAI STT returned non-JSON: ${rawBody.slice(0, 1000)}` }
          }

          await writeFile(outputPath, renderMarkdown({ audioPath, model, result }), "utf8")

          const preview = (result.text ?? "").trim().slice(0, 600)
          return {
            content: [
              `Wrote transcript: ${outputPath}`,
              `Duration: ${result.duration ?? "?"}s`,
              `Language: ${result.language ?? "?"}`,
              `Words: ${result.words?.length ?? 0}`,
              preview ? `\nPreview:\n${preview}${result.text && result.text.length > 600 ? "…" : ""}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
          }
        },
      })
    })
  },
})
