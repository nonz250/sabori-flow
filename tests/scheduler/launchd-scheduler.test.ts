import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
    unlinkSync: vi.fn(),
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
    PLIST_DEST_PATH: "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
    getBaseDir: vi.fn().mockReturnValue("/mock/home/.sabori-flow"),
    getPlistGeneratedPath: vi.fn().mockReturnValue("/mock/home/.sabori-flow/com.github.sabori-flow.plist"),
  };
});

import fs from "fs";
import { exec } from "../../src/utils/shell.js";
import { renderPlist } from "../../src/utils/plist.js";
import {
  getBaseDir,
  getPlistGeneratedPath,
} from "../../src/utils/paths.js";
import type { SchedulerInstallOptions } from "../../src/scheduler/types.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedRenderPlist = vi.mocked(renderPlist);
const mockedGetBaseDir = vi.mocked(getBaseDir);
const mockedGetPlistGeneratedPath = vi.mocked(getPlistGeneratedPath);

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();

  mockedGetBaseDir.mockReturnValue("/mock/home/.sabori-flow");
  mockedGetPlistGeneratedPath.mockReturnValue("/mock/home/.sabori-flow/com.github.sabori-flow.plist");
});

// ---------- Lazy import ----------

async function createLaunchdScheduler() {
  const { LaunchdScheduler } = await import("../../src/scheduler/launchd-scheduler.js");
  return new LaunchdScheduler();
}

// ---------- Helpers ----------

const SECONDS_PER_HOUR = 3600;

function makeInstallOptions(overrides?: Partial<SchedulerInstallOptions>): SchedulerInstallOptions {
  return {
    intervalSeconds: SECONDS_PER_HOUR,
    programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/mock/home/.sabori-flow/logs",
    ...overrides,
  };
}

// ---------- Tests ----------

