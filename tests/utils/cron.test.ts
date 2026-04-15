import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

const mockExecFileSync = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: (...args: unknown[]) => mockExecFileSync(...args),
}));

vi.mock("../../src/utils/shell.js", () => ({
  ShellError: class ShellError extends Error {
    constructor(
      message: string,
      public readonly stderr: string,
    ) {
      super(message);
      this.name = "ShellError";
    }
  },
}));

import {
  isCronCompatibleInterval,
  intervalToCronExpression,
  buildCronEntry,
  installCronEntry,
  uninstallCronEntry,
  cronEntryExists,
} from "../../src/utils/cron.js";
import type { CronEntryParams } from "../../src/utils/cron.js";

// ---------- Helpers ----------

const CRON_MARKER_BEGIN = "# BEGIN sabori-flow";
const CRON_MARKER_END = "# END sabori-flow";

function makeCronEntryParams(
  overrides?: Partial<CronEntryParams>,
): CronEntryParams {
  return {
    cronExpression: "*/30 * * * *",
    command: "npx sabori-flow worker",
    envPath: "/usr/local/bin:/usr/bin:/bin",
    stdoutLog: "/home/user/.sabori-flow/logs/stdout.log",
    stderrLog: "/home/user/.sabori-flow/logs/stderr.log",
    ...overrides,
  };
}

function buildExistingCrontab(blocks: string[]): string {
  return blocks.join("\n") + "\n";
}

function buildSaboriFlowBlock(entry: string = "*/30 * * * * npx sabori-flow worker >> /tmp/out.log 2>> /tmp/err.log"): string {
  return [
    CRON_MARKER_BEGIN,
    `PATH=/usr/local/bin:/usr/bin:/bin`,
    entry,
    CRON_MARKER_END,
  ].join("\n");
}

// ---------- Tests ----------

describe("isCronCompatibleInterval", () => {
  describe("valid minute divisors", () => {
    const VALID_MINUTE_DIVISORS = [10, 12, 15, 20, 30, 60] as const;

    it.each(VALID_MINUTE_DIVISORS)(
      "returns true for %i minutes",
      (minutes) => {
        expect(isCronCompatibleInterval(minutes)).toBe(true);
      },
    );
  });

  describe("valid hour multiples", () => {
    const VALID_HOUR_MULTIPLES = [120, 180, 240, 300, 360, 480, 720, 1440] as const;

    it.each(VALID_HOUR_MULTIPLES)(
      "returns true for %i minutes",
      (minutes) => {
        expect(isCronCompatibleInterval(minutes)).toBe(true);
      },
    );
  });

  describe("incompatible values", () => {
    const INCOMPATIBLE_VALUES = [5, 7, 45, 90, 100, 1000] as const;

    it.each(INCOMPATIBLE_VALUES)(
      "returns false for %i minutes",
      (minutes) => {
        expect(isCronCompatibleInterval(minutes)).toBe(false);
      },
    );
  });
});

describe("intervalToCronExpression", () => {
  describe("sub-hourly intervals produce */N format", () => {
    it("converts 10 minutes to */10 * * * *", () => {
      expect(intervalToCronExpression(10)).toBe("*/10 * * * *");
    });

    it("converts 30 minutes to */30 * * * *", () => {
      expect(intervalToCronExpression(30)).toBe("*/30 * * * *");
    });
  });

  describe("hourly interval produces top-of-hour format", () => {
    it("converts 60 minutes to 0 * * * *", () => {
      expect(intervalToCronExpression(60)).toBe("0 * * * *");
    });
  });

  describe("multi-hour intervals produce */N hours format", () => {
    it("converts 120 minutes to 0 */2 * * *", () => {
      expect(intervalToCronExpression(120)).toBe("0 */2 * * *");
    });

    it("converts 360 minutes to 0 */6 * * *", () => {
      expect(intervalToCronExpression(360)).toBe("0 */6 * * *");
    });

    it("converts 720 minutes to 0 */12 * * *", () => {
      expect(intervalToCronExpression(720)).toBe("0 */12 * * *");
    });
  });

  describe("daily interval produces midnight format", () => {
    it("converts 1440 minutes to 0 0 * * *", () => {
      expect(intervalToCronExpression(1440)).toBe("0 0 * * *");
    });
  });

  describe("incompatible intervals throw Error", () => {
    it("throws for 45 minutes with list of valid values", () => {
      expect(() => intervalToCronExpression(45)).toThrow(
        /interval_minutes 45 cannot be exactly represented as a cron expression/,
      );
      expect(() => intervalToCronExpression(45)).toThrow(/Valid values:/);
    });

    it("throws for 90 minutes", () => {
      expect(() => intervalToCronExpression(90)).toThrow(
        /interval_minutes 90 cannot be exactly represented as a cron expression/,
      );
    });
  });
});

