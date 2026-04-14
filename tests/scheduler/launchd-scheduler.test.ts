import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";

// ---------- Mocks ----------

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

vi.mock("../../src/utils/shell.js", () => ({
  exec: vi.fn(),
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

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    PLIST_TEMPLATE_PATH: "/mock/package-root/launchd/template.plist",
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
  };
});

import fs from "fs";
import { exec } from "../../src/utils/shell.js";
import { renderPlist } from "../../src/utils/plist.js";
import { getBaseDir } from "../../src/utils/paths.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedRenderPlist = vi.mocked(renderPlist);
const mockedGetBaseDir = vi.mocked(getBaseDir);

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetBaseDir.mockReturnValue("/mock/data");
  vi.mocked(homedir).mockReturnValue("/mock/home");
});

async function createScheduler() {
  const { LaunchdScheduler } = await import("../../src/scheduler/launchd-scheduler.js");
  return new LaunchdScheduler();
}

const PLIST_DEST_PATH = path.join("/mock/home", "Library", "LaunchAgents", "com.github.sabori-flow.plist");
const PLIST_DEST_DIR = path.join("/mock/home", "Library", "LaunchAgents");
const PLIST_GENERATED_PATH = path.join("/mock/data", "com.github.sabori-flow.plist");

// ---------- Tests ----------

describe("LaunchdScheduler.install", () => {
  it("generates plist and registers with launchd", async () => {
    mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
    mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
    mockedExec.mockReturnValue("");

    const scheduler = await createScheduler();
    scheduler.install({
      programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
      intervalMinutes: 60,
      logDir: "/mock/data/logs",
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    });

    // Creates base directory
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data",
      { recursive: true, mode: 0o700 },
    );

    // Reads template
    expect(mockedFs.readFileSync).toHaveBeenCalledWith(
      "/mock/package-root/launchd/template.plist",
      "utf-8",
    );

    // Renders plist with correct placeholders
    expect(mockedRenderPlist).toHaveBeenCalledWith(
      "<plist>template</plist>",
      {
        programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
        path: "/usr/local/bin:/usr/bin:/bin",
        logDir: "/mock/data/logs",
        startInterval: 3600,
      },
    );

    // Writes generated plist
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      PLIST_GENERATED_PATH,
      "<plist>rendered</plist>",
      { encoding: "utf-8", mode: 0o600 },
    );

    // Copies to LaunchAgents and sets permissions
    expect(mockedFs.copyFileSync).toHaveBeenCalledWith(
      PLIST_GENERATED_PATH,
      PLIST_DEST_PATH,
    );
    expect(mockedFs.chmodSync).toHaveBeenCalledWith(PLIST_DEST_PATH, 0o600);

    // Registers with launchctl
    expect(mockedExec).toHaveBeenCalledWith("launchctl", ["load", PLIST_DEST_PATH]);
  });

  it("converts intervalMinutes to startInterval in seconds", async () => {
    mockedFs.readFileSync.mockReturnValue("<plist/>");
    mockedRenderPlist.mockReturnValue("<plist/>");
    mockedExec.mockReturnValue("");

    const scheduler = await createScheduler();
    scheduler.install({
      programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
      intervalMinutes: 30,
      logDir: "/mock/data/logs",
      env: { PATH: "/usr/local/bin" },
    });

    const placeholders = mockedRenderPlist.mock.calls[0][1];
    expect(placeholders.startInterval).toBe(1800);
  });
});

describe("LaunchdScheduler.uninstall", () => {
  it("unloads from launchd and removes plist files", async () => {
    mockedFs.existsSync.mockImplementation((p: unknown) => {
      if (p === PLIST_DEST_PATH) return true;
      if (p === PLIST_GENERATED_PATH) return true;
      return false;
    });
    mockedExec.mockReturnValue("");

    const scheduler = await createScheduler();
    scheduler.uninstall();

    expect(mockedExec).toHaveBeenCalledWith("launchctl", ["unload", PLIST_DEST_PATH]);
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(PLIST_DEST_PATH);
    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(PLIST_GENERATED_PATH);
  });

  it("does nothing when plist does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const scheduler = await createScheduler();
    scheduler.uninstall();

    expect(mockedExec).not.toHaveBeenCalled();
    expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
  });

  it("ignores launchctl unload failures", async () => {
    mockedFs.existsSync.mockImplementation((p: unknown) => {
      if (p === PLIST_DEST_PATH) return true;
      return false;
    });
    mockedExec.mockImplementation(() => {
      throw new Error("unload failed");
    });

    const scheduler = await createScheduler();
    // Should not throw
    scheduler.uninstall();

    expect(mockedFs.unlinkSync).toHaveBeenCalledWith(PLIST_DEST_PATH);
  });
});

describe("LaunchdScheduler.isInstalled", () => {
  it("returns true when plist exists", async () => {
    mockedFs.existsSync.mockImplementation((p: unknown) => p === PLIST_DEST_PATH);

    const scheduler = await createScheduler();
    expect(scheduler.isInstalled()).toBe(true);
  });

  it("returns false when plist does not exist", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    const scheduler = await createScheduler();
    expect(scheduler.isInstalled()).toBe(false);
  });
});
