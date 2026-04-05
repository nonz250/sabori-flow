import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { ProcessResult } from "./process.js";

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ExecutorError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes

export interface RunClaudeOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly skipPermissions?: boolean;
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

  const args = ["-p"];
  const skipPermissions = options?.skipPermissions ?? true;
  if (skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }

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
