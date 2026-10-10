import { Agent } from "./models.js";
import type { ProcessResult } from "./process.js";

// Both CLIs print these when the account (not a single request) has run out
// of quota. Transient per-request throttling such as HTTP 429 rate limits is
// deliberately excluded: retrying the same agent later in the cycle can still
// succeed, so it is not a reason to hand the issue to another agent.
const APOSTROPHE = "['’]";

// The CLIs print the quota error last, right before exiting. Earlier lines
// can be transcript (Codex streams tool output, including fetched Issue
// bodies, to stderr), so only the tail is trusted.
const TAIL_LINE_COUNT = 3;

const USAGE_LIMIT_PATTERNS: Record<Agent, readonly RegExp[]> = {
  [Agent.CLAUDE]: [
    new RegExp(`You${APOSTROPHE}ve hit your\\b`, "i"),
    new RegExp(`You${APOSTROPHE}ve reached your .*limit`, "i"),
    new RegExp(`You${APOSTROPHE}re out of (?:extra usage|usage credits)`, "i"),
    /Your org(?:anization)? is out of usage/i,
    /usage limit reached/i,
    /credit balance (?:is )?too low/i,
  ],
  [Agent.CODEX]: [
    new RegExp(`You${APOSTROPHE}ve (?:hit|reached) your usage limit`, "i"),
    /usage limit reached/i,
    /out of credits/i,
    /quota exceeded/i,
    /usage_limit_(?:reached|exceeded)/,
    /insufficient_quota/,
  ],
};

/**
 * A failed run is judged by the last lines of both streams. A successful
 * run counts only when its whole stdout is a single line matching a
 * pattern: some CLI versions report the limit with exit code 0, but
 * anything longer is model output that can quote the Issue body.
 */
export function isUsageLimitReached(
  agent: Agent,
  result: Pick<ProcessResult, "success" | "stdout" | "stderr">,
): boolean {
  const patterns = USAGE_LIMIT_PATTERNS[agent];
  const matches = (text: string): boolean => patterns.some((pattern) => pattern.test(text));

  if (result.success) {
    const stdout = result.stdout.trim();
    return !stdout.includes("\n") && matches(stdout);
  }
  return matches(tail(result.stdout)) || matches(tail(result.stderr));
}

function tail(text: string): string {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-TAIL_LINE_COUNT)
    .join("\n");
}
