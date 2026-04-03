import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { runCommandSync, ProcessExecutionError } from "./process.js";
import { createLogger } from "./logger.js";

export class WorktreeError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, WorktreeError.prototype);
  }
}

const GIT_TIMEOUT_MS = 120_000;
const WORKTREES_DIR_NAME = ".sabori-flow-worktrees";

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

/**
 * git worktree を作成し、コールバック実行後に削除する。
 *
 * Python 版の worktree_context コンテキストマネージャに相当する。
 *
 * @param localPath - クローン済みリポジトリの絶対パス
 * @param issueNumber - Issue 番号
 * @param callback - worktree パスを受け取るコールバック
 * @param timestampFn - タイムスタンプ生成関数（テスト用）
 * @returns コールバックの戻り値
 * @throws WorktreeError - worktree の作成に失敗した場合
 */
export async function withWorktree<T>(
  localPath: string,
  issueNumber: number,
  callback: (worktreePath: string) => T | Promise<T>,
  timestampFn: () => string = defaultTimestampFn,
): Promise<T> {
  const ts = timestampFn();
  const branchName = `sabori-flow/${issueNumber}-${ts}`;
  const worktreesDir = join(dirname(localPath), WORKTREES_DIR_NAME);
  const worktreePath = join(worktreesDir, `issue-${issueNumber}-${ts}`);

  // worktree ディレクトリの親を作成
  mkdirSync(worktreesDir, { recursive: true });

  // worktree 作成
  runGit(
    localPath,
    ["worktree", "add", worktreePath, "-b", branchName],
    `worktree の作成に失敗しました: ${worktreePath}`,
  );

  try {
    return await callback(worktreePath);
  } finally {
    // worktree 削除（失敗してもログ警告のみ）
    try {
      runGit(
        localPath,
        ["worktree", "remove", worktreePath, "--force"],
        `worktree の削除に失敗しました: ${worktreePath}`,
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
): void {
  try {
    runCommandSync("git", ["-C", localPath, ...gitArgs], {
      timeoutMs: GIT_TIMEOUT_MS,
    });
  } catch (error: unknown) {
    if (error instanceof ProcessExecutionError) {
      throw new WorktreeError(`${errorMessage}: ${error.message}`);
    }
    throw error;
  }
}
