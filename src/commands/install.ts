import fs from "fs";
import path from "path";
import {
  PACKAGE_ROOT,
  getConfigPath,
  getLogsDir,
} from "../utils/paths.js";
import { exec, commandExists, ShellError } from "../utils/shell.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { loadConfig, ConfigValidationError } from "../worker/config.js";
import { createScheduler, UnsupportedPlatformError } from "../scheduler/index.js";

const REQUIRED_COMMANDS = ["node", "git", "gh", "claude"];

function buildMinimalPath(): string {
  const isWindows = process.platform === "win32";
  const defaultPaths = isWindows
    ? ["C:\\Windows\\System32", "C:\\Windows"]
    : ["/usr/local/bin", "/usr/bin", "/bin"];
  const separator = isWindows ? ";" : ":";

  const dirs = new Set<string>(defaultPaths);
  for (const cmd of REQUIRED_COMMANDS) {
    try {
      const cmdPath = resolveCommandPathSilent(cmd);
      if (cmdPath) {
        dirs.add(path.dirname(cmdPath));
      }
    } catch {
      // Command not found — skip
    }
  }
  return [...dirs].join(separator);
}

function resolveCommandPathSilent(command: string): string | null {
  try {
    const resolved = exec(
      process.platform === "win32" ? "where.exe" : "which",
      [command],
    );
    if (!resolved) return null;
    // On Windows, `where.exe` may return multiple lines; take the first
    const firstLine = resolved.split(/\r?\n/)[0].trim();
    if (!firstLine) return null;
    // On Unix, require absolute path
    if (process.platform !== "win32" && !firstLine.startsWith("/")) return null;
    return firstLine;
  } catch {
    return null;
  }
}

function resolveCommandPath(command: string, label: string): string | null {
  const resolved = resolveCommandPathSilent(command);
  if (!resolved) {
    console.error(t("install.pathResolveFailed", { label }));
    return null;
  }
  return resolved;
}

export async function installCommand(
  options: { local?: boolean } = {},
): Promise<void> {
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  // 1. config.yml check
  if (!fs.existsSync(getConfigPath())) {
    console.error(t("install.configNotFound"));
    console.error(t("install.runInitFirst"));
    return;
  }

  // 2. Command existence check and programArguments construction
  let programArguments: readonly string[];

  if (options.local) {
    if (!commandExists("node")) {
      console.error(t("install.nodeNotFound"));
      return;
    }
    const nodePath = resolveCommandPath("node", "node");
    if (!nodePath) return;
    programArguments = [nodePath, path.join(PACKAGE_ROOT, "dist", "worker.js")];
  } else {
    if (!commandExists("npx")) {
      console.error(t("install.npxNotFound"));
      return;
    }
    const npxPath = resolveCommandPath("npx", "npx");
    if (!npxPath) return;
    programArguments = [npxPath, "sabori-flow", "worker"];
  }

  try {
    // 3. Load config.yml for interval_minutes
    const config = loadConfig(getConfigPath());
    const intervalMinutes = config.execution.intervalMinutes;

    // 4. Create logs directory
    const logDir = getLogsDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    // 5. Create scheduler and install
    const scheduler = createScheduler();
    console.log(t("install.registeringScheduler"));
    scheduler.install({
      programArguments,
      intervalMinutes,
      logDir,
      env: { PATH: buildMinimalPath() },
    });

    if (options.local) {
      console.log(
        t("install.localComplete", { minutes: String(intervalMinutes) }),
      );
    } else {
      console.log(
        t("install.complete", { minutes: String(intervalMinutes) }),
      );
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(t("install.configValidationError", { message: error.message }));
    } else if (error instanceof UnsupportedPlatformError) {
      console.error(t("install.unsupportedPlatform", { message: error.message }));
    } else if (error instanceof ShellError) {
      console.error(`Error: ${error.message}`);
      if (error.stderr) console.error(error.stderr);
    } else {
      console.error(t("install.unexpectedError"), error);
    }
    return;
  }
}
