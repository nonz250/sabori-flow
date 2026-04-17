import { describe, it, expect, vi, beforeEach } from "vitest";

import { processIssue } from "../../src/worker/pipeline.js";
import { Phase } from "../../src/worker/models.js";
import type { ExecutionConfig } from "../../src/worker/models.js";
import { ExecutorTimeoutError } from "../../src/worker/executor.js";
import { WorktreeError } from "../../src/worker/worktree.js";
import {
  makeRepoConfig,
  makeIssue,
  makeProcessResult,
  makeExecutorTimeoutError,
  PLAN_LABELS,
  IMPL_LABELS,
} from "./helpers/factories.js";
import { createMockPipelineDeps } from "./helpers/mock-deps.js";
import type { PipelineDeps } from "../../src/worker/pipeline.js";

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxParallel: 1,
  maxIssuesPerRepo: 10,
  autonomy: "interactive",
  intervalMinutes: 60,
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.transitionToInProgress).toHaveBeenCalledOnce();
      expect(deps.transitionToInProgress).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
      );
      expect(deps.buildPrompt).toHaveBeenCalledOnce();
      expect(deps.buildPrompt).toHaveBeenCalledWith(issue, repoConfig, "ja");
      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.transitionToDone).toHaveBeenCalledOnce();
      expect(deps.transitionToDone).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
      );
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
      expect(deps.postSuccessComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude output",
      );
      expect(deps.transitionToFailed).not.toHaveBeenCalled();
      expect(deps.postFailureComment).not.toHaveBeenCalled();
    });

    it("plan フェーズで正しい PhaseLabels が使われる", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(deps.transitionToInProgress).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
      );
      expect(deps.transitionToDone).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
      );
    });

    it("impl フェーズで正しい PhaseLabels が使われる", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(deps.transitionToInProgress).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        IMPL_LABELS,
      );
      expect(deps.transitionToDone).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        IMPL_LABELS,
      );
    });

    it("runClaude に executionConfig.autonomy が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      const executionConfig: ExecutionConfig = {
        maxParallel: 1,
        maxIssuesPerRepo: 10,
        autonomy: "full",
        language: "ja",
      };

      await processIssue(issue, repoConfig, executionConfig, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        { cwd: "/tmp/worktrees/issue-mock", autonomy: "full" },
      );
    });

    it("autonomy が interactive の場合も runClaude に正しく渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(deps.runClaude).toHaveBeenCalledOnce();
      expect(deps.runClaude).toHaveBeenCalledWith(
        "generated prompt",
        { cwd: "/tmp/worktrees/issue-mock", autonomy: "interactive" },
      );
    });

    it("withWorktree に repoConfig.defaultBranch が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(deps.withWorktree).toHaveBeenCalledOnce();
      expect(deps.withWorktree.mock.calls[0][2]).toBe("main");
    });

    it("defaultBranch が 'develop' の場合に withWorktree に 'develop' が渡される", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig({ defaultBranch: "develop" });

      await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(deps.withWorktree).toHaveBeenCalledOnce();
      expect(deps.withWorktree.mock.calls[0][2]).toBe("develop");
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
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
    it("transitionToInProgress が失敗すると false が返り、後続の関数は呼ばれない", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.transitionToInProgress).mockRejectedValue(
        new Error("label operation failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.buildPrompt).not.toHaveBeenCalled();
      expect(deps.runClaude).not.toHaveBeenCalled();
      expect(deps.transitionToDone).not.toHaveBeenCalled();
      expect(deps.transitionToFailed).not.toHaveBeenCalled();
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.runClaude).not.toHaveBeenCalled();
      expect(deps.transitionToDone).not.toHaveBeenCalled();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
      expect(deps.transitionToFailed).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToDone).not.toHaveBeenCalled();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
      expect(deps.transitionToFailed).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Timeout");
      expect(failureMessage).toContain("partial stdout chunk");
      expect(failureMessage).toContain("partial stderr chunk");
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("CLI Timeout");
      expect(failureMessage).not.toContain("<summary>stderr");
      expect(failureMessage).not.toContain("<summary>stdout");
    });

    it("runClaude が success=false を返すと failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "CLI error output" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToDone).not.toHaveBeenCalled();
      expect(deps.postSuccessComment).not.toHaveBeenCalled();
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
      expect(deps.transitionToFailed).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
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

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
      expect(deps.transitionToFailed).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
      );
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
      const failureMessage = vi.mocked(deps.postFailureComment).mock.calls[0][2];
      expect(failureMessage).toContain("Git Fetch Error");
      expect(failureMessage).toContain("Git fetch failed");
      expect(failureMessage).toContain("git fetch origin failed");
    });

    it("worktree 作成失敗時に failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.withWorktree).mockRejectedValue(
        new Error("worktree creation failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
      expect(deps.transitionToFailed).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        PLAN_LABELS,
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
    it("transitionToDone が失敗しても true が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.transitionToDone).mockRejectedValue(
        new Error("done label failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.postSuccessComment).toHaveBeenCalledOnce();
    });

    it("postSuccessComment が失敗しても true が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.postSuccessComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.transitionToDone).toHaveBeenCalledOnce();
    });
  });

  describe("レベル 3 エラー: 失敗後の後処理失敗", () => {
    it("transitionToFailed が失敗しても処理が継続し、postFailureComment が呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("executor error"),
      );
      vi.mocked(deps.transitionToFailed).mockRejectedValue(
        new Error("failed label error"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.postFailureComment).toHaveBeenCalledOnce();
    });

    it("postFailureComment が失敗しても処理が継続し、transitionToFailed が呼ばれる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("executor error"),
      );
      vi.mocked(deps.postFailureComment).mockRejectedValue(
        new Error("comment post failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.transitionToFailed).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // autoImplAfterPlan: plan 成功後の自動 impl ラベル付与
  // -----------------------------------------------------------------------

  describe("autoImplAfterPlan", () => {
    it("plan 成功 + autoImplAfterPlan: true で addImplTriggerLabel が呼ばれる", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.addImplTriggerLabel).toHaveBeenCalledOnce();
      expect(deps.addImplTriggerLabel).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "claude/impl",
      );
    });

    it("plan 成功 + autoImplAfterPlan: false で addImplTriggerLabel が呼ばれない", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: false });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.addImplTriggerLabel).not.toHaveBeenCalled();
    });

    it("impl 成功 + autoImplAfterPlan: true で addImplTriggerLabel が呼ばれない", async () => {
      const issue = makeIssue({ phase: Phase.IMPL });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.addImplTriggerLabel).not.toHaveBeenCalled();
    });

    it("plan 成功 + autoImplAfterPlan: true + addImplTriggerLabel 失敗でも true が返る", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });
      vi.mocked(deps.addImplTriggerLabel).mockRejectedValue(
        new Error("label add failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.addImplTriggerLabel).toHaveBeenCalledOnce();
    });

    it("plan 成功 + autoImplAfterPlan: true + transitionToDone 失敗時は addImplTriggerLabel が呼ばれない", async () => {
      const issue = makeIssue({ phase: Phase.PLAN });
      const repoConfig = makeRepoConfig({ autoImplAfterPlan: true });
      vi.mocked(deps.transitionToDone).mockRejectedValue(
        new Error("done label failed"),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(true);
      expect(deps.addImplTriggerLabel).not.toHaveBeenCalled();
    });
  });
});
