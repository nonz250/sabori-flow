import type { Language } from "../i18n/types.js";
import type {
  Autonomy,
  ExecutionConfig,
  FailureDiagnostics,
  PhaseLabels,
  PullRequest,
  PullRequestDetails,
  RepositoryConfig,
  StepResult,
} from "./models.js";
import { Agent, FailureCategory, agentDisplayName, repoFullName } from "./models.js";
import type { ProcessResult } from "./process.js";
import type { ReviewPromptOptions } from "./prompt.js";
import { buildReviewPrompt } from "./prompt.js";
import { runAgent, ExecutorTimeoutError } from "./executor.js";
import type { LabelTarget, LabelTransition } from "./label.js";
import { applyLabelTransition } from "./label.js";
import type { CommentTarget, ReviewCommentOptions } from "./comment.js";
import {
  postReviewComment,
  postFailureComment,
  formatFailureDiagnostics,
  sanitizeOutput,
} from "./comment.js";
import { fetchPullRequestDetails } from "./fetcher.js";
import { validateBranchName } from "./config.js";
import {
  withPullRequestWorktree,
  resolveHeadSha,
  WorktreeError,
} from "./worktree.js";
import {
  prepareScreenshotDir,
  withStagedScreenshots,
  MAX_REVIEW_SCREENSHOTS,
} from "./review-screenshots.js";
import type { AttemptOutcome } from "./agent-fallback.js";
import {
  describeFallback,
  enterInProgress,
  tryAgentsInOrder,
  withFallbackNote,
} from "./agent-fallback.js";
import { AgentPool } from "./agent-pool.js";
import { isUsageLimitReached } from "./usage-limit.js";
import { createLogger } from "./logger.js";

const logger = createLogger("review-pipeline");

const MS_PER_MINUTE = 60_000;
const UNKNOWN_SHA = "unknown";

// ---------- Dependency Injection ----------

export interface ReviewPipelineDeps {
  fetchPullRequestDetails: (repo: string, num: number) => Promise<PullRequestDetails>;
  buildReviewPrompt: (
    pullRequest: PullRequest,
    repoConfig: RepositoryConfig,
    language: Language,
    options: ReviewPromptOptions,
  ) => string;
  runAgent: (
    prompt: string,
    options: { cwd: string; agent?: Agent; autonomy?: Autonomy; timeoutMs?: number; authToken?: string },
  ) => Promise<ProcessResult>;
  applyLabelTransition: (
    repo: string,
    num: number,
    transition: LabelTransition,
    target: LabelTarget,
  ) => Promise<void>;
  postReviewComment: (
    repo: string,
    num: number,
    output: string,
    options: ReviewCommentOptions,
  ) => Promise<string>;
  postFailureComment: (
    repo: string,
    num: number,
    message: string,
    target: CommentTarget,
  ) => Promise<void>;
  withPullRequestWorktree: <T>(
    repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath">,
    prNumber: number,
    baseBranch: string,
    callback: (worktreePath: string) => Promise<T>,
    attempt: number,
  ) => Promise<T>;
  resolveHeadSha: (worktreePath: string) => string;
  prepareScreenshotDir: (worktreePath: string) => string;
  withStagedScreenshots: <T>(
    worktreePath: string,
    callback: (attachmentDir: string | null, screenshots: string[]) => Promise<T>,
  ) => Promise<T>;
}

export const defaultReviewDeps: ReviewPipelineDeps = {
  fetchPullRequestDetails,
  buildReviewPrompt,
  runAgent: (prompt, options) => runAgent(options.agent ?? Agent.CLAUDE, prompt, options),
  applyLabelTransition,
  postReviewComment,
  postFailureComment,
  withPullRequestWorktree: (repoConfig, prNumber, baseBranch, callback, attempt) =>
    withPullRequestWorktree(repoConfig, prNumber, baseBranch, callback, undefined, attempt),
  resolveHeadSha,
  prepareScreenshotDir,
  withStagedScreenshots: (worktreePath, callback) => withStagedScreenshots(worktreePath, callback),
};

