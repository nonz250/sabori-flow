import type { Language } from "../i18n/types.js";
import type { Issue, PhaseLabels, RepositoryConfig, ExecutionConfig } from "./models.js";
import { Autonomy, Phase, repoFullName } from "./models.js";
import type { ProcessResult } from "./process.js";
import { buildPrompt } from "./prompt.js";
import { runClaude } from "./executor.js";
import {
  transitionToInProgress,
  transitionToDone,
  transitionToFailed,
  addImplTriggerLabel,
} from "./label.js";
import {
  postSuccessComment,
  postFailureComment,
  sanitizeOutput,
} from "./comment.js";
import { withWorktree } from "./worktree.js";
import { createLogger } from "./logger.js";

const logger = createLogger("pipeline");

// ---------- Dependency Injection ----------

export interface PipelineDeps {
  buildPrompt: (issue: Issue, repoConfig: RepositoryConfig, language: Language) => string;
  runClaude: (
    prompt: string,
    options: { cwd: string; autonomy?: Autonomy },
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
  withWorktree: <T>(
    localPath: string,
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
 *   4-A. 成功: done 遷移 + 成功コメント
 *   4-B. 失敗: failed 遷移 + 失敗コメント
 *
 * エラーハンドリング:
 *   - レベル 1: trigger->in-progress 失敗 -> return false（次回リトライ可能）
 *   - レベル 2: プロンプト生成/CLI 実行失敗 -> failed 遷移 + 失敗コメント + return false
 *   - レベル 3: 後処理失敗 -> ログ WARNING のみ、結果は変えない
 */
export async function processIssue(
  issue: Issue,
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
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
    logger.error(
      "Issue #%s: trigger -> in-progress のラベル遷移に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      error,
    );
    return false;
  }

  // 3. worktree 作成 -> Claude 実行 -> worktree 削除
  try {
    return await deps.withWorktree(
      repoConfig.localPath,
      issue.number,
      async (worktreePath: string) => {
        // 3-1. プロンプト生成（レベル 2）
        let prompt: string;
        try {
          prompt = deps.buildPrompt(issue, repoConfig, executionConfig.language);
        } catch (error: unknown) {
          logger.error(
            "Issue #%s: プロンプト生成に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            error,
          );
          handleFailure(deps, repo, issue.number, phaseLabels, "プロンプトの生成に失敗しました");
          return false;
        }

        // 3-2. Claude CLI 実行（レベル 2）
        let result: ProcessResult;
        try {
          result = await deps.runClaude(prompt, { cwd: worktreePath, autonomy: executionConfig.autonomy });
        } catch (error: unknown) {
          logger.error(
            "Issue #%s: Claude CLI の実行に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            error,
          );
          handleFailure(deps, repo, issue.number, phaseLabels, "Claude Code CLI の実行に失敗しました");
          return false;
        }

        if (!result.success) {
          logger.error(
            "Issue #%s: Claude CLI が失敗ステータスを返しました [repo=%s]",
            issue.number,
            repo,
          );
          handleFailure(deps, repo, issue.number, phaseLabels, "Claude Code CLI がエラーを返しました");
          return false;
        }

        // 4-A. 成功: done 遷移 + 自動 impl ラベル付与 + 成功コメント（レベル 3）
        let doneTransitionSucceeded = false;
        try {
          await deps.transitionToDone(repo, issue.number, phaseLabels);
          doneTransitionSucceeded = true;
        } catch (error: unknown) {
          logger.warn(
            "Issue #%s: done ラベル遷移に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            error,
          );
        }

        // plan 成功 + autoImplAfterPlan 有効時に impl trigger ラベルを付与
        if (doneTransitionSucceeded && issue.phase === Phase.PLAN && repoConfig.autoImplAfterPlan) {
          try {
            await deps.addImplTriggerLabel(repo, issue.number, repoConfig.labels.impl.trigger);
          } catch (error: unknown) {
            logger.warn(
              "Issue #%s: impl trigger ラベルの自動付与に失敗しました [repo=%s]: %s",
              issue.number,
              repo,
              error,
            );
          }
        }

        try {
          await deps.postSuccessComment(repo, issue.number, sanitizeOutput(result.stdout));
        } catch (error: unknown) {
          logger.warn(
            "Issue #%s: 成功コメントの投稿に失敗しました [repo=%s]: %s",
            issue.number,
            repo,
            error,
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
    logger.error(
      "Issue #%s: worktree の作成に失敗しました [repo=%s]: %s",
      issue.number,
      repo,
      error,
    );
    handleFailure(deps, repo, issue.number, phaseLabels, "作業ディレクトリの作成に失敗しました");
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
  errorMessage: string,
): void {
  deps.transitionToFailed(repo, issueNumber, phaseLabels).catch(
    (error: unknown) => {
      logger.warn(
        "Issue #%s: failed ラベル遷移に失敗しました [repo=%s]: %s",
        issueNumber,
        repo,
        error,
      );
    },
  );

  deps.postFailureComment(repo, issueNumber, errorMessage).catch(
    (error: unknown) => {
      logger.warn(
        "Issue #%s: 失敗コメントの投稿に失敗しました [repo=%s]: %s",
        issueNumber,
        repo,
        error,
      );
    },
  );
}
