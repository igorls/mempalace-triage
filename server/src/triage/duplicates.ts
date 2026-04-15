import type { DuplicatePair, Issue } from "./types";

// ─── Ratcliff–Obershelp similarity ──────────────────────────────────────────
//
// Equivalent of Python's `difflib.SequenceMatcher.ratio()`. Titles are short
// (< 200 chars) so Python's autojunk heuristic never triggered in practice —
// we omit it here. Results match Python's ratio() within floating-point
// error for the inputs we feed it.

interface Match {
  i: number;
  j: number;
  size: number;
}

function buildB2J(b: string): Map<string, number[]> {
  const b2j = new Map<string, number[]>();
  for (let j = 0; j < b.length; j++) {
    const ch = b[j]!;
    const arr = b2j.get(ch);
    if (arr) arr.push(j);
    else b2j.set(ch, [j]);
  }
  return b2j;
}

function findLongestMatch(
  a: string,
  b: string,
  alo: number,
  ahi: number,
  blo: number,
  bhi: number,
  b2j: Map<string, number[]>,
): Match {
  let bestI = alo;
  let bestJ = blo;
  let bestSize = 0;
  let j2len = new Map<number, number>();

  for (let i = alo; i < ahi; i++) {
    const newJ2len = new Map<number, number>();
    const js = b2j.get(a[i]!) ?? [];
    for (const j of js) {
      if (j < blo) continue;
      if (j >= bhi) break;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newJ2len.set(j, k);
      if (k > bestSize) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestSize = k;
      }
    }
    j2len = newJ2len;
  }

  while (
    bestI > alo &&
    bestJ > blo &&
    a[bestI - 1] === b[bestJ - 1]
  ) {
    bestI -= 1;
    bestJ -= 1;
    bestSize += 1;
  }
  while (
    bestI + bestSize < ahi &&
    bestJ + bestSize < bhi &&
    a[bestI + bestSize] === b[bestJ + bestSize]
  ) {
    bestSize += 1;
  }

  return { i: bestI, j: bestJ, size: bestSize };
}

export function similarityRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  const b2j = buildB2J(b);
  let totalMatches = 0;
  const queue: [number, number, number, number][] = [[0, a.length, 0, b.length]];

  while (queue.length > 0) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const m = findLongestMatch(a, b, alo, ahi, blo, bhi, b2j);
    if (m.size === 0) continue;
    totalMatches += m.size;
    if (alo < m.i && blo < m.j) queue.push([alo, m.i, blo, m.j]);
    if (m.i + m.size < ahi && m.j + m.size < bhi) {
      queue.push([m.i + m.size, ahi, m.j + m.size, bhi]);
    }
  }

  return (2 * totalMatches) / (a.length + b.length);
}

// ─── Duplicate detection ────────────────────────────────────────────────────

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9 ]+/g, " ");
}

export function findDuplicates(issues: Issue[]): DuplicatePair[] {
  const opens = issues.filter((i) => i.state === "OPEN");
  const normed = opens.map((i) => ({ issue: i, normed: normalizeTitle(i.title) }));
  const dupes: DuplicatePair[] = [];
  for (let idx = 0; idx < normed.length; idx++) {
    for (let j = idx + 1; j < normed.length; j++) {
      const ratio = similarityRatio(normed[idx]!.normed, normed[j]!.normed);
      if (ratio > 0.85) {
        dupes.push({
          a: normed[idx]!.issue.number,
          b: normed[j]!.issue.number,
          similarity: Number(ratio.toFixed(4)),
        });
      }
    }
  }
  return dupes;
}
