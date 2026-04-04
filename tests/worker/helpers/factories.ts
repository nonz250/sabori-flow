import type {
  Issue,
  PhaseLabels,
  LabelsConfig,
  RepositoryConfig,
  AppConfig,
  ExecutionConfig,
} from "../../../src/worker/models.js";
import { Phase, Priority } from "../../../src/worker/models.js";
import type { Language } from "../../../src/i18n/types.js";
import type { ProcessResult } from "../../../src/worker/process.js";

// ---------- Label constants ----------

export const PLAN_LABELS: PhaseLabels = {
  trigger: "claude/plan",
  inProgress: "claude/plan:in-progress",
  done: "claude/plan:done",
  failed: "claude/plan:failed",
};

export const IMPL_LABELS: PhaseLabels = {
  trigger: "claude/impl",
  inProgress: "claude/impl:in-progress",
  done: "claude/impl:done",
  failed: "claude/impl:failed",
};

export const DEFAULT_LABELS_CONFIG: LabelsConfig = {
  plan: PLAN_LABELS,
  impl: IMPL_LABELS,
};

// ---------- Factory functions ----------

export function makeRepoConfig(
  overrides?: Partial<RepositoryConfig>,
): RepositoryConfig {
  return {
    owner: "testowner",
    repo: "testrepo",
    localPath: "/tmp/testowner/testrepo",
    labels: DEFAULT_LABELS_CONFIG,
    priorityLabels: ["priority:high", "priority:low"],
    autoImplAfterPlan: false,
    ...overrides,
  };
}

export function makeIssue(overrides?: Partial<Issue>): Issue {
  const phase = overrides?.phase ?? Phase.PLAN;
  const number = overrides?.number ?? 42;
  const triggerLabel =
    phase === Phase.PLAN ? "claude/plan" : "claude/impl";

  return {
    number,
    title: "Test Issue",
    body: "Issue body",
    labels: [triggerLabel],
    url: `https://github.com/testowner/testrepo/issues/${number}`,
    authorAssociation: "OWNER",
    phase,
    priority: Priority.HIGH,
    ...overrides,
  };
}

export function makeProcessResult(
  overrides?: Partial<ProcessResult>,
): ProcessResult {
  return {
    success: true,
    stdout: "Claude output",
    stderr: "",
    ...overrides,
  };
}

export function makeAppConfig(
  overrides?: Partial<AppConfig> & {
    language?: Language;
    repositories?: RepositoryConfig[];
    execution?: Partial<ExecutionConfig>;
  },
): AppConfig {
  const defaultExecution: ExecutionConfig = {
    maxParallel: 1,
    maxIssuesPerRepo: 10,
    skipPermissions: true,
  };

  return {
    language: overrides?.language ?? "ja",
    repositories: overrides?.repositories ?? [makeRepoConfig()],
    execution: { ...defaultExecution, ...overrides?.execution },
  };
}
