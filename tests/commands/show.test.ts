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

vi.mock("../../src/worker/config.js", () => ({
  loadConfig: vi.fn(),
  ConfigValidationError: class ConfigValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigValidationError";
    }
  },
}));

vi.mock("../../src/worker/config-inspect.js", () => ({
  readRawConfigDocument: vi.fn(),
  inspectConfig: vi.fn(),
}));

vi.mock("../../src/commands/helpers/config-render.js", () => ({
  renderConfigInspection: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    getConfigPath: vi.fn().mockReturnValue("/mock/config/config.yml"),
  };
});

// ---------- Imports ----------

import fs from "fs";
import {
  loadConfig,
  ConfigValidationError,
} from "../../src/worker/config.js";
import {
  readRawConfigDocument,
  inspectConfig,
} from "../../src/worker/config-inspect.js";
import { renderConfigInspection } from "../../src/commands/helpers/config-render.js";
import { getConfigPath } from "../../src/utils/paths.js";
import { showCommand } from "../../src/commands/show.js";

const mockedFs = vi.mocked(fs);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedReadRawConfigDocument = vi.mocked(readRawConfigDocument);
const mockedInspectConfig = vi.mocked(inspectConfig);
const mockedRenderConfigInspection = vi.mocked(renderConfigInspection);
const mockedGetConfigPath = vi.mocked(getConfigPath);

// ---------- Setup ----------

let consoleSpy: {
  log: ReturnType<typeof vi.spyOn>;
  error: ReturnType<typeof vi.spyOn>;
};
let savedExitCode: number | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = undefined;

  vi.restoreAllMocks();

  mockedGetConfigPath.mockReturnValue("/mock/config/config.yml");

  mockedFs.existsSync.mockReset();
  mockedFs.writeFileSync.mockReset();
  mockedFs.mkdirSync.mockReset();
  mockedFs.copyFileSync.mockReset();
  mockedFs.chmodSync.mockReset();
  mockedLoadConfig.mockReset();
  mockedReadRawConfigDocument.mockReset();
  mockedInspectConfig.mockReset();
  mockedRenderConfigInspection.mockReset();

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

afterEach(() => {
  process.exitCode = savedExitCode;
});

// ---------- Helpers ----------

function setupNormalFlow(overrides?: {
  lines?: string[];
  hasDefaultValues?: boolean;
}): void {
  const {
    lines = ["repositories (1)", "REPOSITORY  BRANCH", "acme/app    main*"],
    hasDefaultValues = false,
  } = overrides ?? {};

  mockedFs.existsSync.mockReturnValue(true);
  mockedLoadConfig.mockReturnValue({
    language: "ja",
    repositories: [],
    execution: {
      maxParallel: 1,
      maxIssuesPerRepo: 1,
      autonomy: "interactive",
      intervalMinutes: 60,
      timeoutMinutes: 60,
      language: "ja",
    },
  } as ReturnType<typeof loadConfig>);
  mockedReadRawConfigDocument.mockReturnValue({});
  mockedInspectConfig.mockReturnValue({
    repositories: [],
    execution: {
      maxParallel: { value: 1, source: "default" },
      maxIssuesPerRepo: { value: 1, source: "default" },
      autonomy: { value: "interactive", source: "default" },
      intervalMinutes: { value: 60, source: "default" },
      timeoutMinutes: { value: 60, source: "default" },
    },
    language: { value: "ja", source: "default" },
  } as ReturnType<typeof inspectConfig>);
  mockedRenderConfigInspection.mockReturnValue({ lines, hasDefaultValues });
}

// ---------- Tests: config.yml not found ----------

describe("showCommand - config.yml not found", () => {
  it("outputs configNotFound and runInitFirst to stderr", () => {
    mockedFs.existsSync.mockReturnValue(false);

    showCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("sabori-flow init"),
    );
  });

  it("sets process.exitCode to 1", () => {
    mockedFs.existsSync.mockReturnValue(false);

    showCommand();

    expect(process.exitCode).toBe(1);
  });

  it("does not call loadConfig", () => {
    mockedFs.existsSync.mockReturnValue(false);

    showCommand();

    expect(mockedLoadConfig).not.toHaveBeenCalled();
  });
});

