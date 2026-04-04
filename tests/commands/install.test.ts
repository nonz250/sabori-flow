import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

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

vi.mock("../../src/utils/plist.js", () => ({
  renderPlist: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    PACKAGE_ROOT: "/mock/package-root",
    PLIST_TEMPLATE_PATH: "/mock/package-root/launchd/template.plist",
    PLIST_DEST_DIR: "/mock/home/Library/LaunchAgents",
    PLIST_DEST_PATH: "/mock/home/Library/LaunchAgents/com.github.nonz250.sabori-flow.plist",
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getLogsDir: vi.fn().mockReturnValue("/mock/data/logs"),
    getDataDir: vi.fn().mockReturnValue("/mock/data"),
    getPlistGeneratedPath: vi.fn().mockReturnValue("/mock/data/com.github.nonz250.sabori-flow.plist"),
  };
});

import fs from "fs";
import { exec, commandExists, ShellError } from "../../src/utils/shell.js";
import { renderPlist } from "../../src/utils/plist.js";
import {
  getConfigPath,
  getLogsDir,
  getDataDir,
  getPlistGeneratedPath,
} from "../../src/utils/paths.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedCommandExists = vi.mocked(commandExists);
const mockedRenderPlist = vi.mocked(renderPlist);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetLogsDir = vi.mocked(getLogsDir);
const mockedGetDataDir = vi.mocked(getDataDir);
const mockedGetPlistGeneratedPath = vi.mocked(getPlistGeneratedPath);

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  // paths のモック関数は restoreAllMocks でリセットされるため毎回再設定
  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetLogsDir.mockReturnValue("/mock/data/logs");
  mockedGetDataDir.mockReturnValue("/mock/data");
  mockedGetPlistGeneratedPath.mockReturnValue("/mock/data/com.github.nonz250.sabori-flow.plist");

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runInstallCommand(): Promise<void> {
  const { installCommand } = await import("../../src/commands/install.js");
  return installCommand();
}

// ---------- Helpers ----------

/** 正常系の前提条件をセットアップする */
function setupNormalFlow(overrides?: {
  configYaml?: string;
  nodePath?: string;
  templateContent?: string;
  renderedPlist?: string;
}): void {
  const {
    configYaml = YAML.stringify({ repositories: [] }),
    nodePath = "/usr/local/bin/node",
    templateContent = "<plist>template</plist>",
    renderedPlist = "<plist>rendered</plist>",
  } = overrides ?? {};

  // config.yml が存在する
  mockedFs.existsSync.mockReturnValue(true);
  // node コマンドが存在する
  mockedCommandExists.mockReturnValue(true);
  // config.yml の内容
  mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
    if (filePath === "/mock/config/dir/config.yml") return configYaml;
    if (filePath === "/mock/package-root/launchd/template.plist") return templateContent;
    return "";
  });
  // which node の結果
  mockedExec.mockImplementation((file: string, args: readonly string[]) => {
    if (file === "which" && args[0] === "node") return nodePath;
    return "";
  });
  // renderPlist の戻り値
  mockedRenderPlist.mockReturnValue(renderedPlist);
}

// ---------- Tests ----------

describe("installCommand - config.yml が存在しない場合", () => {
  it("sabori-flow init を案内するエラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(false);

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml が見つかりません"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("sabori-flow init"),
    );
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("installCommand - node コマンドが見つからない場合", () => {
  it("エラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(false);

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("node が見つかりません"),
    );
    expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("installCommand - which node の結果が空文字列の場合", () => {
  it("エラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(YAML.stringify({ repositories: [] }));
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "node") return "";
      return "";
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("node のパスを正しく解決できませんでした"),
    );
    expect(mockedRenderPlist).not.toHaveBeenCalled();
  });
});

describe("installCommand - which node の結果が相対パスの場合", () => {
  it("エラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(true);
    mockedFs.readFileSync.mockReturnValue(YAML.stringify({ repositories: [] }));
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "node") return "node";
      return "";
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("node のパスを正しく解決できませんでした"),
    );
    expect(mockedRenderPlist).not.toHaveBeenCalled();
  });
});

