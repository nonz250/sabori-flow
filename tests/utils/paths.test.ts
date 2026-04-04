import path from "path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { homedir } from "node:os";
import { expandTilde } from "../../src/utils/paths.js";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(() => "/mock/home"),
  };
});

// XDG 準拠パス関数のテストでは、モジュールキャッシュを回避するため
// 各テストで動的 import を使用する。
// paths.ts のモジュールレベル定数（PACKAGE_ROOT 等）は import.meta.url から決定されるため、
// テストでは実際の PACKAGE_ROOT 値を取得して期待値に使用する。

describe("getConfigDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("XDG_CONFIG_HOME 未設定時は ~/.config/sabori-flow を返す", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    // 空文字は falsy なので未設定と同じ扱い
    const { getConfigDir } = await import("../../src/utils/paths.js");
    expect(getConfigDir()).toBe(
      path.join("/mock/home", ".config", "sabori-flow"),
    );
  });

  it("XDG_CONFIG_HOME 設定時はその値が使われる", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "/custom/config");
    const { getConfigDir } = await import("../../src/utils/paths.js");
    expect(getConfigDir()).toBe(
      path.join("/custom/config", "sabori-flow"),
    );
  });

  it("XDG_CONFIG_HOME に相対パスが設定された場合は path.resolve で絶対パスになる", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "relative/config");
    const { getConfigDir } = await import("../../src/utils/paths.js");
    const expected = path.join(
      path.resolve("relative/config"),
      "sabori-flow",
    );
    expect(getConfigDir()).toBe(expected);
  });
});

describe("getConfigPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getConfigDir()/config.yml を返す", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    const { getConfigPath } = await import("../../src/utils/paths.js");
    expect(getConfigPath()).toBe(
      path.join("/mock/home", ".config", "sabori-flow", "config.yml"),
    );
  });
});

describe("getUserPromptsDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getConfigDir()/prompts を返す", async () => {
    vi.stubEnv("XDG_CONFIG_HOME", "");
    const { getUserPromptsDir } = await import("../../src/utils/paths.js");
    expect(getUserPromptsDir()).toBe(
      path.join("/mock/home", ".config", "sabori-flow", "prompts"),
    );
  });
});

describe("getDataDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("XDG_DATA_HOME 未設定時は ~/.local/share/sabori-flow を返す", async () => {
    vi.stubEnv("XDG_DATA_HOME", "");
    const { getDataDir } = await import("../../src/utils/paths.js");
    expect(getDataDir()).toBe(
      path.join("/mock/home", ".local", "share", "sabori-flow"),
    );
  });

  it("XDG_DATA_HOME 設定時はその値が使われる", async () => {
    vi.stubEnv("XDG_DATA_HOME", "/custom/data");
    const { getDataDir } = await import("../../src/utils/paths.js");
    expect(getDataDir()).toBe(
      path.join("/custom/data", "sabori-flow"),
    );
  });
});

describe("getLogsDir", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("~/.sabori-flow/logs を返す", async () => {
    const { getLogsDir } = await import("../../src/utils/paths.js");
    expect(getLogsDir()).toBe(
      path.join("/mock/home", ".sabori-flow", "logs"),
    );
  });
});

describe("getPlistGeneratedPath", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("getDataDir()/{PLIST_LABEL}.plist を返す", async () => {
    vi.stubEnv("XDG_DATA_HOME", "");
    const { getPlistGeneratedPath, PLIST_LABEL } = await import(
      "../../src/utils/paths.js"
    );
    expect(getPlistGeneratedPath()).toBe(
      path.join(
        "/mock/home",
        ".local",
        "share",
        "sabori-flow",
        `${PLIST_LABEL}.plist`,
      ),
    );
  });
});

describe("パッケージ内部リソースパス", () => {
  it("getConfigExamplePath は PACKAGE_ROOT/config.yml.example を返す", async () => {
    const { getConfigExamplePath, PACKAGE_ROOT } = await import(
      "../../src/utils/paths.js"
    );
    expect(getConfigExamplePath()).toBe(
      path.join(PACKAGE_ROOT, "config.yml.example"),
    );
  });

  it("getDefaultPromptsDir は PACKAGE_ROOT/prompts を返す", async () => {
    const { getDefaultPromptsDir, PACKAGE_ROOT } = await import(
      "../../src/utils/paths.js"
    );
    expect(getDefaultPromptsDir()).toBe(path.join(PACKAGE_ROOT, "prompts"));
  });

  it("getPlistTemplatePath は PACKAGE_ROOT/launchd/{PLIST_LABEL}.plist.template を返す", async () => {
    const { getPlistTemplatePath, PACKAGE_ROOT, PLIST_LABEL } = await import(
      "../../src/utils/paths.js"
    );
    expect(getPlistTemplatePath()).toBe(
      path.join(PACKAGE_ROOT, "launchd", `${PLIST_LABEL}.plist.template`),
    );
  });
});

describe("expandTilde", () => {
  it("~ 単体は homedir() を返す", () => {
    expect(expandTilde("~")).toBe(homedir());
  });

  it("~/path/to/dir は homedir()/path/to/dir を返す", () => {
    const result = expandTilde("~/path/to/dir");
    expect(result).toBe(`${homedir()}/path/to/dir`);
  });

  it("絶対パスはそのまま返す", () => {
    expect(expandTilde("/absolute/path")).toBe("/absolute/path");
  });

  it("相対パスはそのまま返す", () => {
    expect(expandTilde("relative/path")).toBe("relative/path");
  });
});
