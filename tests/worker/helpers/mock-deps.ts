import { vi } from "vitest";

import type { PipelineDeps } from "../../../src/worker/pipeline.js";
import type { WorkerDeps } from "../../../src/worker/main.js";

/**
 * PipelineDeps の全プロパティを vi.fn() で生成したモックを返す。
 * overrides で個別のモック実装を上書きできる。
 */
export function createMockPipelineDeps(
  overrides?: Partial<PipelineDeps>,
): PipelineDeps {
  return {
    buildPrompt: vi.fn().mockReturnValue("generated prompt"),
    runEngine: vi.fn().mockResolvedValue({
      success: true,
      stdout: "Claude output",
      stderr: "",
    }),
    transitionToInProgress: vi.fn().mockResolvedValue(undefined),
    transitionToDone: vi.fn().mockResolvedValue(undefined),
    transitionToFailed: vi.fn().mockResolvedValue(undefined),
    addImplTriggerLabel: vi.fn().mockResolvedValue(undefined),
    postSuccessComment: vi.fn().mockResolvedValue(undefined),
    postFailureComment: vi.fn().mockResolvedValue(undefined),
    withWorktree: vi.fn().mockImplementation(
      async (_localPath: string, _issueNumber: number, callback: (path: string) => Promise<unknown>) => {
        return callback("/tmp/worktrees/issue-mock");
      },
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
    processIssue: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}
