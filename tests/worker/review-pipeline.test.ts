import { describe, it, expect, vi, beforeEach } from "vitest";

import { processReviewRequest } from "../../src/worker/review-pipeline.js";
import type { ReviewPipelineDeps } from "../../src/worker/review-pipeline.js";
import type { ExecutionConfig } from "../../src/worker/models.js";
import { WorktreeError } from "../../src/worker/worktree.js";
import { CommentError } from "../../src/worker/comment.js";
import { MAX_REVIEW_SCREENSHOTS } from "../../src/worker/review-screenshots.js";
import { AgentPool } from "../../src/worker/agent-pool.js";
import {
  makeRepoConfig,
  makePullRequest,
  makeProcessResult,
  makeExecutorTimeoutError,
  REVIEW_LABELS,
} from "./helpers/factories.js";
import { createMockReviewPipelineDeps } from "./helpers/mock-deps.js";

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const EXECUTION_CONFIG: ExecutionConfig = {
  maxParallel: 1,
  maxIssuesPerRepo: 10,
  agents: ["claude"],
  autonomy: "full",
  intervalMinutes: 60,
  timeoutMinutes: 30,
  language: "ja",
};

const REPO = "testowner/testrepo";
const SHA = "0123456789abcdef0123456789abcdef01234567";
const SCREENSHOT_DIR = "/tmp/worktrees/pr-mock/.sabori-flow-review/screenshots";
const USAGE_LIMIT_RESULT = makeProcessResult({
  success: false,
  stdout: "",
  stderr: "You've hit your usage limit. Try again later.",
});

let deps: ReviewPipelineDeps;

function run(
  overrides: { pr?: Parameters<typeof makePullRequest>[0]; execution?: Partial<ExecutionConfig>; pool?: AgentPool } = {},
) {
  const execution = { ...EXECUTION_CONFIG, ...overrides.execution };
  return processReviewRequest(
    makePullRequest(overrides.pr),
    makeRepoConfig(),
    execution,
    null,
    deps,
    overrides.pool ?? new AgentPool(execution.agents),
  );
}

function transitions() {
  return vi.mocked(deps.applyLabelTransition).mock.calls.map((call) => ({
    transition: call[2],
    target: call[3],
  }));
}

function failureComment(): string {
  const calls = vi.mocked(deps.postFailureComment).mock.calls;
  expect(calls).toHaveLength(1);
  expect(calls[0][3]).toBe("pr");
  return calls[0][2];
}

describe("processReviewRequest - success", () => {
  beforeEach(() => {
    deps = createMockReviewPipelineDeps();
  });

  it("moves the label to in-progress, posts the review, then moves it to done", async () => {
    const result = await run();

    expect(result).toEqual({ outcome: "success", claudeExecuted: true });
    expect(transitions()).toEqual([
      { transition: { add: [REVIEW_LABELS.inProgress], remove: [REVIEW_LABELS.trigger] }, target: "pr" },
      { transition: { add: [REVIEW_LABELS.done], remove: [REVIEW_LABELS.inProgress] }, target: "pr" },
    ]);
    expect(deps.postFailureComment).not.toHaveBeenCalled();
  });

  it("posts the review before moving the label to done", async () => {
    await run();

    const commentOrder = vi.mocked(deps.postReviewComment).mock.invocationCallOrder[0];
    const doneOrder = vi.mocked(deps.applyLabelTransition).mock.invocationCallOrder[1];
    expect(commentOrder).toBeLessThan(doneOrder);
  });

  it("builds the prompt with the pull request's base branch and the screenshot directory", async () => {
    vi.mocked(deps.fetchPullRequestDetails).mockResolvedValue({ baseRefName: "develop", isCrossRepository: false });

    await run();

    expect(deps.buildReviewPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ number: 7 }),
      expect.objectContaining({ owner: "testowner" }),
      "ja",
      { baseBranch: "develop", screenshotDir: SCREENSHOT_DIR, maxScreenshots: MAX_REVIEW_SCREENSHOTS },
    );
    expect(deps.prepareScreenshotDir).toHaveBeenCalledWith("/tmp/worktrees/pr-mock");
  });

  it("runs the agent in the worktree with the configured autonomy and timeout", async () => {
    await run();

    expect(deps.runAgent).toHaveBeenCalledWith("review prompt", {
      cwd: "/tmp/worktrees/pr-mock",
      agent: "claude",
      autonomy: "full",
      timeoutMs: 30 * 60_000,
      authToken: undefined,
    });
  });

  it("posts the agent output with the reviewed commit and the collected screenshots", async () => {
    vi.mocked(deps.collectScreenshots).mockReturnValue(["01-login.png"]);

    await run();

    expect(deps.collectScreenshots).toHaveBeenCalledWith("/tmp/worktrees/pr-mock");
    expect(deps.postReviewComment).toHaveBeenCalledWith(REPO, 7, "## 総合判定\n\n問題なし", {
      reviewedSha: SHA,
      screenshotDir: SCREENSHOT_DIR,
      screenshots: ["01-login.png"],
      note: null,
    });
  });

  it("removes a stale done or failed label left by an earlier review", async () => {
    await run({ pr: { labels: [REVIEW_LABELS.trigger, REVIEW_LABELS.done, REVIEW_LABELS.failed, "bug"] } });

    expect(transitions()[0].transition).toEqual({
      add: [REVIEW_LABELS.inProgress],
      remove: [REVIEW_LABELS.trigger, REVIEW_LABELS.done, REVIEW_LABELS.failed],
    });
  });

  it("still succeeds when the done transition fails", async () => {
    vi.mocked(deps.applyLabelTransition)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("label error"));

    const result = await run();

    expect(result).toEqual({ outcome: "success", claudeExecuted: true });
    expect(deps.postFailureComment).not.toHaveBeenCalled();
  });
});

