import fs from "fs";
import path from "path";
import {
  PACKAGE_ROOT,
  PLIST_TEMPLATE_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
  getConfigPath,
  getLogsDir,
  getBaseDir,
  getPlistGeneratedPath,
} from "../utils/paths.js";
import { exec, commandExists, ShellError } from "../utils/shell.js";
import { renderPlist } from "../utils/plist.js";
import { setLanguage, t, loadLanguageFromConfig } from "../i18n/index.js";
import { loadConfig, ConfigValidationError } from "../worker/config.js";
import {
  isCronCompatibleInterval,
  intervalToCronExpression,
  buildCronEntry,
  installCronEntry,
  CRON_COMPATIBLE_INTERVALS,
} from "../utils/cron.js";

export type SchedulerType = "launchd" | "cron";

const STANDARD_PATHS = ["/usr/local/bin", "/usr/bin", "/bin"];
const REQUIRED_COMMANDS = ["node", "git", "gh", "claude"];

export function buildMinimalPath(): string {
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

export function getDefaultScheduler(): SchedulerType {
  return process.platform === "darwin" ? "launchd" : "cron";
}

export async function installCommand(
  options: { local?: boolean; scheduler?: SchedulerType } = {},
): Promise<void> {
  setLanguage(loadLanguageFromConfig(getConfigPath()));

  const scheduler = options.scheduler ?? getDefaultScheduler();

  // Validate scheduler for platform
  if (scheduler === "launchd" && process.platform !== "darwin") {
    console.error(t("install.launchdNotAvailable"));
    return;
  }

  // 1. config.yml check
  if (!fs.existsSync(getConfigPath())) {
    console.error(t("install.configNotFound"));
    console.error(
      t("install.runInitFirst"),
    );
    return;
  }

  // 2. Command existence check and command construction
  let commandArgs: readonly string[];

  if (options.local) {
    if (!commandExists("node")) {
      console.error(
        t("install.nodeNotFound"),
      );
      return;
    }
    const nodePath = resolveCommandPath("node", "node");
    if (!nodePath) return;
    commandArgs = [nodePath, path.join(PACKAGE_ROOT, "dist", "worker.js")];
  } else {
    if (!commandExists("npx")) {
      console.error(
        t("install.npxNotFound"),
      );
      return;
    }
    const npxPath = resolveCommandPath("npx", "npx");
    if (!npxPath) return;
    commandArgs = [npxPath, "sabori-flow", "worker"];
  }

  try {
    // 3. Load config.yml to get interval_minutes
    const config = loadConfig(getConfigPath());
    const intervalMinutes = config.execution.intervalMinutes;

    // 4. Create logs directory
    const logDir = getLogsDir();
    fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

    if (scheduler === "cron") {
      await installWithCron({
        commandArgs,
        intervalMinutes,
        logDir,
        local: options.local,
      });
    } else {
      await installWithLaunchd({
        programArguments: commandArgs,
        intervalMinutes,
        logDir,
        local: options.local,
      });
    }
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(t("install.configValidationError", { message: error.message }));
    } else if (error instanceof ShellError) {
      console.error(`Error: ${error.message}`);
      if (error.stderr) console.error(error.stderr);
    } else {
      console.error(t("install.unexpectedError"), error);
    }
    return;
  }
}

async function installWithLaunchd(params: {
  programArguments: readonly string[];
  intervalMinutes: number;
  logDir: string;
  local?: boolean;
}): Promise<void> {
  const { programArguments, intervalMinutes, logDir } = params;
  const startInterval = intervalMinutes * 60;

  // Generate plist
  console.log(t("install.generatingPlist"));
  fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
  const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
  const plist = renderPlist(template, {
    programArguments,
    path: buildMinimalPath(),
    logDir,
    startInterval,
  });
  fs.writeFileSync(getPlistGeneratedPath(), plist, { encoding: "utf-8", mode: 0o600 });

  // Register with launchd
  console.log(t("install.registeringLaunchd"));
  fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
  fs.copyFileSync(getPlistGeneratedPath(), PLIST_DEST_PATH);
  fs.chmodSync(PLIST_DEST_PATH, 0o600);
  exec("launchctl", ["load", PLIST_DEST_PATH]);

  if (params.local) {
    console.log(
      t("install.localComplete", { minutes: String(intervalMinutes) }),
    );
  } else {
    console.log(
      t("install.complete", { minutes: String(intervalMinutes) }),
    );
  }
}

async function installWithCron(params: {
  commandArgs: readonly string[];
  intervalMinutes: number;
  logDir: string;
  local?: boolean;
}): Promise<void> {
  const { commandArgs, intervalMinutes, logDir } = params;

  // Check crontab command exists
  if (!commandExists("crontab")) {
    console.error(t("install.crontabNotFound"));
    return;
  }

  // Show macOS warning
  if (process.platform === "darwin") {
    console.log(t("install.cronMacosWarning"));
  }

  // Validate interval compatibility
  if (!isCronCompatibleInterval(intervalMinutes)) {
    console.error(
      t("install.cronIncompatibleInterval", {
        minutes: String(intervalMinutes),
        validValues: CRON_COMPATIBLE_INTERVALS.join(", "),
      }),
    );
    return;
  }

  const cronExpression = intervalToCronExpression(intervalMinutes);
  const envPath = buildMinimalPath();
  const command = commandArgs.join(" ");
  const stdoutLog = path.join(logDir, "worker-stdout.log");
  const stderrLog = path.join(logDir, "worker-stderr.log");

  const entry = buildCronEntry({
    cronExpression,
    command,
    envPath,
    stdoutLog,
    stderrLog,
  });

  // Register with crontab
  console.log(t("install.registeringCron"));
  fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
  installCronEntry(entry);

  if (params.local) {
    console.log(
      t("install.cronLocalComplete", { minutes: String(intervalMinutes) }),
    );
  } else {
    console.log(
      t("install.cronComplete", { minutes: String(intervalMinutes) }),
    );
  }
}
