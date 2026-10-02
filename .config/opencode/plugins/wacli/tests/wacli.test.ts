import assert from "node:assert/strict"
import { mkdtemp, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { buildArgs, invoke } from "../index.ts"

test("CLI arguments preserve literal text and cannot inject flags", () => {
  const malicious = "--store=/elsewhere; $(touch /tmp/nope)\n'quoted'"
  const args = buildArgs("send_text", { to: "15551234567", message: malicious })
  assert.ok(args.includes(`--message=${malicious}`))
  assert.ok(!args.includes("--message-escapes"))
  assert.deepEqual(buildArgs("contacts_search", { query: malicious }).slice(-2), ["--", malicious])
  assert.deepEqual(buildArgs("messages_search", { query: "--help", chat: "--store=bad" }).slice(-3), ["--chat=--store=bad", "--", "--help"])
  assert.ok(buildArgs("messages_list", {}).includes("--limit=50"))
  assert.ok(buildArgs("status", {}).includes("--read-only"))
  assert.throws(() => buildArgs("send_text", { to: "Alice", message: "hello" }), /exact/)
  assert.throws(() => buildArgs("send_file", { to: "15551234567", file: "relative.txt" }), /absolute/)
  assert.throws(() => buildArgs("messages_list", { limit: 201 }), /limit/)
  assert.throws(() => buildArgs("send_text", { to: "15551234567" }), /Missing/)
  assert.throws(() => buildArgs("chats", { query: "a\0b" }), /NUL/)
  assert.throws(() => buildArgs("status", { query: "anything" }), /Unexpected/)
})

test("subprocess JSON, missing executable, bounded output, cancellation, and no send retries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wacli-plugin-test-"))
  const binary = join(directory, "mock-wacli")
  const previous = process.env.WACLI_BINARY
  process.env.WACLI_BINARY = binary
  try {
    const mock = async (body: string) => writeFile(binary, `#!${process.execPath}\n${body}\n`, { mode: 0o700 })
    await mock('console.log(JSON.stringify({success:true,data:{authenticated:false,args:process.argv.slice(2)}}))')
    assert.equal(JSON.parse(await invoke("status", {})).data.authenticated, false)
    const message = "--help; $(echo injected)\nhello"
    assert.ok(JSON.parse(await invoke("send_text", { to: "15551234567", message })).data.args.includes(`--message=${message}`))
    await mock('process.stdout.write("x".repeat(2 * 1024 * 1024))')
    await assert.rejects(invoke("chats", {}), /exceeded 1 MiB/)
    await mock('console.log("not JSON")')
    await assert.rejects(invoke("status", {}), /invalid JSON/)
    await mock('console.log(JSON.stringify({success:false,error:"unavailable"}))')
    await assert.rejects(invoke("status", {}), /reported failure/)
    const marker = join(directory, "attempts")
    await mock(`require("node:fs").appendFileSync(${JSON.stringify(marker)}, "attempt\\n"); process.stderr.write("offline"); process.exit(1)`)
    await assert.rejects(invoke("send_text", { to: "15551234567", message: "private text" }), (error: Error) => {
      assert.match(error.message, /Delivery may have occurred/)
      assert.ok(!error.message.includes("private text"))
      return true
    })
    const { readFile } = await import("node:fs/promises")
    assert.equal(await readFile(marker, "utf8"), "attempt\n")
    await assert.rejects(invoke("send_text", { to: "15551234567", message: "cancelled" }, AbortSignal.abort()), /before starting/)
    assert.equal(await readFile(marker, "utf8"), "attempt\n")
    await mock('setInterval(() => {}, 1000)')
    const controller = new AbortController()
    const pending = invoke("status", {}, controller.signal)
    controller.abort()
    await assert.rejects(pending, /cancelled/)
    process.env.WACLI_BINARY = join(directory, "missing")
    await assert.rejects(invoke("status", {}), /executable not found/)
  } finally {
    if (previous === undefined) delete process.env.WACLI_BINARY
    else process.env.WACLI_BINARY = previous
    await rm(directory, { recursive: true, force: true })
  }
})
