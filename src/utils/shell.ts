import { execFileSync } from "node:child_process";
import { PROJECT_ROOT } from "./paths.js";

export class ShellError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "ShellError";
    Object.setPrototypeOf(this, ShellError.prototype);
  }
}

export function exec(
  file: string,
  args: readonly string[],
  options?: { cwd?: string },
): string {
  try {
    return execFileSync(file, [...args], {
      cwd: options?.cwd ?? PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error: unknown) {
    const e = error as { stderr?: string; message?: string };
    throw new ShellError(
      `コマンドの実行に失敗しました: ${file} ${args.join(" ")}`,
      (e.stderr as string) || e.message || "",
    );
  }
}

export function commandExists(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
