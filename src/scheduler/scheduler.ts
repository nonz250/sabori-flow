/**
 * Platform-agnostic scheduler interface.
 * Each platform (macOS, Windows, Linux) provides a concrete implementation.
 */
export interface SchedulerConfig {
  /** Command and arguments to execute on schedule */
  readonly programArguments: readonly string[];
  /** Execution interval in minutes */
  readonly intervalMinutes: number;
  /** Directory for log files */
  readonly logDir: string;
  /**
   * Environment variables (e.g. PATH).
   * Note: Not all platforms support custom environment variables for scheduled
   * tasks. For example, Windows Task Scheduler ignores this field.
   */
  readonly env: Record<string, string>;
}

export interface Scheduler {
  /** Register the worker as a scheduled task */
  install(config: SchedulerConfig): void;
  /** Remove the scheduled task */
  uninstall(): void;
  /** Check whether a scheduled task is currently registered */
  isInstalled(): boolean;
}
