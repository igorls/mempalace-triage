import {
  cacheFresh,
  cachePath,
  readCachedJson,
  readCachedText,
  writeCachedJson,
  writeCachedText,
} from "./cache";
import { REPO } from "./constants";
import type { Issue, PR } from "./types";

// ─── gh CLI wrappers ────────────────────────────────────────────────────────

async function runGh(args: string[]): Promise<{ stdout: string; code: number }> {
  const proc = Bun.spawn(["gh", ...args], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { stdout, code };
}

/** Run `gh ... --json ...` and parse the response, with on-disk caching. */
export async function ghJson<T>(
  args: string[],
  cacheName: string | null,
  useCache: boolean,
): Promise<T> {
  if (cacheName && useCache) {
    const p = cachePath(cacheName);
    if (cacheFresh(p)) return await readCachedJson<T>(p);
  }
  const { stdout, code } = await runGh(args);
  if (code !== 0) {
    throw new Error(`gh ${args.join(" ")} exited with code ${code}`);
  }
  const data = (stdout.trim() ? JSON.parse(stdout) : []) as T;
  if (cacheName) await writeCachedJson(cachePath(cacheName), data);
  return data;
}

/** Run `gh ...` and return raw stdout, with on-disk caching. */
export async function ghText(
  args: string[],
  cacheName: string | null,
  useCache: boolean,
): Promise<string> {
  if (cacheName && useCache) {
    const p = cachePath(cacheName);
    if (cacheFresh(p)) return await readCachedText(p);
  }
  const { stdout, code } = await runGh(args);
  if (code !== 0) {
    // `gh pr diff` can fail transiently — return empty rather than crash the run.
    console.error(`gh ${args.join(" ")} exited with code ${code}`);
    return "";
  }
  if (cacheName) await writeCachedText(cachePath(cacheName), stdout);
  return stdout;
}

// ─── High-level fetchers ────────────────────────────────────────────────────

interface RawLabel {
  name: string;
}

interface RawAuthor {
  login?: string;
}

interface RawIssue {
  number: number;
  title: string | null;
  state: string;
  labels: RawLabel[];
  author: RawAuthor | null;
  body: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface RawFile {
  path: string;
}

interface RawPR {
  number: number;
  title: string | null;
  state: string;
  labels: RawLabel[];
  author: RawAuthor | null;
  body: string | null;
  headRefName: string;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  files: RawFile[];
}

function newIssue(raw: RawIssue): Issue {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: raw.state as Issue["state"],
    labels: (raw.labels ?? []).map((l) => l.name),
    author: raw.author?.login ?? "—",
    body: raw.body ?? "",
    created_at: raw.createdAt,
    closed_at: raw.closedAt ?? null,
    severity: "normal",
    is_noise: false,
    noise_reason: "",
    modules: [],
  };
}

function newPr(raw: RawPR): PR {
  return {
    number: raw.number,
    title: raw.title ?? "",
    state: raw.state as PR["state"],
    labels: (raw.labels ?? []).map((l) => l.name),
    author: raw.author?.login ?? "—",
    body: raw.body ?? "",
    branch: raw.headRefName ?? "",
    created_at: raw.createdAt,
    merged_at: raw.mergedAt ?? null,
    closed_at: raw.closedAt ?? null,
    files: (raw.files ?? []).map((f) => f.path),
    additions: raw.additions ?? 0,
    deletions: raw.deletions ?? 0,
    suspicious_flags: [],
    suspicion_level: "none",
    context_notes: [],
    modules: [],
    linked_issues: [],
    first_time_author: false,
  };
}

export async function fetchIssues(useCache = true): Promise<Issue[]> {
  const raw = await ghJson<RawIssue[]>(
    [
      "issue", "list", "--repo", REPO, "--state", "all",
      "--limit", "500",
      "--json", "number,title,state,labels,author,body,createdAt,closedAt",
    ],
    "issues.json",
    useCache,
  );
  return raw.map(newIssue);
}

export async function fetchPrs(useCache = true): Promise<PR[]> {
  const raw = await ghJson<RawPR[]>(
    [
      "pr", "list", "--repo", REPO, "--state", "all",
      "--limit", "500",
      "--json",
      "number,title,state,labels,author,body,headRefName," +
        "createdAt,mergedAt,closedAt,additions,deletions,files",
    ],
    "prs.json",
    useCache,
  );
  return raw.map(newPr);
}

export async function fetchPrDiff(
  prNumber: number,
  useCache = true,
): Promise<string> {
  return await ghText(
    ["pr", "diff", String(prNumber), "--repo", REPO],
    `pr_${prNumber}_diff.txt`,
    useCache,
  );
}

export async function fetchAuthorHistory(
  login: string,
  useCache = true,
): Promise<number> {
  if (!login || login === "—") return 0;
  const safe = login.replace(/[^A-Za-z0-9_.-]/g, "_");
  const raw = await ghJson<{ number: number }[]>(
    [
      "pr", "list", "--repo", REPO, "--state", "merged",
      "--author", login, "--limit", "50",
      "--json", "number",
    ],
    `author_${safe}.json`,
    useCache,
  );
  return raw.length;
}
