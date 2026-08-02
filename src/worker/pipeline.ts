import type { Language } from "../i18n/types.js";
import type { Issue, IssueComment, PhaseLabels, RepositoryConfig, ExecutionConfig, FailureDiagnostics, StepResult, SpecPhaseLabels } from "./models.js";
import { Autonomy, Phase, FailureCategory, repoFullName } from "./models.js";
import type { ProcessResult } from "./process.js";
import { buildPrompt } from "./prompt.js";
import { runClaude, ExecutorTimeoutError } from "./executor.js";
import { applyLabelTransition } from "./label.js";
import type { LabelTransition } from "./label.js";
import {
  postSuccessComment,
  postFailureComment,
  postSpecProposalComment,
  formatFailureDiagnostics,
  sanitizeOutput,
} from "./comment.js";
import { fetchIssueComments, IssueCommentsError } from "./issue-comments.js";
import { deriveSpecThread, buildSpecContext } from "./spec-thread.js";
import { evaluateSpecResume } from "./spec-review.js";
import { fetchLinkedPullRequestNumbers } from "./linked-pr.js";
import { withWorktree, WorktreeError } from "./worktree.js";
import { createLogger } from "./logger.js";

const logger = createLogger("pipeline");

const MS_PER_MINUTE = 60_000;

// ---------- Dependency Injection ----------

export interface PipelineDeps {
  buildPrompt: (issue: Issue, repoConfig: RepositoryConfig, language: Language, specContext?: string | null) => string;
  runClaude: (
    prompt: string,
    options: { cwd: string; autonomy?: Autonomy; timeoutMs?: number; authToken?: string },
  ) => Promise<ProcessResult>;
  applyLabelTransition: (
    repo: string,
    num: number,
    transition: LabelTransition,
  ) => Promise<void>;
  postSuccessComment: (
    repo: string,
    num: number,
    output: string,
  ) => Promise<void>;
  postFailureComment: (
    repo: string,
    num: number,
    message: string,
  ) => Promise<void>;
  postSpecProposalComment: (
    repo: string,
    num: number,
    rawOutput: string,
    round: number,
  ) => Promise<void>;
  fetchIssueComments: (
    owner: string,
    repo: string,
    issueNumber: number,
  ) => Promise<readonly IssueComment[]>;
  fetchLinkedPullRequestNumbers: (
    repo: string,
    num: number,
  ) => Promise<readonly number[]>;
  withWorktree: <T>(
    repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath" | "defaultBranch">,
    issueNumber: number,
    callback: (worktreePath: string) => Promise<T>,
  ) => Promise<T>;
}

export const defaultDeps: PipelineDeps = {
  buildPrompt,
  runClaude: (prompt, options) => runClaude(prompt, options),
  applyLabelTransition,
  postSuccessComment,
  postFailureComment,
  postSpecProposalComment,
  fetchIssueComments,
  fetchLinkedPullRequestNumbers,
  withWorktree,
};

// ---------- Pipeline ----------

