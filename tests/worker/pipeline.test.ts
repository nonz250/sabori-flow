import { describe, it, expect, vi, beforeEach } from "vitest";

import { processIssue } from "../../src/worker/pipeline.js";
import { Phase } from "../../src/worker/models.js";
import type { ExecutionConfig } from "../../src/worker/models.js";
import {
  makeRepoConfig,
  makeIssue,
  makeProcessResult,
  PLAN_LABELS,
  IMPL_LABELS,
} from "./helpers/factories.js";
import { createMockPipelineDeps } from "./helpers/mock-deps.js";
import type { PipelineDeps } from "../../src/worker/pipeline.js";

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxParallel: 1,
  maxIssuesPerRepo: 10,
  autonomy: "interactive",
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
      expect(deps.buildPrompt).toHaveBeenCalledWith(issue, repoConfig);
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
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "プロンプトの生成に失敗しました",
      );
    });

    it("runClaude が例外を投げると failed 遷移 + 失敗コメントが呼ばれ false が返る", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockRejectedValue(
        new Error("timeout after 1800 seconds"),
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
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude Code CLI の実行に失敗しました",
      );
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
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude Code CLI がエラーを返しました",
      );
    });

    it("runClaude が success=false かつ stderr が空の場合もデフォルトのエラーメッセージが使われる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "", stdout: "stdout error" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude Code CLI がエラーを返しました",
      );
    });

    it("runClaude が success=false かつ stderr/stdout ともに空の場合もデフォルトのエラーメッセージが使われる", async () => {
      const issue = makeIssue();
      const repoConfig = makeRepoConfig();
      vi.mocked(deps.buildPrompt).mockReturnValue("generated prompt");
      vi.mocked(deps.runClaude).mockResolvedValue(
        makeProcessResult({ success: false, stderr: "", stdout: "" }),
      );

      const result = await processIssue(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, deps);

      expect(result).toBe(false);
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "Claude Code CLI がエラーを返しました",
      );
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
      expect(deps.postFailureComment).toHaveBeenCalledWith(
        "testowner/testrepo",
        42,
        "作業ディレクトリの作成に失敗しました",
      );
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
