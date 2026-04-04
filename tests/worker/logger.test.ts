import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  lstatSync: vi.fn(() => ({ isSymbolicLink: () => false })),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
}));

import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import {
  configureLogger,
  createLogger,
  resetLoggerForTest,
  rotateOldLogs,
} from "../../src/worker/logger.js";
import type { Logger } from "../../src/worker/logger.js";

describe("logger", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetLoggerForTest();
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  describe("createLogger", () => {
    it("Logger インターフェースを満たすオブジェクトを返す", () => {
      const logger: Logger = createLogger("test");

      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });
  });

  describe("ログレベルフィルタ", () => {
    it("minLevel が warn の場合、info は出力されない", () => {
      configureLogger({ minLevel: "warn" });
      const logger = createLogger("test");

      logger.info("should not appear");

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it("minLevel が warn の場合、warn と error は出力される", () => {
      configureLogger({ minLevel: "warn" });
      const logger = createLogger("test");

      logger.warn("warning message");
      logger.error("error message");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
    });

    it("minLevel が debug の場合、全レベルが出力される", () => {
      configureLogger({ minLevel: "debug" });
      const logger = createLogger("test");

      logger.debug("d");
      logger.info("i");
      logger.warn("w");
      logger.error("e");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(4);
    });
  });

  describe("フォーマット", () => {
    it("[timestamp] LEVEL - [name] message 形式で出力される", () => {
      const logger = createLogger("myModule");

      logger.info("hello world");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      const output = consoleErrorSpy.mock.calls[0][0] as string;

      // [ISO8601] INFO - [myModule] hello world
      expect(output).toMatch(
        /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}\] INFO - \[myModule\] hello world$/,
      );
    });

    it("timestamps include local timezone offset in ±HH:MM format", () => {
      const logger = createLogger("tz");
      logger.info("test");

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      const match = output.match(
        /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3})([+-]\d{2}:\d{2})\]/,
      );
      expect(match).not.toBeNull();

      const offset = match![2];
      const [, hours, minutes] = offset.match(/[+-](\d{2}):(\d{2})/)!;
      expect(Number(hours)).toBeLessThanOrEqual(14);
      expect(Number(minutes)).toBeLessThanOrEqual(59);
    });

    it("レベル名が大文字で出力される", () => {
      configureLogger({ minLevel: "debug" });
      const logger = createLogger("test");

      logger.debug("d");
      logger.warn("w");
      logger.error("e");

      const outputs = consoleErrorSpy.mock.calls.map(
        (call) => call[0] as string,
      );
      expect(outputs[0]).toContain("DEBUG");
      expect(outputs[1]).toContain("WARN");
      expect(outputs[2]).toContain("ERROR");
    });
  });

  describe("%s 展開", () => {
    it("args が message 内の %s を置換する", () => {
      const logger = createLogger("test");

      logger.info("Hello %s, you have %s items", "Alice", 42);

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(output).toContain("Hello Alice, you have 42 items");
    });

    it("args が不足する場合 %s がそのまま残る", () => {
      const logger = createLogger("test");

      logger.info("Hello %s and %s", "Alice");

      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(output).toContain("Hello Alice and %s");
    });
  });

  describe("ファイル出力", () => {
    it("logDir 設定時に appendFileSync が呼ばれる", () => {
      configureLogger({ logDir: "/tmp/test-logs" });
      const logger = createLogger("test");

      logger.info("file output test");

      expect(mkdirSync).toHaveBeenCalledWith("/tmp/test-logs", {
        recursive: true,
        mode: 0o700,
      });
      expect(appendFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = vi.mocked(appendFileSync).mock.calls[0];
      expect(filePath).toBe("/tmp/test-logs/worker.log");
      expect(content).toMatch(/file output test\n$/);
    });

    it("logDir 未設定時には appendFileSync が呼ばれない", () => {
      const logger = createLogger("test");

      logger.info("no file output");

      expect(appendFileSync).not.toHaveBeenCalled();
    });

    it("appendFileSync が throw しても例外が漏れない", () => {
      vi.mocked(appendFileSync).mockImplementation(() => {
        throw new Error("disk full");
      });
      configureLogger({ logDir: "/tmp/test-logs" });
      const logger = createLogger("test");

      expect(() => logger.info("should not throw")).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("rotateOldLogs", () => {
    it("retentionDays を超えた古いファイルが削除される", () => {
      configureLogger({
        logDir: "/tmp/test-logs",
        retentionDays: 7,
      });

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const oldFileName = `worker.log.${oldDate.toISOString().slice(0, 10)}`;

      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 3);
      const recentFileName = `worker.log.${recentDate.toISOString().slice(0, 10)}`;

      vi.mocked(readdirSync).mockReturnValue(
        [oldFileName, recentFileName, "worker.log", "other.txt"] as unknown as ReturnType<typeof readdirSync>,
      );

      rotateOldLogs();

      expect(unlinkSync).toHaveBeenCalledTimes(1);
      expect(unlinkSync).toHaveBeenCalledWith(
        `/tmp/test-logs/${oldFileName}`,
      );
    });

    it("logDir 未設定時に何もしない", () => {
      rotateOldLogs();

      expect(readdirSync).not.toHaveBeenCalled();
      expect(unlinkSync).not.toHaveBeenCalled();
    });

    it("シンボリックリンクの場合は削除をスキップする", () => {
      configureLogger({
        logDir: "/tmp/test-logs",
        retentionDays: 7,
      });

      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      const oldFileName = `worker.log.${oldDate.toISOString().slice(0, 10)}`;

      vi.mocked(readdirSync).mockReturnValue(
        [oldFileName] as unknown as ReturnType<typeof readdirSync>,
      );

      vi.mocked(lstatSync).mockReturnValue({
        isSymbolicLink: () => true,
      } as unknown as ReturnType<typeof lstatSync>);

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      rotateOldLogs();

      expect(lstatSync).toHaveBeenCalledWith(`/tmp/test-logs/${oldFileName}`);
      expect(unlinkSync).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        `[logger] WARNING: Skipping symbolic link: ${oldFileName}`,
      );

      consoleWarnSpy.mockRestore();
    });
  });
});