describe("installCommand - 正常フロー", () => {
  it("ログディレクトリ作成、plist 生成、launchd 登録が正しい順序で実行される", async () => {
    setupNormalFlow();
    const callOrder: string[] = [];
    mockedFs.mkdirSync.mockImplementation((..._args: unknown[]) => {
      const dir = _args[0] as string;
      callOrder.push(`mkdirSync:${dir}`);
      return undefined;
    });
    mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
      callOrder.push(`readFileSync:${filePath}`);
      if (filePath === "/mock/config/dir/config.yml") {
        return YAML.stringify({ repositories: [] });
      }
      if (filePath === "/mock/package-root/launchd/template.plist") {
        return "<plist>template</plist>";
      }
      return "";
    });
    mockedRenderPlist.mockImplementation((..._args: unknown[]) => {
      callOrder.push("renderPlist");
      return "<plist>rendered</plist>";
    });
    mockedFs.writeFileSync.mockImplementation((..._args: unknown[]) => {
      callOrder.push("writeFileSync");
      return undefined;
    });
    mockedFs.copyFileSync.mockImplementation((..._args: unknown[]) => {
      callOrder.push("copyFileSync");
      return undefined;
    });
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "node") return "/usr/local/bin/node";
      if (file === "launchctl") callOrder.push("launchctl");
      return "";
    });

    await runInstallCommand();

    // ログディレクトリ作成が最初に呼ばれる
    expect(callOrder.indexOf("mkdirSync:/mock/data/logs")).toBeLessThan(
      callOrder.indexOf("readFileSync:/mock/package-root/launchd/template.plist"),
    );
    // テンプレート読み込み後に renderPlist
    expect(callOrder.indexOf("readFileSync:/mock/package-root/launchd/template.plist")).toBeLessThan(
      callOrder.indexOf("renderPlist"),
    );
    // renderPlist 後に plist 書き込み
    expect(callOrder.indexOf("renderPlist")).toBeLessThan(
      callOrder.indexOf("writeFileSync"),
    );
    // plist 書き込み後に copyFileSync
    expect(callOrder.indexOf("writeFileSync")).toBeLessThan(
      callOrder.indexOf("copyFileSync"),
    );
    // copyFileSync 後に launchctl load
    expect(callOrder.indexOf("copyFileSync")).toBeLessThan(
      callOrder.indexOf("launchctl"),
    );
  });

  it("renderPlist に正しい引数が渡される", async () => {
    setupNormalFlow();

    await runInstallCommand();

    expect(mockedRenderPlist).toHaveBeenCalledTimes(1);
    const [template, placeholders] = mockedRenderPlist.mock.calls[0];
    expect(template).toBe("<plist>template</plist>");
    expect(placeholders.nodePath).toBe("/usr/local/bin/node");
    expect(placeholders.projectRoot).toBe("/mock/package-root");
    expect(placeholders.logDir).toBe("/mock/data/logs");
    // path は buildMinimalPath の結果: STANDARD_PATHS + which で解決したディレクトリ
    expect(placeholders.path).toContain("/usr/local/bin");
    expect(placeholders.path).toContain("/usr/bin");
    expect(placeholders.path).toContain("/bin");
  });

  it("plist コピー先に chmod 0o600 が設定される", async () => {
    setupNormalFlow();

    await runInstallCommand();

    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      "/mock/home/Library/LaunchAgents/com.github.nonz250.sabori-flow.plist",
      0o600,
    );
  });

  it("完了メッセージに「1時間ごとにワーカーが実行されます」が含まれる", async () => {
    setupNormalFlow();

    await runInstallCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("1時間ごとにワーカーが実行されます"),
    );
  });

  it("生成した plist を getDataDir 配下に mode 0o600 で書き込む", async () => {
    setupNormalFlow({ renderedPlist: "<plist>final-output</plist>" });

    await runInstallCommand();

    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/mock/data/com.github.nonz250.sabori-flow.plist",
      "<plist>final-output</plist>",
      { encoding: "utf-8", mode: 0o600 },
    );
  });

  it("launchctl load が PLIST_DEST_PATH で呼ばれる", async () => {
    setupNormalFlow();

    await runInstallCommand();

    expect(mockedExec).toHaveBeenCalledWith("launchctl", [
      "load",
      "/mock/home/Library/LaunchAgents/com.github.nonz250.sabori-flow.plist",
    ]);
  });
});

describe("installCommand - buildMinimalPath の間接検証", () => {
  it("REQUIRED_COMMANDS のディレクトリが path に含まれる", async () => {
    setupNormalFlow();
    // which の結果を各コマンドごとに異なるディレクトリで返す
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") {
        const cmdPathMap: Record<string, string> = {
          node: "/usr/local/bin/node",
          git: "/usr/bin/git",
          gh: "/opt/homebrew/bin/gh",
          claude: "/home/user/.local/bin/claude",
        };
        return cmdPathMap[args[0]] ?? "";
      }
      return "";
    });

    await runInstallCommand();

    const pathArg = mockedRenderPlist.mock.calls[0][1].path;
    // STANDARD_PATHS
    expect(pathArg).toContain("/usr/local/bin");
    expect(pathArg).toContain("/usr/bin");
    expect(pathArg).toContain("/bin");
    // REQUIRED_COMMANDS のディレクトリ
    expect(pathArg).toContain("/opt/homebrew/bin");
    expect(pathArg).toContain("/home/user/.local/bin");
  });

  it("which が失敗したコマンドはスキップされ、STANDARD_PATHS は含まれる", async () => {
    setupNormalFlow();
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") {
        if (args[0] === "node") return "/usr/local/bin/node";
        // それ以外のコマンドは失敗
        throw new Error("not found");
      }
      return "";
    });

    await runInstallCommand();

    const pathArg = mockedRenderPlist.mock.calls[0][1].path;
    // STANDARD_PATHS は必ず含まれる
    expect(pathArg).toContain("/usr/local/bin");
    expect(pathArg).toContain("/usr/bin");
    expect(pathArg).toContain("/bin");
  });

  it("重複するディレクトリは1回のみ含まれる", async () => {
    setupNormalFlow();
    // 全コマンドが同じディレクトリを返す
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") return "/usr/local/bin/" + args[0];
      return "";
    });

    await runInstallCommand();

    const pathArg = mockedRenderPlist.mock.calls[0][1].path;
    const dirs = pathArg.split(":");
    const uniqueDirs = new Set(dirs);
    expect(dirs.length).toBe(uniqueDirs.size);
  });
});

