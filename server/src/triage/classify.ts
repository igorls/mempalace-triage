import {
  BUG_TITLE_PREFIX,
  CRITICAL_KEYWORDS,
  DEWEIGHT_PHRASES,
  FEATURE_TITLE_PREFIX,
  HIGH_KEYWORDS,
  NOISE_BODY_PATTERNS,
  NOISE_TITLE_PATTERNS,
  SUBSTANTIVE_TITLE_MARKERS,
} from "./constants";
import type { Issue, Severity } from "./types";

function matchAny(patterns: string[], text: string): boolean {
  for (const pat of patterns) {
    if (new RegExp(pat, "i").test(text)) return true;
  }
  return false;
}

export function classifySeverity(issue: Issue): Severity {
  const titleLower = issue.title.toLowerCase();
  let bodyLower = issue.body.toLowerCase();

  // Features / RFCs never get severity bumps from body keywords.
  if (issue.labels.includes("enhancement")) return "normal";
  if (FEATURE_TITLE_PREFIX.test(issue.title)) return "normal";

  // De-weight common "prevent X" phrasing before keyword matching.
  for (const phrase of DEWEIGHT_PHRASES) {
    bodyLower = bodyLower.split(phrase).join("");
  }

  const isBugSignaled =
    issue.labels.includes("bug") || BUG_TITLE_PREFIX.test(issue.title);

  // Title alone is the strongest signal → always promotes to CRITICAL.
  if (matchAny(CRITICAL_KEYWORDS, titleLower)) return "critical";

  // Body keyword only promotes if there's a bug signal elsewhere.
  if (isBugSignaled && matchAny(CRITICAL_KEYWORDS, bodyLower)) return "critical";

  if (matchAny(HIGH_KEYWORDS, titleLower)) return "high";
  if (isBugSignaled && matchAny(HIGH_KEYWORDS, bodyLower)) return "high";

  return "normal";
}

export function detectNoise(issue: Issue): { isNoise: boolean; reason: string } {
  const title = issue.title.trim();
  const body = issue.body.trim();
  const substantiveTitle = SUBSTANTIVE_TITLE_MARKERS.test(title);

  // Hard noise title patterns always win.
  for (const pat of NOISE_TITLE_PATTERNS) {
    if (pat.test(title)) {
      return { isNoise: true, reason: `title matches noise pattern /${pat.source}/` };
    }
  }

  // Very short title + very short body, and title has no bug/error signal.
  if (title.length < 20 && body.length < 40 && !substantiveTitle) {
    return {
      isNoise: true,
      reason: "very short title and body, no bug signal in title",
    };
  }

  // Thanks-only / greeting body (short and sweet).
  if (body.length < 200 && !substantiveTitle) {
    for (const pat of NOISE_BODY_PATTERNS) {
      if (pat.test(body)) {
        return { isNoise: true, reason: `body matches noise pattern /${pat.source}/` };
      }
    }
  }

  // Body mostly emoji / non-ASCII punctuation (only when title is also unhelpful).
  if (body.length > 0 && body.length < 300 && !substantiveTitle) {
    let nonWord = 0;
    for (const ch of body) {
      const isAlnum = /[\p{L}\p{N}]/u.test(ch);
      const isSpace = /\s/.test(ch);
      if (!isAlnum && !isSpace) nonWord += 1;
    }
    if (nonWord / Math.max(body.length, 1) > 0.5) {
      return { isNoise: true, reason: "body is mostly symbols/emoji" };
    }
  }

  return { isNoise: false, reason: "" };
}
