import { describe, it, expect } from "vitest";
import {
  Phase,
  Priority,
  Autonomy,
  FailureCategory,
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

describe("Autonomy", () => {
  it("FULL の値が 'full' である", () => {
    expect(Autonomy.FULL).toBe("full");
  });

  it("AUTO の値が 'auto' である", () => {
    expect(Autonomy.AUTO).toBe("auto");
  });

  it("SANDBOXED の値が 'sandboxed' である", () => {
    expect(Autonomy.SANDBOXED).toBe("sandboxed");
  });

  it("INTERACTIVE の値が 'interactive' である", () => {
    expect(Autonomy.INTERACTIVE).toBe("interactive");
  });
});

describe("FailureCategory", () => {
  it("PROMPT_GENERATION の値が 'prompt_generation' である", () => {
    expect(FailureCategory.PROMPT_GENERATION).toBe("prompt_generation");
  });

  it("CLI_EXECUTION_ERROR の値が 'cli_execution_error' である", () => {
    expect(FailureCategory.CLI_EXECUTION_ERROR).toBe("cli_execution_error");
  });

  it("CLI_NON_ZERO_EXIT の値が 'cli_non_zero_exit' である", () => {
    expect(FailureCategory.CLI_NON_ZERO_EXIT).toBe("cli_non_zero_exit");
  });

  it("CLI_TIMEOUT の値が 'cli_timeout' である", () => {
    expect(FailureCategory.CLI_TIMEOUT).toBe("cli_timeout");
  });

  it("CLI_PERMISSION_DENIED の値が 'cli_permission_denied' である", () => {
    expect(FailureCategory.CLI_PERMISSION_DENIED).toBe("cli_permission_denied");
  });

  it("WORKTREE_CREATION の値が 'worktree_creation' である", () => {
    expect(FailureCategory.WORKTREE_CREATION).toBe("worktree_creation");
  });

  it("GIT_FETCH の値が 'git_fetch' である", () => {
    expect(FailureCategory.GIT_FETCH).toBe("git_fetch");
  });
});

describe("repoFullName", () => {
  it("'owner/repo' 形式のフルネームを返す", () => {
    const config: RepositoryConfig = {
      owner: "nonz250",
      repo: "sabori-flow",
      localPath: "/path/to/repo",
      defaultBranch: "main",
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
      autoImplAfterPlan: false,
    };

    expect(repoFullName(config)).toBe("nonz250/sabori-flow");
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
      authorAssociation: "OWNER",
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
      authorAssociation: "COLLABORATOR",
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
      defaultBranch: "main",
      labels: labelsConfig,
      priorityLabels: ["priority/high", "priority/low"],
      autoImplAfterPlan: false,
    };

    const executionConfig: ExecutionConfig = {
      maxParallel: 4,
      maxIssuesPerRepo: 5,
      autonomy: Autonomy.FULL,
    };

    const appConfig: AppConfig = {
      repositories: [repoConfig],
      execution: executionConfig,
    };

    expect(appConfig.repositories).toHaveLength(1);
    expect(appConfig.execution.maxParallel).toBe(4);
  });
});
