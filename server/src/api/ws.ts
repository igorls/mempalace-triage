import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
// (and is used for the leftJoin condition below)
import { db } from "@/db/client";
import {
  activityLog,
  claims,
  maintainers,
  triageItems,
} from "@/db/schema";

type Topic = "items" | "stats" | "activity" | "claims";
const ALL_TOPICS: Topic[] = ["items", "stats", "activity", "claims"];

interface ServerMessage {
  topic: Topic;
  type: "snapshot" | "updated" | "claimed" | "released" | "appended";
  payload: unknown;
}

type WS = {
  id: string | number;
  subscribed: Set<Topic>;
  send: (data: string) => number;
};

const sockets = new Map<string | number, WS>();

export function broadcast(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const s of sockets.values()) {
    if (s.subscribed.has(msg.topic)) s.send(data);
  }
}

// ─── snapshot builders ───────────────────────────────────────────────────────

async function buildItemsSnapshot() {
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
    .orderBy(desc(triageItems.number))
    .limit(1000);

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

  return rows.map((r) => ({ ...r, claim: claimByItem.get(r.number) ?? null }));
}

async function buildStatsSnapshot() {
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
}

async function buildActivitySnapshot() {
  return await db
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
    .limit(50);
}

async function buildSnapshot(topic: Topic): Promise<unknown> {
  switch (topic) {
    case "items":
      return await buildItemsSnapshot();
    case "stats":
      return await buildStatsSnapshot();
    case "activity":
      return await buildActivitySnapshot();
    case "claims":
      return []; // claims live inside items.claim; topic exists for future delta events
  }
}

// ─── helpers for poller/MCP tools to push updates ────────────────────────────

export async function broadcastSnapshots(topics: Topic[] = ALL_TOPICS) {
  for (const topic of topics) {
    const payload = await buildSnapshot(topic);
    broadcast({ topic, type: "snapshot", payload });
  }
}

// ─── Elysia WS plugin ────────────────────────────────────────────────────────

export const wsApi = new Elysia().ws("/ws", {
  body: t.Object({
    subscribe: t.Optional(
      t.Array(
        t.Union([
          t.Literal("items"),
          t.Literal("stats"),
          t.Literal("activity"),
          t.Literal("claims"),
        ]),
      ),
    ),
  }),
  open(ws) {
    sockets.set(ws.id, {
      id: ws.id,
      subscribed: new Set(),
      send: (data) => ws.send(data),
    });
  },
  async message(ws, msg) {
    const sock = sockets.get(ws.id);
    if (!sock) return;
    if (msg.subscribe) {
      for (const topic of msg.subscribe) {
        sock.subscribed.add(topic);
      }
      // Snapshot-on-subscribe: fire a fresh snapshot for each newly subscribed
      // topic so reconnecting clients never have to round-trip to REST.
      for (const topic of msg.subscribe) {
        const payload = await buildSnapshot(topic);
        ws.send(JSON.stringify({ topic, type: "snapshot", payload }));
      }
    }
  },
  close(ws) {
    sockets.delete(ws.id);
  },
});
