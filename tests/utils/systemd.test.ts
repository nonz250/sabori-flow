import { describe, it, expect } from "vitest";
import { renderServiceUnit, renderTimerUnit } from "../../src/utils/systemd.js";
import type { SystemdPlaceholders } from "../../src/utils/systemd.js";

// ---------- Constants ----------

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_HALF_HOUR = 1800;
const SECONDS_TEN_MINUTES = 600;

// ---------- Helpers ----------

function makePlaceholders(
  overrides?: Partial<SystemdPlaceholders>,
): SystemdPlaceholders {
  return {
    programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
    path: "/usr/local/bin:/usr/bin:/bin",
    logDir: "/home/user/.sabori-flow/logs",
    intervalSeconds: SECONDS_PER_HOUR,
    ...overrides,
  };
}

const SERVICE_TEMPLATE = [
  "[Service]",
  "ExecStart=__EXEC_START__",
  "Environment=PATH=__PATH__",
  "StandardOutput=append:__LOG_DIR__/stdout.log",
  "StandardError=append:__LOG_DIR__/stderr.log",
].join("\n");

const TIMER_TEMPLATE = [
  "[Timer]",
  "OnBootSec=__ON_BOOT_SEC__",
  "OnUnitActiveSec=__ON_UNIT_ACTIVE_SEC__",
].join("\n");

// ---------- Tests ----------

describe("renderServiceUnit", () => {
  describe("正常系: プレースホルダの展開", () => {
    it("__EXEC_START__ が programArguments を結合した文字列に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("ExecStart=/usr/local/bin/npx sabori-flow worker");
    });

    it("単一要素の programArguments が正しく展開される", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/local/bin/node"],
      });

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("ExecStart=/usr/local/bin/node");
    });

    it("__PATH__ が path の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("Environment=PATH=/usr/local/bin:/usr/bin:/bin");
    });

    it("__LOG_DIR__ が logDir の値に展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("StandardOutput=append:/home/user/.sabori-flow/logs/stdout.log");
      expect(result).toContain("StandardError=append:/home/user/.sabori-flow/logs/stderr.log");
    });

    it("同一プレースホルダが複数回出現しても全て展開される", () => {
      const template = "__LOG_DIR__ and __LOG_DIR__";
      const placeholders = makePlaceholders();

      const result = renderServiceUnit(template, placeholders);

      expect(result).toBe(
        "/home/user/.sabori-flow/logs and /home/user/.sabori-flow/logs",
      );
    });
  });

  describe("展開順序: 各プレースホルダは独立に展開される", () => {
    it("__EXEC_START__ と __PATH__ と __LOG_DIR__ が全て展開される", () => {
      const placeholders = makePlaceholders();

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("ExecStart=/usr/local/bin/npx sabori-flow worker");
      expect(result).toContain("Environment=PATH=/usr/local/bin:/usr/bin:/bin");
      expect(result).toContain("StandardOutput=append:/home/user/.sabori-flow/logs/stdout.log");
    });
  });

  describe("systemd 特殊文字のバリデーション", () => {
    it("programArguments に $ が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/path/with/$1/npx"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "systemd special characters",
      );
    });

    it("programArguments に % が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/path/with/%n/npx"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "systemd special characters",
      );
    });

    it("programArguments に ; が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node; rm -rf /"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "systemd special characters",
      );
    });

    it("programArguments に \\ が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\\extra"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "systemd special characters",
      );
    });
  });

  describe("スペースを含む引数のクォート処理", () => {
    it("スペースを含む引数がダブルクォートで囲まれる", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node", "/path/to/my app/worker.js"],
      });

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain('ExecStart=/usr/bin/node "/path/to/my app/worker.js"');
    });

    it("スペースを含まない引数はクォートされない", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/local/bin/npx", "sabori-flow", "worker"],
      });

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("ExecStart=/usr/local/bin/npx sabori-flow worker");
    });
  });

  describe("異常系: 制御文字のバリデーション", () => {
    it("programArguments にヌル文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\x00"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("programArguments にタブ文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\t"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("programArguments に改行文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\n"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("programArguments にキャリッジリターンが含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\r"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("programArguments に DEL 文字 (0x7f) が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node\x7f"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("programArguments の2番目の要素に制御文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node", "arg\x00with-null"],
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in programArguments: control characters are not allowed",
      );
    });

    it("path に制御文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        path: "/usr/bin\x00:/usr/local/bin",
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in path: control characters are not allowed",
      );
    });

    it("logDir に制御文字が含まれている場合エラーをスローする", () => {
      const placeholders = makePlaceholders({
        logDir: "/logs\x00/dir",
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in logDir: control characters are not allowed",
      );
    });
  });

  describe("境界値: 制御文字の境界", () => {
    it("スペース (0x20) は制御文字に該当せず正常に処理される（クォートされる）", () => {
      const placeholders = makePlaceholders({
        programArguments: ["/usr/bin/node", "arg with space"],
      });

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain('ExecStart=/usr/bin/node "arg with space"');
    });

    it("チルダ (0x7e) は制御文字に該当せず正常に処理される", () => {
      const placeholders = makePlaceholders({
        path: "~/bin:/usr/bin",
      });

      const result = renderServiceUnit(SERVICE_TEMPLATE, placeholders);

      expect(result).toContain("Environment=PATH=~/bin:/usr/bin");
    });

    it("制御文字の下限 (0x00) でエラーになる", () => {
      const placeholders = makePlaceholders({
        path: "\x00/usr/bin",
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in path",
      );
    });

    it("制御文字の上限 (0x1f) でエラーになる", () => {
      const placeholders = makePlaceholders({
        path: "\x1f/usr/bin",
      });

      expect(() => renderServiceUnit(SERVICE_TEMPLATE, placeholders)).toThrow(
        "Invalid characters in path",
      );
    });
  });
});

