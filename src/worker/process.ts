import { spawn, execFileSync } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10MB
const SIGKILL_DELAY_MS = 5_000;

export class ProcessTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(`Process timed out after ${timeoutMs}ms`);
    Object.setPrototypeOf(this, ProcessTimeoutError.prototype);
  }
}

export class ProcessExecutionError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ProcessExecutionError.prototype);
  }
}

export interface ProcessResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface RunCommandOptions {
  cwd?: string;
  input?: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

export async function runCommand(
  file: string,
  args: readonly string[],
  options?: RunCommandOptions,
): Promise<ProcessResult> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;

  return new Promise<ProcessResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(file, args, {
        cwd: options?.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        detached: true,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to spawn process";
      reject(new ProcessExecutionError(message));
      return;
    }

    let stdout = "";
    let stderr = "";
    let killed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const timeoutTimer = setTimeout(() => {
      killed = true;
      if (child.pid !== undefined) {
        const pgid = -child.pid;
        try {
          process.kill(pgid, "SIGTERM");
        } catch (error: unknown) {
          const detail =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `[process] WARNING: Failed to send SIGTERM to process group ${pgid}: ${detail}`,
          );
        }
        killTimer = setTimeout(() => {
          try {
            process.kill(pgid, "SIGKILL");
          } catch (error: unknown) {
            const detail =
              error instanceof Error ? error.message : String(error);
            console.warn(
              `[process] WARNING: Failed to send SIGKILL to process group ${pgid}: ${detail}`,
            );
          }
        }, SIGKILL_DELAY_MS);
      }
    }, timeoutMs);

    child.stdout!.on("data", (chunk: Buffer) => {
      if (stdout.length < maxBuffer) {
        stdout += chunk.toString();
        if (stdout.length > maxBuffer) {
          stdout = stdout.slice(0, maxBuffer);
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      if (stderr.length < maxBuffer) {
        stderr += chunk.toString();
        if (stderr.length > maxBuffer) {
          stderr = stderr.slice(0, maxBuffer);
        }
      }
    });

    child.on("error", (error: Error) => {
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      reject(new ProcessExecutionError(error.message));
    });

    child.on("close", (code: number | null) => {
      clearTimeout(timeoutTimer);
      if (killTimer !== undefined) {
        clearTimeout(killTimer);
      }
      if (killed) {
        reject(new ProcessTimeoutError(timeoutMs, stdout, stderr));
        return;
      }
      resolve({
        success: code === 0,
        stdout,
        stderr,
        exitCode: code,
      });
    });

    if (options?.input !== undefined) {
      child.stdin!.write(options.input);
      child.stdin!.end();
    } else {
      child.stdin!.end();
    }
  });
}

export function runCommandSync(
  file: string,
  args: readonly string[],
  options?: { cwd?: string; timeoutMs?: number },
): string {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
  try {
    const result = execFileSync(file, [...args], {
      cwd: options?.cwd,
      timeout: timeoutMs,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Command execution failed";
    throw new ProcessExecutionError(message);
  }
}
