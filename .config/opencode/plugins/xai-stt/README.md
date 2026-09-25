# xai-stt

Transcribe an audio file with xAI. Always splits speakers (`Speaker 0`, `1`, …).

## Files

| File | Role |
|---|---|
| `index.ts` | OpenCode plugin. Registers the `xai_stt` tool. |
| `../../commands/stt.md` | `/stt` slash command (transcript + summary). |

## Auth

The OpenCode **server** needs `XAI_API_KEY`:

```bash
opencode service set env XAI_API_KEY 'xai-...'
opencode service restart
```

Do not put the key in git.

## `/stt`

```text
/stt "/path/to/audio file.m4a" "optional topics and who was on the call"
```

| Arg | Meaning |
|---|---|
| `$1` | Audio path (wav, mp3, m4a, mp4, ogg, flac, aac, opus, mkv). Absolute or relative to the project. |
| `$2` | Rest of the line. What the call is about and who was there. Optional. Used as a **lens** for the summary, not a filter. |

Always diarizes. Writes `<audio-basename>-transcript.md` next to the file (speaker turns only), then `<audio-basename>-summary.md`.

Do not treat filename order as speaker identity. The summary should map Speaker N → names from what they said, with a one-line proof, or keep the numbers.

## Tool only

Agents can call `xai_stt` with `path` (required) and optional `output`, `language`, `model`. That writes the transcript only — no summary.
