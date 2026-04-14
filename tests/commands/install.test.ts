import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
  commandExists: vi.fn(),
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

vi.mock("../../src/worker/config.js", () => ({
  loadConfig: vi.fn(),
  ConfigValidationError: class ConfigValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigValidationError";
    }
  },
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    PACKAGE_ROOT: "/mock/package-root",
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getLogsDir: vi.fn().mockReturnValue("/mock/data/logs"),
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
  };
});

const mockSchedulerInstall = vi.fn();
const mockSchedulerUninstall = vi.fn();
const mockSchedulerIsInstalled = vi.fn();

vi.mock("../../src/scheduler/index.js", () => ({
  createScheduler: vi.fn(() => ({
    install: mockSchedulerInstall,
    uninstall: mockSchedulerUninstall,
    isInstalled: mockSchedulerIsInstalled,
  })),
  UnsupportedPlatformError: class UnsupportedPlatformError extends Error {
    constructor(platform: string) {
      super(`Unsupported platform: ${platform}`);
      this.name = "UnsupportedPlatformError";
    }
  },
}));

import fs from "fs";
import { exec, commandExists, ShellError } from "../../src/utils/shell.js";
import { loadConfig, ConfigValidationError } from "../../src/worker/config.js";
import {
  getConfigPath,
  getLogsDir,
} from "../../src/utils/paths.js";
import { createScheduler, UnsupportedPlatformError } from "../../src/scheduler/index.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedCommandExists = vi.mocked(commandExists);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetLogsDir = vi.mocked(getLogsDir);
const mockedCreateScheduler = vi.mocked(createScheduler);

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetLogsDir.mockReturnValue("/mock/data/logs");

  mockSchedulerInstall.mockReset();
  mockSchedulerUninstall.mockReset();
  mockSchedulerIsInstalled.mockReset();
  mockedCreateScheduler.mockReturnValue({
    install: mockSchedulerInstall,
    uninstall: mockSchedulerUninstall,
    isInstalled: mockSchedulerIsInstalled,
  });

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runInstallCommand(options: { local?: boolean } = {}): Promise<void> {
  const { installCommand } = await import("../../src/commands/install.js");
  return installCommand(options);
}

// ---------- Helpers ----------

/** Set up prerequisites for a normal npx-mode flow */
function setupNormalFlow(overrides?: {
  npxPath?: string;
  intervalMinutes?: number;
}): void {
  const {
    npxPath = "/usr/local/bin/npx",
    intervalMinutes = 60,
  } = overrides ?? {};

  mockedFs.existsSync.mockReturnValue(true);
  mockedCommandExists.mockReturnValue(true);
  mockedLoadConfig.mockReturnValue({
    repositories: [],
    execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes },
  });
  mockedExec.mockImplementation((file: string, args: readonly string[]) => {
    if (file === "which" && args[0] === "npx") return npxPath;
    return "";
  });
}

/** Set up prerequisites for a --local mode flow */
function setupLocalFlow(overrides?: {
  nodePath?: string;
  intervalMinutes?: number;
}): void {
  const {
    nodePath = "/usr/local/bin/node",
    intervalMinutes = 60,
  } = overrides ?? {};

  mockedFs.existsSync.mockReturnValue(true);
  mockedCommandExists.mockReturnValue(true);
  mockedLoadConfig.mockReturnValue({
    repositories: [],
    execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes },
  });
  mockedExec.mockImplementation((file: string, args: readonly string[]) => {
    if (file === "which" && args[0] === "node") return nodePath;
    return "";
  });
}

// ---------- Tests ----------

describe("installCommand - config.yml does not exist", () => {
  it("outputs error message and returns early", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    expect(mockSchedulerInstall).not.toHaveBeenCalled();
  });
});

describe("installCommand - default (npx mode)", () => {
  describe("npx command not found", () => {
    it("outputs error message and returns early", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(false);

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx"),
      );
      expect(mockSchedulerInstall).not.toHaveBeenCalled();
    });
  });

  describe("which npx returns empty string", () => {
    it("outputs error message and returns early", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "npx") return "";
        return "";
      });

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx"),
      );
      expect(mockSchedulerInstall).not.toHaveBeenCalled();
    });
  });

  describe("which npx returns relative path", () => {
    it("outputs error message and returns early", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "npx") return "npx";
        return "";
      });

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx"),
      );
      expect(mockSchedulerInstall).not.toHaveBeenCalled();
    });
  });

  describe("normal flow", () => {
    it("creates logs directory and calls scheduler.install", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        "/mock/data/logs",
        { recursive: true, mode: 0o700 },
      );
      expect(mockSchedulerInstall).toHaveBeenCalledTimes(1);
    });

    it("passes correct config to scheduler.install", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(mockSchedulerInstall).toHaveBeenCalledTimes(1);
      const config = mockSchedulerInstall.mock.calls[0][0];
      expect(config.programArguments).toEqual(["/usr/local/bin/npx", "sabori-flow", "worker"]);
      expect(config.logDir).toBe("/mock/data/logs");
      expect(config.intervalMinutes).toBe(60);
      expect(config.env.PATH).toContain("/usr/local/bin");
      expect(config.env.PATH).toContain("/usr/bin");
      expect(config.env.PATH).toContain("/bin");
    });

    it("outputs completion message with interval", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("60"),
      );
    });

    it("passes intervalMinutes: 30 correctly", async () => {
      setupNormalFlow({ intervalMinutes: 30 });

      await runInstallCommand();

      const config = mockSchedulerInstall.mock.calls[0][0];
      expect(config.intervalMinutes).toBe(30);
    });

    it("outputs completion message with custom interval", async () => {
      setupNormalFlow({ intervalMinutes: 30 });

      await runInstallCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("30"),
      );
    });
  });
});

