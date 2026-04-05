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

import { runClaude, runCodex, runEngine, ExecutorError, resolveClaudeAutonomyFlags, resolveCodexAutonomyFlags } from "../../src/worker/executor.js";
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

// =========================================================================
// runCodex
// =========================================================================

describe("runCodex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("プロンプトの渡し方", () => {
    it("プロンプトが位置引数として渡され stdin (input) は使用されない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "Codex output",
        stderr: "",
      });

      const prompt = "Implement feature Z";
      await runCodex(prompt);

      expect(mockedRunCommand).toHaveBeenCalledOnce();
      expect(mockedRunCommand).toHaveBeenCalledWith(
        "codex",
        ["exec", prompt],
        { cwd: undefined, timeoutMs: 1_800_000 },
      );
    });
  });

  describe("デフォルトタイムアウト", () => {
    it("タイムアウト未指定時にデフォルト値 1800000ms が渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text");

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.timeoutMs).toBe(1_800_000);
    });
  });

  describe("カスタムオプション", () => {
    it("指定したタイムアウト値が runCommand に渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text", { timeoutMs: 600_000 });

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.timeoutMs).toBe(600_000);
    });

    it("cwd が runCommand に渡される", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text", { cwd: "/work/dir" });

      const callOptions = mockedRunCommand.mock.calls[0][2];
      expect(callOptions?.cwd).toBe("/work/dir");
    });
  });

  describe("autonomy オプション", () => {
    it("autonomy が full の場合 --dangerously-bypass-approvals-and-sandbox が含まれる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text", { autonomy: "full" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("autonomy が sandboxed の場合 --full-auto が含まれる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text", { autonomy: "sandboxed" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toContain("--full-auto");
    });

    it("autonomy が interactive の場合 追加フラグが含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runCodex("prompt text", { autonomy: "interactive" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["exec", "prompt text"]);
    });
  });

  describe("タイムアウト", () => {
    it("ProcessTimeoutError 発生時に ExecutorError が throw される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      await expect(runCodex("Long running task")).rejects.toThrow(
        ExecutorError,
      );
    });

    it("タイムアウトのエラーメッセージに 'Codex CLI timed out' が含まれる", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessTimeoutError(1_800_000),
      );

      await expect(runCodex("Long running task")).rejects.toThrow(
        "Codex CLI timed out",
      );
    });
  });

  describe("バイナリ未検出", () => {
    it("ProcessExecutionError 発生時に ExecutorError が throw される", async () => {
      mockedRunCommand.mockRejectedValue(
        new ProcessExecutionError("spawn codex ENOENT"),
      );

      try {
        await runCodex("Some prompt");
        expect.fail("should have thrown");
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(ExecutorError);
        expect((error as Error).message).toBe("spawn codex ENOENT");
      }
    });
  });
});

// =========================================================================
// resolveCodexAutonomyFlags
// =========================================================================

describe("resolveCodexAutonomyFlags", () => {
  it("full の場合 --dangerously-bypass-approvals-and-sandbox を返す", () => {
    expect(resolveCodexAutonomyFlags("full")).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
  });

  it("sandboxed の場合 --full-auto を返す", () => {
    expect(resolveCodexAutonomyFlags("sandboxed")).toEqual(["--full-auto"]);
  });

  it("interactive の場合 空配列を返す", () => {
    expect(resolveCodexAutonomyFlags("interactive")).toEqual([]);
  });
});

// =========================================================================
// runEngine
// =========================================================================

describe("runEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("engine が 'claude' の場合 runClaude にディスパッチされる (stdin 経由)", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "Claude output",
      stderr: "",
    });

    const result = await runEngine("claude", "test prompt");

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("Claude output");
    // runClaude は input (stdin) を使う
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "claude",
      ["-p"],
      { input: "test prompt", cwd: undefined, timeoutMs: 1_800_000 },
    );
  });

  it("engine が 'codex' の場合 runCodex にディスパッチされる (位置引数)", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "Codex output",
      stderr: "",
    });

    const result = await runEngine("codex", "test prompt");

    expect(result.success).toBe(true);
    expect(result.stdout).toBe("Codex output");
    // runCodex は位置引数を使い、input は渡さない
    expect(mockedRunCommand).toHaveBeenCalledWith(
      "codex",
      ["exec", "test prompt"],
      { cwd: undefined, timeoutMs: 1_800_000 },
    );
  });
});
