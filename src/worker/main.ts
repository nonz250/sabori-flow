import type { AppConfig, Issue, Phase, RepositoryConfig } from "./models.js";
import { repoFullName } from "./models.js";
import { Phase as PhaseEnum } from "./models.js";
import { loadConfig } from "./config.js";
import { fetchIssues } from "./fetcher.js";
import { processIssue } from "./pipeline.js";
import { configureLogger, createLogger, rotateOldLogs } from "./logger.js";
import { getConfigPath, getLogsDir } from "../utils/paths.js";

const logger = createLogger("main");

// ---------- Dependency Injection ----------

export interface WorkerDeps {
  loadConfig: (configPath: string) => AppConfig;
  fetchIssues: (
    repoConfig: RepositoryConfig,
    phase: Phase,
  ) => Promise<readonly Issue[]>;
  processIssue: (
    issue: Issue,
    repoConfig: RepositoryConfig,
  ) => Promise<boolean>;
}

export const defaultWorkerDeps: WorkerDeps = {
  loadConfig,
  fetchIssues,
  processIssue,
};

// ---------- Internal helpers ----------

/**
 * 指定リポジトリ・フェーズの Issue を取得し、パイプラインを実行する。
 *
 * @returns anySuccess: 1 件以上の Issue を正常に処理できた場合 true,
 *          processedCount: 処理対象とした Issue 件数
 */
async function processPhase(
  repoConfig: RepositoryConfig,
  phase: Phase,
  deps: WorkerDeps,
  remainingQuota: number,
): Promise<{ anySuccess: boolean; processedCount: number }> {
  const fullName = repoFullName(repoConfig);

  logger.info("[%s] %s フェーズの Issue を取得中...", fullName, phase);

  let issues: readonly Issue[];
  try {
    issues = await deps.fetchIssues(repoConfig, phase);
  } catch (error: unknown) {
    logger.error(
      "[%s] %s フェーズの Issue 取得に失敗: %s",
      fullName,
      phase,
      error,
    );
    return { anySuccess: false, processedCount: 0 };
  }

  logger.info(
    "[%s] %s フェーズ: %s 件の Issue を取得",
    fullName,
    phase,
    issues.length,
  );

  if (issues.length === 0) {
    return { anySuccess: true, processedCount: 0 }; // 0 件は成功扱い
  }

  const targetIssues = issues.slice(0, remainingQuota);
  if (targetIssues.length < issues.length) {
    logger.info(
      "[%s] %s フェーズ: 上限により %s/%s 件を処理",
      fullName,
      phase,
      targetIssues.length,
      issues.length,
    );
  }

  let anySuccess = false;
  for (const issue of targetIssues) {
    logger.info(
      "  #%s [%s] %s の処理を開始",
      issue.number,
      issue.priority,
      issue.title,
    );
    const success = await deps.processIssue(issue, repoConfig);
    if (success) {
      anySuccess = true;
    }
  }

  return { anySuccess, processedCount: targetIssues.length };
}

/**
 * 1 リポジトリの全フェーズを処理する。
 *
 * @returns 1 件以上の Issue を正常に処理できた場合 true
 */
async function processRepository(
  repoConfig: RepositoryConfig,
  maxIssuesPerRepo: number,
  deps: WorkerDeps,
): Promise<boolean> {
  const fullName = repoFullName(repoConfig);
  let anySuccess = false;
  let remaining = maxIssuesPerRepo;

  for (const phase of [PhaseEnum.PLAN, PhaseEnum.IMPL]) {
    if (remaining <= 0) {
      logger.info("[%s] リポジトリ上限に達したため %s フェーズをスキップ", fullName, phase);
      break;
    }
    const result = await processPhase(repoConfig, phase, deps, remaining);
    remaining -= result.processedCount;
    if (result.anySuccess) {
      anySuccess = true;
    }
  }
  return anySuccess;
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
 * config 読み込み -> ログ設定 -> リポジトリ並列処理 -> 結果判定
 *
 * @returns 終了コード (0: 成功, 1: 失敗)
 */
export async function workerMain(
  configPath: string = getConfigPath(),
  deps: WorkerDeps = defaultWorkerDeps,
): Promise<number> {
  // config 読み込み
  let appConfig: AppConfig;
  try {
    appConfig = deps.loadConfig(configPath);
  } catch (error: unknown) {
    logger.error("設定ファイルの読み込みに失敗しました: %s", error);
    return 1;
  }

  // ログ設定
  configureLogger({ logDir: getLogsDir() });
  rotateOldLogs();

  logger.info(
    "config.yml を読み込みました (リポジトリ数: %s)",
    appConfig.repositories.length,
  );

  // リポジトリ並列処理 (Promise.allSettled + セマフォ制御)
  const semaphore = new Semaphore(appConfig.execution.maxParallel);

  const results = await Promise.allSettled(
    appConfig.repositories.map(async (repoConfig) => {
      await semaphore.acquire();
      try {
        return await processRepository(repoConfig, appConfig.execution.maxIssuesPerRepo, deps);
      } finally {
        semaphore.release();
      }
    }),
  );

  // 結果判定
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
