import fs from "fs";
import path from "path";
import { homedir } from "node:os";
import type { Scheduler, SchedulerConfig } from "./scheduler.js";
import { exec } from "../utils/shell.js";
import { renderPlist } from "../utils/plist.js";
import { getBaseDir, PLIST_TEMPLATE_PATH } from "../utils/paths.js";

const PLIST_LABEL = "com.github.sabori-flow";

function getPlistDestDir(): string {
  return path.join(homedir(), "Library", "LaunchAgents");
}

function getPlistDestPath(): string {
  return path.join(getPlistDestDir(), `${PLIST_LABEL}.plist`);
}

function getPlistGeneratedPath(): string {
  return path.join(getBaseDir(), `${PLIST_LABEL}.plist`);
}

export class LaunchdScheduler implements Scheduler {
  install(config: SchedulerConfig): void {
    const SECONDS_PER_MINUTE = 60;
    const startInterval = config.intervalMinutes * SECONDS_PER_MINUTE;

    // Generate plist from template
    fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const plist = renderPlist(template, {
      programArguments: config.programArguments,
      path: config.env["PATH"] ?? "",
      logDir: config.logDir,
      startInterval,
    });
    fs.writeFileSync(getPlistGeneratedPath(), plist, {
      encoding: "utf-8",
      mode: 0o600,
    });

    // Register with launchd
    fs.mkdirSync(getPlistDestDir(), { recursive: true });
    fs.copyFileSync(getPlistGeneratedPath(), getPlistDestPath());
    fs.chmodSync(getPlistDestPath(), 0o600);
    exec("launchctl", ["load", getPlistDestPath()]);
  }

  uninstall(): void {
    if (fs.existsSync(getPlistDestPath())) {
      try {
        exec("launchctl", ["unload", getPlistDestPath()]);
      } catch {
        // unload failure is non-critical
      }
      fs.unlinkSync(getPlistDestPath());
    }

    // Remove generated plist
    const generatedPlist = getPlistGeneratedPath();
    if (fs.existsSync(generatedPlist)) {
      fs.unlinkSync(generatedPlist);
    }
  }

  isInstalled(): boolean {
    return fs.existsSync(getPlistDestPath());
  }
}
