# mempalace-triage

Maintainer triage tooling for [MemPalace/mempalace](https://github.com/MemPalace/mempalace).

This repo is intentionally separate from `MemPalace/mempalace` so the two
can be cloned side-by-side without name collision in CI/remote-agent
environments, and so triage tooling evolves independently of the project
itself.

## What's here

| Path | Purpose |
|---|---|
| [`server/src/triage/`](server/src/triage/) | Heuristic classifier module (TypeScript/Bun). Fetches issues/PRs from the upstream repo, tags severity by keyword, flags noise candidates and suspicious PRs, cross-references mempalace modules. Exposed as both a library (consumed by the poller) and a CLI (writes `ISSUES.md`). |
| [`server/`](server/) | Bun + Elysia + Drizzle + SQLite backend. Polls the triage module every 15 min, persists state, serves REST + WebSocket for the dashboard. |
| [`dashboard/`](dashboard/) | Angular 21 + Tailwind 4 frontend that talks to the server. |
| [`.claude/skills/triage-issues/SKILL.md`](.claude/skills/triage-issues/SKILL.md) | Deep-triage skill — drives the part heuristics can't do (semantic dedup, real severity, PR malicious review, next-action ranking). Writes `TRIAGE.md`. |

## Quickstart (local)

```bash
# Requires gh CLI, authenticated to read MemPalace/mempalace, and bun.
cd server
bun install
bun run src/triage/cli.ts              # regenerate ISSUES.md at repo root
bun run src/triage/cli.ts --audit-prs  # terminal report on flagged PRs
bun run src/triage/cli.ts --no-cache   # force fresh fetch
```

Then (if you have Claude Code) invoke the `triage-issues` skill for the deep
analysis layer on top of `ISSUES.md`. It writes `TRIAGE.md`.

## Quickstart (scheduled remote agent)

This repo is also cloned by a scheduled Claude Code remote agent that runs
weekday mornings. The agent runs the triage CLI, reads the skill, does the
deep triage, and prints the report to the trigger run logs. Manage at
https://claude.ai/code/scheduled

## Running the full stack (server + dashboard)

Long-running processes are managed by PM2 via ecosystem files at the repo
root. See [CLAUDE.md](CLAUDE.md) for the PM2 commands. TL;DR: `pm2 start
ecosystem.dev.config.cjs` for dev, `pm2 start ecosystem.config.cjs` for prod.

## Output conventions

- `ISSUES.md` — heuristic output from the triage CLI (regenerated every run)
- `TRIAGE.md` — curated deep-triage report from the skill (regenerated)
- `.cache/` — fetched issue/PR/diff data, 6h TTL, gitignored

Both outputs are meant to be read and discarded — they're point-in-time
snapshots, not historical records.

## Tuning heuristics

All keyword banks and regex patterns live in
[`server/src/triage/constants.ts`](server/src/triage/constants.ts):

- `CRITICAL_KEYWORDS` / `HIGH_KEYWORDS` — severity signals
- `FEATURE_TITLE_PREFIX` / `BUG_TITLE_PREFIX` — issue type markers
- `NOISE_TITLE_PATTERNS` / `NOISE_BODY_PATTERNS` — junk filters
- `SENSITIVE_PATHS` — PR path patterns that trigger red flags
- `DIFF_RED_FLAGS` — dangerous diff content patterns
- `MEMPALACE_MODULES` — module names for cross-reference

Tweak and re-run; results are deterministic given the same cache.
