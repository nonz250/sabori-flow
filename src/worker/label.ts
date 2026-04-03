import type { PhaseLabels } from "./models.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";

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
