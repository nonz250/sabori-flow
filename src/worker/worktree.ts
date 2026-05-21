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
const WORKTREE_DIR_MODE = 0o700;

const logger = createLogger("worktree");

// Second-level granularity is sufficient because:
//   1. Same-repo issues are processed sequentially (max_issues_per_repo
//      gates parallelism per repo).
//   2. Cross-repo collisions are prevented by the <owner>/<repo>/ path
//      prefix added in withWorktree() below.
// If max_issues_per_repo becomes truly parallel in the future, switch
// to millisecond granularity or UUID-based naming.
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
 * Creates a git worktree and removes it after the callback runs.
 *
 * Worktrees are placed under ~/.sabori-flow/worktrees/<owner>/<repo>/
 * to keep them out of the user's working tree.
 */
export async function withWorktree<T>(
  repoConfig: Pick<RepositoryConfig, "owner" | "repo" | "localPath" | "defaultBranch">,
  issueNumber: number,
  callback: (worktreePath: string) => T | Promise<T>,
  timestampFn: () => string = defaultTimestampFn,
): Promise<T> {
  const ts = timestampFn();
  const branchName = `sabori-flow/${issueNumber}-${ts}`;
  const repoDir = join(getWorktreesDir(), repoConfig.owner, repoConfig.repo);
  const worktreePath = join(repoDir, `issue-${issueNumber}-${ts}`);

  // Phase 1: fetch first. If fetch fails, no filesystem side-effects occur,
  // so no empty directories are left behind.
  runGit(
    repoConfig.localPath,
    ["fetch", "origin"],
    "git fetch origin に失敗しました",
    "fetch",
  );

  // Phase 2: create the parent directory (after fetch succeeds).
  // mode 0o700 prevents other local users from reading worktree contents,
  // which is relevant on shared workstations holding private repos.
  try {
    mkdirSync(repoDir, { recursive: true, mode: WORKTREE_DIR_MODE });
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
    // Intentionally do NOT remove the <owner>/<repo>/ parent directory:
    // concurrent issues for the same repo may share it, and removing it
    // could break other in-flight worktree operations.
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
