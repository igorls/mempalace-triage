import { REPO } from "./constants";
import type { Issue, PR } from "./types";

function moduleStr(modules: string[]): string {
  if (modules.length === 0) return "—";
  if (modules.length <= 4) return modules.join(", ");
  return modules.slice(0, 4).join(", ") + `, +${modules.length - 4} more`;
}

export function printPrAudit(prs: PR[]): void {
  const flagged = prs
    .filter((p) => p.state === "OPEN" && p.suspicious_flags.length > 0)
    .sort((a, b) => b.number - a.number);

  if (flagged.length === 0) {
    console.log("No open PRs flagged.");
    return;
  }

  console.log(`\n${flagged.length} open PRs flagged for review:\n`);
  for (const pr of flagged) {
    const linked =
      pr.linked_issues.length > 0
        ? pr.linked_issues.map((n) => `#${n}`).join(", ")
        : "—";
    console.log(`━━━ PR #${pr.number} [${pr.branch}] by @${pr.author} ━━━`);
    console.log(`  Title:   ${pr.title}`);
    console.log(
      `  Size:    +${pr.additions}/-${pr.deletions} across ${pr.files.length} files`,
    );
    console.log(`  Linked:  ${linked}`);
    console.log(`  Modules: ${moduleStr(pr.modules)}`);
    console.log(`  URL:     https://github.com/${REPO}/pull/${pr.number}`);
    console.log("  Red flags:");
    for (const flag of pr.suspicious_flags) console.log(`    ! ${flag}`);
    if (pr.context_notes.length > 0) {
      console.log("  Context:");
      for (const note of pr.context_notes) console.log(`    · ${note}`);
    }
    console.log("");
  }
}

export function printNoiseReport(issues: Issue[]): void {
  const noise = issues
    .filter((i) => i.state === "OPEN" && i.is_noise)
    .sort((a, b) => b.number - a.number);

  if (noise.length === 0) {
    console.log("No open noise candidates.");
    return;
  }

  console.log(`\n${noise.length} open issues flagged as low-signal:\n`);
  for (const i of noise) {
    const title = i.title.length > 70 ? i.title.slice(0, 70) : i.title;
    console.log(
      `  #${String(i.number).padEnd(4)} ${title.padEnd(70)} [${i.noise_reason}]`,
    );
  }
  console.log(`\n  URLs: https://github.com/${REPO}/issues/<NUMBER>`);
}
