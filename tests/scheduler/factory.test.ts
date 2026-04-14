import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the scheduler implementations to avoid their side effects
vi.mock("../../src/scheduler/launchd-scheduler.js", () => ({
  LaunchdScheduler: vi.fn().mockImplementation(() => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  })),
}));

vi.mock("../../src/scheduler/windows-scheduler.js", () => ({
  WindowsScheduler: vi.fn().mockImplementation(() => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  })),
}));

import { LaunchdScheduler } from "../../src/scheduler/launchd-scheduler.js";
import { WindowsScheduler } from "../../src/scheduler/windows-scheduler.js";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(LaunchdScheduler).mockImplementation(() => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
  vi.mocked(WindowsScheduler).mockImplementation(() => ({
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
});

async function getFactory() {
  return import("../../src/scheduler/factory.js");
}

describe("createScheduler", () => {
  it("returns LaunchdScheduler for darwin", async () => {
    const { createScheduler } = await getFactory();
    const scheduler = createScheduler("darwin");

    expect(LaunchdScheduler).toHaveBeenCalledTimes(1);
    expect(scheduler).toBeDefined();
  });

  it("returns WindowsScheduler for win32", async () => {
    const { createScheduler } = await getFactory();
    const scheduler = createScheduler("win32");

    expect(WindowsScheduler).toHaveBeenCalledTimes(1);
    expect(scheduler).toBeDefined();
  });

  it("throws UnsupportedPlatformError for linux", async () => {
    const { createScheduler, UnsupportedPlatformError } = await getFactory();

    expect(() => createScheduler("linux")).toThrow(UnsupportedPlatformError);
    expect(() => createScheduler("linux")).toThrow("Unsupported platform: linux");
  });

  it("throws UnsupportedPlatformError for unknown platforms", async () => {
    const { createScheduler, UnsupportedPlatformError } = await getFactory();

    expect(() => createScheduler("freebsd")).toThrow(UnsupportedPlatformError);
  });
});
