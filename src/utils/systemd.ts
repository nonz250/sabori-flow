export interface SystemdPlaceholders {
  programArguments: readonly string[];
  path: string;
  logDir: string;
  intervalSeconds: number;
}

const CONTROL_CHAR_PATTERN = /[\x00-\x1f\x7f]/;
const SYSTEMD_SPECIAL_PATTERN = /[%$\\;]/;

function validateValue(value: string, label: string): void {
  if (CONTROL_CHAR_PATTERN.test(value)) {
    throw new Error(
      `Invalid characters in ${label}: control characters are not allowed`,
    );
  }
}

function validateExecStartArg(value: string, label: string): void {
  validateValue(value, label);
  if (SYSTEMD_SPECIAL_PATTERN.test(value)) {
    throw new Error(
      `Invalid characters in ${label}: systemd special characters (%, $, \\, ;) are not allowed`,
    );
  }
}

function quoteIfNeeded(arg: string): string {
  if (/[\s"]/.test(arg)) {
    return `"${arg.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return arg;
}

function buildExecStart(args: readonly string[]): string {
  for (const arg of args) {
    validateExecStartArg(arg, "programArguments");
  }
  return args.map(quoteIfNeeded).join(" ");
}

export function renderServiceUnit(
  template: string,
  placeholders: SystemdPlaceholders,
): string {
  const execStart = buildExecStart(placeholders.programArguments);
  validateValue(placeholders.path, "path");
  validateValue(placeholders.logDir, "logDir");

  return template
    .replace(/__EXEC_START__/g, () => execStart)
    .replace(/__PATH__/g, () => placeholders.path)
    .replace(/__LOG_DIR__/g, () => placeholders.logDir);
}

export function renderTimerUnit(
  template: string,
  placeholders: SystemdPlaceholders,
): string {
  const intervalSec = String(placeholders.intervalSeconds);
  return template
    .replace(/__ON_BOOT_SEC__/g, () => `${intervalSec}s`)
    .replace(/__ON_UNIT_ACTIVE_SEC__/g, () => `${intervalSec}s`);
}
