import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  activityLog,
  claims,
  maintainers,
  triageItems,
} from "@/db/schema";
import { verifyToken, type VerifiedToken } from "@/services/tokens";
import {
  ClaimError,
  claimItem,
  getActiveClaim,
  heartbeatClaim,
  releaseClaim,
} from "@/services/claims";
import { createNote, listNotes, NoteError } from "@/services/notes";
import { ItemMutationError, patchItem } from "@/services/items";

/**
 * Pull the verified maintainer off the inbound HTTP request. MCP tools call
 * this at the top of every handler — there is no "session" abstraction in
 * stateless mode, so auth is per-request.
 */
async function maintainerFromExtra(
  extra: { requestInfo?: { headers: Record<string, string | string[] | undefined> } },
): Promise<VerifiedToken> {
  const raw = extra.requestInfo?.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
    throw new Error("missing_or_malformed_token");
  }
  const token = header.slice(7).trim();
  const m = await verifyToken(token);
  if (!m) throw new Error("invalid_token");
  return m;
}

function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function fail(code: string, message: string) {
  return {
    isError: true,
    content: [
      { type: "text" as const, text: JSON.stringify({ error: code, message }) },
    ],
  };
}

function handleError(err: unknown) {
  if (err instanceof ClaimError) return fail(err.code, err.message);
  if (err instanceof NoteError) return fail(err.code, err.message);
  if (err instanceof ItemMutationError) return fail(err.code, err.message);
  const message = err instanceof Error ? err.message : String(err);
  if (message === "missing_or_malformed_token" || message === "invalid_token") {
    return fail("unauthorized", message);
  }
  return fail("internal_error", message);
}

// ─── Schema fragments ────────────────────────────────────────────────────────

