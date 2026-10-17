import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { RepositoryConfig } from "./models.js";
import { runCommandSync, ProcessExecutionError } from "./process.js";
import { createLogger } from "./logger.js";
import { getWorktreesDir } from "../utils/paths.js";

export type WorktreePhase = "fetch" | "mkdir" | "create";

export class WorktreeError extends Error {
  readonly phase: WorktreePhase;
  constructor(message: string, phase: WorktreePhase) {
    super(message);
    this.phase = phase;
    Object.setPrototypeOf(this, WorktreeError.prototype);
  }
}

const GIT_TIMEOUT_MS = 120_000;
export const FIRST_ATTEMPT = 1;

const logger = createLogger("worktree");

function defaultTimestampFn(): string {
  const now = new Date();
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const s = String(now.getSeconds()).padStart(2, "0");
  return `${y}${mo}${d}${h}${mi}${s}`;
}

export async function withWorktree<T>(
  repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath" | "defaultBranch">,
  issueNumber: number,
  callback: (worktreePath: string) => T | Promise<T>,
  timestampFn: () => string = defaultTimestampFn,
  attempt: number = FIRST_ATTEMPT,
): Promise<T> {
  const ts = attemptTimestamp(timestampFn, attempt);
  const branchName = `sabori-flow/${issueNumber}-${ts}`;
  const repoDir = join(getWorktreesDir(), repoConfig.owner, repoConfig.repo);
  const worktreePath = join(repoDir, `issue-${issueNumber}-${ts}`);

  runGit(
    repoConfig.localPath,
    ["fetch", "origin"],
    "git fetch origin に失敗しました",
    "fetch",
  );

  ensureRepoDir(repoDir);

  runGit(
    repoConfig.localPath,
    ["worktree", "add", worktreePath, "-b", branchName, `origin/${repoConfig.defaultBranch}`],
    `worktree の作成に失敗しました: ${worktreePath}`,
    "create",
  );

  return useWorktree(repoConfig.localPath, worktreePath, callback);
}

/**
 * Pull Request の head を detached HEAD でチェックアウトした worktree でコールバックを実行する。
 *
 * レビューはコミットしないため、ブランチは作らない。
 */
export async function withPullRequestWorktree<T>(
  repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath">,
  prNumber: number,
  callback: (worktreePath: string) => T | Promise<T>,
  timestampFn: () => string = defaultTimestampFn,
  attempt: number = FIRST_ATTEMPT,
): Promise<T> {
  const ts = attemptTimestamp(timestampFn, attempt);
  const repoDir = join(getWorktreesDir(), repoConfig.owner, repoConfig.repo);
  const worktreePath = join(repoDir, `pr-${prNumber}-${ts}`);

  // The base branch is fetched too so the agent can diff against origin/<base>.
  runGit(
    repoConfig.localPath,
    ["fetch", "origin"],
    "git fetch origin に失敗しました",
    "fetch",
  );
  runGit(
    repoConfig.localPath,
    ["fetch", "origin", `pull/${prNumber}/head`],
    `PR #${prNumber} の head の取得に失敗しました`,
    "fetch",
  );

  ensureRepoDir(repoDir);

  runGit(
    repoConfig.localPath,
    ["worktree", "add", "--detach", worktreePath, "FETCH_HEAD"],
    `worktree の作成に失敗しました: ${worktreePath}`,
    "create",
  );

  return useWorktree(repoConfig.localPath, worktreePath, callback);
}

/**
 * @throws {WorktreeError} git rev-parse に失敗した場合
 */
export function resolveHeadSha(worktreePath: string): string {
  try {
    return runCommandSync("git", ["-C", worktreePath, "rev-parse", "HEAD"], {
      timeoutMs: GIT_TIMEOUT_MS,
    }).trim();
  } catch (error: unknown) {
    if (error instanceof ProcessExecutionError) {
      throw new WorktreeError(`HEAD の解決に失敗しました: ${error.message}`, "create");
    }
    throw error;
  }
}

function attemptTimestamp(timestampFn: () => string, attempt: number): string {
  // A retry with a fallback agent can start within the same second as the
  // attempt it replaces, and the previous branch is not deleted on cleanup.
  return attempt > FIRST_ATTEMPT ? `${timestampFn()}-${attempt}` : timestampFn();
}

function ensureRepoDir(repoDir: string): void {
  try {
    mkdirSync(repoDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorktreeError(
      `worktree ディレクトリの作成に失敗しました: ${repoDir}: ${message}`,
      "mkdir",
    );
  }
}

async function useWorktree<T>(
  localPath: string,
  worktreePath: string,
  callback: (worktreePath: string) => T | Promise<T>,
): Promise<T> {
  try {
    return await callback(worktreePath);
  } finally {
    try {
      runGit(
        localPath,
        ["worktree", "remove", worktreePath, "--force"],
        `worktree の削除に失敗しました: ${worktreePath}`,
        "create",
      );
    } catch {
      logger.warn("worktree の削除に失敗しました: %s", worktreePath);
    }
  }
}

function runGit(
  localPath: string,
  gitArgs: readonly string[],
  errorMessage: string,
  phase: WorktreePhase,
): void {
  try {
    runCommandSync("git", ["-C", localPath, ...gitArgs], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (error instanceof ProcessExecutionError) {
      throw new WorktreeError(`${errorMessage}: ${error.message}`, phase);
    }
    throw error;
  }
}