export async function processIssue(
  issue: Issue,
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
  authToken: string | null,
  entryLabel: string,
  deps: PipelineDeps = defaultDeps,
): Promise<StepResult> {
  const repo = repoFullName(repoConfig);
  const phaseLabels = repoConfig.labels[issue.phase];

  logger.info(
    "Issue #%s (%s) の処理を開始します [repo=%s, phase=%s]",
    issue.number,
    issue.title,
    repo,
    issue.phase,
  );

  // Fetch comments before removing the trigger label so that a transient
  // failure leaves the label intact and the Issue is retried next cycle.
  let specContext: string | null = null;
  let specRound = 1;
  const isSpecTrigger = issue.phase === Phase.SPEC && entryLabel === repoConfig.labels.spec.trigger;
  const isSpecReview = issue.phase === Phase.SPEC && entryLabel === repoConfig.labels.spec.review;

  try {
    const comments = await deps.fetchIssueComments(repoConfig.owner, repoConfig.repo, issue.number);
    const thread = deriveSpecThread(comments);
    specContext = buildSpecContext(thread);

    if (issue.phase === Phase.SPEC) {
      specRound = isSpecTrigger ? 1 : thread.round + 1;
    }
  } catch (error: unknown) {
    // Never fall through to claude without the spec. "No spec exists" and
    // "the spec could not be read" look identical downstream, and impl would
    // build against unknown acceptance criteria and open a PR — which strips
    // the trigger label, so the mistake is never retried.
    return await handleCommentFetchError(error, deps, repo, issue, repoConfig, entryLabel, isSpecReview);
  }

  // Trigger → in-progress (level 1)
  if (entryLabel !== phaseLabels.inProgress) {
    try {
      await deps.applyLabelTransition(repo, issue.number, {
        add: [phaseLabels.inProgress],
        remove: [entryLabel],
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        "Issue #%s: trigger -> in-progress のラベル遷移に失敗しました [repo=%s]: %s",
        issue.number,
        repo,
        errorMessage,
      );
      return { outcome: "failure", claudeExecuted: false };
    }
  }

  // Worktree → prompt → claude
  try {
    return await deps.withWorktree(
      repoConfig,
      issue.number,
      async (worktreePath: string) => {
        let prompt: string;
        try {
          prompt = deps.buildPrompt(issue, repoConfig, executionConfig.language, specContext);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            "Issue #%s: プロンプト生成に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            errorMessage,
          );
          await handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.PROMPT_GENERATION,
            summary: "Prompt generation failed",
            errorMessage,
          });
          return { outcome: "failure", claudeExecuted: false };
        }

        let result: ProcessResult;
        try {
          result = await deps.runClaude(prompt, {
            cwd: worktreePath,
            autonomy: executionConfig.autonomy,
            timeoutMs: executionConfig.timeoutMinutes * MS_PER_MINUTE,
            authToken: authToken ?? undefined,
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            "Issue #%s: Claude CLI の実行に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            errorMessage,
          );
          if (error instanceof ExecutorTimeoutError) {
            await handleFailure(deps, repo, issue.number, phaseLabels, {
              category: FailureCategory.CLI_TIMEOUT,
              summary: "Claude Code CLI timed out",
              timeoutMs: error.timeoutMs,
              errorMessage,
              stdout: error.stdout,
              stderr: error.stderr,
            });
          } else {
            await handleFailure(deps, repo, issue.number, phaseLabels, {
              category: FailureCategory.CLI_EXECUTION_ERROR,
              summary: "Claude Code CLI execution failed",
              errorMessage,
            });
          }
          return { outcome: "failure", claudeExecuted: true };
        }

        if (!result.success) {
          logger.error(
            "Issue #%s: Claude CLI が失敗ステータスを返しました [repo=%s]",
            issue.number,
            repo,
          );
          await handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.CLI_NON_ZERO_EXIT,
            summary: "Claude Code CLI returned a non-zero exit code",
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode,
          });
          return { outcome: "failure", claudeExecuted: true };
        }

        // Phase-specific success handling
        if (issue.phase === Phase.SPEC) {
          return handleSpecSuccess(deps, repo, issue, repoConfig.labels.spec, result, specRound);
        }

        // `claude -p` exits 0 when the model stops calling tools, even if
        // background processes or subagents it spawned are still running.
        // Exit code alone therefore cannot confirm that impl actually
        // produced a deliverable.
        if (
          issue.phase === Phase.IMPL &&
          !(await implPullRequestCheckPassed(deps, repo, issue.number))
        ) {
          logger.error(
            "Issue #%s: impl が成功終了しましたが紐づく PR がありません [repo=%s]",
            issue.number,
            repo,
          );
          await handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.IMPL_NO_LINKED_PR,
            summary:
              "Claude Code CLI exited 0, but no pull request is linked to close this issue",
            stdout: result.stdout,
            stderr: result.stderr,
          });
          return { outcome: "failure", claudeExecuted: true };
        }

        // plan/impl success: done + success comment (level 3)
        let doneTransitionSucceeded = false;
        try {
          await deps.applyLabelTransition(repo, issue.number, {
            add: [phaseLabels.done],
            remove: [phaseLabels.inProgress],
          });
          doneTransitionSucceeded = true;
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(
            "Issue #%s: done ラベル遷移に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            errorMessage,
          );
        }

        if (doneTransitionSucceeded && issue.phase === Phase.PLAN && repoConfig.autoImplAfterPlan) {
          try {
            await deps.applyLabelTransition(repo, issue.number, {
              add: [repoConfig.labels.impl.trigger],
              remove: [],
            });
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.warn(
              "Issue #%s: impl trigger ラベルの自動付与に失敗しました [repo=%s]: %s",
              issue.number,
              repo,
              errorMessage,
            );
          }
        }

        try {
          await deps.postSuccessComment(repo, issue.number, sanitizeOutput(result.stdout));
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.warn(
            "Issue #%s: 成功コメントの投稿に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            errorMessage,
          );
        }

        logger.info(
          "Issue #%s の処理が正常に完了しました [repo=%s]",
          issue.number,
          repo,
        );
        return { outcome: "success", claudeExecuted: true };
      },
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Issue #%s: worktree の作成に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      errorMessage,
    );
    const category =
      error instanceof WorktreeError && error.phase === "fetch"
        ? FailureCategory.GIT_FETCH
        : FailureCategory.WORKTREE_CREATION;
    const summary =
      category === FailureCategory.GIT_FETCH
        ? "Git fetch failed"
        : "Worktree creation failed";
    await handleFailure(deps, repo, issue.number, phaseLabels, {
      category,
      summary,
      errorMessage,
    });
    return { outcome: "failure", claudeExecuted: false };
  }
}

