import { describe, it, expect } from "vitest";
import {
  Phase,
  Priority,
  repoFullName,
} from "../../src/worker/models.js";
import type {
  Issue,
  PhaseLabels,
  LabelsConfig,
  RepositoryConfig,
  ExecutionConfig,
  AppConfig,
} from "../../src/worker/models.js";

describe("Phase", () => {
  it("PLAN の値が 'plan' である", () => {
    expect(Phase.PLAN).toBe("plan");
  });

  it("IMPL の値が 'impl' である", () => {
    expect(Phase.IMPL).toBe("impl");
  });
});

describe("Priority", () => {
  it("HIGH の値が 0 である", () => {
    expect(Priority.HIGH).toBe(0);
  });

  it("LOW の値が 1 である", () => {
    expect(Priority.LOW).toBe(1);
  });

  it("NONE の値が 2 である", () => {
    expect(Priority.NONE).toBe(2);
  });
});

describe("repoFullName", () => {
  it("'owner/repo' 形式のフルネームを返す", () => {
    const config: RepositoryConfig = {
      owner: "nonz250",
      repo: "claude-issue-worker",
      localPath: "/path/to/repo",
      labels: {
        plan: {
          trigger: "claude/plan",
          inProgress: "claude/plan:in-progress",
          done: "claude/plan:done",
          failed: "claude/plan:failed",
        },
        impl: {
          trigger: "claude/impl",
          inProgress: "claude/impl:in-progress",
          done: "claude/impl:done",
          failed: "claude/impl:failed",
        },
      },
      priorityLabels: ["priority/high"],
    };

    expect(repoFullName(config)).toBe("nonz250/claude-issue-worker");
  });
});

describe("型の構造テスト", () => {
  it("Issue インターフェースに準拠するオブジェクトが作成できる", () => {
    const issue: Issue = {
      number: 1,
      title: "Test issue",
      body: "Issue body",
      labels: ["claude/plan"],
      url: "https://github.com/owner/repo/issues/1",
      phase: Phase.PLAN,
      priority: Priority.HIGH,
    };

    expect(issue.number).toBe(1);
    expect(issue.phase).toBe("plan");
    expect(issue.priority).toBe(0);
  });

  it("Issue の body が null を許容する", () => {
    const issue: Issue = {
      number: 2,
      title: "No body issue",
      body: null,
      labels: [],
      url: "https://github.com/owner/repo/issues/2",
      phase: Phase.IMPL,
      priority: Priority.NONE,
    };

    expect(issue.body).toBeNull();
  });

  it("AppConfig インターフェースに準拠するオブジェクトが作成できる", () => {
    const phaseLabels: PhaseLabels = {
      trigger: "claude/plan",
      inProgress: "claude/plan:in-progress",
      done: "claude/plan:done",
      failed: "claude/plan:failed",
    };

    const labelsConfig: LabelsConfig = {
      plan: phaseLabels,
      impl: {
        trigger: "claude/impl",
        inProgress: "claude/impl:in-progress",
        done: "claude/impl:done",
        failed: "claude/impl:failed",
      },
    };

    const repoConfig: RepositoryConfig = {
      owner: "test-owner",
      repo: "test-repo",
      localPath: "/tmp/repo",
      labels: labelsConfig,
      priorityLabels: ["priority/high", "priority/low"],
    };

    const executionConfig: ExecutionConfig = {
      maxParallel: 4,
      logDir: "/tmp/logs",
    };

    const appConfig: AppConfig = {
      repositories: [repoConfig],
      execution: executionConfig,
    };

    expect(appConfig.repositories).toHaveLength(1);
    expect(appConfig.execution.maxParallel).toBe(4);
  });
});
