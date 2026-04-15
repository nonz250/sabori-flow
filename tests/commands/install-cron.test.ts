import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

vi.mock("../../src/utils/plist.js", () => ({
  renderPlist: vi.fn(),
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
    PLIST_TEMPLATE_PATH: "/mock/package-root/launchd/template.plist",
    PLIST_DEST_DIR: "/mock/home/Library/LaunchAgents",
    PLIST_DEST_PATH: "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getLogsDir: vi.fn().mockReturnValue("/mock/data/logs"),
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
    getPlistGeneratedPath: vi.fn().mockReturnValue("/mock/data/com.github.sabori-flow.plist"),
  };
});

vi.mock("../../src/utils/cron.js", () => ({
  isCronCompatibleInterval: vi.fn(),
  intervalToCronExpression: vi.fn(),
  buildCronEntry: vi.fn(),
  installCronEntry: vi.fn(),
  CRON_COMPATIBLE_INTERVALS: [10, 12, 15, 20, 30, 60, 120, 180, 240, 300, 360, 480, 720, 1440],
}));

import fs from "fs";
import { exec, commandExists } from "../../src/utils/shell.js";
import { loadConfig } from "../../src/worker/config.js";
import {
  getConfigPath,
  getLogsDir,
  getBaseDir,
} from "../../src/utils/paths.js";
import {
  isCronCompatibleInterval,
  intervalToCronExpression,
  buildCronEntry,
  installCronEntry,
} from "../../src/utils/cron.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedCommandExists = vi.mocked(commandExists);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetLogsDir = vi.mocked(getLogsDir);
const mockedGetBaseDir = vi.mocked(getBaseDir);
const mockedIsCronCompatibleInterval = vi.mocked(isCronCompatibleInterval);
const mockedIntervalToCronExpression = vi.mocked(intervalToCronExpression);
const mockedBuildCronEntry = vi.mocked(buildCronEntry);
const mockedInstallCronEntry = vi.mocked(installCronEntry);

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };
let originalPlatform: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.restoreAllMocks();

  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetLogsDir.mockReturnValue("/mock/data/logs");
  mockedGetBaseDir.mockReturnValue("/mock/data");

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };

  originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
});

afterEach(() => {
  if (originalPlatform) {
    Object.defineProperty(process, "platform", originalPlatform);
  }
});

// ---------- Lazy import (after mocks) ----------

async function runInstallCommand(
  options: { local?: boolean; scheduler?: "launchd" | "cron" } = {},
): Promise<void> {
  const { installCommand } = await import("../../src/commands/install.js");
  return installCommand(options);
}

async function importGetDefaultScheduler(): Promise<() => "launchd" | "cron"> {
  const { getDefaultScheduler } = await import("../../src/commands/install.js");
  return getDefaultScheduler;
}

// ---------- Helpers ----------

