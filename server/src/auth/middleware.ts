import { Elysia } from "elysia";
import { verifyToken, type VerifiedToken } from "@/services/tokens";

/**
 * Elysia plugin that enforces `Authorization: Bearer <token>` on every
 * downstream route and attaches the verified maintainer to context. Mount
 * with `.use(requireAuth)` on the sub-app whose routes need it.
 *
 * Routes get `maintainer: VerifiedToken` in their handler context.
 */
export const requireAuth = new Elysia({ name: "require-auth" })
  .derive({ as: "scoped" }, async ({ headers, status }) => {
    const header = headers.authorization;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      return status(401, { error: "missing_or_malformed_token" });
    }
    const raw = header.slice(7).trim();
    const m = await verifyToken(raw);
    if (!m) return status(401, { error: "invalid_token" });
    return { maintainer: m as VerifiedToken };
  });
