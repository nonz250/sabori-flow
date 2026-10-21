import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { ProcessResult, RunCommandOptions } from "./process.js";
import { Autonomy, Agent } from "./models.js";
import { agentDisplayName } from "./agent-fallback.js";

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
const BG_WAIT_CEILING_MS = 3_600_000; // 60 minutes

export interface RunAgentOptions {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly autonomy?: Autonomy;
  readonly authToken?: string;
  readonly continueSession?: boolean;
}

/**
 * Run the Claude Code CLI and return its result.
 *
 * The prompt is supplied via stdin so the CLI runs non-interactively.
 *
 * @param prompt - prompt string passed to the Claude Code CLI
 * @param options - optional cwd, timeoutMs, autonomy, authToken
 * @returns ProcessResult (success, stdout, stderr)
 * @throws ExecutorError - on timeout or unexpected execution failures
 */
export async function runClaude(
  prompt: string,
  options?: RunAgentOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const autonomy = options?.autonomy ?? Autonomy.INTERACTIVE;
  const autonomyFlags = resolveClaudeAutonomyFlags(autonomy);
  const args = ["-p", ...(options?.continueSession ? ["--continue"] : []), ...autonomyFlags];

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // The CLI force-terminates still-running background tasks after this idle
    // window and exits 0, so the worker sees a successful run with no PR.
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(BG_WAIT_CEILING_MS),
  };
  if (options?.authToken) {
    // Scope the dedicated long-lived token to the claude child only. It avoids
    // 401s from credentials.json refresh-rotation races during unattended runs,
    // and keeps the secret out of the gh/git children the worker also spawns.
    env.CLAUDE_CODE_OAUTH_TOKEN = options.authToken;
  }

  const runOptions: RunCommandOptions = {
    input: prompt,
    cwd: options?.cwd,
    timeoutMs,
    env,
  };

  try {
    return await runCommand("claude", args, runOptions);
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
 * - interactive -> no flags
 */
export function resolveClaudeAutonomyFlags(autonomy: Autonomy): readonly string[] {
  switch (autonomy) {
    case Autonomy.FULL:
      return ["--dangerously-skip-permissions"];
    case Autonomy.AUTO:
      return ["--permission-mode", "auto"];
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

const AUTONOMY_FLAG_RESOLVERS: Readonly<
  Record<Agent, (autonomy: Autonomy) => readonly string[]>
> = {
  [Agent.CLAUDE]: resolveClaudeAutonomyFlags,
  [Agent.CODEX]: resolveCodexAutonomyFlags,
};

/**
 * Return the startup log entry (if any) for a given autonomy level and agent.
 *
 * Emitted once per configured agent at config load so operators can see the
 * flags each agent runs with. The flags come from the same resolvers that
 * build the argv, so the log cannot drift from what is actually passed.
 * Null means no log should be emitted.
 */
export function resolveAutonomyLogMessage(
  autonomy: Autonomy,
  agent: Agent,
): AutonomyLogMessage | null {
  const level = resolveAutonomyLogLevel(autonomy);
  if (level === null) {
    return null;
  }
  const flags = AUTONOMY_FLAG_RESOLVERS[agent](autonomy).join(" ");
  return {
    level,
    message: `autonomy is set to '${autonomy}'. ${agentDisplayName(agent)} will run with ${flags}.`,
  };
}

function resolveAutonomyLogLevel(autonomy: Autonomy): AutonomyLogLevel | null {
  switch (autonomy) {
    case Autonomy.FULL:
      return "warn";
    case Autonomy.AUTO:
      return "info";
    case Autonomy.INTERACTIVE:
      return null;
    default: {
      const _exhaustive: never = autonomy;
      throw new Error(`Unknown autonomy level: ${_exhaustive}`);
    }
  }
}

/**
 * OpenAI Codex CLI を実行し、結果を返す。
 *
 * プロンプトは `-` を指定して stdin から渡す。これにより長い Issue 本文や
 * シークレットを含み得るプロンプトがプロセス一覧へ露出しない。
 */
export async function runCodex(
  prompt: string,
  options?: RunAgentOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const autonomy = options?.autonomy ?? Autonomy.INTERACTIVE;
  const autonomyFlags = resolveCodexAutonomyFlags(autonomy);
  // Flags go before `resume`: `codex exec resume` does not accept --sandbox or
  // --approve-for-me, while `codex exec` applies its own flags to the resumed run.
  // Without them the resumed run falls back to approval "never" and loses the reviewer.
  const args = options?.continueSession
    ? ["exec", ...autonomyFlags, "resume", "--last", "-"]
    : ["exec", ...autonomyFlags, "-"];

  try {
    return await runCommand(
      "codex",
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
        `Codex CLI timed out after ${timeoutMs}ms`,
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
 * Autonomy レベルから Codex CLI のフラグを解決する。
 *
 * - full: --yolo (no sandbox, no approvals)
 * - auto: --approve-for-me (workspace-write sandbox, approval requests go to automatic review)
 * - interactive: no flags (use Codex configuration defaults)
 */
export function resolveCodexAutonomyFlags(autonomy: Autonomy): readonly string[] {
  switch (autonomy) {
    case Autonomy.FULL:
      return ["--yolo"];
    case Autonomy.AUTO:
      return ["--approve-for-me"];
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