describe("buildCronEntry", () => {
  it("throws when parameter contains newline character", () => {
    const params = makeCronEntryParams({ command: "cmd\nmalicious" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("throws when parameter contains semicolon", () => {
    const params = makeCronEntryParams({ envPath: "/usr/bin; rm -rf /" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("throws when parameter contains pipe", () => {
    const params = makeCronEntryParams({ command: "cmd | cat /etc/passwd" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("throws when parameter contains backtick", () => {
    const params = makeCronEntryParams({ command: "cmd `whoami`" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("throws when parameter contains dollar sign", () => {
    const params = makeCronEntryParams({ command: "cmd $(whoami)" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("throws when parameter contains ampersand", () => {
    const params = makeCronEntryParams({ command: "cmd && malicious" });
    expect(() => buildCronEntry(params)).toThrow(/Unsafe characters/);
  });

  it("returns formatted multi-line string with markers, PATH, and command", () => {
    const params = makeCronEntryParams();

    const result = buildCronEntry(params);

    const lines = result.split("\n");
    expect(lines[0]).toBe(CRON_MARKER_BEGIN);
    expect(lines[1]).toBe("PATH=/usr/local/bin:/usr/bin:/bin");
    expect(lines[2]).toBe(
      "*/30 * * * * npx sabori-flow worker >> /home/user/.sabori-flow/logs/stdout.log 2>> /home/user/.sabori-flow/logs/stderr.log",
    );
    expect(lines[3]).toBe(CRON_MARKER_END);
  });

  it("uses provided cron expression and command in the schedule line", () => {
    const params = makeCronEntryParams({
      cronExpression: "0 */2 * * *",
      command: "/usr/local/bin/node /opt/worker.js",
    });

    const result = buildCronEntry(params);

    expect(result).toContain("0 */2 * * * /usr/local/bin/node /opt/worker.js");
  });
});

describe("installCronEntry", () => {
  const newEntry = buildSaboriFlowBlock();

  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("appends entry to empty crontab", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        throw new Error("no crontab for user");
      }
      return "";
    });

    installCronEntry(newEntry);

    const writeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-",
    );
    expect(writeCall).toBeDefined();
    const writtenContent = (writeCall![2] as { input: string }).input;
    expect(writtenContent).toBe(`${newEntry}\n`);
  });

  it("replaces existing sabori-flow block when already present", () => {
    const existingBlock = [
      CRON_MARKER_BEGIN,
      "PATH=/old/path",
      "*/60 * * * * old-command >> /tmp/old.log 2>> /tmp/old-err.log",
      CRON_MARKER_END,
    ].join("\n");
    const otherEntry = "0 5 * * * /usr/bin/backup";
    const existingCrontab = `${otherEntry}\n${existingBlock}\n`;

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return existingCrontab;
      }
      return "";
    });

    installCronEntry(newEntry);

    const writeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-",
    );
    expect(writeCall).toBeDefined();
    const writtenContent = (writeCall![2] as { input: string }).input;
    expect(writtenContent).toContain(otherEntry);
    expect(writtenContent).toContain(newEntry);
    expect(writtenContent).not.toContain("old-command");
  });

  it("preserves other crontab entries when appending", () => {
    const existingEntries = "30 2 * * * /usr/bin/daily-task\n0 * * * * /usr/bin/hourly-task";

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return existingEntries + "\n";
      }
      return "";
    });

    installCronEntry(newEntry);

    const writeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-",
    );
    expect(writeCall).toBeDefined();
    const writtenContent = (writeCall![2] as { input: string }).input;
    expect(writtenContent).toContain("30 2 * * * /usr/bin/daily-task");
    expect(writtenContent).toContain("0 * * * * /usr/bin/hourly-task");
    expect(writtenContent).toContain(newEntry);
  });

  it("throws ShellError with stderr when writing crontab fails with stderr", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return "";
      }
      if (cmd === "crontab" && args[0] === "-") {
        throw { stderr: "permission denied", message: "crontab write failed" };
      }
      return "";
    });

    expect(() => installCronEntry(newEntry)).toThrow("Failed to write crontab");
  });

  it("throws ShellError with message when writing crontab fails without stderr", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return "";
      }
      if (cmd === "crontab" && args[0] === "-") {
        throw { message: "unexpected error" };
      }
      return "";
    });

    expect(() => installCronEntry(newEntry)).toThrow("Failed to write crontab");
  });

  it("throws ShellError with empty string when error has neither stderr nor message", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return "";
      }
      if (cmd === "crontab" && args[0] === "-") {
        throw {};
      }
      return "";
    });

    expect(() => installCronEntry(newEntry)).toThrow("Failed to write crontab");
  });
});