// ---------- Internal helpers ----------

async function handleCommentFetchError(
  error: unknown,
  deps: PipelineDeps,
  repo: string,
  issue: Issue,
  repoConfig: RepositoryConfig,
  entryLabel: string,
  isSpecReview: boolean,
): Promise<StepResult> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const specLabels = repoConfig.labels.spec;

  if (error instanceof IssueCommentsError && error.structural) {
    // The fetch runs before the trigger label is removed, so the entry label
    // has to come off here. Otherwise the Issue keeps matching its queue and
    // reposts the same diagnostic every cycle. The review queue has no
    // trigger to strip, so it goes to needs-human instead of :failed.
    const transition = {
      add: [isSpecReview ? specLabels.needsHuman : repoConfig.labels[issue.phase].failed],
      remove: [entryLabel],
    };

    let transitionSucceeded = false;
    try {
      await deps.applyLabelTransition(repo, issue.number, transition);
      transitionSucceeded = true;
    } catch (e: unknown) {
      logger.warn(
        "Issue #%s: コメント取得失敗後のラベル遷移に失敗しました [repo=%s]: %s",
        issue.number,
        repo,
        e instanceof Error ? e.message : String(e),
      );
    }

    if (transitionSucceeded) {
      const formattedMessage = formatFailureDiagnostics({
        category: FailureCategory.CLI_EXECUTION_ERROR,
        summary: "Structural failure fetching Issue comments",
        errorMessage,
      });
      try {
        await deps.postFailureComment(repo, issue.number, formattedMessage);
      } catch (e: unknown) {
        logger.warn(
          "Issue #%s: 診断コメントの投稿に失敗しました [repo=%s]: %s",
          issue.number,
          repo,
          e instanceof Error ? e.message : String(e),
        );
      }
    }
    return { outcome: "failure", claudeExecuted: false };
  }

  // Transient failure: leave labels intact for next-cycle retry
  logger.error(
    "Issue #%s: コメント取得に一時的に失敗しました [repo=%s]: %s",
    issue.number,
    repo,
    errorMessage,
  );
  return { outcome: "failure", claudeExecuted: false };
}

/**
 * Spec success: post proposal comment first, then transition to review.
 * Comment before label because the marker comment is the state itself —
 * transitioning to review without a marker makes the review evaluator
 * unable to find the proposal.
 */
async function handleSpecSuccess(
  deps: PipelineDeps,
  repo: string,
  issue: Issue,
  specLabels: SpecPhaseLabels,
  result: ProcessResult,
  round: number,
): Promise<StepResult> {
  try {
    await deps.postSpecProposalComment(repo, issue.number, result.stdout, round);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Issue #%s: spec 提案コメントの投稿に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      errorMessage,
    );
    // Preserve spec output in logs since the comment failed to post
    logger.error(
      "Issue #%s: spec output (not posted): %s",
      issue.number,
      sanitizeOutput(result.stdout),
    );
    await handleFailure(deps, repo, issue.number, specLabels, {
      category: FailureCategory.SPEC_PROPOSAL_COMMENT,
      summary: "Failed to post spec proposal comment",
      errorMessage,
    });
    return { outcome: "failure", claudeExecuted: true };
  }

  // in-progress → review (level 3)
  try {
    await deps.applyLabelTransition(repo, issue.number, {
      add: [specLabels.review],
      remove: [specLabels.inProgress],
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Issue #%s: review ラベル遷移に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      errorMessage,
    );
  }

  logger.info(
    "Issue #%s の spec 提案が投稿されました [repo=%s]",
    issue.number,
    repo,
  );
  return { outcome: "success", claudeExecuted: true };
}

async function handleFailure(
  deps: PipelineDeps,
  repo: string,
  issueNumber: number,
  phaseLabels: PhaseLabels,
  diagnostics: FailureDiagnostics,
): Promise<void> {
  // Awaited rather than fire-and-forget: worker.ts calls process.exit() as
  // soon as the run returns, which would kill an in-flight gh child process
  // and leave the Issue with neither a failed label nor a diagnostic.
  await deps.applyLabelTransition(repo, issueNumber, {
    add: [phaseLabels.failed],
    remove: [phaseLabels.inProgress],
  }).catch(
    (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        "Issue #%s: failed ラベル遷移に失敗しました [repo=%s]: %s",
        issueNumber,
        repo,
        errorMessage,
      );
    },
  );

  const formattedMessage = formatFailureDiagnostics(diagnostics);
  await deps.postFailureComment(repo, issueNumber, formattedMessage).catch(
    (error: unknown) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.warn(
        "Issue #%s: 失敗コメントの投稿に失敗しました [repo=%s]: %s",
        issueNumber,
        repo,
        errorMessage,
      );
    },
  );
}