describe("renderTimerUnit", () => {
  describe("正常系: プレースホルダの展開", () => {
    it("__ON_BOOT_SEC__ が intervalSeconds の秒数形式に展開される", () => {
      const placeholders = makePlaceholders({ intervalSeconds: SECONDS_PER_HOUR });

      const result = renderTimerUnit(TIMER_TEMPLATE, placeholders);

      expect(result).toContain("OnBootSec=3600s");
    });

    it("__ON_UNIT_ACTIVE_SEC__ が intervalSeconds の秒数形式に展開される", () => {
      const placeholders = makePlaceholders({ intervalSeconds: SECONDS_PER_HOUR });

      const result = renderTimerUnit(TIMER_TEMPLATE, placeholders);

      expect(result).toContain("OnUnitActiveSec=3600s");
    });

    it("カスタム intervalSeconds が正しく展開される", () => {
      const placeholders = makePlaceholders({ intervalSeconds: SECONDS_PER_HALF_HOUR });

      const result = renderTimerUnit(TIMER_TEMPLATE, placeholders);

      expect(result).toContain("OnBootSec=1800s");
      expect(result).toContain("OnUnitActiveSec=1800s");
    });

    it("短い間隔でも正しく展開される", () => {
      const placeholders = makePlaceholders({ intervalSeconds: SECONDS_TEN_MINUTES });

      const result = renderTimerUnit(TIMER_TEMPLATE, placeholders);

      expect(result).toContain("OnBootSec=600s");
      expect(result).toContain("OnUnitActiveSec=600s");
    });

    it("同一プレースホルダが複数回出現しても全て展開される", () => {
      const template = "__ON_BOOT_SEC__ and __ON_BOOT_SEC__";
      const placeholders = makePlaceholders({ intervalSeconds: SECONDS_PER_HOUR });

      const result = renderTimerUnit(template, placeholders);

      expect(result).toBe("3600s and 3600s");
    });
  });

  describe("テンプレートに置換対象がない場合", () => {
    it("テンプレートをそのまま返す", () => {
      const template = "[Timer]\nPersistent=true";
      const placeholders = makePlaceholders();

      const result = renderTimerUnit(template, placeholders);

      expect(result).toBe("[Timer]\nPersistent=true");
    });
  });
});
