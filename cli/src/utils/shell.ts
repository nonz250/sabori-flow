import { execSync } from "child_process";
import { PROJECT_ROOT } from "./paths";

export class ShellError extends Error {
  constructor(
    message: string,
    public readonly stderr: string,
  ) {
    super(message);
    this.name = "ShellError";
  }
}

export function exec(command: string, options?: { cwd?: string }): string {
  try {
    return execSync(command, {
      cwd: options?.cwd ?? PROJECT_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error: unknown) {
    const e = error as { stderr?: string; message?: string };
    throw new ShellError(
      `コマンドの実行に失敗しました: ${command}`,
      (e.stderr as string) || e.message || "",
    );
  }
}

export function commandExists(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
