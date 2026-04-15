import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { maintainers } from "@/db/schema";

const CONFIG_PATH =
  process.env.MAINTAINERS_CONFIG ??
  resolve(import.meta.dir, "../../../config/maintainers.toml");

type Role = "owner" | "maintainer" | "agent";

interface ConfigEntry {
  github_login: string;
  display_name?: string;
  role: Role;
}

interface MaintainersToml {
  maintainer?: ConfigEntry[];
}

export async function loadMaintainersConfig(): Promise<ConfigEntry[]> {
  const text = await Bun.file(CONFIG_PATH).text();
  const parsed = Bun.TOML.parse(text) as MaintainersToml;
  return parsed.maintainer ?? [];
}

/**
 * Seeds the `maintainers` table from config/maintainers.toml. Idempotent —
 * safe to call on every startup. Upserts role and display_name, and marks
 * anyone in the DB but missing from config as inactive (cascade-revoke).
 */
export async function syncMaintainersFromConfig(): Promise<{
  added: number;
  updated: number;
  deactivated: number;
}> {
  const entries = await loadMaintainersConfig();
  const configLogins = new Set(entries.map((e) => e.github_login));

  let added = 0;
  let updated = 0;
  let deactivated = 0;

  for (const entry of entries) {
    const [existing] = await db
      .select()
      .from(maintainers)
      .where(eq(maintainers.githubLogin, entry.github_login));

    if (!existing) {
      await db.insert(maintainers).values({
        githubLogin: entry.github_login,
        displayName: entry.display_name ?? null,
        role: entry.role,
        isActive: true,
      });
      added += 1;
    } else if (
      existing.role !== entry.role ||
      existing.displayName !== (entry.display_name ?? null) ||
      !existing.isActive
    ) {
      await db
        .update(maintainers)
        .set({
          role: entry.role,
          displayName: entry.display_name ?? null,
          isActive: true,
        })
        .where(eq(maintainers.id, existing.id));
      updated += 1;
    }
  }

  const everyone = await db.select().from(maintainers);
  for (const m of everyone) {
    if (!configLogins.has(m.githubLogin) && m.isActive) {
      await db
        .update(maintainers)
        .set({ isActive: false })
        .where(eq(maintainers.id, m.id));
      deactivated += 1;
    }
  }

  return { added, updated, deactivated };
}
