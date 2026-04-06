import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

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

vi.mock("../../src/scheduler/launchd-scheduler.js", () => {
  const MockLaunchdScheduler = vi.fn().mockImplementation(() => ({
    name: "launchd",
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
  return { LaunchdScheduler: MockLaunchdScheduler };
});

vi.mock("../../src/scheduler/systemd-scheduler.js", () => {
  const MockSystemdScheduler = vi.fn().mockImplementation(() => ({
    name: "systemd",
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
  return { SystemdScheduler: MockSystemdScheduler };
});

import { commandExists } from "../../src/utils/shell.js";
import { LaunchdScheduler } from "../../src/scheduler/launchd-scheduler.js";
import { SystemdScheduler } from "../../src/scheduler/systemd-scheduler.js";

const mockedCommandExists = vi.mocked(commandExists);
const mockedLaunchdScheduler = vi.mocked(LaunchdScheduler);
const mockedSystemdScheduler = vi.mocked(SystemdScheduler);

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();

  // restoreAllMocks resets mockImplementation, so re-setup
  mockedLaunchdScheduler.mockImplementation(() => ({
    name: "launchd",
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
  mockedSystemdScheduler.mockImplementation(() => ({
    name: "systemd",
    install: vi.fn(),
    uninstall: vi.fn(),
    isInstalled: vi.fn(),
  }));
});

// ---------- Lazy import ----------

async function importFactory() {
  return await import("../../src/scheduler/factory.js");
}

// ---------- Tests ----------

describe("createScheduler", () => {
  describe("darwin プラットフォームの場合", () => {
    it("LaunchdScheduler のインスタンスを返す", async () => {
      const { createScheduler } = await importFactory();

      const scheduler = createScheduler("darwin");

      expect(scheduler.name).toBe("launchd");
      expect(mockedLaunchdScheduler).toHaveBeenCalledTimes(1);
    });

    it("commandExists を呼ばない", async () => {
      const { createScheduler } = await importFactory();

      createScheduler("darwin");

      expect(mockedCommandExists).not.toHaveBeenCalled();
    });
  });

  describe("linux プラットフォームの場合", () => {
    describe("systemctl が利用可能な場合", () => {
      it("SystemdScheduler のインスタンスを返す", async () => {
        mockedCommandExists.mockReturnValue(true);
        const { createScheduler } = await importFactory();

        const scheduler = createScheduler("linux");

        expect(scheduler.name).toBe("systemd");
        expect(mockedSystemdScheduler).toHaveBeenCalledTimes(1);
      });

      it("commandExists を systemctl で呼び出す", async () => {
        mockedCommandExists.mockReturnValue(true);
        const { createScheduler } = await importFactory();

        createScheduler("linux");

        expect(mockedCommandExists).toHaveBeenCalledWith("systemctl");
      });
    });

    describe("systemctl が利用不可の場合", () => {
      it("SystemdNotAvailableError をスローする", async () => {
        mockedCommandExists.mockReturnValue(false);
        const { createScheduler, SystemdNotAvailableError } = await importFactory();

        expect(() => createScheduler("linux")).toThrow(SystemdNotAvailableError);
      });

      it("エラーメッセージに systemctl が見つからない旨が含まれる", async () => {
        mockedCommandExists.mockReturnValue(false);
        const { createScheduler } = await importFactory();

        expect(() => createScheduler("linux")).toThrow(
          "systemctl not found. systemd is required for scheduled execution on Linux.",
        );
      });
    });
  });

  describe("サポートされていないプラットフォームの場合", () => {
    it("win32 で UnsupportedPlatformError をスローする", async () => {
      const { createScheduler, UnsupportedPlatformError } = await importFactory();

      expect(() => createScheduler("win32")).toThrow(UnsupportedPlatformError);
    });

    it("エラーメッセージにプラットフォーム名が含まれる", async () => {
      const { createScheduler } = await importFactory();

      expect(() => createScheduler("win32")).toThrow("Unsupported platform: win32");
    });

    it("freebsd で UnsupportedPlatformError をスローする", async () => {
      const { createScheduler, UnsupportedPlatformError } = await importFactory();

      expect(() => createScheduler("freebsd")).toThrow(UnsupportedPlatformError);
    });

    it("空文字列で UnsupportedPlatformError をスローする", async () => {
      const { createScheduler, UnsupportedPlatformError } = await importFactory();

      expect(() => createScheduler("")).toThrow(UnsupportedPlatformError);
    });
  });
});

describe("UnsupportedPlatformError", () => {
  it("name プロパティが UnsupportedPlatformError である", async () => {
    const { UnsupportedPlatformError } = await importFactory();

    const error = new UnsupportedPlatformError("test-platform");

    expect(error.name).toBe("UnsupportedPlatformError");
  });

  it("Error を継承している", async () => {
    const { UnsupportedPlatformError } = await importFactory();

    const error = new UnsupportedPlatformError("test-platform");

    expect(error).toBeInstanceOf(Error);
  });

  it("instanceof で正しく判定できる", async () => {
    const { UnsupportedPlatformError } = await importFactory();

    const error = new UnsupportedPlatformError("test-platform");

    expect(error).toBeInstanceOf(UnsupportedPlatformError);
  });
});

describe("SystemdNotAvailableError", () => {
  it("name プロパティが SystemdNotAvailableError である", async () => {
    const { SystemdNotAvailableError } = await importFactory();

    const error = new SystemdNotAvailableError();

    expect(error.name).toBe("SystemdNotAvailableError");
  });

  it("Error を継承している", async () => {
    const { SystemdNotAvailableError } = await importFactory();

    const error = new SystemdNotAvailableError();

    expect(error).toBeInstanceOf(Error);
  });

  it("instanceof で正しく判定できる", async () => {
    const { SystemdNotAvailableError } = await importFactory();

    const error = new SystemdNotAvailableError();

    expect(error).toBeInstanceOf(SystemdNotAvailableError);
  });

  it("固定のエラーメッセージを持つ", async () => {
    const { SystemdNotAvailableError } = await importFactory();

    const error = new SystemdNotAvailableError();

    expect(error.message).toBe(
      "systemctl not found. systemd is required for scheduled execution on Linux.",
    );
  });
});
