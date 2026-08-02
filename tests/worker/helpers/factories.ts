import type {
  Issue,
  PhaseLabels,
  SpecPhaseLabels,
  LabelsConfig,
  RepositoryConfig,
  AppConfig,
  ExecutionConfig,
} from "../../../src/worker/models.js";
import { Phase, Priority } from "../../../src/worker/models.js";
import type { Language } from "../../../src/i18n/types.js";
import type { ProcessResult } from "../../../src/worker/process.js";
import { ExecutorTimeoutError } from "../../../src/worker/executor.js";

// ---------- Label constants ----------

export const SPEC_LABELS: SpecPhaseLabels = {
  trigger: "test/spec",
  inProgress: "test/spec/in-progress",
  done: "test/spec/done",
  failed: "test/spec/failed",
  review: "test/spec/review",
  approved: "test/spec/approved",
  needsHuman: "test/spec/needs-human",
};

export const PLAN_LABELS: PhaseLabels = {
  trigger: "test/plan",
  inProgress: "test/plan/in-progress",
  done: "test/plan/done",
  failed: "test/plan/failed",
};

export const IMPL_LABELS: PhaseLabels = {
  trigger: "test/impl",
  inProgress: "test/impl/in-progress",
  done: "test/impl/done",
  failed: "test/impl/failed",
};

export const DEFAULT_LABELS_CONFIG: LabelsConfig = {
  spec: SPEC_LABELS,
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
    defaultBranch: "main",
    ...overrides,
  };
}

export function makeIssue(overrides?: Partial<Issue>): Issue {
  const phase = overrides?.phase ?? Phase.PLAN;
  const number = overrides?.number ?? 42;
  const triggerLabelMap: Record<Phase, string> = {
    [Phase.SPEC]: "test/spec",
    [Phase.PLAN]: "test/plan",
    [Phase.IMPL]: "test/impl",
  };
  const triggerLabel = triggerLabelMap[phase];

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
    exitCode: overrides?.success === false ? 1 : 0,
    ...overrides,
  };
}

export function makeExecutorTimeoutError(overrides?: {
  timeoutMs?: number;
  stdout?: string;
  stderr?: string;
  message?: string;
}): ExecutorTimeoutError {
  const timeoutMs = overrides?.timeoutMs ?? 3_600_000;
  const message =
    overrides?.message ?? `Claude Code CLI timed out after ${timeoutMs}ms`;
  return new ExecutorTimeoutError(
    message,
    timeoutMs,
    overrides?.stdout ?? "",
    overrides?.stderr ?? "",
  );
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
    autonomy: "interactive",
    intervalMinutes: 60,
    timeoutMinutes: 60,
    language: overrides?.language ?? "ja",
  };

  return {
    language: overrides?.language ?? "ja",
    repositories: overrides?.repositories ?? [makeRepoConfig()],
    execution: { ...defaultExecution, ...overrides?.execution },
  };
}
