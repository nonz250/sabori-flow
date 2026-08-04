import { describe, it, expect, vi, beforeEach } from "vitest";

import { resumeSpecReview } from "../../src/worker/pipeline.js";
import { Phase } from "../../src/worker/models.js";
import type { ExecutionConfig, IssueComment } from "../../src/worker/models.js";
import { IssueCommentsError } from "../../src/worker/issue-comments.js";
import {
  makeRepoConfig,
  makeIssue,
  SPEC_LABELS,
  PLAN_LABELS,
} from "./helpers/factories.js";
import { createMockPipelineDeps } from "./helpers/mock-deps.js";
import type { PipelineDeps } from "../../src/worker/pipeline.js";
import { formatMarker } from "../../src/worker/spec-thread.js";

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxParallel: 1,
  maxIssuesPerRepo: 10,
  autonomy: "interactive",
  intervalMinutes: 10,
  timeoutMinutes: 60,
  language: "ja",
};

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

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

describe("resumeSpecReview", () => {
  let deps: PipelineDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockPipelineDeps();
  });

  it("approve → spec.done + plan.trigger / -review -approved", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review, SPEC_LABELS.approved],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
    ]);

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("success");
    expect(result.claudeExecuted).toBe(false);
    expect(deps.applyLabelTransition).toHaveBeenCalledWith(
      "testowner/testrepo",
      42,
      expect.objectContaining({
        add: [SPEC_LABELS.done, PLAN_LABELS.trigger],
      }),
    );
  });

  it("escalate → needs-human + explanation comment", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("success");
    expect(deps.applyLabelTransition).toHaveBeenCalledWith(
      "testowner/testrepo",
      42,
      expect.objectContaining({
        add: [SPEC_LABELS.needsHuman],
      }),
    );
    expect(deps.postFailureComment).toHaveBeenCalledWith(
      "testowner/testrepo",
      42,
      expect.stringContaining("human attention"),
    );
  });

  it("revise → processIssue delegation", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
      makeHumanComment("fix this"),
    ]);
    vi.mocked(deps.runClaude).mockResolvedValue({
      success: true,
      stdout: "revised proposal",
      stderr: "",
      exitCode: 0,
    });

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.claudeExecuted).toBe(true);
    // The revise path delegates to processIssue which transitions in-progress and runs claude
    expect(deps.applyLabelTransition).toHaveBeenCalled();
  });

  it("wait → deferred, no label changes", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
    ]);

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("deferred");
    expect(result.claudeExecuted).toBe(false);
    expect(deps.applyLabelTransition).not.toHaveBeenCalled();
  });

  it("quota 0 + revise → deferred, no label changes", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
      makeHumanComment("fix this"),
    ]);

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, false, deps);

    expect(result.outcome).toBe("deferred");
    expect(result.claudeExecuted).toBe(false);
    expect(deps.applyLabelTransition).not.toHaveBeenCalled();
  });

  it("structural comment fetch error → needs-human + diagnostic", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockRejectedValue(
      new IssueCommentsError("viewerDidAuthor missing", true),
    );

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("failure");
    expect(deps.applyLabelTransition).toHaveBeenCalledWith(
      "testowner/testrepo",
      42,
      expect.objectContaining({
        add: [SPEC_LABELS.needsHuman],
        remove: [SPEC_LABELS.review],
      }),
    );
    expect(deps.postFailureComment).toHaveBeenCalled();
  });

  it("transient comment fetch error → failure, no label changes", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockRejectedValue(
      new IssueCommentsError("gh timeout", false),
    );

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("failure");
    expect(deps.applyLabelTransition).not.toHaveBeenCalled();
  });

  it("escalate のラベル遷移失敗時は説明コメントを投稿しない", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
    vi.mocked(deps.applyLabelTransition).mockRejectedValue(new Error("gh failed"));

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("success");
    expect(deps.postFailureComment).not.toHaveBeenCalled();
  });

  it("approve のラベル遷移が throw しても success を返す", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review, SPEC_LABELS.approved],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
    ]);
    vi.mocked(deps.applyLabelTransition).mockRejectedValue(new Error("gh failed"));

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("success");
    expect(result.claudeExecuted).toBe(false);
  });

  it("escalate の説明コメント投稿が throw しても success を返す", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);
    vi.mocked(deps.postFailureComment).mockRejectedValue(new Error("comment failed"));

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result.outcome).toBe("success");
    expect(result.claudeExecuted).toBe(false);
  });

  it("revise のラベル遷移が throw したら failure を返し processIssue に委譲しない", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
      makeHumanComment("fix this"),
    ]);
    vi.mocked(deps.applyLabelTransition).mockRejectedValue(new Error("gh failed"));

    const result = await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    expect(result).toEqual({ outcome: "failure", claudeExecuted: false });
    expect(deps.runClaude).not.toHaveBeenCalled();
    expect(deps.withWorktree).not.toHaveBeenCalled();
  });

  it("escalate 時に spec.trigger がラベルに含まれる場合 remove に含まれる", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review, SPEC_LABELS.trigger],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([]);

    await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    const call = vi.mocked(deps.applyLabelTransition).mock.calls[0];
    const transition = call[2] as { add: string[]; remove: string[] };
    expect(transition.remove).toContain(SPEC_LABELS.trigger);
  });

  it("approve strips spec.trigger if present in labels", async () => {
    const issue = makeIssue({
      phase: Phase.SPEC,
      labels: [SPEC_LABELS.review, SPEC_LABELS.approved, SPEC_LABELS.trigger],
    });
    const repoConfig = makeRepoConfig();
    vi.mocked(deps.fetchIssueComments).mockResolvedValue([
      makeWorkerComment(1, "proposal"),
    ]);

    await resumeSpecReview(issue, repoConfig, DEFAULT_EXECUTION_CONFIG, null, true, deps);

    const call = vi.mocked(deps.applyLabelTransition).mock.calls[0];
    const transition = call[2] as { add: string[]; remove: string[] };
    expect(transition.remove).toContain(SPEC_LABELS.trigger);
  });
});
