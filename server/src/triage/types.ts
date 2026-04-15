export type IssueState = "OPEN" | "CLOSED";
export type PrState = "OPEN" | "CLOSED" | "MERGED";
export type Severity = "critical" | "high" | "normal";

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
