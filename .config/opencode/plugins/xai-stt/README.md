# xai-stt

Transcribe an audio file with xAI. Always splits speakers (`Speaker 0`, `1`, …).

## Files

| File | Role |
|---|---|
| `index.ts` | OpenCode plugin. Registers the `xai_stt` tool. |
| `../../commands/stt.md` | `/stt` slash command (transcript + summary). |

## Auth

The OpenCode **server** needs `XAI_API_KEY`. Run this in a local Bash terminal
on the server and paste the key at the hidden prompt:

```bash
read -rsp 'xAI API key: ' XAI_KEY; echo
opencode service set env XAI_API_KEY "$XAI_KEY"
unset XAI_KEY
opencode service restart
```

The prompt keeps the key off the screen and out of shell history, though it is
briefly passed as a process argument. Do not put the key in git or chat.

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
