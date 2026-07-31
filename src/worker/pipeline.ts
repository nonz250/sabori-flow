import type { Language } from "../i18n/types.js";
import type { Issue, PhaseLabels, RepositoryConfig, ExecutionConfig, FailureDiagnostics } from "./models.js";
import { Autonomy, Phase, FailureCategory, repoFullName } from "./models.js";
import type { ProcessResult } from "./process.js";
import { buildPrompt } from "./prompt.js";
import { runClaude, ExecutorTimeoutError } from "./executor.js";
import {
  transitionToInProgress,
  transitionToDone,
  transitionToFailed,
  addImplTriggerLabel,
} from "./label.js";
import {
  postSuccessComment,
  postFailureComment,
  formatFailureDiagnostics,
  sanitizeOutput,
} from "./comment.js";
import { fetchLinkedPullRequestNumbers } from "./linked-pr.js";
import { withWorktree, WorktreeError } from "./worktree.js";
import { createLogger } from "./logger.js";

const logger = createLogger("pipeline");

const MS_PER_MINUTE = 60_000;

// ---------- Dependency Injection ----------

export interface PipelineDeps {
  buildPrompt: (issue: Issue, repoConfig: RepositoryConfig, language: Language) => string;
  runClaude: (
    prompt: string,
    options: { cwd: string; autonomy?: Autonomy; timeoutMs?: number; authToken?: string },
  ) => Promise<ProcessResult>;
  transitionToInProgress: (
    repo: string,
    num: number,
    labels: PhaseLabels,
  ) => Promise<void>;
  transitionToDone: (
    repo: string,
    num: number,
    labels: PhaseLabels,
  ) => Promise<void>;
  transitionToFailed: (
    repo: string,
    num: number,
    labels: PhaseLabels,
  ) => Promise<void>;
  addImplTriggerLabel: (
    repo: string,
    num: number,
    implTriggerLabel: string,
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
  transitionToInProgress,
  transitionToDone,
  transitionToFailed,
  addImplTriggerLabel,
  postSuccessComment,
  postFailureComment,
  fetchLinkedPullRequestNumbers,
  withWorktree,
};

// ---------- Pipeline ----------

/**
 * 1 Issue の処理パイプラインを実行する。
 *
 * 処理フロー:
 *   1. PhaseLabels 解決: issue.phase から plan/impl のラベル定義を取得
 *   2. ラベル遷移 trigger -> in-progress
 *   3. worktree 作成 -> プロンプト生成 -> Claude CLI 実行 -> worktree 削除
 *   4. impl のみ: Issue に紐づく PR の存在を検証
 *   5-A. 成功: done 遷移 + 成功コメント
 *   5-B. 失敗: failed 遷移 + 失敗コメント
 *
 * エラーハンドリング:
 *   - レベル 1: trigger->in-progress 失敗 -> return false（次回リトライ可能）
 *   - レベル 2: プロンプト生成/CLI 実行失敗/impl の PR 未作成 -> failed 遷移 + 失敗コメント + return false
 *   - レベル 3: 後処理失敗 -> ログ WARNING のみ、結果は変えない
 */
export async function processIssue(
  issue: Issue,
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
  authToken: string | null,
  deps: PipelineDeps = defaultDeps,
): Promise<boolean> {
  const repo = repoFullName(repoConfig);

  // 1. PhaseLabels 解決
  const phaseLabels: PhaseLabels =
    issue.phase === Phase.PLAN ? repoConfig.labels.plan : repoConfig.labels.impl;

  logger.info(
    "Issue #%s (%s) の処理を開始します [repo=%s, phase=%s]",
    issue.number,
    issue.title,
    repo,
    issue.phase,
  );

  // 2. ラベル遷移 trigger -> in-progress（レベル 1）
  try {
    await deps.transitionToInProgress(repo, issue.number, phaseLabels);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(
      "Issue #%s: trigger -> in-progress のラベル遷移に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      errorMessage,
    );
    return false;
  }

  // 3. worktree 作成 -> Claude 実行 -> worktree 削除
  try {
    return await deps.withWorktree(
      repoConfig,
      issue.number,
      async (worktreePath: string) => {
        // 3-1. プロンプト生成（レベル 2）
        let prompt: string;
        try {
          prompt = deps.buildPrompt(issue, repoConfig, executionConfig.language);
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error(
            "Issue #%s: プロンプト生成に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            errorMessage,
          );
          handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.PROMPT_GENERATION,
            summary: "Prompt generation failed",
            errorMessage,
          });
          return false;
        }

        // 3-2. Claude CLI 実行（レベル 2）
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
            handleFailure(deps, repo, issue.number, phaseLabels, {
              category: FailureCategory.CLI_TIMEOUT,
              summary: "Claude Code CLI timed out",
              timeoutMs: error.timeoutMs,
              errorMessage,
              stdout: error.stdout,
              stderr: error.stderr,
            });
          } else {
            handleFailure(deps, repo, issue.number, phaseLabels, {
              category: FailureCategory.CLI_EXECUTION_ERROR,
              summary: "Claude Code CLI execution failed",
              errorMessage,
            });
          }
          return false;
        }

        if (!result.success) {
          logger.error(
            "Issue #%s: Claude CLI が失敗ステータスを返しました [repo=%s]",
            issue.number,
            repo,
          );
          handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.CLI_NON_ZERO_EXIT,
            summary: "Claude Code CLI returned a non-zero exit code",
            stderr: result.stderr,
            stdout: result.stdout,
            exitCode: result.exitCode,
          });
          return false;
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
          handleFailure(deps, repo, issue.number, phaseLabels, {
            category: FailureCategory.IMPL_NO_LINKED_PR,
            summary:
              "Claude Code CLI exited 0, but no pull request is linked to close this issue",
            stdout: result.stdout,
            stderr: result.stderr,
          });
          return false;
        }

        // 4-A. 成功: done 遷移 + 自動 impl ラベル付与 + 成功コメント（レベル 3）
        let doneTransitionSucceeded = false;
        try {
          await deps.transitionToDone(repo, issue.number, phaseLabels);
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

        // plan 成功 + autoImplAfterPlan 有効時に impl trigger ラベルを付与
        if (doneTransitionSucceeded && issue.phase === Phase.PLAN && repoConfig.autoImplAfterPlan) {
          try {
            await deps.addImplTriggerLabel(repo, issue.number, repoConfig.labels.impl.trigger);
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
        return true;
      },
    );
  } catch (error: unknown) {
    // worktree 作成失敗（レベル 2）
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
    handleFailure(deps, repo, issue.number, phaseLabels, {
      category,
      summary,
      errorMessage,
    });
    return false;
  }
}

// ---------- Internal helpers ----------

/**
 * 失敗時の後処理を行う。
 *
 * failed ラベルへの遷移と失敗コメントの投稿を行う。
 * いずれの操作もレベル 3 のエラーハンドリングとして、
 * 失敗してもログ WARNING のみで処理を継続する。
 */
function handleFailure(
  deps: PipelineDeps,
  repo: string,
  issueNumber: number,
  phaseLabels: PhaseLabels,
  diagnostics: FailureDiagnostics,
): void {
  deps.transitionToFailed(repo, issueNumber, phaseLabels).catch(
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
  deps.postFailureComment(repo, issueNumber, formattedMessage).catch(
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
