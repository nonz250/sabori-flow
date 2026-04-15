import { execFileSync } from "node:child_process";
import { ShellError } from "./shell.js";

const CRON_MARKER_BEGIN = "# BEGIN sabori-flow";
const CRON_MARKER_END = "# END sabori-flow";

/**
 * Interval values (in minutes) that can be exactly represented as cron expressions.
 * - Divisors of 60: step-based minute expressions (e.g., *\/10 * * * *)
 * - Multiples of 60 up to 1440: hourly step expressions (e.g., 0 *\/2 * * *)
 */
const CRON_COMPATIBLE_MINUTE_DIVISORS = [10, 12, 15, 20, 30, 60] as const;
const CRON_COMPATIBLE_HOUR_MULTIPLES = [120, 180, 240, 300, 360, 480, 720, 1440] as const;

export const CRON_COMPATIBLE_INTERVALS: readonly number[] = [
  ...CRON_COMPATIBLE_MINUTE_DIVISORS,
  ...CRON_COMPATIBLE_HOUR_MULTIPLES,
];

export function isCronCompatibleInterval(minutes: number): boolean {
  return (
    (CRON_COMPATIBLE_MINUTE_DIVISORS as readonly number[]).includes(minutes) ||
    (CRON_COMPATIBLE_HOUR_MULTIPLES as readonly number[]).includes(minutes)
  );
}

export function intervalToCronExpression(minutes: number): string {
  if (!isCronCompatibleInterval(minutes)) {
    const allValid = [
      ...CRON_COMPATIBLE_MINUTE_DIVISORS,
      ...CRON_COMPATIBLE_HOUR_MULTIPLES,
    ];
    throw new Error(
      `interval_minutes ${minutes} cannot be exactly represented as a cron expression. ` +
      `Valid values: ${allValid.join(", ")}`,
    );
  }

  if (minutes < 60) {
    return `*/${minutes} * * * *`;
  }
  if (minutes === 60) {
    return "0 * * * *";
  }
  const hours = minutes / 60;
  if (minutes === 1440) {
    return "0 0 * * *";
  }
  return `0 */${hours} * * *`;
}

export interface CronEntryParams {
  readonly cronExpression: string;
  readonly command: string;
  readonly envPath: string;
  readonly stdoutLog: string;
  readonly stderrLog: string;
}

const DANGEROUS_CHARS = /[\n\r;|&`$]/;

function validateCronParam(name: string, value: string): void {
  if (DANGEROUS_CHARS.test(value)) {
    throw new Error(
      `Unsafe characters in cron entry parameter "${name}". ` +
      `Newlines and shell metacharacters (;|&\`$) are not allowed.`,
    );
  }
}

export function buildCronEntry(params: CronEntryParams): string {
  validateCronParam("cronExpression", params.cronExpression);
  validateCronParam("command", params.command);
  validateCronParam("envPath", params.envPath);
  validateCronParam("stdoutLog", params.stdoutLog);
  validateCronParam("stderrLog", params.stderrLog);

  const lines = [
    CRON_MARKER_BEGIN,
    `PATH=${params.envPath}`,
    `${params.cronExpression} ${params.command} >> ${params.stdoutLog} 2>> ${params.stderrLog}`,
    CRON_MARKER_END,
  ];
  return lines.join("\n");
}

function getCurrentCrontab(): string {
  try {
    return execFileSync("crontab", ["-l"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
  } catch {
    // crontab -l returns exit code 1 when no crontab is set
    return "";
  }
}

function writeCrontab(content: string): void {
  try {
    execFileSync("crontab", ["-"], {
      input: content,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 10_000,
    });
  } catch (error: unknown) {
    const e = error as { stderr?: string; message?: string };
    throw new ShellError(
      "Failed to write crontab",
      (e.stderr as string) || e.message || "",
    );
  }
}

function removeSaboriFlowBlock(crontab: string): string {
  const lines = crontab.split("\n");
  const result: string[] = [];
  let insideBlock = false;

  for (const line of lines) {
    if (line.trim() === CRON_MARKER_BEGIN) {
      insideBlock = true;
      continue;
    }
    if (line.trim() === CRON_MARKER_END) {
      insideBlock = false;
      continue;
    }
    if (!insideBlock) {
      result.push(line);
    }
  }

  return result.join("\n");
}

export function installCronEntry(entry: string): void {
  const current = getCurrentCrontab();
  // Remove any existing sabori-flow block first
  const cleaned = removeSaboriFlowBlock(current);
  // Ensure a trailing newline before appending
  const base = cleaned.trimEnd();
  const newContent = base ? `${base}\n${entry}\n` : `${entry}\n`;
  writeCrontab(newContent);
}

export function uninstallCronEntry(): void {
  const current = getCurrentCrontab();
  const cleaned = removeSaboriFlowBlock(current);
  // If nothing remains (only whitespace), remove crontab entirely
  if (cleaned.trim() === "") {
    try {
      execFileSync("crontab", ["-r"], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 10_000,
      });
    } catch {
      // Ignore errors when removing empty crontab
    }
  } else {
    writeCrontab(cleaned);
  }
}

export function cronEntryExists(): boolean {
  const current = getCurrentCrontab();
  return current.includes(CRON_MARKER_BEGIN) && current.includes(CRON_MARKER_END);
}
