import { describe, it, expect, vi, beforeEach } from "vitest";
import { existsSync } from "node:fs";

vi.mock("node:fs");
vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/home/user"),
}));
vi.mock("../../src/utils/paths.js", () => ({
  getConfigPath: vi.fn(() => "/home/user/.sabori-flow/config.yml"),
}));

const mockedExistsSync = vi.mocked(existsSync);

describe("detectLegacyPaths", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns hasLegacyConfig=true when old config exists and new does not", async () => {
    mockedExistsSync.mockImplementation((p) => {
      if (p === "/home/user/.sabori-flow/config.yml") return false; // new config
      if (p === "/home/user/.config/sabori-flow/config.yml") return true; // legacy config
      return false;
    });

    const { detectLegacyPaths } = await import("../../src/utils/migration.js");
    const result = detectLegacyPaths();

    expect(result.hasLegacyConfig).toBe(true);
    expect(result.legacyConfigPath).toBe("/home/user/.config/sabori-flow/config.yml");
  });

  it("returns hasLegacyConfig=false when new config exists even if old exists", async () => {
    mockedExistsSync.mockImplementation((p) => {
      if (p === "/home/user/.sabori-flow/config.yml") return true; // new config
      if (p === "/home/user/.config/sabori-flow/config.yml") return true; // legacy config
      return false;
    });

    const { detectLegacyPaths } = await import("../../src/utils/migration.js");
    const result = detectLegacyPaths();

    expect(result.hasLegacyConfig).toBe(false);
  });

  it("returns hasLegacyData=true when old data dir exists", async () => {
    mockedExistsSync.mockImplementation((p) => {
      if (p === "/home/user/.local/share/sabori-flow") return true; // legacy data
      return false;
    });

    const { detectLegacyPaths } = await import("../../src/utils/migration.js");
    const result = detectLegacyPaths();

    expect(result.hasLegacyData).toBe(true);
    expect(result.legacyDataDir).toBe("/home/user/.local/share/sabori-flow");
  });

  it("returns both false when nothing exists", async () => {
    mockedExistsSync.mockReturnValue(false);

    const { detectLegacyPaths } = await import("../../src/utils/migration.js");
    const result = detectLegacyPaths();

    expect(result.hasLegacyConfig).toBe(false);
    expect(result.hasLegacyData).toBe(false);
  });
});

describe("formatMigrationMessage", () => {
  it("returns null when no legacy paths detected", async () => {
    const { formatMigrationMessage } = await import("../../src/utils/migration.js");
    const result = formatMigrationMessage({
      hasLegacyConfig: false,
      hasLegacyData: false,
      legacyConfigPath: "/home/user/.config/sabori-flow/config.yml",
      legacyDataDir: "/home/user/.local/share/sabori-flow",
    });

    expect(result).toBeNull();
  });

  it("returns message with mv command when hasLegacyConfig", async () => {
    const { formatMigrationMessage } = await import("../../src/utils/migration.js");
    const result = formatMigrationMessage({
      hasLegacyConfig: true,
      hasLegacyData: false,
      legacyConfigPath: "/home/user/.config/sabori-flow/config.yml",
      legacyDataDir: "/home/user/.local/share/sabori-flow",
    });

    expect(result).toContain("mv");
    expect(result).toContain("/home/user/.config/sabori-flow/config.yml");
    expect(result).toContain("/home/user/.sabori-flow/config.yml");
  });

  it("returns message with rm command when hasLegacyData", async () => {
    const { formatMigrationMessage } = await import("../../src/utils/migration.js");
    const result = formatMigrationMessage({
      hasLegacyConfig: false,
      hasLegacyData: true,
      legacyConfigPath: "/home/user/.config/sabori-flow/config.yml",
      legacyDataDir: "/home/user/.local/share/sabori-flow",
    });

    expect(result).toContain("rm -rf");
    expect(result).toContain("/home/user/.local/share/sabori-flow");
  });
});
