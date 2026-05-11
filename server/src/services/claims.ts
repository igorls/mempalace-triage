import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { claims, maintainers, triageItems } from "@/db/schema";
import { recordActivity } from "./activity";

export type Intent = "triage" | "review" | "fix" | "investigate";
const INTENTS: Intent[] = ["triage", "review", "fix", "investigate"];

/** Default claim TTL — 30 minutes. Heartbeat extends. */
const DEFAULT_TTL_MS = 30 * 60_000;
const MAX_TTL_MS = 4 * 60 * 60_000;

export class ClaimError extends Error {
  constructor(
    public code:
      | "item_not_found"
      | "already_claimed"
      | "not_owner"
      | "no_active_claim"
      | "bad_intent"
      | "bad_ttl",
    message: string,
  ) {
    super(message);
  }
}

export interface ActiveClaim {
  id: number;
  itemNumber: number;
  maintainerId: number;
  maintainerLogin: string;
  intent: Intent;
  claimedAt: Date;
  expiresAt: Date;
  heartbeatAt: Date;
  note: string | null;
}

async function loadActiveClaim(itemNumber: number): Promise<ActiveClaim | null> {
  const [row] = await db
    .select({
      id: claims.id,
      itemNumber: claims.itemNumber,
      maintainerId: claims.maintainerId,
      maintainerLogin: maintainers.githubLogin,
      intent: claims.intent,
      claimedAt: claims.claimedAt,
      expiresAt: claims.expiresAt,
      heartbeatAt: claims.heartbeatAt,
      note: claims.note,
    })
    .from(claims)
    .innerJoin(maintainers, eq(claims.maintainerId, maintainers.id))
    .where(and(eq(claims.itemNumber, itemNumber), isNull(claims.releasedAt)));
  return row ?? null;
}

export async function getActiveClaim(
  itemNumber: number,
): Promise<ActiveClaim | null> {
  return loadActiveClaim(itemNumber);
}

function clampTtl(ttlMs?: number): number {
  if (!ttlMs) return DEFAULT_TTL_MS;
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new ClaimError("bad_ttl", "ttl must be a positive number of ms");
  }
  return Math.min(ttlMs, MAX_TTL_MS);
}

export async function claimItem(opts: {
  itemNumber: number;
  maintainerId: number;
  intent: Intent;
  ttlMs?: number;
  note?: string | null;
}): Promise<ActiveClaim> {
  if (!INTENTS.includes(opts.intent)) {
    throw new ClaimError(
      "bad_intent",
      `intent must be one of ${INTENTS.join(", ")}`,
    );
  }
  const ttl = clampTtl(opts.ttlMs);
  const [item] = await db
    .select({ number: triageItems.number })
    .from(triageItems)
    .where(eq(triageItems.number, opts.itemNumber));
  if (!item) {
    throw new ClaimError("item_not_found", `item #${opts.itemNumber} not found`);
  }

  // Reap expired claims for this item before checking. A claim whose
  // expiresAt is past is treated as released by the next claimant.
  const now = Date.now();
  const existing = await loadActiveClaim(opts.itemNumber);
  if (existing && existing.expiresAt.getTime() > now) {
    if (existing.maintainerId !== opts.maintainerId) {
      throw new ClaimError(
        "already_claimed",
        `item #${opts.itemNumber} is claimed by @${existing.maintainerLogin} until ${existing.expiresAt.toISOString()}`,
      );
    }
    // Same maintainer re-claiming → treat as heartbeat with possible intent change.
    return await heartbeatClaim({
      itemNumber: opts.itemNumber,
      maintainerId: opts.maintainerId,
      ttlMs: ttl,
      note: opts.note,
    });
  }
  if (existing) {
    // expired — release it implicitly so the unique active-claim index is free.
    await db
      .update(claims)
      .set({ releasedAt: new Date() })
      .where(eq(claims.id, existing.id));
  }

  const [inserted] = await db
    .insert(claims)
    .values({
      itemNumber: opts.itemNumber,
      maintainerId: opts.maintainerId,
      intent: opts.intent,
      expiresAt: new Date(now + ttl),
      note: opts.note ?? null,
    })
    .returning({ id: claims.id });
  if (!inserted) throw new Error("claim insert returned no row");

  const fresh = await loadActiveClaim(opts.itemNumber);
  if (!fresh) throw new Error("claim insert reported success but no active row found");

  await recordActivity({
    maintainerId: opts.maintainerId,
    action: "claim.create",
    itemNumber: opts.itemNumber,
    after: {
      intent: fresh.intent,
      expiresAt: fresh.expiresAt.toISOString(),
      note: fresh.note,
    },
    broadcast: ["items", "activity", "stats", "claims"],
  });

  return fresh;
}

export async function heartbeatClaim(opts: {
  itemNumber: number;
  maintainerId: number;
  ttlMs?: number;
  note?: string | null;
}): Promise<ActiveClaim> {
  const ttl = clampTtl(opts.ttlMs);
  const existing = await loadActiveClaim(opts.itemNumber);
  if (!existing) {
    throw new ClaimError(
      "no_active_claim",
      `item #${opts.itemNumber} has no active claim`,
    );
  }
  if (existing.maintainerId !== opts.maintainerId) {
    throw new ClaimError(
      "not_owner",
      `item #${opts.itemNumber} is claimed by @${existing.maintainerLogin}, not you`,
    );
  }
  const now = new Date();
  await db
    .update(claims)
    .set({
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + ttl),
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    })
    .where(eq(claims.id, existing.id));

  const fresh = await loadActiveClaim(opts.itemNumber);
  if (!fresh) throw new Error("heartbeat ran but claim row vanished");
  return fresh;
}

export async function releaseClaim(opts: {
  itemNumber: number;
  maintainerId: number;
  /** Owners can release any active claim regardless of who owns it. */
  isOwnerOverride?: boolean;
  /** Optional release reason — recorded on the activity log. */
  reason?: string;
}): Promise<void> {
  const existing = await loadActiveClaim(opts.itemNumber);
  if (!existing) {
    throw new ClaimError(
      "no_active_claim",
      `item #${opts.itemNumber} has no active claim`,
    );
  }
  if (
    !opts.isOwnerOverride &&
    existing.maintainerId !== opts.maintainerId
  ) {
    throw new ClaimError(
      "not_owner",
      `item #${opts.itemNumber} is claimed by @${existing.maintainerLogin}, not you`,
    );
  }
  await db
    .update(claims)
    .set({ releasedAt: new Date() })
    .where(eq(claims.id, existing.id));

  await recordActivity({
    maintainerId: opts.maintainerId,
    action: opts.isOwnerOverride && existing.maintainerId !== opts.maintainerId
      ? "claim.force_release"
      : "claim.release",
    itemNumber: opts.itemNumber,
    before: {
      claimedBy: existing.maintainerLogin,
      intent: existing.intent,
    },
    after: opts.reason ? { reason: opts.reason } : null,
    broadcast: ["items", "activity", "stats", "claims"],
  });
}