/** Set up normal flow prerequisites for cron scheduler in npx mode */
function setupCronNormalFlow(overrides?: {
  npxPath?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  cronEntry?: string;
}): void {
  const {
    npxPath = "/usr/local/bin/npx",
    intervalMinutes = 60,
    cronExpression = "0 * * * *",
    cronEntry = "# BEGIN sabori-flow\nPATH=/usr/local/bin:/usr/bin:/bin\n0 * * * * /usr/local/bin/npx sabori-flow worker >> /mock/data/logs/worker-stdout.log 2>> /mock/data/logs/worker-stderr.log\n# END sabori-flow",
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
  mockedIsCronCompatibleInterval.mockReturnValue(true);
  mockedIntervalToCronExpression.mockReturnValue(cronExpression);
  mockedBuildCronEntry.mockReturnValue(cronEntry);
}

/** Set up normal flow prerequisites for cron scheduler in local mode */
function setupCronLocalFlow(overrides?: {
  nodePath?: string;
  intervalMinutes?: number;
  cronExpression?: string;
  cronEntry?: string;
}): void {
  const {
    nodePath = "/usr/local/bin/node",
    intervalMinutes = 60,
    cronExpression = "0 * * * *",
    cronEntry = "# BEGIN sabori-flow\nPATH=/usr/local/bin:/usr/bin:/bin\n0 * * * * /usr/local/bin/node /mock/package-root/dist/worker.js >> /mock/data/logs/worker-stdout.log 2>> /mock/data/logs/worker-stderr.log\n# END sabori-flow",
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
  mockedIsCronCompatibleInterval.mockReturnValue(true);
  mockedIntervalToCronExpression.mockReturnValue(cronExpression);
  mockedBuildCronEntry.mockReturnValue(cronEntry);
}

// ---------- Tests ----------

describe("getDefaultScheduler", () => {
  it("darwin プラットフォームでは launchd を返す", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });

    const getDefaultScheduler = await importGetDefaultScheduler();

    expect(getDefaultScheduler()).toBe("launchd");
  });

  it("linux プラットフォームでは cron を返す", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const getDefaultScheduler = await importGetDefaultScheduler();

    expect(getDefaultScheduler()).toBe("cron");
  });

  it("win32 プラットフォームでは cron を返す", async () => {
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const getDefaultScheduler = await importGetDefaultScheduler();

    expect(getDefaultScheduler()).toBe("cron");
  });
});

describe("installCommand - scheduler: launchd を非 darwin プラットフォームで指定した場合", () => {
  it("launchd が利用できない旨のエラーメッセージを出力し、早期 return する", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    await runInstallCommand({ scheduler: "launchd" });

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("launchd はこのプラットフォームでは利用できません"),
    );
    expect(mockedFs.existsSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
  });
});

describe("installCommand - scheduler: cron で crontab が見つからない場合", () => {
  it("crontab が見つからない旨のエラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockImplementation((cmd: string) => {
      if (cmd === "crontab") return false;
      return true;
    });
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
      return "";
    });
    mockedLoadConfig.mockReturnValue({
      repositories: [],
      execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes: 60 },
    });

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("crontab が見つかりません"),
    );
    expect(mockedInstallCronEntry).not.toHaveBeenCalled();
  });
});

describe("installCommand - scheduler: cron で cron 非互換のインターバル値の場合", () => {
  it("非互換のインターバル値に対してエラーメッセージを出力し、有効な値一覧を含む", async () => {
    const incompatibleInterval = 45;
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(true);
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
      return "";
    });
    mockedLoadConfig.mockReturnValue({
      repositories: [],
      execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes: incompatibleInterval },
    });
    mockedIsCronCompatibleInterval.mockReturnValue(false);

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("45"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("cron で正確に表現できません"),
    );
    expect(mockedInstallCronEntry).not.toHaveBeenCalled();
  });
});

describe("installCommand - scheduler: cron 正常フロー（npx モード、60分間隔）", () => {
  it("ログディレクトリが mode 0o700 で作成される", async () => {
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
  });

  it("getBaseDir 配下のディレクトリが mode 0o700 で作成される", async () => {
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data",
      { recursive: true, mode: 0o700 },
    );
  });

  it("intervalToCronExpression に正しいインターバル値が渡される", async () => {
    setupCronNormalFlow({ intervalMinutes: 30, cronExpression: "*/30 * * * *" });

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedIntervalToCronExpression).toHaveBeenCalledWith(30);
  });

  it("buildCronEntry に正しいパラメータが渡される", async () => {
    setupCronNormalFlow({
      cronExpression: "0 * * * *",
    });

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedBuildCronEntry).toHaveBeenCalledTimes(1);
    const params = mockedBuildCronEntry.mock.calls[0][0];
    expect(params.cronExpression).toBe("0 * * * *");
    expect(params.command).toBe("/usr/local/bin/npx sabori-flow worker");
    expect(params.stdoutLog).toBe("/mock/data/logs/worker-stdout.log");
    expect(params.stderrLog).toBe("/mock/data/logs/worker-stderr.log");
    // envPath contains standard paths
    expect(params.envPath).toContain("/usr/local/bin");
    expect(params.envPath).toContain("/usr/bin");
    expect(params.envPath).toContain("/bin");
  });

  it("installCronEntry が buildCronEntry の戻り値で呼ばれる", async () => {
    const expectedEntry = "# BEGIN sabori-flow\nmocked-entry\n# END sabori-flow";
    setupCronNormalFlow({ cronEntry: expectedEntry });

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedInstallCronEntry).toHaveBeenCalledTimes(1);
    expect(mockedInstallCronEntry).toHaveBeenCalledWith(expectedEntry);
  });

  it("cron 登録中メッセージが出力される", async () => {
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("crontab に登録中"),
    );
  });

  it("完了メッセージに cron とインターバル値が含まれる", async () => {
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("cron により 60分ごとにワーカーが実行されます"),
    );
  });

  it("interval_minutes: 30 の場合、完了メッセージに 30 分が含まれる", async () => {
    setupCronNormalFlow({ intervalMinutes: 30, cronExpression: "*/30 * * * *" });

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("30分ごとにワーカーが実行されます"),
    );
  });

  it("plist 関連の処理が呼ばれない", async () => {
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    expect(mockedFs.chmodSync).not.toHaveBeenCalled();
  });
});

