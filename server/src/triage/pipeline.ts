import { classifySeverity, detectNoise } from "./classify";
import { REPO } from "./constants";
import { findDuplicates } from "./duplicates";
import {
  fetchAuthorHistory,
  fetchIssues,
  fetchPrDiff,
  fetchPrs,
} from "./gh";
import {
  analyzePrSuspicion,
  crossReferenceModules,
  extractLinkedIssues,
} from "./prSuspicion";
import type { Issue, PR, SyncOptions, SyncPayload } from "./types";

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

export async function enrichPrs(
  prs: PR[],
  useCache: boolean,
  scanDiffs = true,
): Promise<PR[]> {
  const authorCache = new Map<string, number>();

  for (const pr of prs) {
    if (!authorCache.has(pr.author)) {
      authorCache.set(pr.author, await fetchAuthorHistory(pr.author, useCache));
    }
    let diff = "";
    // Only scan diffs for OPEN PRs (performance + relevance).
    if (scanDiffs && pr.state === "OPEN") {
      diff = await fetchPrDiff(pr.number, useCache);
    }
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
  }
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
