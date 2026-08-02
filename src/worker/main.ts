import type { AppConfig, ExecutionConfig, Issue, LabelsConfig, Phase, RepositoryConfig, StepResult } from "./models.js";
import { repoFullName } from "./models.js";
import { Phase as PhaseEnum } from "./models.js";
import { loadConfig } from "./config.js";
import { fetchIssues } from "./fetcher.js";
import { processIssue, resumeSpecReview } from "./pipeline.js";
import { resolveAutonomyLogMessage } from "./executor.js";
import { configureLogger, createLogger, rotateOldLogs } from "./logger.js";
import { getConfigPath, getLogsDir } from "../utils/paths.js";
import { readAuthToken } from "../utils/auth-token.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";

const logger = createLogger("main");

const GH_TIMEOUT_MS = 120_000;

// ---------- Dependency Injection ----------

export interface WorkerDeps {
  loadConfig: (configPath: string) => AppConfig;
  fetchIssues: (
    repoConfig: RepositoryConfig,
    phase: Phase,
    label: string,
  ) => Promise<readonly Issue[]>;
  processIssue: (
    issue: Issue,
    repoConfig: RepositoryConfig,
    executionConfig: ExecutionConfig,
    authToken: string | null,
    entryLabel: string,
  ) => Promise<StepResult>;
  resumeSpecReview: (
    issue: Issue,
    repoConfig: RepositoryConfig,
    executionConfig: ExecutionConfig,
    authToken: string | null,
    canRunClaude: boolean,
  ) => Promise<StepResult>;
  ensureLabelsExist: (
    repo: string,
    labels: readonly string[],
  ) => Promise<void>;
  readAuthToken: () => string | null;
}

export const defaultWorkerDeps: WorkerDeps = {
  loadConfig,
  fetchIssues: (repoConfig, phase, label) => fetchIssues(repoConfig, phase, label),
  processIssue,
  resumeSpecReview,
  ensureLabelsExist,
  readAuthToken,
};

// ---------- Step definitions ----------

interface StepContext {
  repoConfig: RepositoryConfig;
  executionConfig: ExecutionConfig;
  deps: WorkerDeps;
  authToken: string | null;
}

interface Step {
  readonly phase: Phase;
  readonly label: (labels: LabelsConfig) => string;
  readonly run: (ctx: StepContext, issue: Issue, canRunClaude: boolean) => Promise<StepResult>;
  /** Skipped once the claude quota is spent. False for steps that only read GitHub. */
  readonly requiresQuota: boolean;
}

/**
 * Process later-stage phases first. When quota is 1, the first step
 * always wins — processing front-to-back would let new intake
 * overtake in-progress work and stall impl.
 */
const STEPS: readonly Step[] = [
  {
    phase: PhaseEnum.IMPL,
    label: (l) => l.impl.trigger,
    run: (ctx, issue, _canRunClaude) =>
      ctx.deps.processIssue(issue, ctx.repoConfig, ctx.executionConfig, ctx.authToken, ctx.repoConfig.labels.impl.trigger),
    requiresQuota: true,
  },
  {
    phase: PhaseEnum.PLAN,
    label: (l) => l.plan.trigger,
    run: (ctx, issue, _canRunClaude) =>
      ctx.deps.processIssue(issue, ctx.repoConfig, ctx.executionConfig, ctx.authToken, ctx.repoConfig.labels.plan.trigger),
    requiresQuota: true,
  },
  {
    phase: PhaseEnum.SPEC,
    label: (l) => l.spec.review,
    run: (ctx, issue, canRunClaude) =>
      ctx.deps.resumeSpecReview(issue, ctx.repoConfig, ctx.executionConfig, ctx.authToken, canRunClaude),
    // Evaluating a review costs one gh call and no claude run. Skipping it
    // when quota is spent would sit on a human's approval until a cycle
    // happens to have quota left over.
    requiresQuota: false,
  },
  {
    phase: PhaseEnum.SPEC,
    label: (l) => l.spec.trigger,
    run: (ctx, issue, _canRunClaude) =>
      ctx.deps.processIssue(issue, ctx.repoConfig, ctx.executionConfig, ctx.authToken, ctx.repoConfig.labels.spec.trigger),
    requiresQuota: true,
  },
];

// ---------- Internal helpers ----------

/**
 * 1 リポジトリの全ステップを処理する。
 *
 * @returns 1 件以上の Issue を正常に処理できた場合 true
 */