describe("uninstallCronEntry", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("removes sabori-flow block and preserves other entries", () => {
    const otherEntry = "0 5 * * * /usr/bin/backup";
    const saboriBlock = buildSaboriFlowBlock();
    const existingCrontab = `${otherEntry}\n${saboriBlock}\n`;

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return existingCrontab;
      }
      return "";
    });

    uninstallCronEntry();

    const writeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-",
    );
    expect(writeCall).toBeDefined();
    const writtenContent = (writeCall![2] as { input: string }).input;
    expect(writtenContent).toContain(otherEntry);
    expect(writtenContent).not.toContain(CRON_MARKER_BEGIN);
    expect(writtenContent).not.toContain(CRON_MARKER_END);
  });

  it("calls crontab -r when crontab becomes empty after removal", () => {
    const saboriBlock = buildSaboriFlowBlock();

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return saboriBlock + "\n";
      }
      return "";
    });

    uninstallCronEntry();

    const removeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-r",
    );
    expect(removeCall).toBeDefined();

    const writeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-",
    );
    expect(writeCall).toBeUndefined();
  });

  it("ignores errors when crontab -r fails on empty crontab", () => {
    const saboriBlock = buildSaboriFlowBlock();

    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        return saboriBlock + "\n";
      }
      if (cmd === "crontab" && args[0] === "-r") {
        throw new Error("no crontab for user");
      }
      return "";
    });

    expect(() => uninstallCronEntry()).not.toThrow();
  });

  it("removes sabori-flow block when crontab has no other entries", () => {
    mockExecFileSync.mockImplementation((cmd: string, args: string[]) => {
      if (cmd === "crontab" && args[0] === "-l") {
        throw new Error("no crontab for user");
      }
      return "";
    });

    uninstallCronEntry();

    const removeCall = mockExecFileSync.mock.calls.find(
      (call: unknown[]) => call[0] === "crontab" && (call[1] as string[])[0] === "-r",
    );
    expect(removeCall).toBeDefined();
  });
});

describe("cronEntryExists", () => {
  beforeEach(() => {
    mockExecFileSync.mockReset();
  });

  it("returns true when both markers exist in crontab", () => {
    const saboriBlock = buildSaboriFlowBlock();
    mockExecFileSync.mockReturnValue(saboriBlock + "\n");

    expect(cronEntryExists()).toBe(true);
  });

  it("returns false when crontab is empty", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("no crontab for user");
    });

    expect(cronEntryExists()).toBe(false);
  });

  it("returns false when crontab has no sabori-flow markers", () => {
    mockExecFileSync.mockReturnValue("0 5 * * * /usr/bin/backup\n");

    expect(cronEntryExists()).toBe(false);
  });

  it("returns false when only BEGIN marker exists", () => {
    mockExecFileSync.mockReturnValue(`${CRON_MARKER_BEGIN}\nsome content\n`);

    expect(cronEntryExists()).toBe(false);
  });

  it("returns false when only END marker exists", () => {
    mockExecFileSync.mockReturnValue(`some content\n${CRON_MARKER_END}\n`);

    expect(cronEntryExists()).toBe(false);
  });
});