describe("processReviewRequest - before the label changes", () => {
  beforeEach(() => {
    deps = createMockReviewPipelineDeps();
  });

  it("leaves the labels untouched when the pull request details cannot be fetched", async () => {
    vi.mocked(deps.fetchPullRequestDetails).mockRejectedValue(new Error("HTTP 502"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(deps.applyLabelTransition).not.toHaveBeenCalled();
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it("marks a pull request from a fork as failed without running an agent", async () => {
    vi.mocked(deps.fetchPullRequestDetails).mockResolvedValue({ baseRefName: "main", isCrossRepository: true });

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(transitions()).toEqual([
      { transition: { add: [REVIEW_LABELS.failed], remove: [REVIEW_LABELS.trigger] }, target: "pr" },
    ]);
    expect(failureComment()).toContain("Unsupported Pull Request");
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it("marks a pull request whose base branch name cannot be passed safely as failed", async () => {
    vi.mocked(deps.fetchPullRequestDetails).mockResolvedValue({ baseRefName: "-main", isCrossRepository: false });

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(transitions()[0].transition).toEqual({ add: [REVIEW_LABELS.failed], remove: [REVIEW_LABELS.trigger] });
    expect(failureComment()).toContain("Unsupported Pull Request");
  });

  it("defers without touching labels when no agent is available", async () => {
    const pool = new AgentPool(["claude"]);
    pool.markExhausted("claude");

    const result = await run({ pool });

    expect(result).toEqual({ outcome: "deferred", claudeExecuted: false });
    expect(deps.applyLabelTransition).not.toHaveBeenCalled();
  });

  it("fails without running an agent when the in-progress transition fails", async () => {
    vi.mocked(deps.applyLabelTransition).mockRejectedValueOnce(new Error("label error"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it("hands the trigger label back when the last agent runs out during the transition", async () => {
    const pool = new AgentPool(["claude"]);
    vi.mocked(deps.applyLabelTransition).mockImplementationOnce(async () => {
      pool.markExhausted("claude");
    });

    const result = await run({ pool });

    expect(result).toEqual({ outcome: "deferred", claudeExecuted: false });
    expect(transitions()[1].transition).toEqual({ add: [REVIEW_LABELS.trigger], remove: [REVIEW_LABELS.inProgress] });
    expect(deps.runAgent).not.toHaveBeenCalled();
  });
});

describe("processReviewRequest - failures after the agent starts", () => {
  beforeEach(() => {
    deps = createMockReviewPipelineDeps();
  });

  function expectFailedTransition(): void {
    expect(transitions().at(-1)).toEqual({
      transition: { add: [REVIEW_LABELS.failed], remove: [REVIEW_LABELS.inProgress] },
      target: "pr",
    });
  }

  it("fails with a prompt generation error", async () => {
    vi.mocked(deps.buildReviewPrompt).mockImplementation(() => {
      throw new Error("Template file not found: review.md");
    });

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expectFailedTransition();
    expect(failureComment()).toContain("Prompt Generation Error");
    expect(deps.runAgent).not.toHaveBeenCalled();
  });

  it("fails with a timeout", async () => {
    vi.mocked(deps.runAgent).mockRejectedValue(makeExecutorTimeoutError({ timeoutMs: 1_800_000 }));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expectFailedTransition();
    expect(failureComment()).toContain("CLI Timeout");
  });

  it("fails with an execution error", async () => {
    vi.mocked(deps.runAgent).mockRejectedValue(new Error("spawn claude ENOENT"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expect(failureComment()).toContain("CLI Execution Error");
  });

  it("fails with a non-zero exit including the agent's stderr", async () => {
    vi.mocked(deps.runAgent).mockResolvedValue(
      makeProcessResult({ success: false, stdout: "", stderr: "fatal: something broke", exitCode: 2 }),
    );

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expectFailedTransition();
    const comment = failureComment();
    expect(comment).toContain("CLI Non-zero Exit");
    expect(comment).toContain("fatal: something broke");
    expect(deps.postReviewComment).not.toHaveBeenCalled();
  });

  it("fails when the agent exits successfully without any output", async () => {
    vi.mocked(deps.runAgent).mockResolvedValue(makeProcessResult({ stdout: "  \n" }));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expectFailedTransition();
    expect(failureComment()).toContain("Empty Review Output");
    expect(deps.postReviewComment).not.toHaveBeenCalled();
  });

  it("fails without moving to done when the review comment cannot be posted", async () => {
    vi.mocked(deps.postReviewComment).mockRejectedValue(new CommentError("unknown flag: --attach"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expectFailedTransition();
    expect(transitions().some((t) => t.transition.add.includes(REVIEW_LABELS.done))).toBe(false);
    const comment = failureComment();
    expect(comment).toContain("Review Comment Not Posted");
    expect(comment).toContain("unknown flag: --attach");
  });

  it("reports a git fetch failure", async () => {
    vi.mocked(deps.withPullRequestWorktree).mockRejectedValue(new WorktreeError("fetch failed", "fetch"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expectFailedTransition();
    expect(failureComment()).toContain("Git Fetch");
  });

  it("reports a worktree creation failure", async () => {
    vi.mocked(deps.withPullRequestWorktree).mockRejectedValue(new WorktreeError("add failed", "create"));

    const result = await run();

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(failureComment()).toContain("Worktree Creation");
  });

  it("keeps going when the reviewed commit cannot be resolved", async () => {
    vi.mocked(deps.resolveHeadSha).mockImplementation(() => {
      throw new WorktreeError("rev-parse failed", "create");
    });

    const result = await run();

    expect(result).toEqual({ outcome: "success", claudeExecuted: true });
    expect(vi.mocked(deps.postReviewComment).mock.calls[0][3].reviewedSha).toBe("unknown");
  });
});

describe("processReviewRequest - agent fallback", () => {
  beforeEach(() => {
    deps = createMockReviewPipelineDeps();
  });

  it("retries with the next agent in a fresh worktree after a usage limit", async () => {
    vi.mocked(deps.runAgent)
      .mockResolvedValueOnce(USAGE_LIMIT_RESULT)
      .mockResolvedValueOnce(makeProcessResult({ stdout: "review by codex" }));
    const pool = new AgentPool(["claude", "codex"]);

    const result = await run({ execution: { agents: ["claude", "codex"] }, pool });

    expect(result).toEqual({ outcome: "success", claudeExecuted: true });
    expect(vi.mocked(deps.runAgent).mock.calls.map((call) => call[1].agent)).toEqual(["claude", "codex"]);
    expect(vi.mocked(deps.withPullRequestWorktree).mock.calls.map((call) => call[3])).toEqual([1, 2]);
    expect(pool.available()).toEqual(["codex"]);
    const options = vi.mocked(deps.postReviewComment).mock.calls[0][3];
    expect(options.note).toBe("Ran with Codex CLI because Claude Code CLI hit the usage limit.");
  });

  it("fails with a usage limit error once every agent has hit its limit", async () => {
    vi.mocked(deps.runAgent).mockResolvedValue(USAGE_LIMIT_RESULT);

    const result = await run({ execution: { agents: ["claude", "codex"] } });

    expect(result).toEqual({ outcome: "failure", claudeExecuted: true });
    expect(transitions().at(-1)!.transition).toEqual({
      add: [REVIEW_LABELS.failed],
      remove: [REVIEW_LABELS.inProgress],
    });
    const comment = failureComment();
    expect(comment).toContain("Agent Usage Limit");
    expect(comment).toContain("You've hit your usage limit.");
    expect(deps.postReviewComment).not.toHaveBeenCalled();
  });
});
