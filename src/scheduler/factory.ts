import type { Scheduler } from "./types.js";
import { LaunchdScheduler } from "./launchd-scheduler.js";
import { SystemdScheduler } from "./systemd-scheduler.js";
import { commandExists } from "../utils/shell.js";

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Unsupported platform: ${platform}`);
    this.name = "UnsupportedPlatformError";
    Object.setPrototypeOf(this, UnsupportedPlatformError.prototype);
  }
}

export class SystemdNotAvailableError extends Error {
  constructor() {
    super(
      "systemctl not found. systemd is required for scheduled execution on Linux.",
    );
    this.name = "SystemdNotAvailableError";
    Object.setPrototypeOf(this, SystemdNotAvailableError.prototype);
  }
}

export function createScheduler(
  platform: string = process.platform,
): Scheduler {
  switch (platform) {
    case "darwin":
      return new LaunchdScheduler();
    case "linux":
      if (!commandExists("systemctl")) {
        throw new SystemdNotAvailableError();
      }
      return new SystemdScheduler();
    default:
      throw new UnsupportedPlatformError(platform);
  }
}
