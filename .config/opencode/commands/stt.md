---
description: Transcribe audio (xAI, numbered speakers) then Granola-style summary
agent: general
subagent: true
---

Transcribe this recording, then summarize it. The whole command already runs in a child session — keep the parent free.

**Audio path:** $1

**Call context / topics (lens, not a filter):** $2

## Step 1 — transcript

Call the `xai_stt` tool with `path` set to the audio path above (absolute or workspace-relative is fine).

- Diarize is always on. The file is **speaker turns only** (no duplicate full-text block).
- Leave Speaker 0, Speaker 1, … in the transcript. Do **not** rename speakers in that file.
- Do not print API keys.
- Note the written `*-transcript.md` path.

If `$1` is empty, stop and say the usage is:

`/stt /path/to/memo.m4a optional topics and who was on the call`

## Step 2 — summary (background subagent)

After the transcript exists, spawn a **background** `general` subagent. Give it the transcript path, this topics/context string, and these rules:

Write a sibling file `*-summary.md` (same directory and basename as the transcript, `-summary` instead of `-transcript`).

Read **only** the speaker-turn transcript. Do not expect or use a “full text” section.

Granola style:

- Title, then `#` sections with bullets
- No fluff, no long quotes unless a phrase is load-bearing
- Capture decisions, numbers, names, next steps, owners
- Sections that fit what was actually said (drop empty ones), typically: context / who; state of play; product; GTM; money; ops; decisions; open questions; next steps

Topics/context are a **lens**: lead with those themes when they appear. Still record other decisions, numbers, commitments, and next steps — including side threads that matter. Do not invent. If unclear, say so.

Speakers (do this first, with evidence):

- The file name, title, and `$2` list **who might be on the call**. They do **not** mean Speaker 0 = first name. `Alice x Bob.m4a` is not a mapping.
- Map Speaker N → name only from **what they said** (self-reference, “I talked to X”, family names, jobs, “I’ll get back to him”). Quote one short proof per mapping in a Speakers list, e.g. `Speaker 0 = Abe — said they spoke to River yesterday`.
- If two mappings are equally plausible, **keep Speaker N** in the summary. Wrong names are worse than numbers.
- In the summary body, use names only after that evidence list.
- Do **not** rewrite the transcript file.

When done, report the transcript path and the summary path.
