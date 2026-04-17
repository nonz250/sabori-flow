import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommand: vi.fn(),
  };
});

const { mockLoggerInstance } = vi.hoisted(() => ({
  mockLoggerInstance: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/worker/logger.js", () => ({
  createLogger: vi.fn(() => mockLoggerInstance),
}));

import { runClaude, ExecutorError, ExecutorTimeoutError, resolveClaudeAutonomyFlags } from "../../src/worker/executor.js";
import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

describe("runClaude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("成功時", () => {
    it("終了コード 0 の場合 success=true を返す", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "Claude output text",
        stderr: "",
      });

      const result = await runClaude("Implement feature X");

      expect(result.success).toBe(true);
      expect(result.stdout).toBe("Claude output text");
      expect(result.stderr).toBe("");
    });
  });

  describe("失敗時", () => {
    it("非0終了コードの場合 success=false を返す", async () => {
      mockedRunCommand.mockResolvedValue({
        success: false,
        stdout: "",
        stderr: "Error occurred",
      });

      const result = await runClaude("Implement feature X");

      expect(result.success).toBe(false);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("Error occurred");
    });
  });

  describe("stdin 経由のプロンプト渡し", () => {
    it("プロンプトが input オプションで runCommand に渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("Fix the bug in module Y");

      expect(mockedRunCommand).toHaveBeenCalledOnce();
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "claude",
        ["-p"],
        {
          input: "Fix the bug in module Y",
          cwd: undefined,
          timeoutMs: 3_600_000,
        },
      );
    });
  });

  describe("タイムアウト", () => {
    it("ProcessTimeoutError 発生時に ExecutorError が throw される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(3_600_000),
      );

      await expect(runClaude("Long running task")).rejects.toThrow(
        ExecutorError,
      );
    });

    it("タイムアウトのエラーメッセージにタイムアウト値が含まれる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(3_600_000),
      );

      await expect(runClaude("Long running task")).rejects.toThrow(
        "timed out after 3600000ms",
      );
    });

    it("ExecutorError は instanceof で判別できる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(3_600_000),
      );

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorError);
      }
    });

    it("ExecutorTimeoutError は ExecutorError と ExecutorTimeoutError 両方の instanceof で判別できる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorTimeoutError);
        expect(error).toBeInstanceOf(ExecutorError);
      }
    });

    it("ExecutorTimeoutError の timeoutMs プロパティにタイムアウト値が設定される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorTimeoutError);
        expect((error as ExecutorTimeoutError).timeoutMs).toBe(3_600_000);
      }
    });

    it("カスタムタイムアウト指定時に ExecutorTimeoutError の timeoutMs に指定値が設定される", async () => {
      const customTimeoutMs = 600_000;
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(customTimeoutMs),
      );

      try {
        await runClaude("Long running task", { timeoutMs: customTimeoutMs });
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorTimeoutError);
        expect((error as ExecutorTimeoutError).timeoutMs).toBe(customTimeoutMs);
      }
    });

    it("ProcessTimeoutError の partial stdout/stderr が ExecutorTimeoutError に中継される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(
          1_800_000,
          "partial claude stdout",
          "partial claude stderr",
        ),
      );

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorTimeoutError);
        const err = error as ExecutorTimeoutError;
        expect(err.stdout).toBe("partial claude stdout");
        expect(err.stderr).toBe("partial claude stderr");
      }
    });

    it("ProcessTimeoutError が partial 未指定でも ExecutorTimeoutError は空文字列で保持する", async () => {
      mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(1_800_000));

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorTimeoutError);
        const err = error as ExecutorTimeoutError;
        expect(err.stdout).toBe("");
        expect(err.stderr).toBe("");
      }
    });

    it("ExecutorTimeoutError のデフォルトコンストラクタで stdout/stderr は空文字列", () => {
      const err = new ExecutorTimeoutError("timed out", 1_000);
      expect(err.stdout).toBe("");
      expect(err.stderr).toBe("");
    });
  });

  describe("バイナリ未検出", () => {
    it("ProcessExecutionError 発生時に ExecutorError が throw される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessExecutionError("spawn claude ENOENT"),
      );

      try {
        await runClaude("Some prompt");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorError);
        expect((error as Error).message).toBe("spawn claude ENOENT");
      }
    });

    it("ExecutorError は instanceof で判別できる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessExecutionError("spawn claude ENOENT"),
      );

      try {
        await runClaude("Some prompt");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorError);
      }
    });
  });

  describe("デフォルトタイムアウト", () => {
    it("タイムアウト未指定時にデフォルト値 3600000ms が渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text");

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.timeoutMs).toBe(3_600_000);
    });
  });

  describe("カスタムタイムアウト", () => {
    it("指定したタイムアウト値が runCommand に渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { timeoutMs: 600_000 });

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.timeoutMs).toBe(600_000);
    });
  });

  describe("cwd オプション", () => {
    it("cwd が runCommand に渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { cwd: "/work/dir" });

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.cwd).toBe("/work/dir");
    });
  });

  describe("autonomy オプション", () => {
    it("autonomy 未指定時は --dangerously-skip-permissions が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text");

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p"]);
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("autonomy が full の場合 --dangerously-skip-permissions が含まれる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { autonomy: "full" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("autonomy が sandboxed の場合 --dangerously-skip-permissions が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { autonomy: "sandboxed" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p"]);
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("autonomy が interactive の場合 --dangerously-skip-permissions が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { autonomy: "interactive" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p"]);
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("autonomy が sandboxed の場合 WARN ログが出力される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      mockLoggerInstance.warn.mockClear();

      await runClaude("prompt text", { autonomy: "sandboxed" });

      expect(mockLoggerInstance.warn).toHaveBeenCalledWith(
        "Claude Code does not support 'sandboxed' autonomy; falling back to 'interactive'",
      );
    });

    it("autonomy が full の場合 sandboxed WARN ログが出力されない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      mockLoggerInstance.warn.mockClear();

      await runClaude("prompt text", { autonomy: "full" });

      expect(mockLoggerInstance.warn).not.toHaveBeenCalled();
    });
  });
});

describe("resolveClaudeAutonomyFlags", () => {
  it("full の場合 --dangerously-skip-permissions を返す", () => {
    expect(resolveClaudeAutonomyFlags("full")).toEqual(["--dangerously-skip-permissions"]);
  });

  it("sandboxed の場合 空配列を返す", () => {
    expect(resolveClaudeAutonomyFlags("sandboxed")).toEqual([]);
  });

  it("interactive の場合 空配列を返す", () => {
    expect(resolveClaudeAutonomyFlags("interactive")).toEqual([]);
  });
});