// ---------- Pipeline ----------

interface ReviewContext {
  readonly pullRequest: PullRequest;
  readonly repoConfig: RepositoryConfig;
  readonly executionConfig: ExecutionConfig;
  readonly authToken: string | null;
  readonly deps: ReviewPipelineDeps;
  readonly repo: string;
  readonly labels: PhaseLabels;
  readonly baseBranch: string;
}

export async function processReviewRequest(
  pullRequest: PullRequest,
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
  authToken: string | null,
  deps: ReviewPipelineDeps = defaultReviewDeps,
  agentPool: AgentPool = new AgentPool(executionConfig.agents),
): Promise<StepResult> {
  const repo = repoFullName(repoConfig);
  const labels = repoConfig.labels.review;
  const prNumber = pullRequest.number;

  logger.info("PR #%s (%s) のレビューを開始します [repo=%s]", prNumber, pullRequest.title, repo);

  // Read before the trigger label comes off so a transient failure is
  // retried next cycle.
  let details: PullRequestDetails;
  try {
    details = await deps.fetchPullRequestDetails(repo, prNumber);
  } catch (error: unknown) {
    logger.error(
      "PR #%s: PR の詳細取得に失敗しました [repo=%s]: %s",
      prNumber,
      repo,
      error instanceof Error ? error.message : String(error),
    );
    return { outcome: "failure", claudeExecuted: false };
  }

  // A re-review starts from a PR that still carries the previous outcome.
  // Only labels the PR actually has are removed, because gh fails on a
  // label that does not exist in the repository yet.
  const staleOutcomes = [labels.done, labels.failed].filter((label) => pullRequest.labels.includes(label));

  const unsupportedReason = findUnsupportedReason(details);
  if (unsupportedReason !== null) {
    logger.warn("PR #%s: レビュー対象外です [repo=%s]: %s", prNumber, repo, unsupportedReason);
    const remove = [labels.trigger, ...staleOutcomes.filter((label) => label !== labels.failed)];
    await markFailed(deps, repo, prNumber, { add: [labels.failed], remove }, {
      category: FailureCategory.REVIEW_UNSUPPORTED_PR,
      summary: unsupportedReason,
    });
    return { outcome: "failure", claudeExecuted: false };
  }

  const notStarted = await enterInProgress(agentPool, `PR #${prNumber}`, repo, {
    claim: () => deps.applyLabelTransition(
      repo,
      prNumber,
      { add: [labels.inProgress], remove: [labels.trigger, ...staleOutcomes] },
      "pr",
    ),
    release: () => deps.applyLabelTransition(
      repo,
      prNumber,
      { add: [labels.trigger, ...staleOutcomes], remove: [labels.inProgress] },
      "pr",
    ),
  });
  if (notStarted !== null) {
    return notStarted;
  }

  const ctx: ReviewContext = {
    pullRequest,
    repoConfig,
    executionConfig,
    authToken,
    deps,
    repo,
    labels,
    baseBranch: details.baseRefName,
  };
  return runWithAgentFallback(ctx, agentPool);
}

function findUnsupportedReason(details: PullRequestDetails): string | null {
  if (details.isCrossRepository) {
    return "Pull requests from forks are not reviewed, because the review runs the pull request's code locally";
  }
  try {
    validateBranchName(details.baseRefName, "base branch");
  } catch {
    return `The base branch name '${details.baseRefName}' is not supported`;
  }
  return null;
}

/**
 * Unlike impl, a review that stops at the usage limit has no side effect to
 * check for: the agent never posts, so the next agent can simply start over.
 */
async function runWithAgentFallback(ctx: ReviewContext, agentPool: AgentPool): Promise<StepResult> {
  const fallback = await tryAgentsInOrder(
    agentPool,
    ctx.executionConfig.agents,
    `PR #${ctx.pullRequest.number}`,
    ctx.repo,
    (agent, attempt) => runAttempt(ctx, agent, attempt),
  );
  if (fallback.kind === "exhausted") {
    await markInProgressFailed(ctx, fallback.diagnostics);
  }
  return fallback.result;
}

