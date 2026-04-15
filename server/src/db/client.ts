import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import * as schema from "./schema";

const DB_PATH = process.env.DATABASE_URL ?? resolve(process.cwd(), "triage.db");

if (DB_PATH !== ":memory:") {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL;");
sqlite.exec("PRAGMA foreign_keys = ON;");
sqlite.exec("PRAGMA synchronous = NORMAL;");

export const db: BunSQLiteDatabase<typeof schema> = drizzle(sqlite, { schema });
export const rawDb = sqlite;
export { schema };