describe("LaunchdScheduler", () => {
  describe("name プロパティ", () => {
    it("launchd を返す", async () => {
      const scheduler = await createLaunchdScheduler();

      expect(scheduler.name).toBe("launchd");
    });
  });

  describe("install", () => {
    it("ベースディレクトリを mode 0o700 で再帰的に作成する", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        "/mock/home/.sabori-flow",
        { recursive: true, mode: 0o700 },
      );
    });

    it("plist テンプレートを読み込む", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        "/mock/package-root/launchd/template.plist",
        "utf-8",
      );
    });

    it("renderPlist に正しい引数を渡す", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const options = makeInstallOptions();
      const scheduler = await createLaunchdScheduler();

      scheduler.install(options);

      expect(mockedRenderPlist).toHaveBeenCalledWith("<plist>template</plist>", {
        programArguments: options.programArguments,
        path: options.path,
        logDir: options.logDir,
        startInterval: options.intervalSeconds,
      });
    });

    it("生成した plist を mode 0o600 で書き込む", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        "/mock/home/.sabori-flow/com.github.sabori-flow.plist",
        "<plist>rendered</plist>",
        { encoding: "utf-8", mode: 0o600 },
      );
    });

    it("LaunchAgents ディレクトリを再帰的に作成する", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        "/mock/home/Library/LaunchAgents",
        { recursive: true },
      );
    });

    it("生成した plist を LaunchAgents にコピーする", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.copyFileSync).toHaveBeenCalledWith(
        "/mock/home/.sabori-flow/com.github.sabori-flow.plist",
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
      );
    });

    it("コピー先の plist に chmod 0o600 を設定する", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.chmodSync).toHaveBeenCalledWith(
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        0o600,
      );
    });

    it("launchctl load を実行する", async () => {
      mockedFs.readFileSync.mockReturnValue("<plist>template</plist>");
      mockedRenderPlist.mockReturnValue("<plist>rendered</plist>");
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedExec).toHaveBeenCalledWith("launchctl", [
        "load",
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
      ]);
    });

    it("操作が正しい順序で実行される", async () => {
      const callOrder: string[] = [];
      mockedFs.mkdirSync.mockImplementation((..._args: unknown[]) => {
        callOrder.push(`mkdirSync:${_args[0]}`);
        return undefined;
      });
      mockedFs.readFileSync.mockImplementation((..._args: unknown[]) => {
        callOrder.push("readFileSync");
        return "<plist>template</plist>";
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
      mockedFs.chmodSync.mockImplementation((..._args: unknown[]) => {
        callOrder.push("chmodSync");
      });
      mockedExec.mockImplementation((..._args: unknown[]) => {
        callOrder.push("launchctl");
        return "";
      });
      const scheduler = await createLaunchdScheduler();

      scheduler.install(makeInstallOptions());

      expect(callOrder.indexOf("mkdirSync:/mock/home/.sabori-flow")).toBeLessThan(
        callOrder.indexOf("readFileSync"),
      );
      expect(callOrder.indexOf("readFileSync")).toBeLessThan(
        callOrder.indexOf("renderPlist"),
      );
      expect(callOrder.indexOf("renderPlist")).toBeLessThan(
        callOrder.indexOf("writeFileSync"),
      );
      expect(callOrder.indexOf("writeFileSync")).toBeLessThan(
        callOrder.indexOf("copyFileSync"),
      );
      expect(callOrder.indexOf("copyFileSync")).toBeLessThan(
        callOrder.indexOf("chmodSync"),
      );
      expect(callOrder.indexOf("chmodSync")).toBeLessThan(
        callOrder.indexOf("launchctl"),
      );
    });
  });

  describe("uninstall", () => {
    describe("plist がインストール済みの場合", () => {
      it("launchctl unload を実行する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedExec).toHaveBeenCalledWith("launchctl", [
          "unload",
          "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        ]);
      });

      it("LaunchAgents の plist を削除する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
          "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        );
      });

      it("生成済み plist バックアップを削除する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
          "/mock/home/.sabori-flow/com.github.sabori-flow.plist",
        );
      });

      it("launchctl unload が失敗しても例外をスローしない", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedExec.mockImplementation(() => {
          throw new Error("launchctl unload failed");
        });
        const scheduler = await createLaunchdScheduler();

        expect(() => scheduler.uninstall()).not.toThrow();
      });

      it("launchctl unload が失敗しても plist ファイルは削除される", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedExec.mockImplementation(() => {
          throw new Error("launchctl unload failed");
        });
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
          "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        );
      });
    });

    describe("plist がインストールされていない場合", () => {
      it("launchctl unload を実行しない", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          // PLIST_DEST_PATH は存在しない、生成済み plist は存在する
          if (filePath === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return false;
          return true;
        });
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedExec).not.toHaveBeenCalled();
      });

      it("LaunchAgents の plist を削除しない", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          if (filePath === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return false;
          return true;
        });
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith(
          "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
        );
      });

      it("生成済み plist が存在する場合は削除する", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          if (filePath === "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist") return false;
          if (filePath === "/mock/home/.sabori-flow/com.github.sabori-flow.plist") return true;
          return false;
        });
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(
          "/mock/home/.sabori-flow/com.github.sabori-flow.plist",
        );
      });

      it("生成済み plist も存在しない場合は何も削除しない", async () => {
        mockedFs.existsSync.mockReturnValue(false);
        const scheduler = await createLaunchdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
      });
    });
  });

  describe("isInstalled", () => {
    it("PLIST_DEST_PATH が存在する場合 true を返す", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const scheduler = await createLaunchdScheduler();

      const result = scheduler.isInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(
        "/mock/home/Library/LaunchAgents/com.github.sabori-flow.plist",
      );
    });

    it("PLIST_DEST_PATH が存在しない場合 false を返す", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const scheduler = await createLaunchdScheduler();

      const result = scheduler.isInstalled();

      expect(result).toBe(false);
    });
  });
});
