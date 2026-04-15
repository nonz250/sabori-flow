import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    unlinkSync: vi.fn(),
    rmSync: vi.fn(),
  },
}));

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("../../src/utils/cron.js", () => ({
  cronEntryExists: vi.fn(),
  uninstallCronEntry: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    PLIST_DEST_PATH: "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getPlistGeneratedPath: vi.fn().mockReturnValue("/mock/data/com.github.sabori-flow.plist"),
  };
});

vi.mock("../../src/i18n/index.js", () => ({
  setLanguage: vi.fn(),
  loadLanguageFromConfig: vi.fn().mockReturnValue("ja"),
  t: vi.fn().mockImplementation((key: string) => key),
}));

import fs from "fs";
import { confirm } from "@inquirer/prompts";
import { exec } from "../../src/utils/shell.js";
import { cronEntryExists, uninstallCronEntry } from "../../src/utils/cron.js";
import { getBaseDir, getConfigPath, getPlistGeneratedPath } from "../../src/utils/paths.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedConfirm = vi.mocked(confirm);
const mockedCronEntryExists = vi.mocked(cronEntryExists);
const mockedUninstallCronEntry = vi.mocked(uninstallCronEntry);
const mockedGetBaseDir = vi.mocked(getBaseDir);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetPlistGeneratedPath = vi.mocked(getPlistGeneratedPath);

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  // paths mock functions are reset by restoreAllMocks, re-setup defaults
  mockedGetBaseDir.mockReturnValue("/mock/data");
  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetPlistGeneratedPath.mockReturnValue("/mock/data/com.github.sabori-flow.plist");

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runUninstallCommand(options = {}): Promise<void> {
  const { uninstallCommand } = await import("../../src/commands/uninstall.js");
  return uninstallCommand(options);
}

// ---------- Tests ----------

describe("uninstallCommand - launchd plist removal", () => {
  it("calls launchctl unload and deletes plist when plist exists", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(mockedExec).toHaveBeenCalledWith("launchctl", ["unload", "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist"]);
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith("/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist");
    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.deleted");
  });

  it("continues even when launchctl unload throws an error", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);
    mockedExec.mockImplementation(() => {
      throw new Error("launchctl unload failed");
    });

    await runUninstallCommand({ interactive: false });

    expect(mockedFs.unlinkSync).toHaveBeenCalledWith("/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist");
  });
});

describe("uninstallCommand - generated plist deletion", () => {
  it("deletes generated plist if it exists", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/data/com.github.sabori-flow.plist") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(mockedFs.unlinkSync).toHaveBeenCalledWith("/mock/data/com.github.sabori-flow.plist");
  });

  it("does not attempt to delete generated plist when it does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith("/mock/data/com.github.sabori-flow.plist");
  });
});

describe("uninstallCommand - cron entry removal", () => {
  it("calls uninstallCronEntry and shows cronRemoved message when cron entry exists", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(true);

    await runUninstallCommand({ interactive: false });

    expect(mockedUninstallCronEntry).toHaveBeenCalledTimes(1);
    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.cronRemoved");
  });

  it("does not call uninstallCronEntry when cron entry does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(mockedUninstallCronEntry).not.toHaveBeenCalled();
  });
});

describe("uninstallCommand - both launchd and cron exist", () => {
  it("removes both and does not show notRegistered message", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(true);

    await runUninstallCommand({ interactive: false });

    // launchd removed
    expect(mockedExec).toHaveBeenCalledWith("launchctl", ["unload", "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist"]);
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith("/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist");
    // cron removed
    expect(mockedUninstallCronEntry).toHaveBeenCalledTimes(1);
    // notRegistered NOT shown
    const notRegisteredCalls = consoleSpy.log.mock.calls.filter(
      (call) => call[0] === "uninstall.notRegistered",
    );
    expect(notRegisteredCalls).toHaveLength(0);
  });
});

describe("uninstallCommand - only cron entry exists (no plist)", () => {
  it("removes cron entry and does not show notRegistered message", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(true);

    await runUninstallCommand({ interactive: false });

    expect(mockedUninstallCronEntry).toHaveBeenCalledTimes(1);
    const notRegisteredCalls = consoleSpy.log.mock.calls.filter(
      (call) => call[0] === "uninstall.notRegistered",
    );
    expect(notRegisteredCalls).toHaveLength(0);
  });
});

describe("uninstallCommand - nothing registered", () => {
  it("shows notRegistered message when neither plist nor cron entry exists", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.notRegistered");
  });
});

describe("uninstallCommand - complete message", () => {
  it("always shows complete message regardless of state", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.complete");
  });

  it("shows complete message after successful removal", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(true);

    await runUninstallCommand({ interactive: false });

    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.complete");
  });
});

describe("uninstallCommand - interactive mode", () => {
  it("prompts for full data deletion when interactive and baseDir exists", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/data") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);
    mockedConfirm.mockResolvedValue(true);

    await runUninstallCommand({ interactive: true });

    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(mockedFs.rmSync).toHaveBeenCalledWith("/mock/data", { recursive: true, force: true });
    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.deletedAll");
  });

  it("does not delete baseDir when user declines confirmation", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/data") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);
    mockedConfirm.mockResolvedValue(false);

    await runUninstallCommand({ interactive: true });

    expect(mockedConfirm).toHaveBeenCalledTimes(1);
    expect(mockedFs.rmSync).not.toHaveBeenCalled();
  });

  it("does not prompt when baseDir does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: true });

    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("handles Ctrl+C gracefully during confirmation", async () => {
    mockedFs.existsSync.mockImplementation((path: unknown) => {
      if (path === "/mock/data") return true;
      return false;
    });
    mockedCronEntryExists.mockReturnValue(false);
    mockedConfirm.mockRejectedValue(new Error("User force closed the prompt"));

    await expect(runUninstallCommand({ interactive: true })).resolves.toBeUndefined();

    expect(mockedFs.rmSync).not.toHaveBeenCalled();
  });
});

describe("uninstallCommand - non-interactive mode", () => {
  it("does not call confirm when interactive is false", async () => {
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand({ interactive: false });

    expect(mockedConfirm).not.toHaveBeenCalled();
  });

  it("defaults to interactive mode when no options provided", async () => {
    // baseDir does not exist so confirm is not called even in interactive mode
    mockedFs.existsSync.mockReturnValue(false);
    mockedCronEntryExists.mockReturnValue(false);

    await runUninstallCommand();

    // No error, completes successfully - interactive defaults to true
    expect(consoleSpy.log).toHaveBeenCalledWith("uninstall.complete");
  });
});
