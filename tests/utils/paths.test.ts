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

// paths.ts のモジュールキャッシュを回避するため、各テストで動的 import を使用する。
// paths.ts のモジュールレベル定数（PACKAGE_ROOT 等）は import.meta.url から決定されるため、
// テストでは実際の PACKAGE_ROOT 値を取得して期待値に使用する。

describe("getBaseDir", () => {
  it("~/.sabori-flow を返す", async () => {
    const { getBaseDir } = await import("../../src/utils/paths.js");
    expect(getBaseDir()).toBe(path.join("/mock/home", ".sabori-flow"));
  });
});

describe("getConfigPath", () => {
  it("~/.sabori-flow/config.yml を返す", async () => {
    const { getConfigPath } = await import("../../src/utils/paths.js");
    expect(getConfigPath()).toBe(
      path.join("/mock/home", ".sabori-flow", "config.yml"),
    );
  });
});

describe("getUserPromptsDir", () => {
  it("~/.sabori-flow/prompts を返す", async () => {
    const { getUserPromptsDir } = await import("../../src/utils/paths.js");
    expect(getUserPromptsDir()).toBe(
      path.join("/mock/home", ".sabori-flow", "prompts"),
    );
  });
});

describe("getLogsDir", () => {
  it("~/.sabori-flow/logs を返す", async () => {
    const { getLogsDir } = await import("../../src/utils/paths.js");
    expect(getLogsDir()).toBe(
      path.join("/mock/home", ".sabori-flow", "logs"),
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

  it("getPlistTemplatePath は PACKAGE_ROOT/launchd/com.github.sabori-flow.plist.template を返す", async () => {
    const { getPlistTemplatePath, PACKAGE_ROOT } = await import(
      "../../src/utils/paths.js"
    );
    expect(getPlistTemplatePath()).toBe(
      path.join(PACKAGE_ROOT, "launchd", "com.github.sabori-flow.plist.template"),
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
