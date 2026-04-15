import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CACHE_DIR, CACHE_TTL_MS } from "./constants";

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

export function cachePath(name: string): string {
  ensureCacheDir();
  return join(CACHE_DIR, name);
}

export function cacheFresh(path: string): boolean {
  if (!existsSync(path)) return false;
  const ageMs = Date.now() - statSync(path).mtimeMs;
  return ageMs < CACHE_TTL_MS;
}

export async function readCachedText(path: string): Promise<string> {
  return await Bun.file(path).text();
}

export async function readCachedJson<T>(path: string): Promise<T> {
  return (await Bun.file(path).json()) as T;
}

export async function writeCachedText(
  path: string,
  text: string,
): Promise<void> {
  await Bun.write(path, text);
}

export async function writeCachedJson(
  path: string,
  data: unknown,
): Promise<void> {
  await Bun.write(path, JSON.stringify(data));
}
