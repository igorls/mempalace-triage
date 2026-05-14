import { classifySeverity, detectNoise } from "./classify";
import { REPO } from "./constants";
import { findDuplicates } from "./duplicates";
import {
  fetchAuthorHistory,
  fetchIssues,
  fetchPrChecks,
  fetchPrDiff,
  fetchPrs,
} from "./gh";
import {
  analyzePrSuspicion,
  crossReferenceModules,
  extractLinkedIssues,
} from "./prSuspicion";
import type {
  ChecksConclusion,
  CheckRun,
  Issue,
  PR,
  SyncOptions,
  SyncPayload,
} from "./types";

export function enrichIssues(issues: Issue[]): Issue[] {
  for (const i of issues) {
    i.severity = classifySeverity(i);
    const noise = detectNoise(i);
    i.is_noise = noise.isNoise;
    i.noise_reason = noise.reason;
    i.modules = crossReferenceModules(`${i.title}\n${i.body}`);
  }
  return issues;
}

/**
 * Roll up an array of CI check runs into a single conclusion. Any FAILURE/
 * CANCELLED/TIMED_OUT/ACTION_REQUIRED → failure. Anything not COMPLETED yet
 * → pending. All COMPLETED + SUCCESS/NEUTRAL/SKIPPED → success.
 */
export function rollUpChecks(checks: CheckRun[]): ChecksConclusion {
  if (checks.length === 0) return "none";
  let anyFailure = false;
  let anyPending = false;
  for (const c of checks) {
    const conclusion = (c.conclusion ?? "").toUpperCase();
    const status = (c.status ?? "").toUpperCase();
    if (
      conclusion === "FAILURE" ||
      conclusion === "CANCELLED" ||
      conclusion === "TIMED_OUT" ||
      conclusion === "ACTION_REQUIRED" ||
      conclusion === "STARTUP_FAILURE"
    ) {
      anyFailure = true;
    } else if (status && status !== "COMPLETED") {
      anyPending = true;
    } else if (!conclusion && !status) {
      anyPending = true;
    }
  }
  if (anyFailure) return "failure";
  if (anyPending) return "pending";
  return "success";
}

/**
 * Per-PR refresh of mergeability + CI rollup. Bulk `fetchPrs` returns
 * `mergeable`/`merge_state_status` reliably for most PRs but ships
 * `statusCheckRollup` empty for many. For OPEN PRs we always call through
 * to {@link fetchPrChecks} (cached) to get the actual check list, and use
 * the per-PR response to override stale bulk values where needed.
 */
async function refreshPrMergeability(pr: PR, useCache: boolean): Promise<void> {
  if (pr.state !== "OPEN") {
    // CLOSED/MERGED PRs: no point hitting the API for checks. Mark whatever
    // we have as final-state.
    pr.checks_conclusion = rollUpChecks(pr.checks);
    return;
  }
  try {
    const detail = await fetchPrChecks(pr.number, useCache);
    if (detail.mergeable) pr.mergeable = detail.mergeable as PR["mergeable"];
    if (detail.mergeStateStatus) {
      pr.merge_state_status = detail.mergeStateStatus as PR["merge_state_status"];
    }
    if (detail.reviewDecision !== undefined) {
      // gh returns "" (not null) when no review is required — normalize to null.
      pr.review_decision = (detail.reviewDecision || null) as PR["review_decision"];
    }
    pr.checks = (detail.statusCheckRollup ?? []).map((c) => ({
      name: c.name ?? "",
      conclusion: c.conclusion ?? null,
      status: c.status ?? null,
      workflow: c.workflowName ?? null,
    }));
  } catch (err) {
    console.error(`[triage] fetchPrChecks #${pr.number} failed:`, err);
  }
  pr.checks_conclusion = rollUpChecks(pr.checks);
}

async function runWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await fn(items[currentIndex]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function enrichPrs(
  prs: PR[],
  useCache: boolean,
  scanDiffs = true,
): Promise<PR[]> {
  const authorCache = new Map<string, number>();
  const uniqueAuthors = [...new Set(prs.map((p) => p.author))];

  // 1. Fetch author histories with controlled concurrency
  await runWithLimit(uniqueAuthors, 10, async (author) => {
    const count = await fetchAuthorHistory(author, useCache);
    authorCache.set(author, count);
  });

  // 2. Process PRs: diffs, suspicion, and mergeability
  await runWithLimit(prs, 10, async (pr) => {
    const diffPromise = (scanDiffs && pr.state === "OPEN")
      ? fetchPrDiff(pr.number, useCache)
      : Promise.resolve("");

    const mergeabilityPromise = refreshPrMergeability(pr, useCache);

    // Fetch diff and mergeability concurrently for this PR
    const [diff] = await Promise.all([diffPromise, mergeabilityPromise]);
    
    const { hardFlags, contextNotes, suspicionLevel } = analyzePrSuspicion(
      pr,
      diff,
      authorCache.get(pr.author) ?? 0,
    );
    pr.suspicious_flags = hardFlags;
    pr.suspicion_level = suspicionLevel;
    pr.context_notes = contextNotes;
    pr.modules = crossReferenceModules(`${pr.title}\n${pr.body}`, pr.files);
    pr.linked_issues = extractLinkedIssues(pr);
  });

  return prs;
}

/**
 * End-to-end pipeline: fetch → enrich → dedup. Returns the canonical
 * SyncPayload shape consumed by the poller.
 */
export async function runSync(options: SyncOptions = {}): Promise<SyncPayload> {
  const useCache = !options.noCache;

  const rawIssues = await fetchIssues(useCache);
  const issues = enrichIssues(rawIssues);

  const rawPrs = await fetchPrs(useCache);
  const prs = await enrichPrs(rawPrs, useCache, !options.skipDiffs);

  const duplicates = findDuplicates(issues);

  return {
    fetched_at: new Date().toISOString(),
    repo: REPO,
    issues,
    prs,
    duplicates,
  };
}
