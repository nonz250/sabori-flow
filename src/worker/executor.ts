import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { ProcessResult } from "./process.js";
import { Autonomy } from "./models.js";

export class ExecutorError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ExecutorError.prototype);
  }
}

export class ExecutorTimeoutError extends ExecutorError {
  constructor(
    message: string,
    public readonly timeoutMs: number,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    Object.setPrototypeOf(this, ExecutorTimeoutError.prototype);
  }
}

const DEFAULT_TIMEOUT_MS = 3_600_000; // 60 minutes

export interface RunClaudeOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly autonomy?: Autonomy;
}

/**
 * Run the Claude Code CLI and return its result.
 *
 * The prompt is supplied via stdin so the CLI runs non-interactively.
 *
 * @param prompt - prompt string passed to the Claude Code CLI
 * @param options - optional cwd, timeoutMs, autonomy
 * @returns ProcessResult (success, stdout, stderr)
 * @throws ExecutorError - on timeout or unexpected execution failures
 */
export async function runClaude(
  prompt: string,
  options?: RunClaudeOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const autonomy = options?.autonomy ?? Autonomy.INTERACTIVE;
  const autonomyFlags = resolveClaudeAutonomyFlags(autonomy);
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
      throw new ExecutorTimeoutError(
        `Claude Code CLI timed out after ${timeoutMs}ms`,
        timeoutMs,
        error.stdout,
        error.stderr,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new ExecutorError(error.message);
    }
    throw error;
  }
}

/**
 * Resolve Claude Code CLI flags from an autonomy level.
 *
 * - full        -> --dangerously-skip-permissions
 * - auto        -> --permission-mode auto
 * - sandboxed   -> no flags (Claude Code does not support it; reserved for future non-Claude CLIs)
 * - interactive -> no flags
 */
export function resolveClaudeAutonomyFlags(autonomy: Autonomy): readonly string[] {
  switch (autonomy) {
    case Autonomy.FULL:
      return ["--dangerously-skip-permissions"];
    case Autonomy.AUTO:
      return ["--permission-mode", "auto"];
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

export type AutonomyLogLevel = "info" | "warn";

export interface AutonomyLogMessage {
  readonly level: AutonomyLogLevel;
  readonly message: string;
}

/**
 * Return the startup log entry (if any) for a given autonomy level.
 *
 * Emitted once at config load so operators can see the mode the worker
 * is running in. Null means no log should be emitted for that level.
 */
export function resolveAutonomyLogMessage(
  autonomy: Autonomy,
): AutonomyLogMessage | null {
  switch (autonomy) {
    case Autonomy.FULL:
      return {
        level: "warn",
        message:
          "autonomy is set to 'full'. Claude Code CLI will run with --dangerously-skip-permissions.",
      };
    case Autonomy.AUTO:
      return {
        level: "info",
        message:
          "autonomy is set to 'auto'. Claude Code CLI will run with --permission-mode auto.",
      };
    case Autonomy.SANDBOXED:
      return {
        level: "warn",
        message:
          "Claude Code does not support 'sandboxed' autonomy; falling back to 'interactive'",
      };
    case Autonomy.INTERACTIVE:
      return null;
    default: {
      const _exhaustive: never = autonomy;
      throw new Error(`Unknown autonomy level: ${_exhaustive}`);
    }
  }
}
