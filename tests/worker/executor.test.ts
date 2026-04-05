import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import {
  runClaude,
  runCodex,
  runEngine,
  ExecutorError,
  ExecutorTimeoutError,
  resolveClaudeAutonomyFlags,
  resolveCodexAutonomyFlags,
  resolveAutonomyLogMessage,
} from "../../src/worker/executor.js";
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
          env: expect.any(Object),
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

    it("autonomy が auto の場合 --permission-mode と auto が隣接して含まれる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { autonomy: "auto" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p", "--permission-mode", "auto"]);
      expect(args).not.toContain("--dangerously-skip-permissions");
    });

    it("autonomy が auto の場合は full のフラグと異なる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { autonomy: "auto" });
      const autoArgs = mockedRunCommand.mock.calls[0][1];

      mockedRunCommand.mockClear();

      await runClaude("prompt text", { autonomy: "full" });
      const fullArgs = mockedRunCommand.mock.calls[0][1];

      expect(autoArgs).not.toEqual(fullArgs);
      expect(autoArgs).toContain("--permission-mode");
      expect(fullArgs).toContain("--dangerously-skip-permissions");
    });

    it("runClaude は autonomy ログを直接出力しない (config ロード時に一括出力)", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      mockLoggerInstance.warn.mockClear();
      mockLoggerInstance.info.mockClear();

      await runClaude("prompt text", { autonomy: "sandboxed" });
      await runClaude("prompt text", { autonomy: "full" });
      await runClaude("prompt text", { autonomy: "auto" });

      expect(mockLoggerInstance.warn).not.toHaveBeenCalled();
      expect(mockLoggerInstance.info).not.toHaveBeenCalled();
    });
  });

  describe("continueSession オプション", () => {
    it("continueSession が true の場合 --continue が -p の直後に含まれる", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { continueSession: true });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p", "--continue"]);
    });

    it("continueSession: true と autonomy: auto を併用すると --continue の後に --permission-mode auto が続く", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { continueSession: true, autonomy: "auto" });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p", "--continue", "--permission-mode", "auto"]);
    });

    it("continueSession が false の場合 --continue が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text", { continueSession: false });

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p"]);
    });

    it("continueSession 未指定の場合 --continue が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({
        success: true,
        stdout: "",
        stderr: "",
      });

      await runClaude("prompt text");

      const args = mockedRunCommand.mock.calls[0][1];
      expect(args).toEqual(["-p"]);
    });
  });

  describe("authToken オプション", () => {
    const ENV_KEY = "CLAUDE_CODE_OAUTH_TOKEN";
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env[ENV_KEY];
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = savedEnv;
      }
      delete process.env.SABORI_TEST_MARKER;
    });

    it("authToken 指定時、runCommand の env に CLAUDE_CODE_OAUTH_TOKEN が渡される", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text", { authToken: "sk-ant-oat01-example" });

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env).toEqual(
        expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-example" }),
      );
    });

    it("authToken 未指定時、env に CLAUDE_CODE_OAUTH_TOKEN が含まれない", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text");

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    });

    it("authToken 未指定時も env は既存の process.env を継承する", async () => {
      process.env.SABORI_TEST_MARKER = "marker-value";
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text");

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.SABORI_TEST_MARKER).toBe("marker-value");
    });

    it("authToken 指定時も process.env は変異しない", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text", { authToken: "sk-ant-oat01-example" });

      expect(process.env[ENV_KEY]).toBeUndefined();
    });

    it("authToken 指定時、env は既存の process.env を継承する", async () => {
      process.env.SABORI_TEST_MARKER = "marker-value";
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text", { authToken: "sk-ant-oat01-example" });

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.SABORI_TEST_MARKER).toBe("marker-value");
    });
  });

  describe("バックグラウンド待機上限", () => {
    const ENV_KEY = "CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS";
    let savedEnv: string | undefined;

    beforeEach(() => {
      savedEnv = process.env[ENV_KEY];
      delete process.env[ENV_KEY];
    });

    afterEach(() => {
      if (savedEnv === undefined) {
        delete process.env[ENV_KEY];
      } else {
        process.env[ENV_KEY] = savedEnv;
      }
    });

    it("authToken 未指定でも CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS が env に渡される", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text");

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe("3600000");
    });

    it("authToken 指定時も上限とトークンが両方 env に含まれる", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text", { authToken: "sk-ant-oat01-example" });

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env).toEqual(
        expect.objectContaining({
          CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "3600000",
          CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-example",
        }),
      );
    });

    it("timeoutMs を既定と異なる値にしても上限は変わらない", async () => {
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text", { timeoutMs: 600_000 });

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe("3600000");
    });

    it("process.env に既存値があっても worker の値で上書きされる", async () => {
      process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = "1000";
      mockedRunCommand.mockResolvedValue({ success: true, stdout: "", stderr: "" });

      await runClaude("prompt text");

      const options = mockedRunCommand.mock.calls[0][2];
      expect(options?.env?.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe("3600000");
      expect(process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS).toBe("1000");
    });
  });
});

describe("resolveClaudeAutonomyFlags", () => {
  it("full の場合 --dangerously-skip-permissions を返す", () => {
    expect(resolveClaudeAutonomyFlags("full")).toEqual([
      "--dangerously-skip-permissions",
    ]);
  });

  it("auto の場合 ['--permission-mode', 'auto'] を返す", () => {
    expect(resolveClaudeAutonomyFlags("auto")).toEqual([
      "--permission-mode",
      "auto",
    ]);
  });

  it("sandboxed の場合 空配列を返す", () => {
    expect(resolveClaudeAutonomyFlags("sandboxed")).toEqual([]);
  });

  it("interactive の場合 空配列を返す", () => {
    expect(resolveClaudeAutonomyFlags("interactive")).toEqual([]);
  });

  it("auto と full は異なるフラグ配列を返す", () => {
    expect(resolveClaudeAutonomyFlags("auto")).not.toEqual(
      resolveClaudeAutonomyFlags("full"),
    );
  });
});

describe("resolveAutonomyLogMessage", () => {
  it("full の場合 warn レベルで full 向けメッセージを返す", () => {
    const result = resolveAutonomyLogMessage("full");
    expect(result).not.toBeNull();
    expect(result?.level).toBe("warn");
    expect(result?.message).toContain("--dangerously-skip-permissions");
  });

  it("auto の場合 info レベルで auto 向けメッセージを返す", () => {
    const result = resolveAutonomyLogMessage("auto");
    expect(result).not.toBeNull();
    expect(result?.level).toBe("info");
    expect(result?.message).toContain("--permission-mode auto");
  });

  it("sandboxed の場合 warn レベルで fallback メッセージを返す", () => {
    const result = resolveAutonomyLogMessage("sandboxed");
    expect(result).not.toBeNull();
    expect(result?.level).toBe("warn");
    expect(result?.message).toContain("sandboxed");
    expect(result?.message).toContain("interactive");
  });

  it("interactive の場合 null を返す", () => {
    expect(resolveAutonomyLogMessage("interactive")).toBeNull();
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