async function processRepository(
  repoConfig: RepositoryConfig,
  executionConfig: ExecutionConfig,
  deps: WorkerDeps,
  authToken: string | null,
): Promise<boolean> {
  const fullName = repoFullName(repoConfig);
  const labels = repoConfig.labels;

  // Create trigger labels that humans need to use from the UI
  await deps.ensureLabelsExist(fullName, [
    labels.spec.trigger,
    labels.spec.approved,
    labels.plan.trigger,
    labels.impl.trigger,
  ]);

  let anySuccess = false;
  let remaining = executionConfig.maxIssuesPerRepo;

  const ctx: StepContext = { repoConfig, executionConfig, deps, authToken };

  for (const step of STEPS) {
    const stepLabel = step.label(labels);
    logger.info("[%s] %s フェーズ (%s) の Issue を取得中...", fullName, step.phase, stepLabel);

    let issues: readonly Issue[];
    try {
      issues = await deps.fetchIssues(repoConfig, step.phase, stepLabel);
    } catch (error: unknown) {
      logger.error(
        "[%s] %s フェーズの Issue 取得に失敗: %s",
        fullName,
        step.phase,
        error,
      );
      continue;
    }

    logger.info(
      "[%s] %s フェーズ: %s 件の Issue を取得",
      fullName,
      step.phase,
      issues.length,
    );

    if (issues.length === 0) {
      anySuccess = true;
      continue;
    }

    for (const issue of issues) {
      const canRunClaude = remaining > 0;
      if (!canRunClaude && step.requiresQuota) {
        logger.info(
          "[%s] %s フェーズ: claude 起動上限に達したため残りをスキップ",
          fullName,
          step.phase,
        );
        break;
      }
      logger.info(
        "  #%s [%s] %s の処理を開始",
        issue.number,
        issue.priority,
        issue.title,
      );
      const result = await step.run(ctx, issue, canRunClaude);
      if (result.outcome === "success") {
        anySuccess = true;
      }
      if (result.claudeExecuted) {
        remaining--;
      }
    }
  }

  return anySuccess;
}

// ---------- ensureLabelsExist ----------

async function ensureLabelsExist(
  repoFullName: string,
  labels: readonly string[],
): Promise<void> {
  let existingLabels: Set<string>;
  try {
    const result = await runCommand(
      "gh",
      ["label", "list", "--repo", repoFullName, "--json", "name", "--limit", "1000"],
      { timeoutMs: GH_TIMEOUT_MS },
    );
    if (!result.success) {
      logger.warn("Failed to list labels in %s: %s", repoFullName, result.stderr);
      return;
    }
    const parsed = JSON.parse(result.stdout) as Array<{ name: string }>;
    existingLabels = new Set(parsed.map((l) => l.name));
  } catch (error: unknown) {
    logger.warn("Failed to list labels in %s: %s", repoFullName,
      error instanceof Error ? error.message : String(error));
    return;
  }

  for (const label of labels) {
    if (existingLabels.has(label)) continue;
    try {
      const result = await runCommand(
        "gh",
        ["label", "create", label, "--repo", repoFullName],
        { timeoutMs: GH_TIMEOUT_MS },
      );
      if (!result.success) {
        if (result.stderr.toLowerCase().includes("already exists")) continue;
        logger.warn("Failed to create label '%s' in %s: %s", label, repoFullName, result.stderr);
      } else {
        logger.info("Label '%s' created in %s", label, repoFullName);
      }
    } catch (error: unknown) {
      logger.warn("Failed to create label '%s' in %s: %s", label, repoFullName,
        error instanceof Error ? error.message : String(error));
    }
  }
}

// ---------- Semaphore ----------

class Semaphore {
  private queue: (() => void)[] = [];
  private current = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

// ---------- Main ----------

/**
 * ワーカーのメインロジック。
 *
 * @returns 終了コード (0: 成功, 1: 失敗)
 */
export async function workerMain(
  configPath: string = getConfigPath(),
  deps: WorkerDeps = defaultWorkerDeps,
): Promise<number> {
  let appConfig: AppConfig;
  try {
    appConfig = deps.loadConfig(configPath);
  } catch (error: unknown) {
    logger.error("設定ファイルの読み込みに失敗しました: %s", error);
    return 1;
  }

  configureLogger({ logDir: getLogsDir() });
  rotateOldLogs();

  logger.info(
    "config.yml を読み込みました (リポジトリ数: %s)",
    appConfig.repositories.length,
  );

  const autonomyLog = resolveAutonomyLogMessage(appConfig.execution.autonomy);
  if (autonomyLog !== null) {
    logger[autonomyLog.level](autonomyLog.message);
  }

  const authToken = deps.readAuthToken();
  if (authToken !== null) {
    logger.info("Claude auth token loaded; scoping it to claude executions.");
  }

  const semaphore = new Semaphore(appConfig.execution.maxParallel);

  const results = await Promise.allSettled(
    appConfig.repositories.map(async (repoConfig) => {
      await semaphore.acquire();
      try {
        return await processRepository(repoConfig, appConfig.execution, deps, authToken);
      } finally {
        semaphore.release();
      }
    }),
  );

  let anySuccess = false;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      if (result.value) {
        anySuccess = true;
      }
    } else {
      const repoConfig = appConfig.repositories[i];
      logger.error(
        "[%s] 予期しないエラー: %s",
        repoFullName(repoConfig),
        result.reason,
      );
    }
  }

  return anySuccess ? 0 : 1;
}
