import { vi } from "vitest";

import type { PipelineDeps } from "../../../src/worker/pipeline.js";
import type { WorkerDeps } from "../../../src/worker/main.js";
import type { RepositoryConfig } from "../../../src/worker/models.js";

/**
 * PipelineDeps の全プロパティを vi.fn() で生成したモックを返す。
 * overrides で個別のモック実装を上書きできる。
 */
export function createMockPipelineDeps(
  overrides?: Partial<PipelineDeps>,
): PipelineDeps {
  return {
    buildPrompt: vi.fn().mockReturnValue("generated prompt"),
    runClaude: vi.fn().mockResolvedValue({
      success: true,
      stdout: "Claude output",
      stderr: "",
      exitCode: 0,
    }),
    applyLabelTransition: vi.fn().mockResolvedValue(undefined),
    postSuccessComment: vi.fn().mockResolvedValue(undefined),
    postFailureComment: vi.fn().mockResolvedValue(undefined),
    postSpecProposalComment: vi.fn().mockResolvedValue(undefined),
    fetchIssueComments: vi.fn().mockResolvedValue([]),
    fetchLinkedPullRequestNumbers: vi.fn().mockResolvedValue([123]),
    withWorktree: vi.fn().mockImplementation(
      async (
        _repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath" | "defaultBranch">,
        _issueNumber: number,
        callback: (path: string) => Promise<unknown>,
      ) => callback("/tmp/worktrees/issue-mock"),
    ),
    ...overrides,
  };
}

/**
 * WorkerDeps の全プロパティを vi.fn() で生成したモックを返す。
 * overrides で個別のモック実装を上書きできる。
 */
export function createMockWorkerDeps(
  overrides?: Partial<WorkerDeps>,
): WorkerDeps {
  return {
    loadConfig: vi.fn(),
    fetchIssues: vi.fn().mockResolvedValue([]),
    processIssue: vi.fn().mockResolvedValue({ outcome: "success", claudeExecuted: true }),
    resumeSpecReview: vi.fn().mockResolvedValue({ outcome: "deferred", claudeExecuted: false }),
    ensureLabelsExist: vi.fn().mockResolvedValue(undefined),
    readAuthToken: vi.fn().mockReturnValue(null),
    migrateFlatPromptTemplates: vi.fn(),
    ...overrides,
  };
}
