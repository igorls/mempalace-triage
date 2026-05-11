import { Elysia, t } from "elysia";
import { requireAuth } from "@/auth/middleware";
import {
  ClaimError,
  claimItem,
  getActiveClaim,
  heartbeatClaim,
  releaseClaim,
} from "@/services/claims";
import { createNote, listNotes, NoteError } from "@/services/notes";
import {
  ItemMutationError,
  patchItem,
} from "@/services/items";

const intentSchema = t.Union([
  t.Literal("triage"),
  t.Literal("review"),
  t.Literal("fix"),
  t.Literal("investigate"),
]);

const prioritySchema = t.Union([
  t.Literal("P0"),
  t.Literal("P1"),
  t.Literal("P2"),
  t.Literal("P3"),
  t.Literal("none"),
]);

const statusSchema = t.Union([
  t.Literal("untriaged"),
  t.Literal("triaged"),
  t.Literal("in_progress"),
  t.Literal("needs_review"),
  t.Literal("blocked"),
  t.Literal("ready_to_merge"),
  t.Literal("done"),
  t.Literal("wontfix"),
]);

const severitySchema = t.Union([
  t.Literal("CRITICAL"),
  t.Literal("HIGH"),
  t.Literal("MEDIUM"),
  t.Literal("LOW"),
  t.Literal("NOT_A_BUG"),
  t.Null(),
]);

const visibilitySchema = t.Union([
  t.Literal("public"),
  t.Literal("maintainers"),
]);

function claimErrorStatus(code: ClaimError["code"]): number {
  switch (code) {
    case "item_not_found":
      return 404;
    case "already_claimed":
      return 409;
    case "not_owner":
      return 403;
    case "no_active_claim":
      return 404;
    case "bad_intent":
    case "bad_ttl":
      return 400;
  }
}

function noteErrorStatus(code: NoteError["code"]): number {
  switch (code) {
    case "item_not_found":
      return 404;
    case "empty_body":
    case "body_too_long":
      return 400;
  }
}

function itemErrorStatus(code: ItemMutationError["code"]): number {
  switch (code) {
    case "item_not_found":
      return 404;
    case "bad_priority":
    case "bad_status":
    case "bad_severity":
    case "no_changes":
      return 400;
  }
}

/**
 * Agent-facing write endpoints. All routes require `Authorization: Bearer
 * <token>`; the middleware attaches a verified maintainer to context.
 */
export const agentApi = new Elysia({ prefix: "/api" })
  .use(requireAuth)

  // ─── Claims ────────────────────────────────────────────────────────────────
  .get(
    "/items/:number/claim",
    async ({ params }) => {
      const claim = await getActiveClaim(params.number);
      return { claim };
    },
    { params: t.Object({ number: t.Numeric() }) },
  )

  .post(
    "/items/:number/claim",
    async ({ params, body, maintainer, status }) => {
      try {
        const claim = await claimItem({
          itemNumber: params.number,
          maintainerId: maintainer.maintainerId,
          intent: body.intent,
          ttlMs: body.ttlMs,
          note: body.note ?? null,
        });
        return { claim };
      } catch (err) {
        if (err instanceof ClaimError) {
          return status(claimErrorStatus(err.code), {
            error: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ number: t.Numeric() }),
      body: t.Object({
        intent: intentSchema,
        ttlMs: t.Optional(t.Number({ minimum: 60_000 })),
        note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
      }),
    },
  )

  .post(
    "/items/:number/heartbeat",
    async ({ params, body, maintainer, status }) => {
      try {
        const claim = await heartbeatClaim({
          itemNumber: params.number,
          maintainerId: maintainer.maintainerId,
          ttlMs: body?.ttlMs,
          note: body?.note,
        });
        return { claim };
      } catch (err) {
        if (err instanceof ClaimError) {
          return status(claimErrorStatus(err.code), {
            error: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ number: t.Numeric() }),
      body: t.Optional(
        t.Object({
          ttlMs: t.Optional(t.Number({ minimum: 60_000 })),
          note: t.Optional(t.Nullable(t.String({ maxLength: 500 }))),
        }),
      ),
    },
  )

  .post(
    "/items/:number/release",
    async ({ params, body, maintainer, status }) => {
      try {
        await releaseClaim({
          itemNumber: params.number,
          maintainerId: maintainer.maintainerId,
          isOwnerOverride: body?.force === true && maintainer.role === "owner",
          reason: body?.reason,
        });
        return { released: true };
      } catch (err) {
        if (err instanceof ClaimError) {
          return status(claimErrorStatus(err.code), {
            error: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ number: t.Numeric() }),
      body: t.Optional(
        t.Object({
          force: t.Optional(t.Boolean()),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
      ),
    },
  )

  // ─── Notes ─────────────────────────────────────────────────────────────────
  .get(
    "/items/:number/notes",
    async ({ params }) => {
      const items = await listNotes(params.number);
      return { notes: items };
    },
    { params: t.Object({ number: t.Numeric() }) },
  )

  .post(
    "/items/:number/notes",
    async ({ params, body, maintainer, status }) => {
      try {
        const note = await createNote({
          itemNumber: params.number,
          maintainerId: maintainer.maintainerId,
          body: body.body,
          visibility: body.visibility,
        });
        return { note };
      } catch (err) {
        if (err instanceof NoteError) {
          return status(noteErrorStatus(err.code), {
            error: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ number: t.Numeric() }),
      body: t.Object({
        body: t.String({ minLength: 1, maxLength: 16_000 }),
        visibility: t.Optional(visibilitySchema),
      }),
    },
  )

  // ─── Item patch (priority / status / severity_assessed) ────────────────────
  .patch(
    "/items/:number",
    async ({ params, body, maintainer, status }) => {
      try {
        await patchItem({
          itemNumber: params.number,
          maintainerId: maintainer.maintainerId,
          patch: body,
        });
        return { patched: true };
      } catch (err) {
        if (err instanceof ItemMutationError) {
          return status(itemErrorStatus(err.code), {
            error: err.code,
            message: err.message,
          });
        }
        throw err;
      }
    },
    {
      params: t.Object({ number: t.Numeric() }),
      body: t.Object({
        priority: t.Optional(prioritySchema),
        triageStatus: t.Optional(statusSchema),
        severityAssessed: t.Optional(severitySchema),
      }),
    },
  )

  // ─── Whoami (handy for agents to confirm token is valid) ───────────────────
  .get("/whoami", ({ maintainer }) => ({
    login: maintainer.maintainerLogin,
    role: maintainer.role,
    displayName: maintainer.displayName,
  }));
