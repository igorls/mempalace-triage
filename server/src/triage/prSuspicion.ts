import { basename } from "node:path";
import {
  COMMON_WORD_MODULES,
  DIFF_RED_FLAGS,
  MEMPALACE_MODULES,
  MODULE_BARE_NAMES,
  SENSITIVE_PATHS,
  type SuspicionLevel,
} from "./constants";
import type { PR } from "./types";

/** Ordering used to fold individual flag levels into a per-PR max. */
const LEVEL_RANK: Record<SuspicionLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function maxLevel(a: SuspicionLevel, b: SuspicionLevel): SuspicionLevel {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

export function crossReferenceModules(
  text: string,
  changedFiles: string[] = [],
): string[] {
  const hits = new Set<string>();
  const lower = text.toLowerCase();
  const words = new Set(lower.match(/\b\w+\b/g) ?? []);

  for (const mod of MEMPALACE_MODULES) {
    if (lower.includes(mod)) {
      hits.add(mod);
      continue;
    }
    const bare = mod.endsWith(".py") ? mod.slice(0, -3) : mod;
    if (MODULE_BARE_NAMES.has(bare) && words.has(bare)) {
      hits.add(mod);
    }
  }

  for (const f of changedFiles) {
    const base = basename(f);
    if ((MEMPALACE_MODULES as readonly string[]).includes(base)) {
      hits.add(base);
    }
  }

  // Filter: a single hit on a too-generic bare name requires file-path
  // confirmation to count.
  if (hits.size === 1) {
    const only = [...hits][0]!;
    if (COMMON_WORD_MODULES.has(only)) {
      const confirmedByFile = changedFiles.some((f) => basename(f) === only);
      if (!confirmedByFile) return [];
    }
  }

  return [...hits].sort();
}

export function extractLinkedIssues(pr: PR): number[] {
  const text = `${pr.title}\n${pr.body}`;
  const nums = new Set<number>();
  for (const m of text.matchAll(/#(\d+)/g)) {
    nums.add(Number.parseInt(m[1]!, 10));
  }
  return [...nums].sort((a, b) => a - b);
}

export function analyzePrSuspicion(
  pr: PR,
  diff: string,
  authorMergedCount: number,
): {
  hardFlags: string[];
  contextNotes: string[];
  suspicionLevel: SuspicionLevel;
} {
  const hardFlags: string[] = [];
  const contextNotes: string[] = [];
  let level: SuspicionLevel = "none";

  // First-time contributor → context only, never a flag by itself.
  if (authorMergedCount === 0 && pr.state === "OPEN") {
    contextNotes.push("first-time contributor (no prior merged PRs)");
    pr.first_time_author = true;
  }

  // Sensitive file paths → hard flag, each rule carries its own level.
  for (const f of pr.files) {
    for (const rule of SENSITIVE_PATHS) {
      if (new RegExp(rule.pattern).test(f)) {
        hardFlags.push(`touches \`${f}\` — ${rule.reason}`);
        level = maxLevel(level, rule.level);
        break;
      }
    }
  }

  // Diff red flags → hard flag. Only scan the *added* lines. Default level
  // for a diff match is "critical" unless the rule overrides it.
  if (diff) {
    const addedLines: string[] = [];
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        addedLines.push(line.slice(1));
      }
    }
    const addedText = addedLines.join("\n");
    for (const rule of DIFF_RED_FLAGS) {
      const re = new RegExp(rule.pattern, "g");
      for (const m of addedText.matchAll(re)) {
        const snippet = (m[0] ?? "").slice(0, 70);
        if (rule.excludeIf && new RegExp(rule.excludeIf).test(snippet)) continue;
        hardFlags.push(`diff contains ${rule.reason}: \`${snippet}\``);
        level = maxLevel(level, rule.level ?? "critical");
        break; // one hit per pattern is enough
      }
    }
  }

  // Size disproportion — low severity by itself. A very-large diff is still
  // hard to review but isn't inherently risky on its own.
  const totalChanges = pr.additions + pr.deletions;
  if (totalChanges > 2000) {
    hardFlags.push(`very large diff: +${pr.additions}/-${pr.deletions}`);
    level = maxLevel(level, "low");
  } else if (totalChanges > 500) {
    contextNotes.push(`large-ish diff (+${pr.additions}/-${pr.deletions})`);
  }

  if (
    pr.state === "OPEN" &&
    totalChanges > 300 &&
    pr.body.length < 100 &&
    hardFlags.length === 0
  ) {
    contextNotes.push(
      `thin description (${pr.body.length} chars) for ` +
        `+${pr.additions}/-${pr.deletions}`,
    );
  }

  return { hardFlags, contextNotes, suspicionLevel: level };
}
