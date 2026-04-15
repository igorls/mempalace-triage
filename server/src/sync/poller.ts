import { resolve } from "node:path";
import { db } from "@/db/client";
import { triageItems } from "@/db/schema";
import { broadcastSnapshots } from "@/api/ws";
import { runSync } from "@/triage";
import type { SyncPayload } from "@/triage";

/**
 * Writes the payload into `triage_items`. Preserves human-set fields
 * (priority, triageStatus, severityAssessed, clusterId) by only updating
 * GitHub-sourced and heuristic columns.
 */
export async function applySyncPayload(payload: SyncPayload): Promise<{
  issues: number;
  prs: number;
}> {
  const now = Date.now();

  const issueRows = payload.issues.map((i) => ({
    number: i.number,
    kind: "issue" as const,
    githubState: i.state,
    githubTitle: i.title,
    githubAuthor: i.author,
    githubBody: i.body ?? "",
    githubLabels: i.labels,
    githubCreatedAt: i.created_at,
    githubClosedAt: i.closed_at,
    githubMergedAt: null,
    prBranch: null,
    prAdditions: null,
    prDeletions: null,
    prFiles: null,
    prLinkedIssues: null,
    severityHeuristic: i.severity,
    modules: i.modules,
    isNoise: i.is_noise,
    noiseReason: i.noise_reason || null,
    isSuspicious: false,
    suspicionLevel: "none" as const,
    suspiciousFlags: [],
    suspiciousContext: [],
    firstTimeAuthor: false,
    lastSyncedAt: new Date(now),
  }));

  const prRows = payload.prs.map((p) => ({
    number: p.number,
    kind: "pr" as const,
    githubState: p.state,
    githubTitle: p.title,
    githubAuthor: p.author,
    githubBody: p.body ?? "",
    githubLabels: p.labels,
    githubCreatedAt: p.created_at,
    githubClosedAt: p.closed_at,
    githubMergedAt: p.merged_at,
    prBranch: p.branch,
    prAdditions: p.additions,
    prDeletions: p.deletions,
    prFiles: p.files,
    prLinkedIssues: p.linked_issues,
    severityHeuristic: "normal" as const,
    modules: p.modules,
    isNoise: false,
    noiseReason: null,
    isSuspicious: p.suspicious_flags.length > 0,
    suspicionLevel: p.suspicion_level,
    suspiciousFlags: p.suspicious_flags,
    suspiciousContext: p.context_notes,
    firstTimeAuthor: p.first_time_author,
    lastSyncedAt: new Date(now),
  }));

  // Issues and PRs share the `number` primary key in GitHub's URL space but
  // NOT in our triage_items.number column (GitHub uses a single sequence).
  // So no collisions: PR #839 and issue #839 cannot both exist.
  const allRows = [...issueRows, ...prRows];

  // One transaction for all upserts — avoids an fsync per row (~100× speedup
  // at this scale). Preserves human-set columns via targeted `set`.
  await db.transaction(async (tx) => {
    for (const row of allRows) {
      await tx
        .insert(triageItems)
        .values(row)
        .onConflictDoUpdate({
          target: triageItems.number,
          set: {
            kind: row.kind,
            githubState: row.githubState,
            githubTitle: row.githubTitle,
            githubAuthor: row.githubAuthor,
            githubBody: row.githubBody,
            githubLabels: row.githubLabels,
            githubCreatedAt: row.githubCreatedAt,
            githubClosedAt: row.githubClosedAt,
            githubMergedAt: row.githubMergedAt,
            prBranch: row.prBranch,
            prAdditions: row.prAdditions,
            prDeletions: row.prDeletions,
            prFiles: row.prFiles,
            prLinkedIssues: row.prLinkedIssues,
            severityHeuristic: row.severityHeuristic,
            modules: row.modules,
            isNoise: row.isNoise,
            noiseReason: row.noiseReason,
            isSuspicious: row.isSuspicious,
            suspicionLevel: row.suspicionLevel,
            suspiciousFlags: row.suspiciousFlags,
            suspiciousContext: row.suspiciousContext,
            firstTimeAuthor: row.firstTimeAuthor,
            lastSyncedAt: row.lastSyncedAt,
          },
        });
    }
  });

  return { issues: issueRows.length, prs: prRows.length };
}

export async function pollOnce(options?: {
  skipDiffs?: boolean;
  noCache?: boolean;
  broadcast?: boolean;
}): Promise<{ issues: number; prs: number; fetchedAt: string }> {
  const payload = await runSync(options);
  const counts = await applySyncPayload(payload);
  if (options?.broadcast ?? true) {
    await broadcastSnapshots(["items", "stats", "activity"]);
  }
  return { ...counts, fetchedAt: payload.fetched_at };
}

const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 15 * 60_000);

export function startPollerLoop(): { stop: () => void } {
  let stopped = false;
  let timer: Timer | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const res = await pollOnce({ skipDiffs: true });
      console.log(
        `[poller] synced ${res.issues} issues + ${res.prs} PRs @ ${res.fetchedAt}`,
      );
    } catch (err) {
      console.error("[poller] error:", err);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      }
    }
  };

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

// CLI: `bun src/sync/poller.ts --once`
if (import.meta.main) {
  const once = process.argv.includes("--once");
  const noCache = process.argv.includes("--no-cache");

  if (once) {
    const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");
    const { db: _db } = await import("@/db/client");
    migrate(_db, { migrationsFolder: resolve(import.meta.dir, "../db/migrations") });
    const res = await pollOnce({ skipDiffs: true, noCache });
    console.log(`[poller] ${res.issues} issues + ${res.prs} PRs @ ${res.fetchedAt}`);
    process.exit(0);
  }
}
