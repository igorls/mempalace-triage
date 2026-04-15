import { existsSync } from "node:fs";

/**
 * Returns a human-readable delta between the previous ISSUES.md and the
 * newly-rendered one, comparing open issue + open PR counts. Used by the CLI
 * to print a short summary after each run.
 */
export async function diffAgainstPrevious(
  newMd: string,
  path: string,
): Promise<string> {
  if (!existsSync(path)) {
    return "  (no previous ISSUES.md — this is the first sync)";
  }
  const old = await Bun.file(path).text();
  const oldIssues = /\*\*(\d+) open issues\*\*/.exec(old);
  const newIssues = /\*\*(\d+) open issues\*\*/.exec(newMd);
  const oldPrs = /\*\*(\d+) open PRs\*\*/.exec(old);
  const newPrs = /\*\*(\d+) open PRs\*\*/.exec(newMd);
  if (!oldIssues || !newIssues || !oldPrs || !newPrs) {
    return "  (counts not found in old file — cannot compute delta)";
  }
  const dI = Number(newIssues[1]) - Number(oldIssues[1]);
  const dP = Number(newPrs[1]) - Number(oldPrs[1]);
  const sI = dI >= 0 ? `+${dI}` : String(dI);
  const sP = dP >= 0 ? `+${dP}` : String(dP);
  return (
    `  issues: ${oldIssues[1]} → ${newIssues[1]} (Δ ${sI})\n` +
    `  PRs:    ${oldPrs[1]} → ${newPrs[1]} (Δ ${sP})`
  );
}
