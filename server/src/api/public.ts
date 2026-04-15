import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";
import { db } from "@/db/client";
import {
  activityLog,
  claims,
  maintainers,
  triageItems,
} from "@/db/schema";

const priorityEnum = t.Union([
  t.Literal("P0"),
  t.Literal("P1"),
  t.Literal("P2"),
  t.Literal("P3"),
  t.Literal("none"),
]);

const statusEnum = t.Union([
  t.Literal("untriaged"),
  t.Literal("triaged"),
  t.Literal("in_progress"),
  t.Literal("needs_review"),
  t.Literal("blocked"),
  t.Literal("ready_to_merge"),
  t.Literal("done"),
  t.Literal("wontfix"),
]);

const kindEnum = t.Union([t.Literal("issue"), t.Literal("pr")]);
const stateEnum = t.Union([t.Literal("OPEN"), t.Literal("CLOSED"), t.Literal("MERGED")]);

export const publicApi = new Elysia({ prefix: "/api" })
  // ─── GET /api/items ────────────────────────────────────────────────────────
  .get(
    "/items",
    async ({ query }) => {
      const filters = [];
      if (query.priority) filters.push(eq(triageItems.priority, query.priority));
      if (query.status) filters.push(eq(triageItems.triageStatus, query.status));
      if (query.kind) filters.push(eq(triageItems.kind, query.kind));
      if (query.state) filters.push(eq(triageItems.githubState, query.state));

      const whereClause = filters.length > 0 ? and(...filters) : undefined;

      const rows = await db
        .select({
          number: triageItems.number,
          kind: triageItems.kind,
          state: triageItems.githubState,
          title: triageItems.githubTitle,
          author: triageItems.githubAuthor,
          authorRole: maintainers.role,
          labels: triageItems.githubLabels,
          createdAt: triageItems.githubCreatedAt,
          closedAt: triageItems.githubClosedAt,
          mergedAt: triageItems.githubMergedAt,
          priority: triageItems.priority,
          triageStatus: triageItems.triageStatus,
          severityAssessed: triageItems.severityAssessed,
          severityHeuristic: triageItems.severityHeuristic,
          modules: triageItems.modules,
          isNoise: triageItems.isNoise,
          isSuspicious: triageItems.isSuspicious,
          suspicionLevel: triageItems.suspicionLevel,
          suspiciousFlags: triageItems.suspiciousFlags,
          firstTimeAuthor: triageItems.firstTimeAuthor,
          prBranch: triageItems.prBranch,
          prAdditions: triageItems.prAdditions,
          prDeletions: triageItems.prDeletions,
          prLinkedIssues: triageItems.prLinkedIssues,
        })
        .from(triageItems)
        .leftJoin(
          maintainers,
          and(
            eq(triageItems.githubAuthor, maintainers.githubLogin),
            eq(maintainers.isActive, true),
          ),
        )
        .where(whereClause)
        .orderBy(desc(triageItems.number))
        .limit(query.limit ?? 500);

      const activeClaims = await db
        .select({
          itemNumber: claims.itemNumber,
          maintainerLogin: maintainers.githubLogin,
          maintainerDisplayName: maintainers.displayName,
          intent: claims.intent,
          claimedAt: claims.claimedAt,
          expiresAt: claims.expiresAt,
          heartbeatAt: claims.heartbeatAt,
        })
        .from(claims)
        .innerJoin(maintainers, eq(claims.maintainerId, maintainers.id))
        .where(isNull(claims.releasedAt));

      const claimByItem = new Map<number, (typeof activeClaims)[number]>();
      for (const c of activeClaims) claimByItem.set(c.itemNumber, c);

      return rows.map((r) => ({
        ...r,
        claim: claimByItem.get(r.number) ?? null,
      }));
    },
    {
      query: t.Object({
        priority: t.Optional(priorityEnum),
        status: t.Optional(statusEnum),
        kind: t.Optional(kindEnum),
        state: t.Optional(stateEnum),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 2000 })),
      }),
    },
  )

  // ─── GET /api/items/:number ────────────────────────────────────────────────
  .get(
    "/items/:number",
    async ({ params, status }) => {
      const [row] = await db
        .select()
        .from(triageItems)
        .where(eq(triageItems.number, params.number));
      if (!row) return status(404, { error: "not_found" });

      const [author] = await db
        .select({ role: maintainers.role })
        .from(maintainers)
        .where(
          and(
            eq(maintainers.githubLogin, row.githubAuthor),
            eq(maintainers.isActive, true),
          ),
        );
      const authorRole = author?.role ?? null;

      const [activeClaim] = await db
        .select({
          itemNumber: claims.itemNumber,
          maintainerLogin: maintainers.githubLogin,
          maintainerDisplayName: maintainers.displayName,
          intent: claims.intent,
          claimedAt: claims.claimedAt,
          expiresAt: claims.expiresAt,
          heartbeatAt: claims.heartbeatAt,
          note: claims.note,
        })
        .from(claims)
        .innerJoin(maintainers, eq(claims.maintainerId, maintainers.id))
        .where(
          and(
            eq(claims.itemNumber, params.number),
            isNull(claims.releasedAt),
          ),
        );

      return { ...row, authorRole, claim: activeClaim ?? null };
    },
    {
      params: t.Object({ number: t.Numeric() }),
    },
  )

  // ─── GET /api/stats ────────────────────────────────────────────────────────
  .get("/stats", async () => {
    const count = (condition: string) =>
      sql<number>`coalesce(sum(case when ${sql.raw(condition)} then 1 else 0 end), 0)`;
    const [counts] = await db
      .select({
        total: sql<number>`count(*)`,
        openIssues: count("kind = 'issue' AND github_state = 'OPEN'"),
        openPrs: count("kind = 'pr' AND github_state = 'OPEN'"),
        mergedPrs: count("kind = 'pr' AND github_state = 'MERGED'"),
        closedPrs: count("kind = 'pr' AND github_state = 'CLOSED'"),
        p0: count("priority = 'P0'"),
        p1: count("priority = 'P1'"),
        inProgress: count("triage_status = 'in_progress'"),
        blocked: count("triage_status = 'blocked'"),
        suspicious: count("is_suspicious = 1 AND github_state = 'OPEN'"),
        // Per-level suspicion breakdown across OPEN PRs.
        suspicionCritical: count(
          "suspicion_level = 'critical' AND github_state = 'OPEN'",
        ),
        suspicionHigh: count(
          "suspicion_level = 'high' AND github_state = 'OPEN'",
        ),
        suspicionMedium: count(
          "suspicion_level = 'medium' AND github_state = 'OPEN'",
        ),
        suspicionLow: count(
          "suspicion_level = 'low' AND github_state = 'OPEN'",
        ),
        heuristicCritical: count(
          "severity_heuristic = 'critical' AND github_state = 'OPEN'",
        ),
        heuristicHigh: count(
          "severity_heuristic = 'high' AND github_state = 'OPEN'",
        ),
      })
      .from(triageItems);

    const [claimCount] = await db
      .select({ active: sql<number>`count(*)` })
      .from(claims)
      .where(isNull(claims.releasedAt));

    return { ...counts, activeClaims: claimCount?.active ?? 0 };
  })

  // ─── GET /api/activity ─────────────────────────────────────────────────────
  .get(
    "/activity",
    async ({ query }) => {
      const rows = await db
        .select({
          id: activityLog.id,
          ts: activityLog.ts,
          action: activityLog.action,
          itemNumber: activityLog.itemNumber,
          maintainerLogin: maintainers.githubLogin,
          maintainerDisplayName: maintainers.displayName,
          before: activityLog.before,
          after: activityLog.after,
        })
        .from(activityLog)
        .leftJoin(maintainers, eq(activityLog.maintainerId, maintainers.id))
        .orderBy(desc(activityLog.ts))
        .limit(query.limit ?? 100);
      return rows;
    },
    {
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 500 })),
      }),
    },
  )

  // ─── GET /api/maintainers ──────────────────────────────────────────────────
  .get("/maintainers", async () => {
    const rows = await db
      .select({
        login: maintainers.githubLogin,
        displayName: maintainers.displayName,
        role: maintainers.role,
        lastSeenAt: maintainers.lastSeenAt,
      })
      .from(maintainers)
      .where(eq(maintainers.isActive, true));
    return rows;
  });
