import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { ProcessResult } from "./process.js";
import { Autonomy } from "./models.js";
import { createLogger } from "./logger.js";

const logger = createLogger("executor");

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ExecutorError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 3_600_000; // 60 minutes

export interface RunClaudeOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly autonomy?: Autonomy;
}

/**
 * Claude Code CLI を実行し、結果を返す。
 *
 * stdin 経由でプロンプトを渡して非対話実行する。
 *
 * @param prompt - Claude Code CLI に渡すプロンプト文字列
 * @param options - cwd, timeoutMs を指定可能
 * @returns ProcessResult (success, stdout, stderr)
 * @throws ExecutorError - タイムアウトまたは予期しない実行エラーの場合
 */
export async function runClaude(
  prompt: string,
  options?: RunClaudeOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const autonomy = options?.autonomy ?? Autonomy.INTERACTIVE;
  const autonomyFlags = resolveClaudeAutonomyFlags(autonomy);
  if (autonomy === Autonomy.SANDBOXED) {
    logger.warn(
      "Claude Code does not support 'sandboxed' autonomy; falling back to 'interactive'",
    );
  }
  const args = ["-p", ...autonomyFlags];

  try {
    return await runCommand(
      "claude",
      args,
      {
        input: prompt,
        cwd: options?.cwd,
        timeoutMs,
      },
    );
  } catch (error: unknown) {
    if (error instanceof ProcessTimeoutError) {
      throw new ExecutorError(
        `Claude Code CLI timed out after ${timeoutMs}ms`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new ExecutorError(error.message);
    }
    throw error;
  }
}

/**
 * Autonomy レベルから Claude Code CLI のフラグを解決する。
 *
 * Claude Code は full と interactive のみ対応。
 * sandboxed は未対応のため interactive と同じフラグ（空配列）を返す。
 */
export function resolveClaudeAutonomyFlags(autonomy: Autonomy): readonly string[] {
  switch (autonomy) {
    case Autonomy.FULL:
      return ["--dangerously-skip-permissions"];
    case Autonomy.SANDBOXED:
      return [];
    case Autonomy.INTERACTIVE:
      return [];
    default: {
      const _exhaustive: never = autonomy;
      throw new Error(`Unknown autonomy level: ${_exhaustive}`);
    }
  }
}