const intentSchema = z.enum(["triage", "review", "fix", "investigate"]);
const prioritySchema = z.enum(["P0", "P1", "P2", "P3", "none"]);
const statusSchema = z.enum([
  "untriaged",
  "triaged",
  "in_progress",
  "needs_review",
  "blocked",
  "ready_to_merge",
  "done",
  "wontfix",
]);
const severitySchema = z
  .enum(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NOT_A_BUG"])
  .nullable();
const visibilitySchema = z.enum(["public", "maintainers"]);

// ─── Build the MCP server ────────────────────────────────────────────────────

function buildServer(): McpServer {
  const server = new McpServer({
    name: "mempalace-triage",
    version: "0.1.0",
  });

  // -- whoami ---------------------------------------------------------------
  server.registerTool(
    "triage_whoami",
    {
      description:
        "Return the verified maintainer identity for the calling token. Use this to sanity-check that your token is valid and to discover your role (owner/maintainer/agent).",
      inputSchema: {},
    },
    async (_input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        return ok({
          login: m.maintainerLogin,
          role: m.role,
          displayName: m.displayName,
        });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- list items -----------------------------------------------------------
  server.registerTool(
    "triage_list_items",
    {
      description:
        "Discover work. Lists triage items (issues + PRs) with optional filters. " +
        "For PR mergeability filtering, pass prMergeable / prMergeState / prChecksConclusion. " +
        "Default ordering: most recent first. Use this before claim_item to find unclaimed work.",
      inputSchema: {
        kind: z.enum(["issue", "pr"]).optional(),
        state: z.enum(["OPEN", "CLOSED", "MERGED"]).optional(),
        priority: prioritySchema.optional(),
        triageStatus: statusSchema.optional(),
        prMergeState: z
          .enum([
            "CLEAN",
            "DIRTY",
            "BLOCKED",
            "BEHIND",
            "UNSTABLE",
            "HAS_HOOKS",
            "DRAFT",
            "UNKNOWN",
          ])
          .optional(),
        prChecksConclusion: z
          .enum(["success", "failure", "pending", "none"])
          .optional(),
        onlyUnclaimed: z
          .boolean()
          .optional()
          .describe("Only return items with no active claim"),
        limit: z.number().int().min(1).max(500).optional(),
      },
    },
    async (input, extra) => {
      try {
        await maintainerFromExtra(extra);
        const filters = [];
        if (input.kind) filters.push(eq(triageItems.kind, input.kind));
        if (input.state) filters.push(eq(triageItems.githubState, input.state));
        if (input.priority) filters.push(eq(triageItems.priority, input.priority));
        if (input.triageStatus)
          filters.push(eq(triageItems.triageStatus, input.triageStatus));
        if (input.prMergeState)
          filters.push(eq(triageItems.prMergeState, input.prMergeState));
        if (input.prChecksConclusion)
          filters.push(
            eq(triageItems.prChecksConclusion, input.prChecksConclusion),
          );

        const rows = await db
          .select({
            number: triageItems.number,
            kind: triageItems.kind,
            state: triageItems.githubState,
            title: triageItems.githubTitle,
            author: triageItems.githubAuthor,
            priority: triageItems.priority,
            triageStatus: triageItems.triageStatus,
            severityHeuristic: triageItems.severityHeuristic,
            severityAssessed: triageItems.severityAssessed,
            prBranch: triageItems.prBranch,
            prMergeable: triageItems.prMergeable,
            prMergeState: triageItems.prMergeState,
            prChecksConclusion: triageItems.prChecksConclusion,
            prReviewDecision: triageItems.prReviewDecision,
          })
          .from(triageItems)
          .where(filters.length ? and(...filters) : undefined)
          .orderBy(desc(triageItems.number))
          .limit(input.limit ?? 100);

        if (input.onlyUnclaimed) {
          const claimed = await db
            .select({ itemNumber: claims.itemNumber })
            .from(claims)
            .where(isNull(claims.releasedAt));
          const claimedSet = new Set(claimed.map((c) => c.itemNumber));
          return ok({
            items: rows.filter((r) => !claimedSet.has(r.number)),
            count: rows.length,
          });
        }

        return ok({ items: rows, count: rows.length });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- get item -------------------------------------------------------------
  server.registerTool(
    "triage_get_item",
    {
      description:
        "Full detail for one item: GitHub fields, heuristic + assessed severity, current claim (if any), and recent notes. Use after list_items to dive into a specific candidate before claiming.",
      inputSchema: {
        number: z.number().int().positive(),
      },
    },
    async (input, extra) => {
      try {
        await maintainerFromExtra(extra);
        const [row] = await db
          .select()
          .from(triageItems)
          .where(eq(triageItems.number, input.number));
        if (!row) return fail("item_not_found", `item #${input.number} not found`);
        const claim = await getActiveClaim(input.number);
        const notes = await listNotes(input.number);
        return ok({ item: row, claim, notes });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- claim item -----------------------------------------------------------
  server.registerTool(
    "triage_claim_item",
    {
      description:
        "Claim a PR/issue so other agents know you're working on it. Default TTL 30min. " +
        "Re-claiming an item you already hold acts as a heartbeat. Claiming an item held by " +
        "another live maintainer returns `already_claimed` — call get_item to see who holds it.",
      inputSchema: {
        number: z.number().int().positive(),
        intent: intentSchema,
        ttlMs: z
          .number()
          .int()
          .min(60_000)
          .optional()
          .describe("Lease lifetime in ms (default 30min, max 4h)"),
        note: z.string().max(500).optional().nullable(),
      },
    },
    async (input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        const claim = await claimItem({
          itemNumber: input.number,
          maintainerId: m.maintainerId,
          intent: input.intent,
          ttlMs: input.ttlMs,
          note: input.note ?? null,
        });
        return ok({ claim });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- heartbeat ------------------------------------------------------------
  server.registerTool(
    "triage_heartbeat",
    {
      description:
        "Extend the lease on a claim you already hold. Call before the previous TTL expires to keep the claim alive. Returns `not_owner` if someone else holds it.",
      inputSchema: {
        number: z.number().int().positive(),
        ttlMs: z.number().int().min(60_000).optional(),
        note: z.string().max(500).optional().nullable(),
      },
    },
    async (input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        const claim = await heartbeatClaim({
          itemNumber: input.number,
          maintainerId: m.maintainerId,
          ttlMs: input.ttlMs,
          note: input.note,
        });
        return ok({ claim });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- release --------------------------------------------------------------
  server.registerTool(
    "triage_release",
    {
      description:
        "Release a claim you hold. Owners can force-release others' claims by passing `force: true`.",
      inputSchema: {
        number: z.number().int().positive(),
        force: z
          .boolean()
          .optional()
          .describe("Owners only: release a claim held by someone else"),
        reason: z.string().max(500).optional(),
      },
    },
    async (input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        await releaseClaim({
          itemNumber: input.number,
          maintainerId: m.maintainerId,
          isOwnerOverride: input.force === true && m.role === "owner",
          reason: input.reason,
        });
        return ok({ released: true });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- add note -------------------------------------------------------------
  server.registerTool(
    "triage_add_note",
    {
      description:
        "Post a finding, review comment, or status update on an item. Notes are how " +
        "agents communicate findings to each other and to human maintainers. Default " +
        "visibility: maintainers (not surfaced publicly).",
      inputSchema: {
        number: z.number().int().positive(),
        body: z.string().min(1).max(16_000),
        visibility: visibilitySchema.optional(),
      },
    },
    async (input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        const note = await createNote({
          itemNumber: input.number,
          maintainerId: m.maintainerId,
          body: input.body,
          visibility: input.visibility,
        });
        return ok({ note });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- patch item -----------------------------------------------------------
  server.registerTool(
    "triage_patch_item",
    {
      description:
        "Update human-set triage fields on an item: priority, triageStatus (untriaged → triaged → in_progress → needs_review/blocked/ready_to_merge → done/wontfix), or severityAssessed. " +
        "These survive poller refreshes (unlike GitHub fields).",
      inputSchema: {
        number: z.number().int().positive(),
        priority: prioritySchema.optional(),
        triageStatus: statusSchema.optional(),
        severityAssessed: severitySchema.optional(),
      },
    },
    async (input, extra) => {
      try {
        const m = await maintainerFromExtra(extra);
        const { number, ...patch } = input;
        await patchItem({
          itemNumber: number,
          maintainerId: m.maintainerId,
          patch,
        });
        return ok({ patched: true });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  // -- recent activity ------------------------------------------------------
  server.registerTool(
    "triage_recent_activity",
    {
      description:
        "See recent claim/note/patch events across all items. Useful for an agent to understand what others have been doing before claiming new work.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (input, extra) => {
      try {
        await maintainerFromExtra(extra);
        const rows = await db
          .select({
            id: activityLog.id,
            ts: activityLog.ts,
            action: activityLog.action,
            itemNumber: activityLog.itemNumber,
            maintainerLogin: maintainers.githubLogin,
            before: activityLog.before,
            after: activityLog.after,
          })
          .from(activityLog)
          .leftJoin(maintainers, eq(activityLog.maintainerId, maintainers.id))
          .orderBy(desc(activityLog.ts))
          .limit(input.limit ?? 50);
        return ok({ activity: rows });
      } catch (err) {
        return handleError(err);
      }
    },
  );

  return server;
}

// ─── Mount on Elysia at /mcp ─────────────────────────────────────────────────

/**
 * Map from session ID → { server, transport } for stateful mode. Sessions
 * are kept in memory for the life of the process; agents reconnect freely
 * after a server restart since claim TTLs and DB state persist.
 */
interface Session {
  server: McpServer;
  transport: WebStandardStreamableHTTPServerTransport;
}
const sessions = new Map<string, Session>();

async function newSession(): Promise<Session> {
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (sessionId) => {
      sessions.set(sessionId, { server, transport });
    },
    onsessionclosed: (sessionId) => {
      sessions.delete(sessionId);
    },
  });
  await server.connect(transport);
  return { server, transport };
}

/**
 * Elysia-compatible fetch handler. Mount as a catch-all at /mcp — the
 * MCP transport handles POST (RPC) + GET (SSE) + DELETE (close session).
 *
 * Routing: requests with a known `mcp-session-id` header are dispatched to
 * the matching transport; requests without one are treated as fresh
 * initialize calls and get a new session.
 */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const sessionId = request.headers.get("mcp-session-id");
  if (sessionId) {
    const existing = sessions.get(sessionId);
    if (existing) return await existing.transport.handleRequest(request);
    // Unknown session id — fall through and create a new one. The transport
    // will reject mid-conversation messages without a valid id, but accept
    // a fresh initialize cleanly.
  }
  const session = await newSession();
  return await session.transport.handleRequest(request);
}
