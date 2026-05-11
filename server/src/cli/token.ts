import { resolve } from "node:path";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { db } from "@/db/client";
import { syncMaintainersFromConfig } from "@/auth/allowlist";
import { issueToken, listTokens, revokeToken } from "@/services/tokens";

const HELP = `Usage: bun run src/cli/token.ts <command> [args]

Manage agent tokens for the mempalace-triage server.

Commands:
  issue <github-login> <label>   Mint a new token for an allowlisted maintainer.
                                 The raw token is printed once — store it now.
  list [github-login]            List active tokens (optionally filtered by login).
  revoke <id>                    Revoke a token by id.

Examples:
  bun run src/cli/token.ts issue igorls review-agent-1
  bun run src/cli/token.ts list
  bun run src/cli/token.ts revoke 3
`;

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "-h" || cmd === "--help") {
    process.stdout.write(HELP);
    return cmd ? 0 : 1;
  }

  // Make sure the schema is up to date and the allowlist is seeded before any
  // token op. Running the CLI on a clean checkout should "just work".
  migrate(db, { migrationsFolder: resolve(import.meta.dir, "../db/migrations") });
  await syncMaintainersFromConfig();

  if (cmd === "issue") {
    const [login, label] = rest;
    if (!login || !label) {
      console.error("error: `issue` requires <github-login> <label>");
      return 2;
    }
    try {
      const t = await issueToken(login, label);
      console.log(`Issued token id=${t.id} for ${t.maintainerLogin} (${t.label}):`);
      console.log(`  ${t.raw}`);
      console.log("");
      console.log("Save this now — it will never be shown again.");
      return 0;
    } catch (err) {
      console.error("error:", (err as Error).message);
      return 1;
    }
  }

  if (cmd === "list") {
    const [login] = rest;
    const tokens = await listTokens(login);
    if (tokens.length === 0) {
      console.log(login ? `No active tokens for ${login}.` : "No active tokens.");
      return 0;
    }
    console.log(
      ["id", "login", "label", "created", "last-used"].join("\t"),
    );
    for (const t of tokens) {
      console.log(
        [
          t.id,
          t.login,
          t.label,
          t.createdAt.toISOString().slice(0, 19) + "Z",
          t.lastUsedAt ? t.lastUsedAt.toISOString().slice(0, 19) + "Z" : "—",
        ].join("\t"),
      );
    }
    return 0;
  }

  if (cmd === "revoke") {
    const id = Number(rest[0]);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("error: `revoke` requires a positive integer id");
      return 2;
    }
    const ok = await revokeToken(id);
    if (!ok) {
      console.error(`error: no active token with id=${id}`);
      return 1;
    }
    console.log(`Revoked token id=${id}.`);
    return 0;
  }

  console.error(`error: unknown command "${cmd}"`);
  process.stdout.write(HELP);
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
