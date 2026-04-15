import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("../../src/commands/uninstall.js", () => ({
  uninstallCommand: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/commands/install.js", () => ({
  installCommand: vi.fn().mockResolvedValue(undefined),
}));

import { uninstallCommand } from "../../src/commands/uninstall.js";
import { installCommand } from "../../src/commands/install.js";

const mockedUninstallCommand = vi.mocked(uninstallCommand);
const mockedInstallCommand = vi.mocked(installCommand);

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();

  // restoreAllMocks resets mock implementations, so re-setup defaults
  mockedUninstallCommand.mockResolvedValue(undefined);
  mockedInstallCommand.mockResolvedValue(undefined);
});

// ---------- Lazy import (after mocks) ----------

async function runReinstallCommand(
  options: { local?: boolean; scheduler?: "launchd" | "cron" } = {},
): Promise<void> {
  const { reinstallCommand } = await import(
    "../../src/commands/reinstall.js"
  );
  return reinstallCommand(options);
}

// ---------- Tests ----------

describe("reinstallCommand - call order", () => {
  it("calls uninstallCommand before installCommand", async () => {
    const callOrder: string[] = [];
    mockedUninstallCommand.mockImplementation(async () => {
      callOrder.push("uninstall");
    });
    mockedInstallCommand.mockImplementation(async () => {
      callOrder.push("install");
    });

    await runReinstallCommand();

    expect(callOrder).toEqual(["uninstall", "install"]);
    expect(mockedUninstallCommand).toHaveBeenCalledWith({ interactive: false });
  });
});

describe("reinstallCommand - options passthrough", () => {
  it("passes { interactive: false } to uninstallCommand", async () => {
    await runReinstallCommand();

    expect(mockedUninstallCommand).toHaveBeenCalledTimes(1);
    expect(mockedUninstallCommand).toHaveBeenCalledWith({ interactive: false });
  });

  it("passes { local: true } to installCommand when called with --local", async () => {
    await runReinstallCommand({ local: true });

    expect(mockedInstallCommand).toHaveBeenCalledTimes(1);
    expect(mockedInstallCommand).toHaveBeenCalledWith({ local: true });
  });

  it("passes {} to installCommand when called with no arguments", async () => {
    await runReinstallCommand();

    expect(mockedInstallCommand).toHaveBeenCalledTimes(1);
    expect(mockedInstallCommand).toHaveBeenCalledWith({});
  });

  it("passes { scheduler: 'cron' } to installCommand when called with --scheduler cron", async () => {
    await runReinstallCommand({ scheduler: "cron" });

    expect(mockedInstallCommand).toHaveBeenCalledTimes(1);
    expect(mockedInstallCommand).toHaveBeenCalledWith({ scheduler: "cron" });
  });

  it("passes { local: true, scheduler: 'cron' } to installCommand when called with both options", async () => {
    await runReinstallCommand({ local: true, scheduler: "cron" });

    expect(mockedInstallCommand).toHaveBeenCalledTimes(1);
    expect(mockedInstallCommand).toHaveBeenCalledWith({ local: true, scheduler: "cron" });
  });
});

describe("reinstallCommand - error propagation", () => {
  it("rejects when uninstallCommand fails and does not call installCommand", async () => {
    const uninstallError = new Error("uninstall failed");
    mockedUninstallCommand.mockRejectedValue(uninstallError);

    await expect(runReinstallCommand()).rejects.toThrow("uninstall failed");

    expect(mockedInstallCommand).not.toHaveBeenCalled();
  });

  it("rejects when installCommand fails", async () => {
    const installError = new Error("install failed");
    mockedInstallCommand.mockRejectedValue(installError);

    await expect(runReinstallCommand()).rejects.toThrow("install failed");

    expect(mockedUninstallCommand).toHaveBeenCalledTimes(1);
  });
});

describe("reinstallCommand - return value", () => {
  it("resolves to undefined", async () => {
    const result = await runReinstallCommand();

    expect(result).toBeUndefined();
  });
});
