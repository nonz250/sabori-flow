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

vi.mock("../../src/worker/config.js", () => ({
  loadConfig: vi.fn(),
  ConfigValidationError: class ConfigValidationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigValidationError";
    }
  },
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    PACKAGE_ROOT: "/mock/package-root",
    PLIST_TEMPLATE_PATH: "/mock/package-root/launchd/template.plist",
    PLIST_DEST_DIR: "/mock/home/Library/LaunchAgents",
    PLIST_DEST_PATH: "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getLogsDir: vi.fn().mockReturnValue("/mock/data/logs"),
    getBaseDir: vi.fn().mockReturnValue("/mock/data"),
    getPlistGeneratedPath: vi.fn().mockReturnValue("/mock/data/com.github.sabori-flow.plist"),
  };
});

import fs from "fs";
import { exec, commandExists, ShellError } from "../../src/utils/shell.js";
import { renderPlist } from "../../src/utils/plist.js";
import { loadConfig, ConfigValidationError } from "../../src/worker/config.js";
import {
  getConfigPath,
  getLogsDir,
  getBaseDir,
  getPlistGeneratedPath,
} from "../../src/utils/paths.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedCommandExists = vi.mocked(commandExists);
const mockedRenderPlist = vi.mocked(renderPlist);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetLogsDir = vi.mocked(getLogsDir);
const mockedGetBaseDir = vi.mocked(getBaseDir);
const mockedGetPlistGeneratedPath = vi.mocked(getPlistGeneratedPath);

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  // paths のモック関数は restoreAllMocks でリセットされるため毎回再設定
  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetLogsDir.mockReturnValue("/mock/data/logs");
  mockedGetBaseDir.mockReturnValue("/mock/data");
  mockedGetPlistGeneratedPath.mockReturnValue("/mock/data/com.github.sabori-flow.plist");

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runInstallCommand(options: { local?: boolean } = {}): Promise<void> {
  const { installCommand } = await import("../../src/commands/install.js");
  return installCommand(options);
}

// ---------- Helpers ----------

/** 正常系の前提条件をセットアップする（デフォルト: npx モード） */
function setupNormalFlow(overrides?: {
  configYaml?: string;
  npxPath?: string;
  templateContent?: string;
  renderedPlist?: string;
  intervalMinutes?: number;
}): void {
  const {
    configYaml = YAML.stringify({ repositories: [] }),
    npxPath = "/usr/local/bin/npx",
    templateContent = "<plist>template</plist>",
    renderedPlist = "<plist>rendered</plist>",
    intervalMinutes = 60,
  } = overrides ?? {};

  // config.yml が存在する
  mockedFs.existsSync.mockReturnValue(true);
  // npx コマンドが存在する
  mockedCommandExists.mockReturnValue(true);
  // config.yml の内容（テンプレート読み込み用）
  mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
    if (filePath === "/mock/package-root/launchd/template.plist") return templateContent;
    return "";
  });
  // loadConfig の戻り値
  mockedLoadConfig.mockReturnValue({
    repositories: [],
    execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes },
  });
  // which npx の結果
  mockedExec.mockImplementation((file: string, args: readonly string[]) => {
    if (file === "which" && args[0] === "npx") return npxPath;
    return "";
  });
  // renderPlist の戻り値
  mockedRenderPlist.mockReturnValue(renderedPlist);
}

/** --local モードの正常系セットアップ */
function setupLocalFlow(overrides?: {
  configYaml?: string;
  nodePath?: string;
  templateContent?: string;
  renderedPlist?: string;
  intervalMinutes?: number;
}): void {
  const {
    configYaml = YAML.stringify({ repositories: [] }),
    nodePath = "/usr/local/bin/node",
    templateContent = "<plist>template</plist>",
    renderedPlist = "<plist>rendered</plist>",
    intervalMinutes = 60,
  } = overrides ?? {};

  mockedFs.existsSync.mockReturnValue(true);
  mockedCommandExists.mockReturnValue(true);
  mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
    if (filePath === "/mock/package-root/launchd/template.plist") return templateContent;
    return "";
  });
  mockedLoadConfig.mockReturnValue({
    repositories: [],
    execution: { maxParallel: 1, maxIssuesPerRepo: 1, intervalMinutes },
  });
  mockedExec.mockImplementation((file: string, args: readonly string[]) => {
    if (file === "which" && args[0] === "node") return nodePath;
    return "";
  });
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

