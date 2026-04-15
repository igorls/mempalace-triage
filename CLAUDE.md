# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository purpose

Maintainer triage tooling for the **separate** repo [MemPalace/mempalace](https://github.com/MemPalace/mempalace). Kept here (not upstream) so triage evolves independently and both can be cloned side-by-side in remote-agent / CI sandboxes without name collision.

The two main deliverables — `ISSUES.md` and `TRIAGE.md` — are **regenerated every run** and gitignored. Don't treat them as source of truth; the `.cache/` dir (6h TTL) and the server DB are.

## The three layers

The repo is a stack built around one canonical data source, the triage module (`server/src/triage/`):

1. **`server/src/triage/`** (TypeScript, Bun runtime, needs `gh` CLI) — heuristic classifier against `MemPalace/mempalace`, organized as a proper multi-file module. Fetches issues/PRs/diffs via `gh`, caches to `.cache/` at the repo root (6h TTL), tags severity by keyword, detects noise, flags suspicious PRs (CI tampering, exec patterns, sensitive paths, first-time contributors, unfamiliar URLs), cross-references mempalace modules. Consumed two ways: as a library by the poller (`runSync()`), and as a CLI (`bun run src/triage/cli.ts`) that writes `ISSUES.md` or emits `--json` on stdout.
2. **`.claude/skills/triage-issues/SKILL.md`** — deep-triage skill for a Claude Code session. Runs the triage CLI, re-reads bodies/diffs, produces semantic dedup + real severity + PR malicious review + ranked next actions, writes `TRIAGE.md`. Also runs as a scheduled remote agent on weekday mornings (see `README.md`).
3. **`server/`** (Bun + Elysia + Drizzle + SQLite) — persistent backend. Imports the triage module directly (no subprocess, no JSON round-trip), polls every 15 min, upserts into `triage_items`. Exposes REST (`/api/*`) + WebSocket (`/ws`) for the Angular dashboard. Migrations auto-apply and the maintainer allowlist is seeded from `config/maintainers.toml` on every boot.
4. **`dashboard/`** (Angular 21 + Tailwind 4) — frontend that talks to the server. Standard Angular CLI layout.

A standalone single-file HTML prototype (`pr-review-dashboard.html`) predates the Angular dashboard; the Angular app supersedes it.

## Commands

### Triage CLI (run from `server/`)

```bash
bun run src/triage/cli.ts              # regenerate ISSUES.md at repo root
bun run src/triage/cli.ts --json       # emit enriched payload on stdout
bun run src/triage/cli.ts --audit-prs  # flagged-PR report
bun run src/triage/cli.ts --noise-report
bun run src/triage/cli.ts --no-cache   # force fresh fetch from GitHub
bun run src/triage/cli.ts --skip-diffs # skip per-PR diff scans (much faster)
bun run src/triage/cli.ts --dry-run
```

Requires `gh` CLI authenticated to read `MemPalace/mempalace`.

### Running the stack (PM2 — the only supported runtime)

Both long-running processes (server + dashboard) are managed by PM2. **Do not invoke `bun run dev`, `bun run start`, or `ng serve` / `npm start` directly** — use the ecosystem files at the repo root. This keeps env vars, ports, watch behavior, logging, and lifecycle consistent across machines and agents.

```bash
# Development (bun --watch + ng serve, both with HMR)
pm2 start ecosystem.dev.config.cjs

# Production (bun one-shot + PM2's built-in static serve over dashboard/dist)
cd dashboard && npm run build && cd ..
pm2 start ecosystem.config.cjs

# Common ops
pm2 status
pm2 logs                          # tail all
pm2 logs mempalace-server         # tail one
pm2 restart ecosystem.dev.config.cjs
pm2 stop all && pm2 delete all    # clean slate
pm2 save && pm2 startup           # persist across reboots (prod)
```

Logs land in `./logs/` (gitignored). App names: `mempalace-server` / `mempalace-dashboard` (prod), `-dev` suffix in dev.

### Server (non-daemon scripts, run from `server/`)

One-shot / build-time commands only — daemon mode goes through PM2 above.

```bash
bun install
bun run typecheck            # tsc --noEmit
bun test                     # bun's test runner (tests/ is empty today)
bun run db:generate          # drizzle-kit generate (after editing schema.ts)
bun run db:migrate           # apply migrations standalone (normally runs on boot)
bun run sync:once            # one-shot poll (triage module → DB upsert)
```

Server env vars (set in the ecosystem files, override there — not on the CLI): `PORT` (default 7800), `POLL_INTERVAL_MS` (default 15min), `POLLER_ENABLED=false` to disable background polling, `DATABASE_URL` (default `./triage.db`), `MAINTAINERS_CONFIG` (override allowlist path).

TypeScript import alias: `@/*` → `./src/*`.

### Dashboard (non-daemon scripts, run from `dashboard/`)

One-shot / build-time commands only — `ng serve` runs under PM2 via `ecosystem.dev.config.cjs`. **Prefer `bun` for one-shot commands** (install, build, test); PM2 is reserved for long-running processes.

```bash
bun install
bun run build    # writes dashboard/dist/dashboard/browser — prod PM2 serves this
bun run test     # ng test (Vitest)
```

## Architecture specifics worth knowing before editing

- **Numbering**: GitHub uses one sequence for issues and PRs per repo. `triage_items.number` is the PK and is GitHub's number — issue #839 and PR #839 **cannot both exist**, so the issue/PR merge in `applySyncPayload` is safe.
- **Preserving human-set fields in the poller**: `applySyncPayload` uses a targeted `onConflictDoUpdate` `set:` clause that deliberately **omits** `priority`, `triageStatus`, `severityAssessed`, and `clusterId`. When editing the upsert, keep that invariant — otherwise a poll overwrites maintainer decisions.
- **Maintainer allowlist is the source of truth**: `config/maintainers.toml` is re-synced to the `maintainers` table on every server boot. Removing a login cascade-deactivates them (and, once token endpoints exist, cascade-revokes tokens). Never edit the DB directly to add a maintainer.
- **Heuristics are deterministic given the cache**: every keyword bank, regex, and sensitive-path list lives in [`server/src/triage/constants.ts`](server/src/triage/constants.ts) (`CRITICAL_KEYWORDS`, `HIGH_KEYWORDS`, `NOISE_TITLE_PATTERNS`, `NOISE_BODY_PATTERNS`, `SUBSTANTIVE_TITLE_MARKERS`, `SENSITIVE_PATHS`, `DIFF_RED_FLAGS`, `MEMPALACE_MODULES`). Tweak and re-run; results are reproducible against a frozen `.cache/`.
- **Triage module layout**: `server/src/triage/` is split by concern — `types.ts`, `constants.ts`, `cache.ts`, `gh.ts`, `classify.ts`, `duplicates.ts`, `prSuspicion.ts`, `pipeline.ts`, `render.ts`, `audit.ts`, `delta.ts`, `cli.ts`, `index.ts` (barrel). Consumers (like the poller) import from `@/triage`. Don't bloat any one file — route new heuristics to the right slot.
- **Unicode regex gotcha**: one noise pattern (`NOISE_TITLE_PATTERNS`) uses Python-style Unicode `\w` semantics — translated to JS as `[^\p{L}\p{N}_]+` with the `u` flag. If you add patterns involving word-character matching across non-ASCII titles (Chinese, Arabic, etc.), use the same `\p{L}\p{N}` + `u` form; plain `\w` in JS is ASCII-only and will classify non-Latin text as "all non-word" by mistake.
- **Placeholder dirs**: `server/src/mcp/tools/`, `server/src/worker/`, and `server/tests/` are empty — scaffolding for future milestones, not missing code.
- **WebSocket topics**: `items | stats | activity | claims`. Clients subscribe with `{subscribe: [...]}`; the server replies with a snapshot per topic on subscribe and pushes `{topic, type: "snapshot", payload}` after each poll via `broadcastSnapshots`. The `claims` topic is currently a no-op channel reserved for future delta events — claim state rides inside `items[].claim`.
- **`ISSUES.md` and `TRIAGE.md` link conventions**: every issue/PR reference in `TRIAGE.md` must be a markdown link like `[#N](https://github.com/MemPalace/mempalace/issues/N)`. GitHub auto-redirects `/issues/N` to `/pull/N` when the number is a PR, so one URL shape covers both. The triage skill enforces this.

## Tuning / extension notes

- When `MemPalace/mempalace` adds a new Python module, add it to `MEMPALACE_MODULES` in [`server/src/triage/constants.ts`](server/src/triage/constants.ts) for cross-reference to start working.
- Adding a new red flag: append to `DIFF_RED_FLAGS` (`{ pattern, reason, excludeIf? }`). `excludeIf` lets you skip the match when another pattern matches on the same diff snippet — use for FP control.
- Adding a server API or DB column: edit `src/db/schema.ts`, run `bun run db:generate`, commit the generated SQL in `src/db/migrations/`. The boot path auto-applies.
