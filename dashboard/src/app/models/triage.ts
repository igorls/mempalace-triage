export type Priority = 'P0' | 'P1' | 'P2' | 'P3' | 'none';
export type TriageStatus =
  | 'untriaged'
  | 'triaged'
  | 'in_progress'
  | 'needs_review'
  | 'blocked'
  | 'ready_to_merge'
  | 'done'
  | 'wontfix';
export type Kind = 'issue' | 'pr';
export type GithubState = 'OPEN' | 'CLOSED' | 'MERGED';
export type ClaimIntent = 'triage' | 'review' | 'fix' | 'investigate';
export type MaintainerRole = 'owner' | 'maintainer' | 'agent';
export type SuspicionLevel = 'critical' | 'high' | 'medium' | 'low' | 'none';
export type ConnectionState = 'connecting' | 'open' | 'closed';
export type Topic = 'items' | 'stats' | 'activity' | 'claims';

export interface ActiveClaim {
  itemNumber: number;
  maintainerLogin: string;
  maintainerDisplayName: string | null;
  intent: ClaimIntent;
  claimedAt: number;
  expiresAt: number;
  heartbeatAt: number;
}

export interface TriageItem {
  number: number;
  kind: Kind;
  state: GithubState;
  title: string;
  author: string;
  /** null = external contributor; otherwise the author is on the maintainers allowlist. */
  authorRole: MaintainerRole | null;
  labels: string[];
  createdAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  priority: Priority;
  triageStatus: TriageStatus;
  severityAssessed: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NOT_A_BUG' | null;
  severityHeuristic: 'critical' | 'high' | 'normal';
  modules: string[];
  isNoise: boolean;
  isSuspicious: boolean;
  /** Highest-severity tier of any suspicious flag; `'none'` if none fired. */
  suspicionLevel: SuspicionLevel;
  suspiciousFlags: string[];
  firstTimeAuthor: boolean;
  prBranch: string | null;
  prAdditions: number | null;
  prDeletions: number | null;
  prLinkedIssues: number[] | null;
  claim: ActiveClaim | null;
}

export interface Stats {
  total: number;
  openIssues: number;
  openPrs: number;
  mergedPrs: number;
  closedPrs: number;
  p0: number;
  p1: number;
  inProgress: number;
  blocked: number;
  suspicious: number;
  suspicionCritical: number;
  suspicionHigh: number;
  suspicionMedium: number;
  suspicionLow: number;
  heuristicCritical: number;
  heuristicHigh: number;
  activeClaims: number;
}

export interface Maintainer {
  login: string;
  displayName: string | null;
  role: 'owner' | 'maintainer' | 'agent';
  lastSeenAt: number | null;
}

export interface ActivityEntry {
  id: number;
  ts: number;
  action: string;
  itemNumber: number | null;
  maintainerLogin: string | null;
  maintainerDisplayName: string | null;
  before: unknown;
  after: unknown;
}
