import type { PhaseLabels } from "./models.js";
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

/**
 * trigger ラベルを外し、in_progress ラベルを付ける。
 *
 * @throws {LabelError} ラベル操作に失敗した場合
 */
export async function transitionToInProgress(
  repoFullName: string,
  issueNumber: number,
  phaseLabels: PhaseLabels,
): Promise<void> {
  await runGhEdit(repoFullName, issueNumber, {
    addLabel: phaseLabels.inProgress,
    removeLabel: phaseLabels.trigger,
  });
}

/**
 * in_progress ラベルを外し、done ラベルを付ける。
 *
 * @throws {LabelError} ラベル操作に失敗した場合
 */
export async function transitionToDone(
  repoFullName: string,
  issueNumber: number,
  phaseLabels: PhaseLabels,
): Promise<void> {
  await runGhEdit(repoFullName, issueNumber, {
    addLabel: phaseLabels.done,
    removeLabel: phaseLabels.inProgress,
  });
}

/**
 * in_progress ラベルを外し、failed ラベルを付ける。
 *
 * @throws {LabelError} ラベル操作に失敗した場合
 */
export async function transitionToFailed(
  repoFullName: string,
  issueNumber: number,
  phaseLabels: PhaseLabels,
): Promise<void> {
  await runGhEdit(repoFullName, issueNumber, {
    addLabel: phaseLabels.failed,
    removeLabel: phaseLabels.inProgress,
  });
}

interface LabelTransition {
  readonly addLabel: string;
  readonly removeLabel: string;
}

/**
 * gh issue edit コマンドを実行する。
 *
 * @throws {LabelError} コマンドがタイムアウトまたは非0終了した場合
 */
async function runGhEdit(
  repoFullName: string,
  issueNumber: number,
  transition: LabelTransition,
): Promise<void> {
  try {
    const result = await runCommand(
      "gh",
      [
        "issue",
        "edit",
        "--repo",
        repoFullName,
        String(issueNumber),
        "--add-label",
        transition.addLabel,
        "--remove-label",
        transition.removeLabel,
      ],
      { timeoutMs: GH_TIMEOUT_MS },
    );

    if (!result.success) {
      if (isLabelNotFoundError(result.stderr, transition.addLabel)) {
        logger.info(
          "Label '%s' not found in %s — attempting to create",
          transition.addLabel,
          repoFullName,
        );
        await ensureLabel(repoFullName, transition.addLabel);

        const retryResult = await runCommand(
          "gh",
          [
            "issue",
            "edit",
            "--repo",
            repoFullName,
            String(issueNumber),
            "--add-label",
            transition.addLabel,
            "--remove-label",
            transition.removeLabel,
          ],
          { timeoutMs: GH_TIMEOUT_MS },
        );

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

/**
 * stderr が「ラベルが存在しない」エラーかどうかを判定する。
 *
 * gh CLI の `gh issue edit --add-label` で存在しないラベルを指定した際の
 * エラーメッセージ（例: `'labelName' not found`）に基づく判定。
 * gh のバージョンアップでメッセージが変わった場合、リトライが発動しなくなるが、
 * 既存の LabelError フォールバックにより安全に劣化する。
 */
function isLabelNotFoundError(stderr: string, labelName: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes("not found") &&
    lower.includes(labelName.toLowerCase())
  );
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

  logger.info(
    "Label '%s' created in %s",
    labelName,
    repoFullName,
  );
}