describe("installCommand - ShellError 発生時", () => {
  it("エラーメッセージを出力し、早期 return する", async () => {
    setupNormalFlow();
    // launchctl load で ShellError を発生させる
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "node") return "/usr/local/bin/node";
      if (file === "launchctl") {
        throw new ShellError("launchctl の実行に失敗しました", "stderr output");
      }
      return "";
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("launchctl の実行に失敗しました"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith("stderr output");
  });

  it("ShellError に stderr がない場合は stderr 行が出力されない", async () => {
    setupNormalFlow();
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "node") return "/usr/local/bin/node";
      if (file === "launchctl") {
        throw new ShellError("launchctl の実行に失敗しました", "");
      }
      return "";
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("launchctl の実行に失敗しました"),
    );
    // stderr が空なので2回目の console.error は呼ばれない
    const stderrCalls = consoleSpy.error.mock.calls.filter(
      (call) => call[0] === "",
    );
    expect(stderrCalls).toHaveLength(0);
  });
});

describe("installCommand - 予期しないエラー発生時", () => {
  it("「予期しないエラー」メッセージを出力し、早期 return する", async () => {
    setupNormalFlow();
    // writeFileSync で予期しないエラーを発生させる
    mockedFs.writeFileSync.mockImplementation(() => {
      throw new TypeError("unexpected error");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      "予期しないエラーが発生しました:",
      expect.any(TypeError),
    );
    // launchctl は呼ばれない（エラーにより早期 return）
    expect(mockedExec).not.toHaveBeenCalledWith(
      "launchctl",
      expect.anything(),
    );
  });
});

describe("installCommand - getLogDir: config.yml に log_dir が指定されている場合", () => {
  it("config.yml の log_dir が使用される", async () => {
    const configWithLogDir = YAML.stringify({
      repositories: [],
      execution: { log_dir: "/custom/log/dir" },
    });
    setupNormalFlow({ configYaml: configWithLogDir });

    await runInstallCommand();

    // ログディレクトリが config の log_dir で作成される
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/custom/log/dir",
      { recursive: true, mode: 0o700 },
    );
    // renderPlist にも config の log_dir が渡される
    expect(mockedRenderPlist.mock.calls[0][1].logDir).toBe("/custom/log/dir");
  });
});

describe("installCommand - getLogDir: config.yml に log_dir がない場合", () => {
  it("getLogsDir() のデフォルト値が使用される", async () => {
    const configWithoutLogDir = YAML.stringify({
      repositories: [],
      execution: { max_parallel: 1 },
    });
    setupNormalFlow({ configYaml: configWithoutLogDir });

    await runInstallCommand();

    // getLogsDir() のモック値が使用される
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
    expect(mockedRenderPlist.mock.calls[0][1].logDir).toBe("/mock/data/logs");
  });
});

describe("installCommand - getLogDir: config.yml のパースに失敗した場合", () => {
  it("getLogsDir() のデフォルト値にフォールバックする", async () => {
    setupNormalFlow();
    // config.yml の readFileSync が不正な YAML を返す
    mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
      if (filePath === "/mock/config/dir/config.yml") return ":\n  :\n  - [invalid\n";
      if (filePath === "/mock/package-root/launchd/template.plist") return "<plist>template</plist>";
      return "";
    });

    await runInstallCommand();

    // getLogsDir() のデフォルト値にフォールバック
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
    expect(mockedRenderPlist.mock.calls[0][1].logDir).toBe("/mock/data/logs");
  });
});

describe("installCommand - getLogDir: log_dir が空文字列の場合", () => {
  it("getLogsDir() のデフォルト値が使用される", async () => {
    const configWithEmptyLogDir = YAML.stringify({
      repositories: [],
      execution: { log_dir: "" },
    });
    setupNormalFlow({ configYaml: configWithEmptyLogDir });

    await runInstallCommand();

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
    expect(mockedRenderPlist.mock.calls[0][1].logDir).toBe("/mock/data/logs");
  });
});