// ---------- Tests: ConfigValidationError ----------

describe("showCommand - ConfigValidationError", () => {
  it("outputs configValidationError with error message", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedLoadConfig.mockImplementation(() => {
      throw new ConfigValidationError("max_parallel: must be >= 1");
    });

    showCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("max_parallel: must be >= 1"),
    );
  });

  it("sets process.exitCode to 1", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedLoadConfig.mockImplementation(() => {
      throw new ConfigValidationError("test error");
    });

    showCommand();

    expect(process.exitCode).toBe(1);
  });
});

// ---------- Tests: unexpected error ----------

describe("showCommand - unexpected error", () => {
  it("outputs unexpectedError message", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedLoadConfig.mockImplementation(() => {
      throw new TypeError("something went wrong");
    });

    showCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("予期しないエラー"),
      expect.any(TypeError),
    );
  });

  it("sets process.exitCode to 1", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedLoadConfig.mockImplementation(() => {
      throw new TypeError("something went wrong");
    });

    showCommand();

    expect(process.exitCode).toBe(1);
  });
});

// ---------- Tests: normal flow ----------

describe("showCommand - normal flow", () => {
  it("outputs header and rendered lines to console.log", () => {
    setupNormalFlow({
      lines: ["line-1", "line-2"],
    });

    showCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("/mock/config/config.yml"),
    );
    expect(consoleSpy.log).toHaveBeenCalledWith("line-1\nline-2");
  });

  it("does not change process.exitCode", () => {
    setupNormalFlow();

    showCommand();

    expect(process.exitCode).toBeUndefined();
  });
});

// ---------- Tests: defaultLegend ----------

describe("showCommand - defaultLegend", () => {
  it("outputs defaultLegend when hasDefaultValues is true", () => {
    setupNormalFlow({ hasDefaultValues: true });

    showCommand();

    const logCalls = consoleSpy.log.mock.calls.map((call) => call[0]);
    const hasLegend = logCalls.some(
      (msg) => typeof msg === "string" && msg.includes("*"),
    );
    expect(hasLegend).toBe(true);
  });

  it("does not output defaultLegend when hasDefaultValues is false", () => {
    setupNormalFlow({ hasDefaultValues: false });

    showCommand();

    const logCalls = consoleSpy.log.mock.calls.map((call) => call[0]);
    const hasLegend = logCalls.some(
      (msg) =>
        typeof msg === "string" &&
        (msg.includes("デフォルト値が適用") ||
          msg.includes("default value is applied")),
    );
    expect(hasLegend).toBe(false);
  });
});

// ---------- Tests: verbose option ----------

describe("showCommand - verbose option", () => {
  it("passes { verbose: true } to renderConfigInspection when called with { verbose: true }", () => {
    setupNormalFlow();

    showCommand({ verbose: true });

    expect(mockedRenderConfigInspection).toHaveBeenCalledWith(
      expect.anything(),
      { verbose: true },
    );
  });

  it("passes { verbose: false } to renderConfigInspection when called without options", () => {
    setupNormalFlow();

    showCommand();

    expect(mockedRenderConfigInspection).toHaveBeenCalledWith(
      expect.anything(),
      { verbose: false },
    );
  });
});

// ---------- Tests: no write operations ----------

describe("showCommand - no write operations", () => {
  it("does not call any write fs APIs in the normal flow", () => {
    setupNormalFlow();

    showCommand();

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    expect(mockedFs.chmodSync).not.toHaveBeenCalled();
  });

  it("does not call any write fs APIs on config-not-found path", () => {
    mockedFs.existsSync.mockReturnValue(false);

    showCommand();

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    expect(mockedFs.chmodSync).not.toHaveBeenCalled();
  });

  it("does not call any write fs APIs on error path", () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedLoadConfig.mockImplementation(() => {
      throw new ConfigValidationError("bad config");
    });

    showCommand();

    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    expect(mockedFs.chmodSync).not.toHaveBeenCalled();
  });
});
