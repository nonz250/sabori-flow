import fs from "fs";
import type { Scheduler, SchedulerConfig } from "./scheduler.js";
import { exec, ShellError } from "../utils/shell.js";

const TASK_NAME = "sabori-flow";
const SCHTASKS = "schtasks.exe";

export class WindowsScheduler implements Scheduler {
  install(config: SchedulerConfig): void {
    // Build the command string: first element is the executable, rest are arguments.
    // Quote elements that contain spaces to handle paths like "C:\Program Files\...".
    const [command, ...args] = config.programArguments;
    const quotedCommand = command.includes(" ") ? `"${command}"` : command;
    const quotedArgs = args.map(a => a.includes(" ") ? `"${a}"` : a);
    const taskRun = [quotedCommand, ...quotedArgs].join(" ");

    // Create logs directory
    fs.mkdirSync(config.logDir, { recursive: true });

    // Remove existing task if present (ignore errors)
    if (this.isInstalled()) {
      try {
        exec(SCHTASKS, ["/Delete", "/TN", TASK_NAME, "/F"]);
      } catch {
        // Deletion failure is non-critical
      }
    }

    // Register with Windows Task Scheduler
    // /SC MINUTE /MO N = run every N minutes
    const schtasksArgs = [
      "/Create",
      "/TN", TASK_NAME,
      "/TR", taskRun,
      "/SC", "MINUTE",
      "/MO", String(config.intervalMinutes),
      "/F",
    ];

    exec(SCHTASKS, schtasksArgs);
  }

  uninstall(): void {
    if (this.isInstalled()) {
      exec(SCHTASKS, ["/Delete", "/TN", TASK_NAME, "/F"]);
    }
  }

  isInstalled(): boolean {
    try {
      exec(SCHTASKS, ["/Query", "/TN", TASK_NAME]);
      return true;
    } catch (error: unknown) {
      if (error instanceof ShellError) {
        return false;
      }
      throw error;
    }
  }
}
