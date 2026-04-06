import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- Mocks ----------

vi.mock("node:os", () => ({
  homedir: vi.fn().mockReturnValue("/mock/home"),
}));

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
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

vi.mock("../../src/utils/systemd.js", () => ({
  renderServiceUnit: vi.fn(),
  renderTimerUnit: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    SYSTEMD_SERVICE_TEMPLATE_PATH: "/mock/package-root/systemd/sabori-flow.service.template",
    SYSTEMD_TIMER_TEMPLATE_PATH: "/mock/package-root/systemd/sabori-flow.timer.template",
  };
});

import fs from "fs";
import { exec } from "../../src/utils/shell.js";
import { renderServiceUnit, renderTimerUnit } from "../../src/utils/systemd.js";
import type { SchedulerInstallOptions } from "../../src/scheduler/types.js";

const mockedFs = vi.mocked(fs);
const mockedExec = vi.mocked(exec);
const mockedRenderServiceUnit = vi.mocked(renderServiceUnit);
const mockedRenderTimerUnit = vi.mocked(renderTimerUnit);

// ---------- Constants ----------

const SECONDS_PER_HOUR = 3600;
const SYSTEMD_USER_DIR = "/mock/home/.config/systemd/user";
const SERVICE_PATH = `${SYSTEMD_USER_DIR}/sabori-flow.service`;
const TIMER_PATH = `${SYSTEMD_USER_DIR}/sabori-flow.timer`;

// ---------- Setup ----------

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------- Lazy import ----------

async function createSystemdScheduler() {
  const { SystemdScheduler } = await import("../../src/scheduler/systemd-scheduler.js");
  return new SystemdScheduler();
}

// ---------- Helpers ----------

function makeInstallOptions(overrides?: Partial<SchedulerInstallOptions>): SchedulerInstallOptions {
  return {
    intervalSeconds: SECONDS_PER_HOUR,
    programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/mock/home/.sabori-flow/logs",
    ...overrides,
  };
}

function setupInstallMocks(): void {
  mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
    if (filePath === "/mock/package-root/systemd/sabori-flow.service.template") {
      return "[Service]\nExecStart=__EXEC_START__";
    }
    if (filePath === "/mock/package-root/systemd/sabori-flow.timer.template") {
      return "[Timer]\nOnBootSec=__ON_BOOT_SEC__";
    }
    return "";
  });
  mockedRenderServiceUnit.mockReturnValue("[Service]\nExecStart=/usr/local/bin/npx sabori-flow worker");
  mockedRenderTimerUnit.mockReturnValue("[Timer]\nOnBootSec=3600s");
}

// ---------- Tests ----------

