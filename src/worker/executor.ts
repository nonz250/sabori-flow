import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { ProcessResult } from "./process.js";
import { Autonomy, Agent } from "./models.js";
import { createLogger } from "./logger.js";

const logger = createLogger("executor");

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ExecutorError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 1_800_000; // 30 minutes

export interface RunAgentOptions {
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
  options?: RunAgentOptions,
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

/**
 * OpenAI Codex CLI を実行し、結果を返す。
 *
 * プロンプトは位置引数として渡す（Codex CLI は stdin 非対応）。
 *
 * NOTE: プロンプトがコマンドライン引数に含まれるため、
 * `ps` コマンド等で他のプロセスから可視になる点に注意。
 */
export async function runCodex(
  prompt: string,
  options?: RunAgentOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const autonomy = options?.autonomy ?? Autonomy.INTERACTIVE;
  const autonomyFlags = resolveCodexAutonomyFlags(autonomy);
  const args = ["exec", ...autonomyFlags, prompt];

  try {
    return await runCommand(
      "codex",
      args,
      {
        cwd: options?.cwd,
        timeoutMs,
      },
    );
  } catch (error: unknown) {
    if (error instanceof ProcessTimeoutError) {
      throw new ExecutorError(
        `Codex CLI timed out after ${timeoutMs}ms`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new ExecutorError(error.message);
    }
    throw error;
  }
}

/**
 * Autonomy レベルから Codex CLI のフラグを解決する。
 *
 * - full: --dangerously-bypass-approvals-and-sandbox (no sandbox, no approvals)
 * - sandboxed: --full-auto (sandboxed autonomous execution)
 * - interactive: no flags (default interactive mode)
 */
export function resolveCodexAutonomyFlags(autonomy: Autonomy): readonly string[] {
  switch (autonomy) {
    case Autonomy.FULL:
      return ["--dangerously-bypass-approvals-and-sandbox"];
    case Autonomy.SANDBOXED:
      return ["--full-auto"];
    case Autonomy.INTERACTIVE:
      return [];
    default: {
      const _exhaustive: never = autonomy;
      throw new Error(`Unknown autonomy level: ${_exhaustive}`);
    }
  }
}

/**
 * エージェントに応じた CLI を実行するディスパッチ関数。
 */
export async function runAgent(
  agent: Agent,
  prompt: string,
  options?: RunAgentOptions,
): Promise<ProcessResult> {
  switch (agent) {
    case Agent.CLAUDE:
      return runClaude(prompt, options);
    case Agent.CODEX:
      return runCodex(prompt, options);
    default: {
      const _exhaustive: never = agent;
      throw new Error(`Unknown agent: ${_exhaustive}`);
    }
  }
}
