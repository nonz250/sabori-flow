import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    mkdirSync: vi.fn(),
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

import fs from "fs";
import { exec, ShellError } from "../../src/utils/shell.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();
});

async function createScheduler() {
  const { WindowsScheduler } = await import("../../src/scheduler/windows-scheduler.js");
  return new WindowsScheduler();
}

const TASK_NAME = "sabori-flow";
const SCHTASKS = "schtasks.exe";

// ---------- Tests ----------

describe("WindowsScheduler.install", () => {
  it("creates task with schtasks /Create", async () => {
    // isInstalled returns false (task doesn't exist)
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        throw new ShellError("not found", "");
      }
      return "";
    });

    const scheduler = await createScheduler();
    scheduler.install({
      programArguments: ["C:\\node\\npx.cmd", "sabori-flow", "worker"],
      intervalMinutes: 60,
      logDir: "C:\\Users\\user\\.sabori-flow\\logs",
      env: { PATH: "C:\\Windows\\System32" },
    });

    // Creates logs directory
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "C:\\Users\\user\\.sabori-flow\\logs",
      { recursive: true },
    );

    // Creates scheduled task
    expect(mockedExec).toHaveBeenCalledWith(SCHTASKS, [
      "/Create",
      "/TN", TASK_NAME,
      "/TR", "C:\\node\\npx.cmd sabori-flow worker",
      "/SC", "MINUTE",
      "/MO", "60",
      "/F",
    ]);
  });

  it("removes existing task before creating new one", async () => {
    const callOrder: string[] = [];
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        callOrder.push("query");
        return "TaskName: sabori-flow";
      }
      if (file === SCHTASKS && args[0] === "/Delete") {
        callOrder.push("delete");
        return "";
      }
      if (file === SCHTASKS && args[0] === "/Create") {
        callOrder.push("create");
        return "";
      }
      return "";
    });

    const scheduler = await createScheduler();
    scheduler.install({
      programArguments: ["C:\\node\\npx.cmd", "sabori-flow", "worker"],
      intervalMinutes: 60,
      logDir: "C:\\Users\\user\\.sabori-flow\\logs",
      env: { PATH: "C:\\Windows\\System32" },
    });

    expect(callOrder).toContain("delete");
    expect(callOrder).toContain("create");
    expect(callOrder.indexOf("delete")).toBeLessThan(callOrder.indexOf("create"));
  });

  it("uses single command when programArguments has one element", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        throw new ShellError("not found", "");
      }
      return "";
    });

    const scheduler = await createScheduler();
    scheduler.install({
      programArguments: ["C:\\worker.exe"],
      intervalMinutes: 30,
      logDir: "C:\\logs",
      env: { PATH: "C:\\Windows\\System32" },
    });

    expect(mockedExec).toHaveBeenCalledWith(SCHTASKS, [
      "/Create",
      "/TN", TASK_NAME,
      "/TR", "C:\\worker.exe",
      "/SC", "MINUTE",
      "/MO", "30",
      "/F",
    ]);
  });
});

describe("WindowsScheduler.uninstall", () => {
  it("deletes the task when installed", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        return "TaskName: sabori-flow";
      }
      return "";
    });

    const scheduler = await createScheduler();
    scheduler.uninstall();

    expect(mockedExec).toHaveBeenCalledWith(SCHTASKS, [
      "/Delete", "/TN", TASK_NAME, "/F",
    ]);
  });

  it("does nothing when task is not installed", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        throw new ShellError("not found", "");
      }
      return "";
    });

    const scheduler = await createScheduler();
    scheduler.uninstall();

    // Only the /Query call, no /Delete
    const deleteCalls = mockedExec.mock.calls.filter(
      (call) => call[1][0] === "/Delete",
    );
    expect(deleteCalls).toHaveLength(0);
  });
});

describe("WindowsScheduler.isInstalled", () => {
  it("returns true when task exists", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        return "TaskName: sabori-flow";
      }
      return "";
    });

    const scheduler = await createScheduler();
    expect(scheduler.isInstalled()).toBe(true);
  });

  it("returns false when task does not exist (ShellError)", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        throw new ShellError("not found", "ERROR: The system cannot find the file specified.");
      }
      return "";
    });

    const scheduler = await createScheduler();
    expect(scheduler.isInstalled()).toBe(false);
  });

  it("rethrows non-ShellError exceptions", async () => {
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === SCHTASKS && args[0] === "/Query") {
        throw new TypeError("unexpected");
      }
      return "";
    });

    const scheduler = await createScheduler();
    expect(() => scheduler.isInstalled()).toThrow(TypeError);
  });
});
