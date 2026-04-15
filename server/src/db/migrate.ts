import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { resolve } from "node:path";
import { db } from "./client";

const migrationsFolder = resolve(import.meta.dir, "migrations");

migrate(db, { migrationsFolder });
console.log(`Applied migrations from ${migrationsFolder}`);