describe("installCommand - scheduler: cron --local モード", () => {
  it("buildCronEntry の command に node パスと dist/worker.js が含まれる", async () => {
    setupCronLocalFlow();

    await runInstallCommand({ scheduler: "cron", local: true });

    expect(mockedBuildCronEntry).toHaveBeenCalledTimes(1);
    const params = mockedBuildCronEntry.mock.calls[0][0];
    expect(params.command).toBe("/usr/local/bin/node /mock/package-root/dist/worker.js");
  });

  it("完了メッセージに「ローカルビルドのワーカーを cron に登録しました」が含まれる", async () => {
    setupCronLocalFlow();

    await runInstallCommand({ scheduler: "cron", local: true });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("ローカルビルドのワーカーを cron に登録しました"),
    );
  });

  it("installCronEntry が呼ばれる", async () => {
    setupCronLocalFlow();

    await runInstallCommand({ scheduler: "cron", local: true });

    expect(mockedInstallCronEntry).toHaveBeenCalledTimes(1);
  });
});

describe("installCommand - scheduler: cron を macOS で実行した場合", () => {
  it("macOS スリープに関する警告メッセージが出力される", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("macOS では cron はスリープ中にジョブを実行しません"),
    );
  });

  it("警告メッセージに --scheduler launchd の推奨が含まれる", async () => {
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("--scheduler launchd"),
    );
  });
});

describe("installCommand - scheduler: cron を非 macOS で実行した場合", () => {
  it("macOS 警告メッセージが出力されない", async () => {
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    setupCronNormalFlow();

    await runInstallCommand({ scheduler: "cron" });

    const warningCalls = consoleSpy.log.mock.calls.filter(
      (call) => typeof call[0] === "string" && call[0].includes("macOS"),
    );
    expect(warningCalls).toHaveLength(0);
  });
});

describe("installCommand - scheduler: cron の処理順序", () => {
  it("ログディレクトリ作成、ベースディレクトリ作成、cron 登録が正しい順序で実行される", async () => {
    setupCronNormalFlow();
    const callOrder: string[] = [];

    mockedFs.mkdirSync.mockImplementation((..._args: unknown[]) => {
      const dir = _args[0] as string;
      callOrder.push(`mkdirSync:${dir}`);
      return undefined;
    });
    mockedInstallCronEntry.mockImplementation(() => {
      callOrder.push("installCronEntry");
    });

    await runInstallCommand({ scheduler: "cron" });

    // logs directory is created first
    expect(callOrder.indexOf("mkdirSync:/mock/data/logs")).toBeLessThan(
      callOrder.indexOf("mkdirSync:/mock/data"),
    );
    // base directory is created before cron entry installation
    expect(callOrder.indexOf("mkdirSync:/mock/data")).toBeLessThan(
      callOrder.indexOf("installCronEntry"),
    );
  });
});
