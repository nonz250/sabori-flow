import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";

// ---------- Types ----------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

// ---------- Internal state ----------

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_FILE_NAME = "worker.log";
const ROTATED_LOG_PATTERN = /^worker\.log\.(\d{4}-\d{2}-\d{2})$/;
const DEFAULT_RETENTION_DAYS = 7;

interface LoggerConfig {
  minLevel: LogLevel;
  logDir: string | undefined;
  retentionDays: number;
}

let globalConfig: LoggerConfig = {
  minLevel: "info",
  logDir: undefined,
  retentionDays: DEFAULT_RETENTION_DAYS,
};

// ---------- Public API ----------

export function configureLogger(options: {
  minLevel?: LogLevel;
  logDir?: string;
  retentionDays?: number;
}): void {
  globalConfig = {
    minLevel: options.minLevel ?? "info",
    logDir: options.logDir,
    retentionDays: options.retentionDays ?? DEFAULT_RETENTION_DAYS,
  };

  if (globalConfig.logDir) {
    mkdirSync(globalConfig.logDir, { recursive: true, mode: 0o700 });
  }
}

export function createLogger(name: string): Logger {
  const write = (level: LogLevel, message: string, args: unknown[]): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[globalConfig.minLevel]) {
      return;
    }

    const formatted = formatMessage(level, name, message, args);

    // stderr output (stdout is reserved for CLI output)
    console.error(formatted);

    // File output (best-effort)
    if (globalConfig.logDir) {
      try {
        appendFileSync(
          join(globalConfig.logDir, LOG_FILE_NAME),
          formatted + "\n",
        );
      } catch {
        // Ignore file write errors
      }
    }
  };

  return {
    debug: (message, ...args) => write("debug", message, args),
    info: (message, ...args) => write("info", message, args),
    warn: (message, ...args) => write("warn", message, args),
    error: (message, ...args) => write("error", message, args),
  };
}

export function rotateOldLogs(): void {
  if (!globalConfig.logDir) {
    return;
  }

  try {
    const entries = readdirSync(globalConfig.logDir);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - globalConfig.retentionDays);

    for (const entry of entries) {
      const match = ROTATED_LOG_PATTERN.exec(entry);
      if (!match) {
        continue;
      }

      const fileDate = new Date(match[1]);
      if (fileDate < cutoff) {
        try {
          const filePath = join(globalConfig.logDir, entry);
          const stat = lstatSync(filePath);
          if (stat.isSymbolicLink()) {
            console.warn(`[logger] WARNING: Skipping symbolic link: ${entry}`);
            continue;
          }
          unlinkSync(filePath);
        } catch {
          // Ignore delete errors
        }
      }
    }
  } catch {
    // Ignore readdir errors
  }
}

export function resetLoggerForTest(): void {
  globalConfig = {
    minLevel: "info",
    logDir: undefined,
    retentionDays: DEFAULT_RETENTION_DAYS,
  };
}

// ---------- Internal helpers ----------

function formatMessage(
  level: LogLevel,
  name: string,
  message: string,
  args: unknown[],
): string {
  const timestamp = new Date().toISOString();
  const upperLevel = level.toUpperCase();
  const expanded = expandPlaceholders(message, args);
  return `[${timestamp}] ${upperLevel} - [${name}] ${expanded}`;
}

function expandPlaceholders(message: string, args: unknown[]): string {
  let index = 0;
  return message.replace(/%s/g, () => {
    if (index < args.length) {
      return String(args[index++]);
    }
    return "%s";
  });
}
