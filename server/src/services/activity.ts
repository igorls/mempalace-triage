import { db } from "@/db/client";
import { activityLog } from "@/db/schema";
import { broadcastSnapshots } from "@/api/ws";

/**
 * Record a mutation in `activity_log` and broadcast updated snapshots to
 * any subscribed WebSocket clients. Every claim/note/status change should
 * funnel through here so the audit trail is complete.
 *
 * `before` and `after` are JSON-serialized into the row. Pass the
 * minimally-relevant slice — they're not diffed automatically.
 */
export async function recordActivity(opts: {
  maintainerId: number | null;
  action: string;
  itemNumber: number | null;
  before?: unknown;
  after?: unknown;
  /** Which WS topics to refresh. Default: items+activity+stats. */
  broadcast?: Array<"items" | "stats" | "activity" | "claims">;
}): Promise<void> {
  await db.insert(activityLog).values({
    maintainerId: opts.maintainerId,
    action: opts.action,
    itemNumber: opts.itemNumber,
    before: opts.before ?? null,
    after: opts.after ?? null,
  });
  // Fire-and-forget broadcast — never block the mutation on WS clients.
  const topics = opts.broadcast ?? ["items", "stats", "activity"];
  broadcastSnapshots(topics).catch((err) => {
    console.error("[activity] broadcast failed:", err);
  });
}
