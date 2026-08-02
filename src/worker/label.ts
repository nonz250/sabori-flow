import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import { createLogger } from "./logger.js";

const logger = createLogger("label");

const GH_TIMEOUT_MS = 120_000;

export class LabelError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, LabelError.prototype);
  }
}

export interface LabelTransition {
  readonly add: readonly string[];
  readonly remove: readonly string[];
}

/**
 * Issue のラベルを操作する。
 *
 * remove は絞り込まずそのまま gh issue edit に渡す。
 * Issue.labels は fetch 時点のスナップショットで、worker が後から付ける
 * inProgress を含まないため、交差を取ると done / failed 遷移で
 * inProgress が remove から落ちてラベルが残る。
 *
 * @throws {LabelError} ラベル操作に失敗した場合
 */
export async function applyLabelTransition(
  repoFullName: string,
  issueNumber: number,
  transition: LabelTransition,
): Promise<void> {
  try {
    const args = buildGhEditArgs(repoFullName, issueNumber, transition);
    const result = await runCommand("gh", args, { timeoutMs: GH_TIMEOUT_MS });

    if (!result.success) {
      if (isLabelNotFoundError(result.stderr, transition.add)) {
        for (const label of transition.add) {
          logger.info(
            "Label '%s' not found in %s — attempting to create",
            label,
            repoFullName,
          );
          await ensureLabel(repoFullName, label);
        }

        const retryResult = await runCommand("gh", args, {
          timeoutMs: GH_TIMEOUT_MS,
        });

        if (!retryResult.success) {
          throw new LabelError(retryResult.stderr);
        }
        return;
      }

      throw new LabelError(result.stderr);
    }
  } catch (error: unknown) {
    if (error instanceof LabelError) {
      throw error;
    }
    if (error instanceof ProcessTimeoutError) {
      throw new LabelError(
        `gh issue edit timed out after ${GH_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new LabelError(error.message);
    }
    throw error;
  }
}

// ---------- Internal helpers ----------

function buildGhEditArgs(
  repoFullName: string,
  issueNumber: number,
  transition: LabelTransition,
): string[] {
  const args = [
    "issue",
    "edit",
    "--repo",
    repoFullName,
    String(issueNumber),
  ];
  if (transition.add.length > 0) {
    args.push("--add-label", transition.add.join(","));
  }
  if (transition.remove.length > 0) {
    args.push("--remove-label", transition.remove.join(","));
  }
  return args;
}

/**
 * stderr が「ラベルが存在しない」エラーかどうかを判定する。
 *
 * gh CLI の `gh issue edit --add-label` で存在しないラベルを指定した際の
 * エラーメッセージ（例: `'labelName' not found`）に基づく判定。
 * gh のバージョンアップでメッセージが変わった場合、リトライが発動しなくなるが、
 * 既存の LabelError フォールバックにより安全に劣化する。
 */
function isLabelNotFoundError(
  stderr: string,
  labelNames: readonly string[],
): boolean {
  const lower = stderr.toLowerCase();
  if (!lower.includes("not found")) return false;
  return labelNames.some((name) => lower.includes(name.toLowerCase()));
}

/**
 * stderr が「ラベルが既に存在する」エラーかどうかを判定する。
 */
function isLabelAlreadyExistsError(stderr: string): boolean {
  return stderr.toLowerCase().includes("already exists");
}

/**
 * ラベルが存在しない場合に作成する。既に存在する場合は何もしない。
 *
 * @throws {LabelError} ラベルの作成に失敗した場合
 */
async function ensureLabel(
  repoFullName: string,
  labelName: string,
): Promise<void> {
  const result = await runCommand(
    "gh",
    ["label", "create", labelName, "--repo", repoFullName],
    { timeoutMs: GH_TIMEOUT_MS },
  );

  if (!result.success) {
    if (isLabelAlreadyExistsError(result.stderr)) {
      logger.info(
        "Label '%s' already exists in %s — proceeding",
        labelName,
        repoFullName,
      );
      return;
    }
    throw new LabelError(
      `Failed to create label '${labelName}': ${result.stderr}`,
    );
  }

  logger.info("Label '%s' created in %s", labelName, repoFullName);
}
