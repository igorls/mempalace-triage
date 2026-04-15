import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { printNoiseReport, printPrAudit } from "./audit";
import { DEFAULT_OUTPUT, REPO } from "./constants";
import { diffAgainstPrevious } from "./delta";
import { fetchIssues, fetchPrs } from "./gh";
import { enrichIssues, enrichPrs } from "./pipeline";
import { findDuplicates } from "./duplicates";
import { renderMarkdown } from "./render";

interface CliArgs {
  noCache: boolean;
  skipDiffs: boolean;
  jsonOut: boolean;
  auditPrs: boolean;
  noiseReport: boolean;
  dryRun: boolean;
  output: string;
  help: boolean;
}

const HELP = `Usage: bun run src/triage/cli.ts [options]

Heuristic triage of ${REPO}.

Options:
  --no-cache       Bypass on-disk cache, fetch fresh from GitHub
  --skip-diffs     Skip PR diff scans (faster, no diff-based red flags)
  --json           Emit enriched payload as JSON on stdout; don't write ISSUES.md
  --audit-prs      Print suspicious-PR audit report; don't write ISSUES.md
  --noise-report   Print noise candidate list; don't write ISSUES.md
  --dry-run        Print summary of what would be written; don't touch ISSUES.md
  --output PATH    Output path (default: ${DEFAULT_OUTPUT})
  -h, --help       Show this help
`;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    noCache: false,
    skipDiffs: false,
    jsonOut: false,
    auditPrs: false,
    noiseReport: false,
    dryRun: false,
    output: DEFAULT_OUTPUT,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case "--no-cache":
        args.noCache = true;
        break;
      case "--skip-diffs":
        args.skipDiffs = true;
        break;
      case "--json":
        args.jsonOut = true;
        break;
      case "--audit-prs":
        args.auditPrs = true;
        break;
      case "--noise-report":
        args.noiseReport = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--output":
        args.output = argv[++i] ?? DEFAULT_OUTPUT;
        break;
      case "-h":
      case "--help":
        args.help = true;
        break;
      default:
        console.error(`Unknown argument: ${a}`);
        process.exit(2);
    }
  }
  return args;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const useCache = !args.noCache;

  console.error(`Fetching issues from ${REPO}...`);
  const issues = enrichIssues(await fetchIssues(useCache));

  console.error(`Fetching PRs from ${REPO}...`);
  const rawPrs = await fetchPrs(useCache);
  console.error(
    `Analyzing ${rawPrs.length} PRs (diffs: ${args.skipDiffs ? "skipped" : "on"})...`,
  );
  const prs = await enrichPrs(rawPrs, useCache, !args.skipDiffs);

  if (args.auditPrs) {
    printPrAudit(prs);
    return 0;
  }
  if (args.noiseReport) {
    printNoiseReport(issues);
    return 0;
  }

  const dupes = findDuplicates(issues);

  if (args.jsonOut) {
    const payload = {
      fetched_at: new Date().toISOString(),
      repo: REPO,
      issues,
      prs,
      duplicates: dupes,
    };
    process.stdout.write(JSON.stringify(payload) + "\n");
    return 0;
  }

  const md = renderMarkdown(issues, prs, dupes);

  console.error("Delta vs previous ISSUES.md:");
  console.error(await diffAgainstPrevious(md, args.output));

  if (args.dryRun) {
    console.error(`\n(dry-run) Would write ${md.length} bytes to ${args.output}`);
    return 0;
  }

  mkdirSync(dirname(args.output), { recursive: true });
  await Bun.write(args.output, md);
  console.error(`Wrote ${args.output}`);
  return 0;
}

if (import.meta.main) {
  main().then((code) => process.exit(code));
}
