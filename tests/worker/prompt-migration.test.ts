import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockLoggerInstance } = vi.hoisted(() => ({
  mockLoggerInstance: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs");

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => mockLoggerInstance),
}));

vi.mock("../../src/utils/paths.js", () => ({
  getUserPromptsDir: vi.fn(() => "/mock/prompts"),
  getUserPromptsLanguageDir: vi.fn(() => "/mock/prompts/ja"),
}));

import { existsSync, mkdirSync, renameSync } from "node:fs";
import { getUserPromptsDir, getUserPromptsLanguageDir } from "../../src/utils/paths.js";
import { migrateFlatPromptTemplates } from "../../src/worker/prompt-migration.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedMkdirSync = vi.mocked(mkdirSync);
const mockedRenameSync = vi.mocked(renameSync);
const mockedGetUserPromptsDir = vi.mocked(getUserPromptsDir);
const mockedGetUserPromptsLanguageDir = vi.mocked(getUserPromptsLanguageDir);

beforeEach(() => {
  vi.restoreAllMocks();
  mockedGetUserPromptsDir.mockReturnValue("/mock/prompts");
  mockedGetUserPromptsLanguageDir.mockReturnValue("/mock/prompts/ja");
});

describe("migrateFlatPromptTemplates", () => {
  it("renames both plan.md and impl.md into the language directory", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/mock/prompts/plan.md") return true;
      if (path === "/mock/prompts/impl.md") return true;
      // dest files do not exist
      return false;
    });

    migrateFlatPromptTemplates("ja");

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockedRenameSync).toHaveBeenCalledWith(
      "/mock/prompts/plan.md",
      "/mock/prompts/ja/plan.md",
    );
    expect(mockedRenameSync).toHaveBeenCalledWith(
      "/mock/prompts/impl.md",
      "/mock/prompts/ja/impl.md",
    );
  });

  it("calls mkdirSync with recursive and mode 0o700 before renaming", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/mock/prompts/plan.md") return true;
      return false;
    });

    migrateFlatPromptTemplates("ja");

    expect(mockedMkdirSync).toHaveBeenCalledWith("/mock/prompts/ja", {
      recursive: true,
      mode: 0o700,
    });
    const mkdirOrder = mockedMkdirSync.mock.invocationCallOrder[0];
    const renameOrder = mockedRenameSync.mock.invocationCallOrder[0];
    expect(mkdirOrder).toBeLessThan(renameOrder);
  });

  it("skips rename when dest file already exists and logs a warning", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/mock/prompts/plan.md") return true;
      if (path === "/mock/prompts/ja/plan.md") return true;
      return false;
    });

    migrateFlatPromptTemplates("ja");

    expect(mockedRenameSync).not.toHaveBeenCalled();
    expect(mockedMkdirSync).not.toHaveBeenCalled();
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      "Skipping migration: both %s and %s exist",
      "/mock/prompts/plan.md",
      "/mock/prompts/ja/plan.md",
    );
  });

  it("continues to impl.md when plan.md rename throws and does not propagate the error", () => {
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/mock/prompts/plan.md") return true;
      if (path === "/mock/prompts/impl.md") return true;
      return false;
    });
    mockedRenameSync.mockImplementation((src) => {
      if (String(src) === "/mock/prompts/plan.md") {
        throw new Error("EPERM");
      }
    });

    expect(() => migrateFlatPromptTemplates("ja")).not.toThrow();

    expect(mockedRenameSync).toHaveBeenCalledTimes(2);
    expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
      "Failed to migrate %s: %s",
      "plan.md",
      expect.any(Error),
    );
    expect(mockLoggerInstance.info).toHaveBeenCalledWith(
      "Migrated %s -> %s",
      "/mock/prompts/impl.md",
      "/mock/prompts/ja/impl.md",
    );
  });

  it("does not call mkdirSync or renameSync when no flat files exist", () => {
    mockedExistsSync.mockReturnValue(false);

    migrateFlatPromptTemplates("ja");

    expect(mockedMkdirSync).not.toHaveBeenCalled();
    expect(mockedRenameSync).not.toHaveBeenCalled();
  });

  it("uses the 'en' language directory when language is 'en'", () => {
    mockedGetUserPromptsLanguageDir.mockReturnValue("/mock/prompts/en");
    mockedExistsSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/mock/prompts/plan.md") return true;
      return false;
    });

    migrateFlatPromptTemplates("en");

    expect(mockedGetUserPromptsLanguageDir).toHaveBeenCalledWith("en");
    expect(mockedMkdirSync).toHaveBeenCalledWith("/mock/prompts/en", {
      recursive: true,
      mode: 0o700,
    });
    expect(mockedRenameSync).toHaveBeenCalledWith(
      "/mock/prompts/plan.md",
      "/mock/prompts/en/plan.md",
    );
  });
});
