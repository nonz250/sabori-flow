import type { FailureDiagnostics, StepResult } from "./models.js";
import { Agent, FailureCategory, agentDisplayName } from "./models.js";
import type { AgentPool } from "./agent-pool.js";
import type { ProcessResult } from "./process.js";
import { FIRST_ATTEMPT } from "./worktree.js";
import { createLogger } from "./logger.js";

const logger = createLogger("agent-fallback");

/**
 * Agents ahead of the one that ran in the priority list are exactly the
 * ones that were skipped for hitting their usage limit, whether on this
 * item or on an earlier one in the same run.
 */
export function describeFallback(priority: readonly Agent[], agent: Agent): string | null {
  const skipped = priority.slice(0, priority.indexOf(agent));
  if (skipped.length === 0) return null;
  return `Ran with ${agentDisplayName(agent)} because ${skipped.map(agentDisplayName).join(", ")} hit the usage limit.`;
}

export function withFallbackNote(
  diagnostics: FailureDiagnostics,
  fallbackNote: string | null,
): FailureDiagnostics {
  if (fallbackNote === null) return diagnostics;
  return { ...diagnostics, summary: `${diagnostics.summary}. ${fallbackNote}` };
}

export interface InProgressTransition {
  readonly claim: () => Promise<void>;
  /** Puts back every label claim removed. */
  readonly release: () => Promise<void>;
}

/**
 * @param subject how logs name the item, such as "Issue #12"
 * @returns null when the item is in progress with an agent left to run it;
 *   otherwise the result to return without running anything
 */
export async function enterInProgress(
  agentPool: AgentPool,
  subject: string,
  repo: string,
  transition: InProgressTransition,
): Promise<StepResult | null> {
  // Checked before the transition so the item keeps its trigger label and
  // is picked up again next cycle, when the agents' quota may have reset.
  if (agentPool.next() === undefined) {
    logger.info("%s: 利用可能なエージェントがないため次回に回します [repo=%s]", subject, repo);
    return { outcome: "deferred", claudeExecuted: false };
  }

  try {
    await transition.claim();
  } catch (error: unknown) {
    logger.error(
      "%s: trigger -> in-progress のラベル遷移に失敗しました [repo=%s]: %s",
      subject,
      repo,
      error instanceof Error ? error.message : String(error),
    );
    return { outcome: "failure", claudeExecuted: false };
  }

  // Repositories run in parallel, so another one can exhaust the last
  // agent while the transition above is in flight. Nothing has run yet,
  // so handing the labels back is the same deferral as above.
  if (agentPool.next() === undefined) {
    logger.info(
      "%s: ラベル遷移中に利用可能なエージェントがなくなったため trigger ラベルに戻します [repo=%s]",
      subject,
      repo,
    );
    await transition.release().catch((error: unknown) => {
      logger.warn(
        "%s: trigger ラベルへの戻しに失敗しました [repo=%s]: %s",
        subject,
        repo,
        error instanceof Error ? error.message : String(error),
      );
    });
    return { outcome: "deferred", claudeExecuted: false };
  }

  return null;
}

export type AttemptOutcome =
  // limitReached: the attempt is final (e.g. impl had already opened its PR)
  // but its agent still ran out of quota, so later items must skip it.
  | { readonly kind: "done"; readonly result: StepResult; readonly limitReached?: boolean }
  | { readonly kind: "usage-limit"; readonly output: ProcessResult };

export type FallbackResult =
  | { readonly kind: "done"; readonly result: StepResult }
  | { readonly kind: "exhausted"; readonly diagnostics: FailureDiagnostics; readonly result: StepResult };

/**
 * Tries agents in priority order. Only a usage-limit failure moves on to the
 * next agent; any other outcome, success or failure, is final, because a
 * different agent is no more likely to fix a broken prompt or a failing
 * build. runAttempt should give each attempt its own worktree so a fallback
 * agent never inherits a half-finished change.
 *
 * @param subject how logs name the item, such as "Issue #12"
 */
export async function tryAgentsInOrder(
  agentPool: AgentPool,
  agents: readonly Agent[],
  subject: string,
  repo: string,
  runAttempt: (agent: Agent, attempt: number) => Promise<AttemptOutcome>,
): Promise<FallbackResult> {
  let attempt = 0;
  let lastLimitOutput: ProcessResult | null = null;

  for (let agent = agentPool.next(); agent !== undefined; agent = agentPool.next()) {
    attempt++;
    const outcome = await runAttempt(agent, attempt);
    if (outcome.kind === "done") {
      if (outcome.limitReached) {
        agentPool.markExhausted(agent);
      }
      // An earlier attempt that hit the limit still launched a CLI, which
      // counts against max_issues_per_repo even if this attempt never did.
      const result = attempt > FIRST_ATTEMPT ? { ...outcome.result, claudeExecuted: true } : outcome.result;
      return { kind: "done", result };
    }

    agentPool.markExhausted(agent);
    lastLimitOutput = outcome.output;
    const nextAgent = agentPool.next();
    if (nextAgent !== undefined) {
      logger.warn(
        "%s: %s が利用上限に達したため %s にフォールバックします [repo=%s]",
        subject,
        agentDisplayName(agent),
        agentDisplayName(nextAgent),
        repo,
      );
    } else {
      logger.error(
        "%s: %s が利用上限に達し、フォールバック先のエージェントも残っていません [repo=%s]",
        subject,
        agentDisplayName(agent),
        repo,
      );
    }
  }

  return {
    kind: "exhausted",
    diagnostics: {
      category: FailureCategory.AGENT_USAGE_LIMIT,
      summary: `Every configured agent has hit its usage limit (${agents.map(agentDisplayName).join(", ")})`,
      stdout: lastLimitOutput?.stdout,
      stderr: lastLimitOutput?.stderr,
      exitCode: lastLimitOutput?.exitCode,
    },
    result: { outcome: "failure", claudeExecuted: attempt > 0 },
  };
}
