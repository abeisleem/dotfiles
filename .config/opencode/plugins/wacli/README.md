# WhatsApp plugin

`plugins/wacli/index.ts` registers Code Mode tools under `tools.whatsapp`:
`status`, `chats`, `contacts_search`, `messages_list`, `messages_search`,
`messages_show`, `send_text`, and `send_file`.

Requires wacli v0.20.0 at `$HOME/.local/bin/wacli`, or an absolute
`WACLI_BINARY` set in the OpenCode server environment. Uses wacli's normal
store/account configuration (including `WACLI_STORE_DIR`). Pair and run sync
outside the agent. Reads use the local database; `status` checks local pairing,
not connectivity or sync freshness.

```js
await tools.whatsapp.status({})
await tools.whatsapp.chats({ query: "Alice", limit: 10 })
await tools.whatsapp.messages_list({ chat: "15551234567@s.whatsapp.net", limit: 20 })
await tools.whatsapp.send_text({ to: "15551234567@s.whatsapp.net", message: "Hello" })
```

Sends accept exact user/group JIDs or international phone numbers, not names.
Files require absolute host paths. Send errors/cancellation can leave delivery
uncertain: inspect the conversation before deciding whether to send again.
There are no plugin retries, pairing tools, or arbitrary command execution.
Read processes have a 25-second deadline; sends have 100 seconds. Each output
stream is capped at 1 MiB; list/search limits are 1–200, default 50.

From `.config/opencode`, verify without sending real messages:

```sh
node --experimental-strip-types --test plugins/wacli/tests/wacli.test.ts
./node_modules/.bin/tsc --ignoreConfig --noEmit --skipLibCheck --strict --target es2022 --module nodenext --moduleResolution nodenext --types node --allowImportingTsExtensions plugins/wacli/index.ts plugins/wacli/tests/wacli.test.ts
```
