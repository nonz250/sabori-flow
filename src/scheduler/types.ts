export interface SchedulerInstallOptions {
  readonly intervalSeconds: number;
  readonly programArguments: readonly string[];
  readonly path: string;
  readonly logDir: string;
}

export interface Scheduler {
  readonly name: string;
  install(options: SchedulerInstallOptions): void;
  uninstall(): void;
  isInstalled(): boolean;
}
