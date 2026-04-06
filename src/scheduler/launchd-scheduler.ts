import fs from "fs";
import type { Scheduler, SchedulerInstallOptions } from "./types.js";
import {
  PLIST_TEMPLATE_PATH,
  PLIST_DEST_DIR,
  PLIST_DEST_PATH,
  getBaseDir,
  getPlistGeneratedPath,
} from "../utils/paths.js";
import { renderPlist } from "../utils/plist.js";
import { exec } from "../utils/shell.js";

export class LaunchdScheduler implements Scheduler {
  readonly name = "launchd";

  install(options: SchedulerInstallOptions): void {
    // Generate plist from template
    fs.mkdirSync(getBaseDir(), { recursive: true, mode: 0o700 });
    const template = fs.readFileSync(PLIST_TEMPLATE_PATH, "utf-8");
    const plist = renderPlist(template, {
      programArguments: options.programArguments,
      path: options.path,
      logDir: options.logDir,
      startInterval: options.intervalSeconds,
    });
    fs.writeFileSync(getPlistGeneratedPath(), plist, {
      encoding: "utf-8",
      mode: 0o600,
    });

    // Register with launchd
    fs.mkdirSync(PLIST_DEST_DIR, { recursive: true });
    fs.copyFileSync(getPlistGeneratedPath(), PLIST_DEST_PATH);
    fs.chmodSync(PLIST_DEST_PATH, 0o600);
    exec("launchctl", ["load", PLIST_DEST_PATH]);
  }

  uninstall(): void {
    if (this.isInstalled()) {
      try {
        exec("launchctl", ["unload", PLIST_DEST_PATH]);
      } catch {
        // unload failure is ignored
      }
      fs.unlinkSync(PLIST_DEST_PATH);
    }

    // Delete generated plist backup
    const generatedPlist = getPlistGeneratedPath();
    if (fs.existsSync(generatedPlist)) {
      fs.unlinkSync(generatedPlist);
    }
  }

  isInstalled(): boolean {
    return fs.existsSync(PLIST_DEST_PATH);
  }
}