describe("installCommand - デフォルト（npx モード）", () => {
  describe("npx コマンドが見つからない場合", () => {
    it("エラーメッセージを出力し、早期 return する", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(false);

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx が見つかりません"),
      );
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("which npx の結果が空文字列の場合", () => {
    it("エラーメッセージを出力し、早期 return する", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(YAML.stringify({ repositories: [] }));
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "npx") return "";
        return "";
      });

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx のパスを正しく解決できませんでした"),
      );
      expect(mockedRenderPlist).not.toHaveBeenCalled();
    });
  });

  describe("which npx の結果が相対パスの場合", () => {
    it("エラーメッセージを出力し、早期 return する", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(YAML.stringify({ repositories: [] }));
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "npx") return "npx";
        return "";
      });

      await runInstallCommand();

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("npx のパスを正しく解決できませんでした"),
      );
      expect(mockedRenderPlist).not.toHaveBeenCalled();
    });
  });

  describe("正常フロー", () => {
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
        if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
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
      expect(placeholders.programArguments).toEqual(["/usr/local/bin/npx", "sabori-flow", "worker"]);
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
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        0o600,
      );
    });

    it("完了メッセージに「60分ごとにワーカーが実行されます」が含まれる", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("60分ごとにワーカーが実行されます"),
      );
    });

    it("完了メッセージに「インストールが完了しました」が含まれる", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("インストールが完了しました"),
      );
    });

    it("生成した plist を getBaseDir 配下に mode 0o600 で書き込む", async () => {
      setupNormalFlow({ renderedPlist: "<plist>final-output</plist>" });

      await runInstallCommand();

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        "/mock/data/com.github.sabori-flow.plist",
        "<plist>final-output</plist>",
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("launchctl load が PLIST_DEST_PATH で呼ばれる", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(mockedExec).toHaveBeenCalledWith("launchctl", [
        "load",
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
      ]);
    });

    it("renderPlist に startInterval: 3600 が渡される（デフォルト 60 分）", async () => {
      setupNormalFlow();

      await runInstallCommand();

      expect(mockedRenderPlist).toHaveBeenCalledTimes(1);
      const [_template, placeholders] = mockedRenderPlist.mock.calls[0];
      expect(placeholders.startInterval).toBe(3600);
    });

    it("interval_minutes: 30 の場合、startInterval: 1800 が渡される", async () => {
      setupNormalFlow({ intervalMinutes: 30 });

      await runInstallCommand();

      expect(mockedRenderPlist).toHaveBeenCalledTimes(1);
      const [_template, placeholders] = mockedRenderPlist.mock.calls[0];
      expect(placeholders.startInterval).toBe(1800);
    });

    it("interval_minutes: 30 の場合、完了メッセージに「30分ごと」が含まれる", async () => {
      setupNormalFlow({ intervalMinutes: 30 });

      await runInstallCommand();

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("30分ごとにワーカーが実行されます"),
      );
    });
  });
});

describe("installCommand - --local モード", () => {
  describe("node コマンドが見つからない場合", () => {
    it("エラーメッセージを出力し、早期 return する", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(false);

      await runInstallCommand({ local: true });

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("node が見つかりません"),
      );
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
      expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe("which node の結果が空文字列の場合", () => {
    it("エラーメッセージを出力し、早期 return する", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedCommandExists.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue(YAML.stringify({ repositories: [] }));
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "node") return "";
        return "";
      });

      await runInstallCommand({ local: true });

      expect(consoleSpy.error).toHaveBeenCalledWith(
        expect.stringContaining("node のパスを正しく解決できませんでした"),
      );
      expect(mockedRenderPlist).not.toHaveBeenCalled();
    });
  });

  describe("正常フロー", () => {
    it("renderPlist に node パスと dist/worker.js を含む programArguments が渡される", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      expect(mockedRenderPlist).toHaveBeenCalledTimes(1);
      const [_template, placeholders] = mockedRenderPlist.mock.calls[0];
      expect(placeholders.programArguments).toEqual([
        "/usr/local/bin/node",
        "/mock/package-root/dist/worker.js",
      ]);
    });

    it("which node が呼ばれる", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      expect(mockedExec).toHaveBeenCalledWith("which", ["node"]);
    });

    it("PACKAGE_ROOT が programArguments のパスに使用される", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      const [_template, placeholders] = mockedRenderPlist.mock.calls[0];
      // PACKAGE_ROOT は /mock/package-root にモックされている
      expect(placeholders.programArguments[1]).toBe("/mock/package-root/dist/worker.js");
    });

    it("完了メッセージに「ローカルビルドのワーカーを登録しました」が含まれる", async () => {
      setupLocalFlow();

      await runInstallCommand({ local: true });

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringContaining("ローカルビルドのワーカーを登録しました"),
      );
    });

    it("launchctl load が正常に呼ばれる", async () => {
      setupLocalFlow();
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        if (file === "which" && args[0] === "node") return "/usr/local/bin/node";
        return "";
      });

      await runInstallCommand({ local: true });

      expect(mockedExec).toHaveBeenCalledWith("launchctl", [
        "load",
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
      ]);
    });
  });
});

describe("installCommand - buildMinimalPath の間接検証", () => {
  it("REQUIRED_COMMANDS のディレクトリが path に含まれる", async () => {
    setupNormalFlow();
    // which の結果を各コマンドごとに異なるディレクトリで返す
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which") {
        const cmdPathMap: Record<string, string> = {
          npx: "/usr/local/bin/npx",
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
        if (args[0] === "npx") return "/usr/local/bin/npx";
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
    // 全コマンドが同じディレクトリを返す（which npx も含む）
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
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
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
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
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

describe("installCommand - ConfigValidationError 発生時", () => {
  it("config.yml のバリデーションエラーメッセージを出力し、早期 return する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedCommandExists.mockReturnValue(true);
    mockedExec.mockImplementation((file: string, args: readonly string[]) => {
      if (file === "which" && args[0] === "npx") return "/usr/local/bin/npx";
      return "";
    });
    mockedLoadConfig.mockImplementation(() => {
      throw new ConfigValidationError("interval_minutes: must be >= 10, got 5");
    });

    await runInstallCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml のバリデーションに失敗しました"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("interval_minutes: must be >= 10, got 5"),
    );
    // renderPlist は呼ばれない（エラーにより早期 return）
    expect(mockedRenderPlist).not.toHaveBeenCalled();
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

describe("installCommand - ログディレクトリは getLogsDir() 固定で決まる", () => {
  it("getLogsDir() の値がログディレクトリとして使用される", async () => {
    setupNormalFlow();

    await runInstallCommand();

    // getLogsDir() のモック値が使用される
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/data/logs",
      { recursive: true, mode: 0o700 },
    );
    expect(mockedRenderPlist.mock.calls[0][1].logDir).toBe("/mock/data/logs");
  });
});