/**
 * @returns GitHub が「紐づく PR 0 件」と明示した場合のみ false。
 *          問い合わせ自体に失敗した場合は WARNING を残して true を返す。
 *          `:failed` は trigger ラベルを戻さず自動リトライされないため、
 *          確証が無い限り failed に倒さない。
 */
/**
 * spec review キューの Issue を評価し、適切なアクションを実行する。
 */
export async function resumeSpecReview(
  issue: Issue,
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
  authToken: string | null,
  canRunClaude: boolean,
  deps: PipelineDeps = defaultDeps,
): Promise<StepResult> {
  const repo = repoFullName(repoConfig);
  const specLabels = repoConfig.labels.spec;

  // Fetch comments to evaluate review state
  let comments: readonly IssueComment[];
  try {
    comments = await deps.fetchIssueComments(repoConfig.owner, repoConfig.repo, issue.number);
  } catch (error: unknown) {
    return await handleCommentFetchError(
      error,
      deps,
      repo,
      issue,
      repoConfig,
      specLabels.review,
      true,
    );
  }

  const thread = deriveSpecThread(comments);
  const decision = evaluateSpecResume({ thread, labels: issue.labels, specLabels });

  logger.info(
    "Issue #%s: spec review 評価結果 [repo=%s, action=%s, reason=%s]",
    issue.number, repo, decision.action, decision.reason,
  );

  // Filter remove list to labels actually present on the Issue
  const presentLabels = new Set(issue.labels);

  switch (decision.action) {
    case "approve": {
      const removeLabels = [specLabels.review, specLabels.approved];
      if (presentLabels.has(specLabels.trigger)) removeLabels.push(specLabels.trigger);
      try {
        await deps.applyLabelTransition(repo, issue.number, {
          add: [specLabels.done, repoConfig.labels.plan.trigger],
          remove: removeLabels,
        });
      } catch (error: unknown) {
        logger.warn(
          "Issue #%s: approve ラベル遷移に失敗しました [repo=%s]: %s",
          issue.number, repo, error instanceof Error ? error.message : String(error),
        );
      }
      return { outcome: "success", claudeExecuted: false };
    }

    case "escalate": {
      let transitionSucceeded = false;
      try {
        const removeLabels = [specLabels.review];
        if (presentLabels.has(specLabels.trigger)) removeLabels.push(specLabels.trigger);
        await deps.applyLabelTransition(repo, issue.number, {
          add: [specLabels.needsHuman],
          remove: removeLabels,
        });
        transitionSucceeded = true;
      } catch (error: unknown) {
        logger.warn(
          "Issue #%s: escalate ラベル遷移に失敗しました [repo=%s]: %s",
          issue.number, repo, error instanceof Error ? error.message : String(error),
        );
      }
      if (transitionSucceeded) {
        try {
          await deps.postFailureComment(repo, issue.number,
            `This issue requires human attention: ${decision.reason}`,
          );
        } catch (error: unknown) {
          logger.warn(
            "Issue #%s: エスカレーション説明コメントの投稿に失敗しました [repo=%s]: %s",
            issue.number, repo, error instanceof Error ? error.message : String(error),
          );
        }
      }
      return { outcome: "success", claudeExecuted: false };
    }

    case "revise": {
      if (!canRunClaude) {
        return { outcome: "deferred", claudeExecuted: false };
      }
      const removeLabels = [specLabels.review];
      if (presentLabels.has(specLabels.trigger)) removeLabels.push(specLabels.trigger);
      try {
        await deps.applyLabelTransition(repo, issue.number, {
          add: [specLabels.inProgress],
          remove: removeLabels,
        });
      } catch (error: unknown) {
        logger.warn(
          "Issue #%s: revise ラベル遷移に失敗しました [repo=%s]: %s",
          issue.number, repo, error instanceof Error ? error.message : String(error),
        );
        return { outcome: "failure", claudeExecuted: false };
      }
      return processIssue(issue, repoConfig, executionConfig, authToken, specLabels.inProgress, deps);
    }

    case "wait":
      return { outcome: "deferred", claudeExecuted: false };
  }
}

async function implPullRequestCheckPassed(
  deps: PipelineDeps,
  repo: string,
  issueNumber: number,
): Promise<boolean> {
  let prNumbers: readonly number[];
  try {
    prNumbers = await deps.fetchLinkedPullRequestNumbers(repo, issueNumber);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(
      "Issue #%s: PR 紐づけの確認に失敗したため検証をスキップします [repo=%s]: %s",
      issueNumber,
      repo,
      errorMessage,
    );
    return true;
  }
  if (prNumbers.length === 0) {
    return false;
  }
  logger.info(
    "Issue #%s: 紐づく PR を検出しました [repo=%s, pr=%s]",
    issueNumber,
    repo,
    prNumbers.join(", "),
  );
  return true;
}
