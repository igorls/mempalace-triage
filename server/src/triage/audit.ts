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

function truncateTitle(t: string, max = 70): string {
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

function reviewBadge(d: PR["review_decision"]): string {
  if (d === "APPROVED") return "approved";
  if (d === "CHANGES_REQUESTED") return "changes-requested";
  if (d === "REVIEW_REQUIRED") return "review-required";
  return "—";
}

/**
 * Group open PRs by mergeability bucket and print a table per bucket.
 * Ordering of buckets is deliberate: the action-able ones (ready / failing
 * CI / conflicting) come first; unknowns last.
 */
export function printMergeableReport(prs: PR[]): void {
  const open = prs.filter((p) => p.state === "OPEN");
  if (open.length === 0) {
    console.log("No open PRs.");
    return;
  }

  // Ready to merge: clean merge state AND either green CI or no checks (docs
  // PRs etc.). BLOCKED is a separate bucket — it's clean structurally but
  // gated on review.
  const ready = open.filter(
    (p) =>
      p.merge_state_status === "CLEAN" &&
      (p.checks_conclusion === "success" || p.checks_conclusion === "none"),
  );
  const failingCi = open.filter((p) => p.checks_conclusion === "failure");
  const conflicting = open.filter((p) => p.merge_state_status === "DIRTY");
  const blockedReview = open.filter((p) => p.merge_state_status === "BLOCKED");
  const behind = open.filter((p) => p.merge_state_status === "BEHIND");
  const unstable = open.filter(
    (p) => p.merge_state_status === "UNSTABLE" && p.checks_conclusion !== "failure",
  );
  const pendingCi = open.filter(
    (p) =>
      p.checks_conclusion === "pending" &&
      p.merge_state_status !== "DIRTY" &&
      p.merge_state_status !== "BLOCKED" &&
      p.merge_state_status !== "BEHIND" &&
      p.merge_state_status !== "UNSTABLE",
  );
  const unknown = open.filter(
    (p) =>
      p.merge_state_status === "UNKNOWN" &&
      p.checks_conclusion !== "failure" &&
      p.checks_conclusion !== "pending",
  );

  function printBucket(label: string, group: PR[]): void {
    if (group.length === 0) return;
    console.log(`\n━━━ ${label} (${group.length}) ━━━`);
    const sorted = [...group].sort((a, b) => b.number - a.number);
    for (const p of sorted) {
      console.log(
        `  #${String(p.number).padEnd(5)} ${truncateTitle(p.title).padEnd(70)} ` +
          `[checks=${p.checks_conclusion}, review=${reviewBadge(p.review_decision)}]`,
      );
    }
  }

  console.log(`\n${open.length} open PRs against the default branch.\n`);
  printBucket("READY TO MERGE", ready);
  printBucket("FAILING CI", failingCi);
  printBucket("CONFLICTING", conflicting);
  printBucket("BLOCKED BY REVIEW / PROTECTION", blockedReview);
  printBucket("BEHIND BASE BRANCH", behind);
  printBucket("UNSTABLE (clean but checks not all green)", unstable);
  printBucket("CI STILL RUNNING", pendingCi);
  printBucket("UNKNOWN (GitHub hadn't computed)", unknown);
  console.log(`\n  URLs: https://github.com/${REPO}/pull/<NUMBER>\n`);
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
