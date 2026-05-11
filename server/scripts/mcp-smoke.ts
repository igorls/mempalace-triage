/**
 * Smoke test for the MCP server. Connects via streamable HTTP, lists tools,
 * runs whoami + claim/note/release flow, and prints results. Run while the
 * server is up on PORT (default 17809):
 *
 *   PORT=17809 TRIAGE_TOKEN=mtt_xxx bun run scripts/mcp-smoke.ts
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = process.env.PORT ?? "17809";
const TOKEN = process.env.TRIAGE_TOKEN;
if (!TOKEN) {
  console.error("TRIAGE_TOKEN env var required (mtt_...)");
  process.exit(2);
}

const transport = new StreamableHTTPClientTransport(
  new URL(`http://localhost:${PORT}/mcp`),
  {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  },
);

const client = new Client({ name: "mcp-smoke", version: "0.1.0" });
await client.connect(transport);

async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as Array<{ type: string; text?: string }>)
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("\n");
  console.log(`\n── ${name}${res.isError ? " (error)" : ""} ──`);
  console.log(text);
  return res;
}

console.log("=== tools/list ===");
const tools = await client.listTools();
console.log(tools.tools.map((t) => t.name).join(", "));

await call("triage_whoami");
await call("triage_list_items", {
  kind: "pr",
  prMergeState: "CLEAN",
  prChecksConclusion: "success",
  onlyUnclaimed: true,
  limit: 3,
});
await call("triage_claim_item", {
  number: 1447,
  intent: "review",
  note: "mcp smoke test",
});
await call("triage_add_note", {
  number: 1447,
  body: "MCP-driven review: ran the test harness, output matches.",
});
await call("triage_patch_item", {
  number: 1447,
  triageStatus: "needs_review",
});
await call("triage_get_item", { number: 1447 });
await call("triage_release", { number: 1447, reason: "smoke done" });
await call("triage_recent_activity", { limit: 6 });

await client.close();
console.log("\n✓ MCP smoke complete");
process.exit(0);
