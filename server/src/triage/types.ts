export type IssueState = "OPEN" | "CLOSED";
export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type Severity = "critical" | "high" | "normal";

// GitHub `pullRequest.mergeable` — the structural conflict state.
export type Mergeable = "MERGEABLE" | "CONFLICTING" | "UNKNOWN";

// GitHub `pullRequest.mergeStateStatus` — combined mergeability across
// conflicts, CI, reviews, and branch protections. UNKNOWN means GitHub
// hadn't computed it yet at fetch time.
export type MergeStateStatus =
  | "CLEAN"
  | "DIRTY"
  | "BLOCKED"
  | "BEHIND"
  | "UNSTABLE"
  | "HAS_HOOKS"
  | "DRAFT"
  | "UNKNOWN";

// GitHub `pullRequest.reviewDecision` — null when no review is required.
export type ReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED"
  | null;

// Rolled-up CI conclusion across `statusCheckRollup`. `none` means no
// checks have run (or none were configured).
export type ChecksConclusion = "success" | "failure" | "pending" | "none";

export interface CheckRun {
  name: string;
  conclusion: string | null;
  status: string | null;
  workflow: string | null;
}

// Re-exported for downstream consumers (DB, API, dashboard DTOs).
export type { SuspicionLevel } from "./constants";

export interface Issue {
  number: number;
  title: string;
  state: IssueState;
  labels: string[];
  author: string;
  body: string;
  created_at: string;
  closed_at: string | null;
  severity: Severity;
  is_noise: boolean;
  noise_reason: string;
  modules: string[];
}

export interface PR {
  number: number;
  title: string;
  state: PrState;
  labels: string[];
  author: string;
  body: string;
  branch: string;
  created_at: string;
  merged_at: string | null;
  closed_at: string | null;
  files: string[];
  additions: number;
  deletions: number;
  suspicious_flags: string[];
  /**
   * Highest-severity flag matched by {@link analyzePrSuspicion}. Derived, not
   * sent by GitHub. `"none"` means no hard flags fired.
   */
  suspicion_level: import("./constants").SuspicionLevel;
  context_notes: string[];
  modules: string[];
  linked_issues: number[];
  first_time_author: boolean;
  /**
   * GitHub mergeability + CI rollup. Bulk `gh pr list` returns reliable
   * `mergeable`/`merge_state_status` for most PRs; `checks` requires a
   * per-PR `gh pr view` refresh (handled by {@link enrichPrs}).
   */
  mergeable: Mergeable;
  merge_state_status: MergeStateStatus;
  review_decision: ReviewDecision;
  /** Derived rollup across `checks`. `none` if no checks ran. */
  checks_conclusion: ChecksConclusion;
  checks: CheckRun[];
}

export interface DuplicatePair {
  a: number;
  b: number;
  similarity: number;
}

export interface SyncPayload {
  fetched_at: string;
  repo: string;
  issues: Issue[];
  prs: PR[];
  duplicates: DuplicatePair[];
}

export interface SyncOptions {
  skipDiffs?: boolean;
  noCache?: boolean;
}
