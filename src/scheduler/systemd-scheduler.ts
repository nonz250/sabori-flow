import fs from "fs";
import path from "path";
import { homedir } from "node:os";
import type { Scheduler, SchedulerInstallOptions } from "./types.js";
import {
  SYSTEMD_SERVICE_TEMPLATE_PATH,
  SYSTEMD_TIMER_TEMPLATE_PATH,
} from "../utils/paths.js";
import { renderServiceUnit, renderTimerUnit } from "../utils/systemd.js";
import { exec } from "../utils/shell.js";

const SERVICE_NAME = "sabori-flow.service";
const TIMER_NAME = "sabori-flow.timer";

const SYSTEMD_USER_DIR = path.join(
  homedir(),
  ".config",
  "systemd",
  "user",
);

export class SystemdScheduler implements Scheduler {
  readonly name = "systemd";

  install(options: SchedulerInstallOptions): void {
    // Ensure systemd user directory exists
    fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true, mode: 0o700 });

    const placeholders = {
      programArguments: options.programArguments,
      path: options.path,
      logDir: options.logDir,
      intervalSeconds: options.intervalSeconds,
    };

    // Render and write service unit
    const serviceTemplate = fs.readFileSync(SYSTEMD_SERVICE_TEMPLATE_PATH, "utf-8");
    const serviceContent = renderServiceUnit(serviceTemplate, placeholders);
    const servicePath = path.join(SYSTEMD_USER_DIR, SERVICE_NAME);
    fs.writeFileSync(servicePath, serviceContent, {
      encoding: "utf-8",
      mode: 0o644,
    });

    // Render and write timer unit
    const timerTemplate = fs.readFileSync(SYSTEMD_TIMER_TEMPLATE_PATH, "utf-8");
    const timerContent = renderTimerUnit(timerTemplate, placeholders);
    const timerPath = path.join(SYSTEMD_USER_DIR, TIMER_NAME);
    fs.writeFileSync(timerPath, timerContent, {
      encoding: "utf-8",
      mode: 0o644,
    });

    // Reload systemd and enable timer
    exec("systemctl", ["--user", "daemon-reload"]);
    exec("systemctl", ["--user", "enable", "--now", TIMER_NAME]);
  }

  uninstall(): void {
    const timerPath = path.join(SYSTEMD_USER_DIR, TIMER_NAME);
    const servicePath = path.join(SYSTEMD_USER_DIR, SERVICE_NAME);

    if (this.isInstalled()) {
      try {
        exec("systemctl", ["--user", "stop", TIMER_NAME]);
      } catch {
        // stop failure is ignored
      }
      try {
        exec("systemctl", ["--user", "disable", TIMER_NAME]);
      } catch {
        // disable failure is ignored
      }
    }

    // Remove unit files
    if (fs.existsSync(timerPath)) {
      fs.unlinkSync(timerPath);
    }
    if (fs.existsSync(servicePath)) {
      fs.unlinkSync(servicePath);
    }

    // Reload daemon to pick up removal
    try {
      exec("systemctl", ["--user", "daemon-reload"]);
    } catch {
      // daemon-reload failure is ignored during uninstall
    }
  }

  isInstalled(): boolean {
    const timerPath = path.join(SYSTEMD_USER_DIR, TIMER_NAME);
    return fs.existsSync(timerPath);
  }
}
