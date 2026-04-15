import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

// ─── maintainers ──────────────────────────────────────────────────────────────

export const maintainers = sqliteTable(
  "maintainers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    githubLogin: text("github_login").notNull(),
    githubId: integer("github_id"),
    displayName: text("display_name"),
    role: text("role", { enum: ["owner", "maintainer", "agent"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp_ms" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  },
  (t) => ({
    loginUniq: uniqueIndex("maintainers_login_uniq").on(t.githubLogin),
  }),
);

// ─── agent_tokens ─────────────────────────────────────────────────────────────

export const agentTokens = sqliteTable(
  "agent_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    maintainerId: integer("maintainer_id")
      .notNull()
      .references(() => maintainers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    revokedAt: integer("revoked_at", { mode: "timestamp_ms" }),
  },
  (t) => ({
    hashUniq: uniqueIndex("agent_tokens_hash_uniq").on(t.tokenHash),
    maintainerIdx: index("agent_tokens_maintainer_idx").on(t.maintainerId),
  }),
);

// ─── triage_items ─────────────────────────────────────────────────────────────

export const triageItems = sqliteTable(
  "triage_items",
  {
    number: integer("number").primaryKey(),
    kind: text("kind", { enum: ["issue", "pr"] }).notNull(),
    githubState: text("github_state").notNull(),
    githubTitle: text("github_title").notNull(),
    githubAuthor: text("github_author").notNull(),
    githubBody: text("github_body").notNull().default(""),
    githubLabels: text("github_labels", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    githubCreatedAt: text("github_created_at").notNull(),
    githubClosedAt: text("github_closed_at"),
    githubMergedAt: text("github_merged_at"),
    prBranch: text("pr_branch"),
    prAdditions: integer("pr_additions"),
    prDeletions: integer("pr_deletions"),
    prFiles: text("pr_files", { mode: "json" }).$type<string[]>(),
    prLinkedIssues: text("pr_linked_issues", { mode: "json" }).$type<number[]>(),
    priority: text("priority", {
      enum: ["P0", "P1", "P2", "P3", "none"],
    })
      .notNull()
      .default("none"),
    triageStatus: text("triage_status", {
      enum: [
        "untriaged",
        "triaged",
        "in_progress",
        "needs_review",
        "blocked",
        "ready_to_merge",
        "done",
        "wontfix",
      ],
    })
      .notNull()
      .default("untriaged"),
    severityAssessed: text("severity_assessed", {
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW", "NOT_A_BUG"],
    }),
    severityHeuristic: text("severity_heuristic", {
      enum: ["critical", "high", "normal"],
    })
      .notNull()
      .default("normal"),
    modules: text("modules", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    isNoise: integer("is_noise", { mode: "boolean" }).notNull().default(false),
    noiseReason: text("noise_reason"),
    isSuspicious: integer("is_suspicious", { mode: "boolean" })
      .notNull()
      .default(false),
    suspicionLevel: text("suspicion_level", {
      enum: ["critical", "high", "medium", "low", "none"],
    })
      .notNull()
      .default("none"),
    suspiciousFlags: text("suspicious_flags", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    suspiciousContext: text("suspicious_context", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'`),
    firstTimeAuthor: integer("first_time_author", { mode: "boolean" })
      .notNull()
      .default(false),
    clusterId: integer("cluster_id"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => ({
    statusIdx: index("triage_items_status_idx").on(t.triageStatus),
    priorityIdx: index("triage_items_priority_idx").on(t.priority),
    kindStateIdx: index("triage_items_kind_state_idx").on(t.kind, t.githubState),
  }),
);

// ─── claims (soft locks) ──────────────────────────────────────────────────────

export const claims = sqliteTable(
  "claims",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemNumber: integer("item_number")
      .notNull()
      .references(() => triageItems.number, { onDelete: "cascade" }),
    maintainerId: integer("maintainer_id")
      .notNull()
      .references(() => maintainers.id, { onDelete: "cascade" }),
    intent: text("intent", {
      enum: ["triage", "review", "fix", "investigate"],
    }).notNull(),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    heartbeatAt: integer("heartbeat_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    releasedAt: integer("released_at", { mode: "timestamp_ms" }),
    note: text("note"),
  },
  (t) => ({
    activeUniq: uniqueIndex("claims_active_uniq")
      .on(t.itemNumber)
      .where(sql`${t.releasedAt} IS NULL`),
    maintainerIdx: index("claims_maintainer_idx").on(t.maintainerId),
  }),
);

// ─── tags ─────────────────────────────────────────────────────────────────────

export const tags = sqliteTable(
  "tags",
  {
    itemNumber: integer("item_number")
      .notNull()
      .references(() => triageItems.number, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdBy: integer("created_by")
      .notNull()
      .references(() => maintainers.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.itemNumber, t.tag] }),
  }),
);

// ─── notes ────────────────────────────────────────────────────────────────────

export const notes = sqliteTable(
  "notes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemNumber: integer("item_number")
      .notNull()
      .references(() => triageItems.number, { onDelete: "cascade" }),
    maintainerId: integer("maintainer_id")
      .notNull()
      .references(() => maintainers.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    visibility: text("visibility", { enum: ["public", "maintainers"] })
      .notNull()
      .default("maintainers"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
  },
  (t) => ({
    itemIdx: index("notes_item_idx").on(t.itemNumber),
  }),
);

// ─── clusters ─────────────────────────────────────────────────────────────────

export const clusters = sqliteTable("clusters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  canonicalItemNumber: integer("canonical_item_number").notNull(),
  summary: text("summary").notNull(),
  createdBy: integer("created_by")
    .notNull()
    .references(() => maintainers.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsec') * 1000)`),
});

// ─── activity_log ─────────────────────────────────────────────────────────────

export const activityLog = sqliteTable(
  "activity_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsec') * 1000)`),
    maintainerId: integer("maintainer_id").references(() => maintainers.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    itemNumber: integer("item_number"),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
  },
  (t) => ({
    tsIdx: index("activity_ts_idx").on(t.ts),
    itemIdx: index("activity_item_idx").on(t.itemNumber),
  }),
);
