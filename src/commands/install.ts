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
import {
  createScheduler,
  UnsupportedPlatformError,
  SystemdNotAvailableError,
} from "../scheduler/index.js";

const SECONDS_PER_MINUTE = 60;
const STANDARD_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"];
const REQUIRED_COMMANDS = ["node", "git", "gh", "claude"];

function buildMinimalPath(): string {
  const dirs = new Set<string>(STANDARD_PATHS);
  for (const cmd of REQUIRED_COMMANDS) {
    try {
      const cmdPath = exec("which", [cmd]);
      if (cmdPath && cmdPath.startsWith("/")) {
        dirs.add(path.dirname(cmdPath));
      }
    } catch {
      // skip if command not found
    }
  }
  return [...dirs].join(":");
}

function resolveCommandPath(command: string, label: string): string | null {
  const resolved = exec("which", [command]);
  if (!resolved || !resolved.startsWith("/")) {
    console.error(
      t("install.pathResolveFailed", { label }),
    );
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
    console.error(
      t("install.runInitFirst"),
    );
    return;
  }

  // 2. Command existence check and programArguments construction
  let programArguments: readonly string[];

  if (options.local) {
    if (!commandExists("node")) {
      console.error(
        t("install.nodeNotFound"),
      );
      return;
    }
    const nodePath = resolveCommandPath("node", "node");
    if (!nodePath) return;
    programArguments = [nodePath, path.join(PACKAGE_ROOT, "dist", "worker.js")];
  } else {
    if (!commandExists("npx")) {
      console.error(
        t("install.npxNotFound"),
      );
      return;
    }
    const npxPath = resolveCommandPath("npx", "npx");
    if (!npxPath) return;
    programArguments = [npxPath, "sabori-flow", "worker"];
  }

  try {
    // 3. Create scheduler instance
    const scheduler = createScheduler();

    // 4. Load config and get interval_minutes
    const config = loadConfig(getConfigPath());
    const intervalMinutes = config.execution.intervalMinutes;
    const intervalSeconds = intervalMinutes * SECONDS_PER_MINUTE;

    // 5. Create logs directory
    const logDir = getLogsDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    // 6. Generate configuration and register
    console.log(t("install.generatingConfig", { scheduler: scheduler.name }));
    console.log(t("install.registeringScheduler", { scheduler: scheduler.name }));

    scheduler.install({
      intervalSeconds,
      programArguments,
      path: buildMinimalPath(),
      logDir,
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
      console.error(`Error: ${error.message}`);
    } else if (error instanceof SystemdNotAvailableError) {
      console.error(`Error: ${error.message}`);
    } else if (error instanceof ShellError) {
      console.error(`Error: ${error.message}`);
      if (error.stderr) console.error(error.stderr);
    } else {
      console.error(t("install.unexpectedError"), error);
    }
    return;
  }
}
