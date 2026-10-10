import { Agent } from "./models.js";
import type { ProcessResult } from "./process.js";

// Both CLIs print these when the account (not a single request) has run out
// of quota. Transient per-request throttling such as HTTP 429 rate limits is
// deliberately excluded: retrying the same agent later in the cycle can still
// succeed, so it is not a reason to hand the issue to another agent.
const APOSTROPHE = "['’]";

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
 * Callers must only pass the output of a failed run. A successful run's
 * stdout is model output that can quote the Issue body, so matching it would
 * let Issue text trigger a fallback.
 */
export function isUsageLimitReached(
  agent: Agent,
  output: Pick<ProcessResult, "stdout" | "stderr">,
): boolean {
  return USAGE_LIMIT_PATTERNS[agent].some(
    (pattern) => pattern.test(output.stdout) || pattern.test(output.stderr),
  );
}