describe("SystemdScheduler", () => {
  describe("name プロパティ", () => {
    it("systemd を返す", async () => {
      const scheduler = await createSystemdScheduler();

      expect(scheduler.name).toBe("systemd");
    });
  });

  describe("install", () => {
    it("systemd ユーザーディレクトリを mode 0o700 で再帰的に作成する", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
        SYSTEMD_USER_DIR,
        { recursive: true, mode: 0o700 },
      );
    });

    it("service テンプレートを読み込む", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        "/mock/package-root/systemd/sabori-flow.service.template",
        "utf-8",
      );
    });

    it("timer テンプレートを読み込む", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.readFileSync).toHaveBeenCalledWith(
        "/mock/package-root/systemd/sabori-flow.timer.template",
        "utf-8",
      );
    });

    it("renderServiceUnit に正しい引数を渡す", async () => {
      setupInstallMocks();
      const options = makeInstallOptions();
      const scheduler = await createSystemdScheduler();

      scheduler.install(options);

      expect(mockedRenderServiceUnit).toHaveBeenCalledWith(
        "[Service]\nExecStart=__EXEC_START__",
        {
          programArguments: options.programArguments,
          path: options.path,
          logDir: options.logDir,
          intervalSeconds: options.intervalSeconds,
        },
      );
    });

    it("renderTimerUnit に正しい引数を渡す", async () => {
      setupInstallMocks();
      const options = makeInstallOptions();
      const scheduler = await createSystemdScheduler();

      scheduler.install(options);

      expect(mockedRenderTimerUnit).toHaveBeenCalledWith(
        "[Timer]\nOnBootSec=__ON_BOOT_SEC__",
        {
          programArguments: options.programArguments,
          path: options.path,
          logDir: options.logDir,
          intervalSeconds: options.intervalSeconds,
        },
      );
    });

    it("service ユニットファイルを mode 0o644 で書き込む", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        SERVICE_PATH,
        "[Service]\nExecStart=/usr/local/bin/npx sabori-flow worker",
        { encoding: "utf-8", mode: 0o644 },
      );
    });

    it("timer ユニットファイルを mode 0o644 で書き込む", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        TIMER_PATH,
        "[Timer]\nOnBootSec=3600s",
        { encoding: "utf-8", mode: 0o644 },
      );
    });

    it("systemctl daemon-reload を実行する", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedExec).toHaveBeenCalledWith("systemctl", ["--user", "daemon-reload"]);
    });

    it("systemctl enable --now でタイマーを有効化する", async () => {
      setupInstallMocks();
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      expect(mockedExec).toHaveBeenCalledWith("systemctl", [
        "--user", "enable", "--now", "sabori-flow.timer",
      ]);
    });

    it("操作が正しい順序で実行される", async () => {
      const callOrder: string[] = [];
      mockedFs.mkdirSync.mockImplementation((..._args: unknown[]) => {
        callOrder.push("mkdirSync");
        return undefined;
      });
      mockedFs.readFileSync.mockImplementation((filePath: unknown) => {
        callOrder.push(`readFileSync:${filePath}`);
        if (String(filePath).includes("service")) return "[Service]";
        return "[Timer]";
      });
      mockedRenderServiceUnit.mockImplementation((..._args: unknown[]) => {
        callOrder.push("renderServiceUnit");
        return "[Service] rendered";
      });
      mockedRenderTimerUnit.mockImplementation((..._args: unknown[]) => {
        callOrder.push("renderTimerUnit");
        return "[Timer] rendered";
      });
      mockedFs.writeFileSync.mockImplementation((filePath: unknown) => {
        callOrder.push(`writeFileSync:${filePath}`);
        return undefined;
      });
      mockedExec.mockImplementation((file: string, args: readonly string[]) => {
        callOrder.push(`exec:${args.join(" ")}`);
        return "";
      });
      const scheduler = await createSystemdScheduler();

      scheduler.install(makeInstallOptions());

      // ディレクトリ作成が最初
      expect(callOrder.indexOf("mkdirSync")).toBe(0);
      // service テンプレート読み込み後に renderServiceUnit
      expect(
        callOrder.indexOf("readFileSync:/mock/package-root/systemd/sabori-flow.service.template"),
      ).toBeLessThan(callOrder.indexOf("renderServiceUnit"));
      // renderServiceUnit 後に service ファイル書き込み
      expect(callOrder.indexOf("renderServiceUnit")).toBeLessThan(
        callOrder.indexOf(`writeFileSync:${SERVICE_PATH}`),
      );
      // timer ファイル書き込み後に daemon-reload
      expect(callOrder.indexOf(`writeFileSync:${TIMER_PATH}`)).toBeLessThan(
        callOrder.indexOf("exec:--user daemon-reload"),
      );
      // daemon-reload 後に enable --now
      expect(callOrder.indexOf("exec:--user daemon-reload")).toBeLessThan(
        callOrder.indexOf("exec:--user enable --now sabori-flow.timer"),
      );
    });
  });

  describe("uninstall", () => {
    describe("タイマーがインストール済みの場合", () => {
      it("systemctl stop でタイマーを停止する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).toHaveBeenCalledWith("systemctl", [
          "--user", "stop", "sabori-flow.timer",
        ]);
      });

      it("systemctl disable でタイマーを無効化する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).toHaveBeenCalledWith("systemctl", [
          "--user", "disable", "sabori-flow.timer",
        ]);
      });

      it("timer ファイルを削除する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(TIMER_PATH);
      });

      it("service ファイルを削除する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(SERVICE_PATH);
      });

      it("daemon-reload を実行する", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).toHaveBeenCalledWith("systemctl", [
          "--user", "daemon-reload",
        ]);
      });

      it("systemctl stop が失敗しても例外をスローしない", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedExec.mockImplementation((_file: string, args: readonly string[]) => {
          if (args.includes("stop")) throw new Error("stop failed");
          return "";
        });
        const scheduler = await createSystemdScheduler();

        expect(() => scheduler.uninstall()).not.toThrow();
      });

      it("systemctl disable が失敗しても例外をスローしない", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedExec.mockImplementation((_file: string, args: readonly string[]) => {
          if (args.includes("disable")) throw new Error("disable failed");
          return "";
        });
        const scheduler = await createSystemdScheduler();

        expect(() => scheduler.uninstall()).not.toThrow();
      });

      it("daemon-reload が失敗しても例外をスローしない", async () => {
        mockedFs.existsSync.mockReturnValue(true);
        mockedExec.mockImplementation((_file: string, args: readonly string[]) => {
          if (args.includes("daemon-reload")) throw new Error("daemon-reload failed");
          return "";
        });
        const scheduler = await createSystemdScheduler();

        expect(() => scheduler.uninstall()).not.toThrow();
      });
    });

    describe("タイマーがインストールされていない場合", () => {
      it("systemctl stop を実行しない", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          // timer ファイルが存在しない = isInstalled() が false
          if (String(filePath) === TIMER_PATH) return false;
          return false;
        });
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).not.toHaveBeenCalledWith(
          "systemctl",
          expect.arrayContaining(["stop"]),
        );
      });

      it("systemctl disable を実行しない", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          if (String(filePath) === TIMER_PATH) return false;
          return false;
        });
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).not.toHaveBeenCalledWith(
          "systemctl",
          expect.arrayContaining(["disable"]),
        );
      });

      it("ユニットファイルが存在しない場合は unlinkSync を呼ばない", async () => {
        mockedFs.existsSync.mockReturnValue(false);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).not.toHaveBeenCalled();
      });

      it("daemon-reload は実行される", async () => {
        mockedFs.existsSync.mockReturnValue(false);
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedExec).toHaveBeenCalledWith("systemctl", [
          "--user", "daemon-reload",
        ]);
      });
    });

    describe("一部のファイルのみ存在する場合", () => {
      it("timer のみ存在する場合は timer だけ削除する", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          return String(filePath) === TIMER_PATH;
        });
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(TIMER_PATH);
        expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith(SERVICE_PATH);
      });

      it("service のみ存在する場合は service だけ削除する", async () => {
        mockedFs.existsSync.mockImplementation((filePath: unknown) => {
          return String(filePath) === SERVICE_PATH;
        });
        const scheduler = await createSystemdScheduler();

        scheduler.uninstall();

        expect(mockedFs.unlinkSync).toHaveBeenCalledWith(SERVICE_PATH);
        expect(mockedFs.unlinkSync).not.toHaveBeenCalledWith(TIMER_PATH);
      });
    });
  });

  describe("isInstalled", () => {
    it("timer ファイルが存在する場合 true を返す", async () => {
      mockedFs.existsSync.mockReturnValue(true);
      const scheduler = await createSystemdScheduler();

      const result = scheduler.isInstalled();

      expect(result).toBe(true);
      expect(mockedFs.existsSync).toHaveBeenCalledWith(TIMER_PATH);
    });

    it("timer ファイルが存在しない場合 false を返す", async () => {
      mockedFs.existsSync.mockReturnValue(false);
      const scheduler = await createSystemdScheduler();

      const result = scheduler.isInstalled();

      expect(result).toBe(false);
    });
  });
});
