import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { triageItems } from "@/db/schema";
import { recordActivity } from "./activity";

export type Priority = "P0" | "P1" | "P2" | "P3" | "none";
export type TriageStatus =
  | "untriaged"
  | "triaged"
  | "in_progress"
  | "needs_review"
  | "blocked"
  | "ready_to_merge"
  | "done"
  | "wontfix";
export type SeverityAssessed =
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW"
  | "NOT_A_BUG";

const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3", "none"];
const STATUSES: TriageStatus[] = [
  "untriaged",
  "triaged",
  "in_progress",
  "needs_review",
  "blocked",
  "ready_to_merge",
  "done",
  "wontfix",
];
const SEVERITIES: SeverityAssessed[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "NOT_A_BUG",
];

export class ItemMutationError extends Error {
  constructor(
    public code: "item_not_found" | "bad_priority" | "bad_status" | "bad_severity" | "no_changes",
    message: string,
  ) {
    super(message);
  }
}

export interface ItemPatch {
  priority?: Priority;
  triageStatus?: TriageStatus;
  severityAssessed?: SeverityAssessed | null;
}

/**
 * Apply a maintainer-driven patch to an item's triage fields. Only the
 * four human-set columns are mutable here — everything else is upstream-
 * derived and overwritten by the poller. Activity log captures before/after.
 */
export async function patchItem(opts: {
  itemNumber: number;
  maintainerId: number;
  patch: ItemPatch;
}): Promise<void> {
  if (
    opts.patch.priority === undefined &&
    opts.patch.triageStatus === undefined &&
    opts.patch.severityAssessed === undefined
  ) {
    throw new ItemMutationError("no_changes", "patch must include at least one field");
  }
  if (
    opts.patch.priority !== undefined &&
    !PRIORITIES.includes(opts.patch.priority)
  ) {
    throw new ItemMutationError(
      "bad_priority",
      `priority must be one of ${PRIORITIES.join(", ")}`,
    );
  }
  if (
    opts.patch.triageStatus !== undefined &&
    !STATUSES.includes(opts.patch.triageStatus)
  ) {
    throw new ItemMutationError(
      "bad_status",
      `triageStatus must be one of ${STATUSES.join(", ")}`,
    );
  }
  if (
    opts.patch.severityAssessed !== undefined &&
    opts.patch.severityAssessed !== null &&
    !SEVERITIES.includes(opts.patch.severityAssessed)
  ) {
    throw new ItemMutationError(
      "bad_severity",
      `severityAssessed must be one of ${SEVERITIES.join(", ")} (or null)`,
    );
  }

  const [existing] = await db
    .select({
      priority: triageItems.priority,
      triageStatus: triageItems.triageStatus,
      severityAssessed: triageItems.severityAssessed,
    })
    .from(triageItems)
    .where(eq(triageItems.number, opts.itemNumber));
  if (!existing) {
    throw new ItemMutationError(
      "item_not_found",
      `item #${opts.itemNumber} not found`,
    );
  }

  const setClause: ItemPatch = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  if (
    opts.patch.priority !== undefined &&
    opts.patch.priority !== existing.priority
  ) {
    setClause.priority = opts.patch.priority;
    before.priority = existing.priority;
    after.priority = opts.patch.priority;
  }
  if (
    opts.patch.triageStatus !== undefined &&
    opts.patch.triageStatus !== existing.triageStatus
  ) {
    setClause.triageStatus = opts.patch.triageStatus;
    before.triageStatus = existing.triageStatus;
    after.triageStatus = opts.patch.triageStatus;
  }
  if (
    opts.patch.severityAssessed !== undefined &&
    opts.patch.severityAssessed !== existing.severityAssessed
  ) {
    setClause.severityAssessed = opts.patch.severityAssessed;
    before.severityAssessed = existing.severityAssessed;
    after.severityAssessed = opts.patch.severityAssessed;
  }

  if (Object.keys(setClause).length === 0) {
    throw new ItemMutationError("no_changes", "patch matches current state");
  }

  await db
    .update(triageItems)
    .set(setClause)
    .where(eq(triageItems.number, opts.itemNumber));

  await recordActivity({
    maintainerId: opts.maintainerId,
    action: "item.patch",
    itemNumber: opts.itemNumber,
    before,
    after,
    broadcast: ["items", "stats", "activity"],
  });
}
