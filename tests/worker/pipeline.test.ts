import { describe, it, expect, vi, beforeEach } from "vitest";

import { processIssue } from "../../src/worker/pipeline.js";
import { Phase } from "../../src/worker/models.js";
import type { ExecutionConfig, IssueComment } from "../../src/worker/models.js";
import { ExecutorTimeoutError } from "../../src/worker/executor.js";
import { WorktreeError } from "../../src/worker/worktree.js";
import { IssueCommentsError } from "../../src/worker/issue-comments.js";
import { CLI_TIMEOUT_WARNING_NOTE } from "../../src/worker/comment.js";
import { formatMarker } from "../../src/worker/spec-thread.js";
import {
  makeRepoConfig,
  makeIssue,
  makeProcessResult,
  makeExecutorTimeoutError,
  PLAN_LABELS,
  IMPL_LABELS,
  SPEC_LABELS,
} from "./helpers/factories.js";
import { createMockPipelineDeps } from "./helpers/mock-deps.js";
import type { PipelineDeps } from "../../src/worker/pipeline.js";

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxParallel: 1,
  maxIssuesPerRepo: 10,
  autonomy: "interactive",
  intervalMinutes: 60,
  timeoutMinutes: 60,
  language: "ja",
};

// logger 出力を抑制
vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe("processIssue", () => {
  let deps: PipelineDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockPipelineDeps();
  });

  // -----------------------------------------------------------------------
  // 正常系テスト
  // -----------------------------------------------------------------------

  describe("正常系", () => {
    it("全ステップ成功時に true が返り、done 遷移と成功コメントが呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "Claude output" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        1,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.inProgress], remove: [PLAN_LABELS.trigger] },
      );
      expect(deps.buildPrompt).toHaveBeenCalledOnce();
      expect(deps.buildPrompt).toHaveBeenCalledWith(issue, repoConfig, "ja", null);
      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.done], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
      expect(deps.postSuccessComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude output",
      );
      expect(deps.postFailureComment).not.toHaveBeenCalled();
    });

    it("plan フェーズで正しい PhaseLabels が使われる", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        1,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.inProgress], remove: [PLAN_LABELS.trigger] },
      );
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.done], remove: [PLAN_LABELS.inProgress] },
      );
    });

    it("impl フェーズで正しい PhaseLabels が使われる", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        1,
        "testowner/testrepo",
        42,
        { add: [IMPL_LABELS.inProgress], remove: [IMPL_LABELS.trigger] },
      );
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [IMPL_LABELS.done], remove: [IMPL_LABELS.inProgress] },
      );
    });

    it("runClaude に executionConfig.autonomy が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const executionConfig: ExecutionConfig = {
        maxParallel: 1,
        maxIssuesPerRepo: 10,
        autonomy: "full",
        intervalMinutes: 60,
        timeoutMinutes: 60,
        language: "ja",
      };

      await processIssue(issue, repoConfig, executionConfig, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        { cwd: "/tmp/worktrees/issue-mock", autonomy: "full", timeoutMs: 3_600_000 },
      );
    });

    it("autonomy が interactive の場合も runClaude に正しく渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        { cwd: "/tmp/worktrees/issue-mock", autonomy: "interactive", timeoutMs: 3_600_000 },
      );
    });

    it("runClaude に executionConfig.timeoutMinutes を ms に変換した値が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const executionConfig: ExecutionConfig = {
        ...DEFAULT_EXECUTION_CONFIG,
        timeoutMinutes: 30,
      };

      await processIssue(issue, repoConfig, executionConfig, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        expect.objectContaining({ timeoutMs: 1_800_000 }),
      );
    });

    it("runClaude に executionConfig.timeoutMinutes 最大値 240 を ms に変換した値が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const executionConfig: ExecutionConfig = {
        ...DEFAULT_EXECUTION_CONFIG,
        timeoutMinutes: 240,
      };

      await processIssue(issue, repoConfig, executionConfig, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        expect.objectContaining({ timeoutMs: 14_400_000 }),
      );
    });

    it("authToken が runClaude の options に渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(
        issue,
        repoConfig,
        DEFAULT_EXECUTION_CONFIG,
        "sk-ant-oat01-example",
        repoConfig.labels[issue.phase].trigger,
        deps,
      );

      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        expect.objectContaining({ authToken: "sk-ant-oat01-example" }),
      );
    });

    it("authToken が null の場合、runClaude の options に authToken が付かない", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      const options = vi.mocked(deps.runClaude).mock.calls[0][1];
      expect(options.authToken).toBeUndefined();
    });

    it("withWorktree に owner/repo/localPath/defaultBranch を含む repoConfig が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.withWorktree).toHaveBeenCalledOnce();
      expect(deps.withWorktree).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: repoConfig.owner,
          repo: repoConfig.repo,
          localPath: repoConfig.localPath,
          defaultBranch: "main",
        }),
        issue.number,
        expect.any(Function),
      );
    });

    it("defaultBranch が 'develop' の場合に withWorktree に 'develop' が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig({ defaultBranch: "develop" });

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(deps.withWorktree).toHaveBeenCalledOnce();
      expect(deps.withWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ defaultBranch: "develop" }),
        issue.number,
        expect.any(Function),
      );
    });

    it("stdout にシークレットが含まれる場合、sanitizeOutput 適用後の値で成功コメントが呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({
          stdout: "Found token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl in output",
        }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
      expect(deps.postSuccessComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Found token: [REDACTED] in output",
      );
    });
  });

  // -----------------------------------------------------------------------
  // レベル 1 エラー: trigger -> in-progress 失敗
  // -----------------------------------------------------------------------

  describe("レベル 1 エラー: trigger -> in-progress 失敗", () => {
    it("in-progress 遷移が失敗すると false が返り、後続の関数は呼ばれない", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.applyLabelTransition).mockRejectedValue(
        new Error("label operation failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledOnce();
      expect(deps.buildPrompt).not.toHaveBeenCalled();
      expect(deps.runClaude).not.toHaveBeenCalled();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.postFailureComment).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // レベル 2 エラー: プロンプト生成 / CLI 実行失敗
  // -----------------------------------------------------------------------

  describe("レベル 2 エラー: プロンプト生成 / CLI 実行失敗", () => {
    it("buildPrompt が例外を投げると failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockImplementation(() => {
        throw new Error("template not found");
      });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.runClaude).not.toHaveBeenCalled();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Prompt Generation Error");
      expect(failureMessage).toContain("Prompt generation failed");
      expect(failureMessage).toContain("template not found");
    });

    it("runClaude が例外を投げると failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("execution failed unexpectedly"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Execution Error");
      expect(failureMessage).toContain("Claude Code CLI execution failed");
      expect(failureMessage).toContain("execution failed unexpectedly");
    });

    it("runClaude が ExecutorTimeoutError を投げるとタイムアウト診断情報が含まれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const timeoutMs = 1_800_000;
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new ExecutorTimeoutError(`Claude Code CLI timed out after ${timeoutMs}ms`, timeoutMs),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Timeout");
      expect(failureMessage).toContain("Claude Code CLI timed out");
      expect(failureMessage).toContain("1800s");
    });

    it("ExecutorTimeoutError の partial stdout/stderr が failed コメントに含まれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        makeExecutorTimeoutError({
          timeoutMs: 600_000,
          stdout: "partial stdout chunk",
          stderr: "partial stderr chunk",
        }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Timeout");
      expect(failureMessage).toContain("partial stdout chunk");
      expect(failureMessage).toContain("partial stderr chunk");
      expect(failureMessage).toContain(CLI_TIMEOUT_WARNING_NOTE);
      expect(failureMessage).toContain("Output reliability is limited");
    });

    it("ExecutorTimeoutError の partial 出力に含まれるシークレットはサニタイズされる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        makeExecutorTimeoutError({
          timeoutMs: 600_000,
          stdout: `using token ${token}`,
          stderr: "",
        }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).not.toContain(token);
      expect(failureMessage).toContain("[REDACTED]");
    });

    it("ExecutorTimeoutError の partial が空の場合、stdout/stderr セクションは含まれない", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        makeExecutorTimeoutError({ timeoutMs: 600_000 }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Timeout");
      expect(failureMessage).not.toContain("<summary>stderr");
      expect(failureMessage).not.toContain("<summary>stdout");
      expect(failureMessage).not.toContain(CLI_TIMEOUT_WARNING_NOTE);
      expect(failureMessage).not.toContain("Output reliability is limited");
    });

    it("runClaude が success=false を返すと failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "CLI error output" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Non-zero Exit");
      expect(failureMessage).toContain("Claude Code CLI returned a non-zero exit code");
      expect(failureMessage).toContain("Exit Code:");
      expect(failureMessage).toContain("CLI error output");
    });

    it("runClaude が success=false かつ stderr が空の場合も診断情報が含まれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "", stdout: "stdout error" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Non-zero Exit");
      expect(failureMessage).toContain("Claude Code CLI returned a non-zero exit code");
      expect(failureMessage).toContain("stdout error");
    });

    it("runClaude が success=false かつ stderr/stdout ともに空の場合も診断情報が含まれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "", stdout: "" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Non-zero Exit");
      expect(failureMessage).toContain("Claude Code CLI returned a non-zero exit code");
    });

    it("WorktreeError (phase='fetch') の場合に GIT_FETCH カテゴリで失敗処理される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.withWorktree).mockRejectedValue(
        new WorktreeError("git fetch origin failed", "fetch"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Git Fetch Error");
      expect(failureMessage).toContain("Git fetch failed");
      expect(failureMessage).toContain("git fetch origin failed");
    });

    it("WorktreeError (phase='mkdir') の場合に WORKTREE_CREATION カテゴリで失敗処理される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.withWorktree).mockRejectedValue(
        new WorktreeError("worktree ディレクトリの作成に失敗しました", "mkdir"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Worktree Creation Error");
      expect(failureMessage).toContain("Worktree creation failed");
      expect(failureMessage).toContain("worktree ディレクトリの作成に失敗しました");
    });

    it("WorktreeError (phase='create') の場合に WORKTREE_CREATION カテゴリで失敗処理される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.withWorktree).mockRejectedValue(
        new WorktreeError("worktree の作成に失敗しました", "create"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Worktree Creation Error");
      expect(failureMessage).toContain("Worktree creation failed");
      expect(failureMessage).toContain("worktree の作成に失敗しました");
    });

    it("worktree 作成失敗時に failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.withWorktree).mockRejectedValue(
        new Error("worktree creation failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.failed], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Worktree Creation Error");
      expect(failureMessage).toContain("Worktree creation failed");
      expect(failureMessage).toContain("worktree creation failed");
    });
  });

  // -----------------------------------------------------------------------
  // レベル 3 エラー: 後処理の失敗はログ WARNING のみ
  // -----------------------------------------------------------------------

  describe("レベル 3 エラー: 成功後の後処理失敗", () => {
    it("done ラベル遷移が失敗しても true が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.applyLabelTransition)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("done label failed"));

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
    });

    it("postSuccessComment が失敗しても true が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.postSuccessComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
    });
  });

  describe("レベル 3 エラー: 失敗後の後処理失敗", () => {
    it("failed ラベル遷移が失敗しても処理が継続し、postFailureComment が呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("executor error"),
      );
      vi.mocked(deps.applyLabelTransition).mockImplementation(
        async (_repo, _num, transition) => {
          if (transition.add.includes(PLAN_LABELS.failed)) {
            throw new Error("failed label error");
          }
        },
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
    });

    it("postFailureComment が失敗しても処理が継続し、failed ラベル遷移が呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("executor error"),
      );
      vi.mocked(deps.postFailureComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // autoImplAfterPlan: plan 成功後の自動 impl ラベル付与
  // -----------------------------------------------------------------------

  describe("autoImplAfterPlan", () => {
    it("plan 成功 + autoImplAfterPlan: true で impl trigger ラベルが付与される", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(3);
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        3,
        "testowner/testrepo",
        42,
        { add: ["test/impl"], remove: [] },
      );
    });

    it("plan 成功 + autoImplAfterPlan: false で impl trigger ラベルが付与されない", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: false });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
    });

    it("impl 成功 + autoImplAfterPlan: true で impl trigger ラベルが付与されない", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
    });

    it("plan 成功 + autoImplAfterPlan: true + impl trigger ラベル付与失敗でも true が返る", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });
      vi.mocked(deps.applyLabelTransition).mockImplementation(
        async (_repo, _num, transition) => {
          if (transition.add.includes("test/impl") && transition.remove.length === 0) {
            throw new Error("label add failed");
          }
        },
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(3);
    });

    it("plan 成功 + autoImplAfterPlan: true + done 遷移失敗時は impl trigger ラベルが付与されない", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });
      vi.mocked(deps.applyLabelTransition).mockImplementation(
        async (_repo, _num, transition) => {
          if (transition.add.includes(PLAN_LABELS.done)) {
            throw new Error("done label failed");
          }
        },
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // impl の完了検証 (PR 紐づけ)
  // -----------------------------------------------------------------------

  describe("impl の完了検証 (PR 紐づけ)", () => {
    it("impl で PR が紐づいている場合は done 遷移と成功コメントが呼ばれ true が返る", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.fetchLinkedPullRequestNumbers).toHaveBeenCalledOnce();
      expect(deps.fetchLinkedPullRequestNumbers).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
      );
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [IMPL_LABELS.done], remove: [IMPL_LABELS.inProgress] },
      );
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
    });

    it("impl で PR が 0 件の場合は failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchLinkedPullRequestNumbers).mockResolvedValue([]);

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [IMPL_LABELS.failed], remove: [IMPL_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
    });

    it("impl で PR が 0 件の場合の失敗コメントに No Linked Pull Request と stdout/stderr が含まれ Exit Code は含まれない", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchLinkedPullRequestNumbers).mockResolvedValue([]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({
          stdout: "Created branch impl-42",
          stderr: "warning: ref not found",
        }),
      );

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("No Linked Pull Request");
      expect(failureMessage).toContain("Created branch impl-42");
      expect(failureMessage).toContain("warning: ref not found");
      expect(failureMessage).not.toContain("Exit Code");
    });

    it("impl で PR 問い合わせが throw した場合は検証をスキップし done に進む", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchLinkedPullRequestNumbers).mockRejectedValue(
        new Error("API error"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [IMPL_LABELS.done], remove: [IMPL_LABELS.inProgress] },
      );
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
      expect(deps.postFailureComment).not.toHaveBeenCalled();
    });

    it("plan フェーズでは PR 検証をスキップし done に進む", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig();

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels[issue.phase].trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.fetchLinkedPullRequestNumbers).not.toHaveBeenCalled();
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [PLAN_LABELS.done], remove: [PLAN_LABELS.inProgress] },
      );
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // spec フェーズ
  // -----------------------------------------------------------------------

  describe("spec フェーズ", () => {
    function makeWorkerComment(round: number, body = ""): IssueComment {
      const marker = formatMarker(round);
      return {
        body: body ? `${body}\n\n${marker}` : marker,
        authorAssociation: "OWNER",
        createdAt: "2025-01-01T00:00:00Z",
        viewerDidAuthor: true,
      };
    }

    function makeHumanComment(body: string): IssueComment {
      return {
        body,
        authorAssociation: "OWNER",
        createdAt: "2025-01-02T00:00:00Z",
        viewerDidAuthor: false,
      };
    }

    it("コメント取得の一時的な失敗時にラベルが変わらず failure を返す", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockRejectedValue(
        new IssueCommentsError("gh timeout", false),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(result.claudeExecuted).toBe(false);
      expect(deps.applyLabelTransition).not.toHaveBeenCalled();
      expect(deps.buildPrompt).not.toHaveBeenCalled();
    });

    it("コメント取得の構造的な失敗時に trigger 経由なら failed 遷移と診断コメントが呼ばれる", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockRejectedValue(
        new IssueCommentsError("viewerDidAuthor missing", true),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(result.claudeExecuted).toBe(false);
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [SPEC_LABELS.failed], remove: [SPEC_LABELS.trigger] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
    });

    it("コメント取得の構造的な失敗時に review 経由なら needs-human と診断コメントが呼ばれる", async () => {
      const issue = makeIssue({
        phase: Phase.SPEC,
        labels: [SPEC_LABELS.review],
      });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockRejectedValue(
        new IssueCommentsError("JSON parse failed", true),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.review, deps);

      expect(result.outcome).toBe("failure");
      expect(result.claudeExecuted).toBe(false);
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [SPEC_LABELS.needsHuman], remove: [SPEC_LABELS.review] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
    });

    it("spec trigger では round 1 で postSpecProposalComment が呼ばれる", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "spec proposal" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      expect(result.outcome).toBe("success");
      expect(result.claudeExecuted).toBe(true);
      expect(deps.postSpecProposalComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "spec proposal",
        1,
      );
    });

    it("spec review entry では thread.round + 1 で postSpecProposalComment が呼ばれる", async () => {
      const issue = makeIssue({
        phase: Phase.SPEC,
        labels: [SPEC_LABELS.inProgress],
      });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([
        makeWorkerComment(1, "proposal v1"),
        makeHumanComment("fix this"),
        makeWorkerComment(2, "proposal v2"),
      ]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "proposal v3" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.inProgress, deps);

      expect(result.outcome).toBe("success");
      expect(deps.postSpecProposalComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "proposal v3",
        3,
      );
    });

    it("spec 成功時に提案コメント投稿後に review ラベル遷移が呼ばれる", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "spec output" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      expect(result.outcome).toBe("success");
      expect(deps.postSpecProposalComment).toHaveBeenCalledOnce();
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        1,
        "testowner/testrepo",
        42,
        { add: [SPEC_LABELS.inProgress], remove: [SPEC_LABELS.trigger] },
      );
      expect(deps.applyLabelTransition).toHaveBeenNthCalledWith(
        2,
        "testowner/testrepo",
        42,
        { add: [SPEC_LABELS.review], remove: [SPEC_LABELS.inProgress] },
      );
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
    });

    it("提案コメント投稿失敗時に failed 遷移と診断コメントが呼ばれる", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "spec output" }),
      );
      vi.mocked(deps.postSpecProposalComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      expect(result.outcome).toBe("failure");
      expect(result.claudeExecuted).toBe(true);
      expect(deps.applyLabelTransition).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        { add: [SPEC_LABELS.failed], remove: [SPEC_LABELS.inProgress] },
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Spec Proposal Comment Error");
    });

    it("提案コメント投稿失敗時に review ラベル遷移は呼ばれない", async () => {
      const issue = makeIssue({ phase: Phase.SPEC });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ stdout: "spec output" }),
      );
      vi.mocked(deps.postSpecProposalComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.spec.trigger, deps);

      const reviewCalls = vi.mocked(deps.applyLabelTransition).mock.calls.filter(
        (call) => (call[2] as { add: string[] }).add.includes(SPEC_LABELS.review),
      );
      expect(reviewCalls).toHaveLength(0);
    });

    it("plan フェーズで spec コンテキストが buildPrompt に渡される", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([
        makeWorkerComment(1, "agreed specification"),
      ]);

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.plan.trigger, deps);

      const specCtx = vi.mocked(deps.buildPrompt).mock.calls[0][3];
      expect(specCtx).toContain("Approved specification");
      expect(specCtx).toContain("agreed specification");
    });

    it("impl フェーズで spec コンテキストが buildPrompt に渡される", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.fetchIssueComments).mockResolvedValue([
        makeWorkerComment(1, "agreed specification"),
      ]);

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, repoConfig.labels.impl.trigger, deps);

      const specCtx = vi.mocked(deps.buildPrompt).mock.calls[0][3];
      expect(specCtx).toContain("Approved specification");
      expect(specCtx).toContain("agreed specification");
    });
  });
});
