import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { agentTokens, maintainers } from "@/db/schema";

const TOKEN_PREFIX = "mtt_";

export interface IssuedToken {
  /** Raw token string. Shown to the user exactly once — never stored. */
  raw: string;
  /** DB row id. */
  id: number;
  /** Maintainer login this token is bound to. */
  maintainerLogin: string;
  /** Human label for the token (e.g. "review-agent-1"). */
  label: string;
}

export interface VerifiedToken {
  tokenId: number;
  maintainerId: number;
  maintainerLogin: string;
  role: "owner" | "maintainer" | "agent";
  displayName: string | null;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Issue a new token for an existing, active maintainer. The raw token is
 * returned once; only the hash is persisted. Caller surfaces it to the user.
 */
export async function issueToken(
  login: string,
  label: string,
): Promise<IssuedToken> {
  const [m] = await db
    .select()
    .from(maintainers)
    .where(and(eq(maintainers.githubLogin, login), eq(maintainers.isActive, true)));
  if (!m) {
    throw new Error(
      `maintainer "${login}" not in allowlist or inactive — add to config/maintainers.toml and restart server`,
    );
  }

  const raw = TOKEN_PREFIX + randomBytes(24).toString("hex");
  const tokenHash = hashToken(raw);

  const [row] = await db
    .insert(agentTokens)
    .values({ maintainerId: m.id, tokenHash, label })
    .returning({ id: agentTokens.id });
  if (!row) throw new Error("insert returned no row");

  return { raw, id: row.id, maintainerLogin: m.githubLogin, label };
}

/**
 * Verify a token presented by a client. Returns the maintainer context or
 * null. Uses timing-safe comparison to avoid leaking via response time.
 * Also bumps `last_used_at` on successful verification (best-effort).
 */
export async function verifyToken(raw: string): Promise<VerifiedToken | null> {
  if (!raw || !raw.startsWith(TOKEN_PREFIX)) return null;
  const presented = hashToken(raw);

  const rows = await db
    .select({
      tokenId: agentTokens.id,
      tokenHash: agentTokens.tokenHash,
      revokedAt: agentTokens.revokedAt,
      maintainerId: maintainers.id,
      maintainerLogin: maintainers.githubLogin,
      displayName: maintainers.displayName,
      role: maintainers.role,
      isActive: maintainers.isActive,
    })
    .from(agentTokens)
    .innerJoin(maintainers, eq(agentTokens.maintainerId, maintainers.id))
    .where(and(isNull(agentTokens.revokedAt), eq(maintainers.isActive, true)));

  // O(N) over active tokens — fine at the scale we care about (dozens). We
  // need timing-safe compare anyway, so hash-indexed lookup wouldn't change
  // the security posture.
  for (const r of rows) {
    const a = Buffer.from(presented, "hex");
    const b = Buffer.from(r.tokenHash, "hex");
    if (a.length === b.length && timingSafeEqual(a, b)) {
      // best-effort bump; failures here must not block auth.
      db.update(agentTokens)
        .set({ lastUsedAt: new Date() })
        .where(eq(agentTokens.id, r.tokenId))
        .execute()
        .catch(() => {});
      return {
        tokenId: r.tokenId,
        maintainerId: r.maintainerId,
        maintainerLogin: r.maintainerLogin,
        role: r.role,
        displayName: r.displayName,
      };
    }
  }
  return null;
}

export interface TokenSummary {
  id: number;
  login: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listTokens(login?: string): Promise<TokenSummary[]> {
  const where = login
    ? and(eq(maintainers.githubLogin, login), isNull(agentTokens.revokedAt))
    : isNull(agentTokens.revokedAt);
  const rows = await db
    .select({
      id: agentTokens.id,
      login: maintainers.githubLogin,
      label: agentTokens.label,
      createdAt: agentTokens.createdAt,
      lastUsedAt: agentTokens.lastUsedAt,
    })
    .from(agentTokens)
    .innerJoin(maintainers, eq(agentTokens.maintainerId, maintainers.id))
    .where(where);
  return rows;
}

export async function revokeToken(id: number): Promise<boolean> {
  const result = await db
    .update(agentTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(agentTokens.id, id), isNull(agentTokens.revokedAt)))
    .returning({ id: agentTokens.id });
  return result.length > 0;
}