async function runAttempt(ctx: ReviewContext, agent: Agent, attempt: number): Promise<AttemptOutcome> {
  const { pullRequest, repoConfig, executionConfig, deps, repo } = ctx;
  const prNumber = pullRequest.number;
  const note = describeFallback(executionConfig.agents, agent);
  const done = (result: StepResult): AttemptOutcome => ({ kind: "done", result });
  const fail = (diagnostics: FailureDiagnostics): Promise<void> =>
    markInProgressFailed(ctx, withFallbackNote(diagnostics, note));

  try {
    return await deps.withPullRequestWorktree(
      repoConfig,
      prNumber,
      ctx.baseBranch,
      async (worktreePath: string): Promise<AttemptOutcome> => {
        let screenshotDir: string;
        try {
          screenshotDir = deps.prepareScreenshotDir(worktreePath);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("PR #%s: スクリーンショットの保存先を作れませんでした [repo=%s]: %s", prNumber, repo, errorMessage);
          await fail({
            category: FailureCategory.WORKTREE_CREATION,
            summary: "Failed to prepare the screenshot directory",
            errorMessage,
          });
          return done({ outcome: "failure", claudeExecuted: false });
        }

        // Read before the agent runs: it may check out other commits while
        // verifying, and the comment must name the commit that was reviewed.
        let reviewedSha = UNKNOWN_SHA;
        try {
          reviewedSha = deps.resolveHeadSha(worktreePath);
        } catch (error: unknown) {
          logger.warn(
            "PR #%s: レビュー対象のコミットを特定できませんでした [repo=%s]: %s",
            prNumber,
            repo,
            error instanceof Error ? error.message : String(error),
          );
        }

        let prompt: string;
        try {
          prompt = deps.buildReviewPrompt(pullRequest, repoConfig, executionConfig.language, {
            baseBranch: ctx.baseBranch,
            screenshotDir,
            maxScreenshots: MAX_REVIEW_SCREENSHOTS,
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("PR #%s: プロンプト生成に失敗しました [repo=%s]: %s", prNumber, repo, errorMessage);
          await fail({ category: FailureCategory.PROMPT_GENERATION, summary: "Prompt generation failed", errorMessage });
          return done({ outcome: "failure", claudeExecuted: false });
        }

        const agentName = agentDisplayName(agent);
        let result: ProcessResult;
        try {
          result = await deps.runAgent(prompt, {
            cwd: worktreePath,
            agent,
            autonomy: executionConfig.autonomy,
            timeoutMs: executionConfig.timeoutMinutes * MS_PER_MINUTE,
            authToken: ctx.authToken ?? undefined,
          });
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("PR #%s: %s の実行に失敗しました [repo=%s]: %s", prNumber, agentName, repo, errorMessage);
          if (error instanceof ExecutorTimeoutError) {
            await fail({
              category: FailureCategory.CLI_TIMEOUT,
              summary: `${agentName} timed out`,
              timeoutMs: error.timeoutMs,
              errorMessage,
              stdout: error.stdout,
              stderr: error.stderr,
            });
          } else {
            await fail({
              category: FailureCategory.CLI_EXECUTION_ERROR,
              summary: `${agentName} execution failed`,
              errorMessage,
            });
          }
          return done({ outcome: "failure", claudeExecuted: true });
        }

        if (isUsageLimitReached(agent, result)) {
          return { kind: "usage-limit", output: result };
        }

        if (!result.success) {
          logger.error("PR #%s: %s が失敗ステータスを返しました [repo=%s]", prNumber, agentName, repo);
          await fail({
            category: FailureCategory.CLI_NON_ZERO_EXIT,
            summary: `${agentName} returned a non-zero exit code`,
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode,
          });
          return done({ outcome: "failure", claudeExecuted: true });
        }

        if (result.stdout.trim() === "") {
          logger.error("PR #%s: %s がレビュー結果を出力しませんでした [repo=%s]", prNumber, agentName, repo);
          await fail({
            category: FailureCategory.REVIEW_EMPTY_OUTPUT,
            summary: `${agentName} exited successfully without printing a review`,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
          return done({ outcome: "failure", claudeExecuted: true });
        }

        let commentUrl: string;
        try {
          commentUrl = await deps.withStagedScreenshots(worktreePath, (attachmentDir, screenshots) =>
            deps.postReviewComment(repo, prNumber, result.stdout, {
              reviewedSha,
              attachmentDir,
              screenshots,
              note,
              language: executionConfig.language,
            }),
          );
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("PR #%s: レビューコメントの投稿に失敗しました [repo=%s]: %s", prNumber, repo, errorMessage);
          logger.error("PR #%s: review output (not posted): %s", prNumber, sanitizeOutput(result.stdout));
          await fail({
            category: FailureCategory.REVIEW_COMMENT,
            summary: "Failed to post the review comment",
            errorMessage,
          });
          return done({ outcome: "failure", claudeExecuted: true });
        }

        try {
          await deps.applyLabelTransition(
            repo,
            prNumber,
            { add: [ctx.labels.done], remove: [ctx.labels.inProgress] },
            "pr",
          );
        } catch (error: unknown) {
          logger.warn(
            "PR #%s: done ラベル遷移に失敗しました [repo=%s]: %s",
            prNumber,
            repo,
            error instanceof Error ? error.message : String(error),
          );
        }

        logger.info("PR #%s のレビューを投稿しました [repo=%s]: %s", prNumber, repo, commentUrl);
        return done({ outcome: "success", claudeExecuted: true });
      },
      attempt,
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (!(error instanceof WorktreeError)) {
      logger.error("PR #%s: レビュー中に予期しないエラーが発生しました [repo=%s]: %s", prNumber, repo, errorMessage);
      await fail({
        category: FailureCategory.CLI_EXECUTION_ERROR,
        summary: "Unexpected error during the review",
        errorMessage,
      });
      return done({ outcome: "failure", claudeExecuted: false });
    }
    logger.error("PR #%s: worktree の作成に失敗しました [repo=%s]: %s", prNumber, repo, errorMessage);
    const isFetch = error.phase === "fetch";
    await fail({
      category: isFetch ? FailureCategory.GIT_FETCH : FailureCategory.WORKTREE_CREATION,
      summary: isFetch ? "Git fetch failed" : "Worktree creation failed",
      errorMessage,
    });
    return done({ outcome: "failure", claudeExecuted: false });
  }
}

function markInProgressFailed(ctx: ReviewContext, diagnostics: FailureDiagnostics): Promise<void> {
  return markFailed(
    ctx.deps,
    ctx.repo,
    ctx.pullRequest.number,
    { add: [ctx.labels.failed], remove: [ctx.labels.inProgress] },
    diagnostics,
  );
}

async function markFailed(
  deps: ReviewPipelineDeps,
  repo: string,
  prNumber: number,
  transition: LabelTransition,
  diagnostics: FailureDiagnostics,
): Promise<void> {
  await deps.applyLabelTransition(repo, prNumber, transition, "pr").catch((error: unknown) => {
    logger.warn(
      "PR #%s: failed ラベル遷移に失敗しました [repo=%s]: %s",
      prNumber,
      repo,
      error instanceof Error ? error.message : String(error),
    );
  });

  await deps.postFailureComment(repo, prNumber, formatFailureDiagnostics(diagnostics), "pr").catch(
    (error: unknown) => {
      logger.warn(
        "PR #%s: 失敗コメントの投稿に失敗しました [repo=%s]: %s",
        prNumber,
        repo,
        error instanceof Error ? error.message : String(error),
      );
    },
  );
}