describe("installCommand - --local mode", () => {
  describe("node command not found", () => {
    it("outputs error message and returns early", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(false);

      await runInstallCommand({ local: true });

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("node"),
      );
      expect(mockSchedulerInstall).not.toHaveBeenCalled();
    });
  });

  describe("which node returns empty string", () => {
    it("outputs error message and returns early", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "node") return "";
        return "";
      });

      await runInstallCommand({ local: true });

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("node"),
      );
      expect(mockSchedulerInstall).not.toHaveBeenCalled();
    });
  });

  describe("normal flow", () => {
    it("passes node path and dist/worker.js in programArguments", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      const config = mockSchedulerInstall.mock.calls[0][0];
      expect(config.programArguments).toEqual([
        "/usr/local/bin/node",
        "/mock/package-root/dist/worker.js",
      ]);
    });

    it("which node is called", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      expect(mockedExec).toHaveBeenCalledWith("which", ["node"]);
    });

    it("outputs local completion message", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("60"),
      );
    });
  });
});

describe("installCommand - buildMinimalPath indirect verification", () => {
  it("includes directories from REQUIRED_COMMANDS", async () => {
    setupNormalFlow();
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") {
        const cmdPathMap: Record<string, string> = {
          npx: "/usr/local/bin/npx",
          node: "/usr/local/bin/node",
          git: "/usr/bin/git",
          gh: "/opt/homebrew/bin/gh",
          claude: "/home/user/.local/bin/claude",
        };
        return cmdPathMap[args[0]] ?? "";
      }
      return "";
    });

    await runInstallCommand();

    const config = mockSchedulerInstall.mock.calls[0][0];
    const pathArg = config.env.PATH;
    expect(pathArg).toContain("/usr/local/bin");
    expect(pathArg).toContain("/usr/bin");
    expect(pathArg).toContain("/bin");
    expect(pathArg).toContain("/opt/homebrew/bin");
    expect(pathArg).toContain("/home/user/.local/bin");
  });

  it("skips commands that fail to resolve and includes STANDARD_PATHS", async () => {
    setupNormalFlow();
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") {
        if (args[0] === "npx") return "/usr/local/bin/npx";
        if (args[0] === "node") return "/usr/local/bin/node";
        throw new Error("not found");
      }
      return "";
    });

    await runInstallCommand();

    const config = mockSchedulerInstall.mock.calls[0][0];
    const pathArg = config.env.PATH;
    expect(pathArg).toContain("/usr/local/bin");
    expect(pathArg).toContain("/usr/bin");
    expect(pathArg).toContain("/bin");
  });

  it("deduplicates directories", async () => {
    setupNormalFlow();
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") return "/usr/local/bin/" + args[0];
      return "";
    });

    await runInstallCommand();

    const config = mockSchedulerInstall.mock.calls[0][0];
    const pathArg = config.env.PATH;
    const dirs = pathArg.split(":");
    const uniqueDirs = new Set(dirs);
    expect(dirs.length).toBe(uniqueDirs.size);
  });
});

describe("installCommand - ShellError during scheduler.install", () => {
  it("outputs error message and returns early", async () => {
    setupNormalFlow();
    mockSchedulerInstall.mockImplementation(() => {
      throw new ShellError("scheduler install failed", "stderr output");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("scheduler install failed"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith("stderr output");
  });

  it("does not output empty stderr", async () => {
    setupNormalFlow();
    mockSchedulerInstall.mockImplementation(() => {
      throw new ShellError("scheduler install failed", "");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("scheduler install failed"),
    );
    const stderrCalls = consoleSpy.error.mock.calls.filter(
      (call) => call[0] === "",
    );
    expect(stderrCalls).toHaveLength(0);
  });
});

describe("installCommand - UnsupportedPlatformError", () => {
  it("outputs unsupported platform error", async () => {
    setupNormalFlow();
    mockedCreateScheduler.mockImplementation(() => {
      throw new UnsupportedPlatformError("linux");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("Unsupported platform: linux"),
    );
  });
});

describe("installCommand - ConfigValidationError", () => {
  it("outputs config validation error", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(true);
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
      return "";
    });
    mockedLoadConfig.mockImplementation(() => {
      throw new ConfigValidationError("interval_minutes: must be >= 10, got 5");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("interval_minutes: must be >= 10, got 5"),
    );
    expect(mockSchedulerInstall).not.toHaveBeenCalled();
  });
});

describe("installCommand - unexpected error", () => {
  it("outputs unexpected error message", async () => {
    setupNormalFlow();
    mockedFs.mkdirSync.mockImplementation(() => {
      throw new TypeError("unexpected error");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("予期しないエラー"),
      expect.any(TypeError),
    );
  });
});

describe("installCommand - logs directory uses getLogsDir()", () => {
  it("getLogsDir() value is used as log directory", async () => {
    setupNormalFlow();

    await runInstallCommand();

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
    const config = mockSchedulerInstall.mock.calls[0][0];
    expect(config.logDir).toBe("/mock/data/logs");
  });
});
