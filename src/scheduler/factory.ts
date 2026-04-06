import type { Scheduler } from "./scheduler.js";
import { LaunchdScheduler } from "./launchd-scheduler.js";
import { WindowsScheduler } from "./windows-scheduler.js";

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(`Unsupported platform: ${platform}. Currently supported: darwin (macOS), win32 (Windows).`);
    this.name = "UnsupportedPlatformError";
    Object.setPrototypeOf(this, UnsupportedPlatformError.prototype);
  }
}

/**
 * Returns the appropriate Scheduler implementation for the current OS.
 * Accepts an optional platform override for testing.
 */
export function createScheduler(platform: string = process.platform): Scheduler {
  switch (platform) {
    case "darwin":
      return new LaunchdScheduler();
    case "win32":
      return new WindowsScheduler();
    default:
      throw new UnsupportedPlatformError(platform);
  }
}
