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
const FIRST_ATTEMPT = 1;

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
  // A retry with a fallback agent can start within the same second as the
  // attempt it replaces, and the previous branch is not deleted on cleanup.
  const ts = attempt > FIRST_ATTEMPT ? `${timestampFn()}-${attempt}` : timestampFn();
  const branchName = `sabori-flow/${issueNumber}-${ts}`;
  const repoDir = join(getWorktreesDir(), repoConfig.owner, repoConfig.repo);
  const worktreePath = join(repoDir, `issue-${issueNumber}-${ts}`);

  runGit(
    repoConfig.localPath,
    ["fetch", "origin"],
    "git fetch origin に失敗しました",
    "fetch",
  );

  try {
    mkdirSync(repoDir, { recursive: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorktreeError(
      `worktree ディレクトリの作成に失敗しました: ${repoDir}: ${message}`,
      "mkdir",
    );
  }

  runGit(
    repoConfig.localPath,
    ["worktree", "add", worktreePath, "-b", branchName, `origin/${repoConfig.defaultBranch}`],
    `worktree の作成に失敗しました: ${worktreePath}`,
    "create",
  );

  try {
    return await callback(worktreePath);
  } finally {
    try {
      runGit(
        repoConfig.localPath,
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
