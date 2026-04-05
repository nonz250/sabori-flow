import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommand: vi.fn(),
  };
});

import { runClaude, ExecutorError } from "../../src/worker/executor.js";
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
          timeoutMs: 1_800_000,
        },
      );
    });
  });

  describe("タイムアウト", () => {
    it("ProcessTimeoutError 発生時に ExecutorError が throw される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      await expect(runClaude("Long running task")).rejects.toThrow(
        ExecutorError,
      );
    });

    it("タイムアウトのエラーメッセージにタイムアウト値が含まれる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      await expect(runClaude("Long running task")).rejects.toThrow(
        "timed out after 1800000ms",
      );
    });

    it("ExecutorError は instanceof で判別できる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      try {
        await runClaude("Long running task");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorError);
      }
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
    it("タイムアウト未指定時にデフォルト値 1800000ms が渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text");

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.timeoutMs).toBe(1_800_000);
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
  });
});
