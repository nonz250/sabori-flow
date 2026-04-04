import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProcessTimeoutError,
  ProcessExecutionError,
} from "../../src/worker/process.js";

vi.mock("../../src/worker/process.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../src/worker/process.js")>();
  return {
    ...original,
    runCommand: vi.fn(),
  };
});

import {
  postSuccessComment,
  postFailureComment,
  sanitizeOutput,
  CommentError,
  MAX_COMMENT_LENGTH,
  SUCCESS_HEADER,
  SUCCESS_TRUNCATED_SUFFIX,
  FAILURE_HEADER,
  FAILURE_TRUNCATED_SUFFIX,
} from "../../src/worker/comment.js";
import { runCommand } from "../../src/worker/process.js";

const mockedRunCommand = vi.mocked(runCommand);

describe("postSuccessComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("成功ヘッダー付きのコメントが投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postSuccessComment(
      "nonz250/example-app",
      10,
      "Implementation completed successfully.",
    );

    expect(mockedRunCommand).toHaveBeenCalledOnce();
    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.startsWith(SUCCESS_HEADER)).toBe(true);
    expect(postedBody).toContain("Implementation completed successfully.");
  });

  it("--body-file - で stdin 経由でコメント本文が投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postSuccessComment("nonz250/example-app", 10, "output text");

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "comment",
        "10",
        "--repo",
        "nonz250/example-app",
        "--body-file",
        "-",
      ],
      { input: SUCCESS_HEADER + "output text", timeoutMs: 120_000 },
    );
  });

  it("空文字列の出力でもヘッダー付きで正常に投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postSuccessComment("nonz250/example-app", 5, "");

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody).toBe(SUCCESS_HEADER);
  });

  it("gh コマンドが非0終了コードを返した場合 CommentError が throw される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "API rate limit exceeded",
    });

    await expect(
      postSuccessComment("nonz250/example-app", 10, "output"),
    ).rejects.toThrow(CommentError);
    await expect(
      postSuccessComment("nonz250/example-app", 10, "output"),
    ).rejects.toThrow("API rate limit exceeded");
  });

  it("タイムアウト時に CommentError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(120_000));

    await expect(
      postSuccessComment("nonz250/example-app", 10, "output"),
    ).rejects.toThrow(CommentError);
    await expect(
      postSuccessComment("nonz250/example-app", 10, "output"),
    ).rejects.toThrow("gh issue comment timed out after 120 seconds");
  });
});

describe("postSuccessComment truncation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ヘッダーと出力の合計が上限を超える場合、出力が切り詰められ省略メッセージが付与される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });
    const maxOutputLength = MAX_COMMENT_LENGTH - SUCCESS_HEADER.length;
    const longOutput = "A".repeat(maxOutputLength + 1);

    await postSuccessComment("nonz250/example-app", 10, longOutput);

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    expect(postedBody.endsWith(SUCCESS_TRUNCATED_SUFFIX)).toBe(true);
  });

  it("ヘッダーと出力の合計が正確に上限以内の場合、切り詰めは発生しない", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });
    const maxOutputLength = MAX_COMMENT_LENGTH - SUCCESS_HEADER.length;
    const exactOutput = "B".repeat(maxOutputLength);

    await postSuccessComment("nonz250/example-app", 10, exactOutput);

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.length).toBe(MAX_COMMENT_LENGTH);
    expect(postedBody).not.toContain(SUCCESS_TRUNCATED_SUFFIX);
  });
});

describe("postFailureComment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("失敗ヘッダー付きのコメントが投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postFailureComment(
      "nonz250/example-app",
      20,
      "Claude Code CLI timed out",
    );

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.startsWith(FAILURE_HEADER)).toBe(true);
    expect(postedBody).toContain("Claude Code CLI timed out");
  });

  it("--body-file - で stdin 経由でコメント本文が投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postFailureComment("nonz250/example-app", 20, "error message");

    expect(mockedRunCommand).toHaveBeenCalledWith(
      "gh",
      [
        "issue",
        "comment",
        "20",
        "--repo",
        "nonz250/example-app",
        "--body-file",
        "-",
      ],
      { input: FAILURE_HEADER + "error message", timeoutMs: 120_000 },
    );
  });

  it("空文字列のエラーメッセージでもヘッダー付きで正常に投稿される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });

    await postFailureComment("nonz250/example-app", 20, "");

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody).toBe(FAILURE_HEADER);
  });

  it("gh コマンドが非0終了コードを返した場合 CommentError が throw される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: false,
      stdout: "",
      stderr: "not found",
    });

    await expect(
      postFailureComment("nonz250/example-app", 20, "error"),
    ).rejects.toThrow(CommentError);
    await expect(
      postFailureComment("nonz250/example-app", 20, "error"),
    ).rejects.toThrow("not found");
  });

  it("タイムアウト時に CommentError が throw される", async () => {
    mockedRunCommand.mockRejectedValue(new ProcessTimeoutError(120_000));

    await expect(
      postFailureComment("nonz250/example-app", 20, "error"),
    ).rejects.toThrow(CommentError);
    await expect(
      postFailureComment("nonz250/example-app", 20, "error"),
    ).rejects.toThrow("gh issue comment timed out after 120 seconds");
  });
});

describe("postFailureComment truncation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("ヘッダーとエラーメッセージの合計が上限を超える場合、メッセージが切り詰められ省略メッセージが付与される", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });
    const maxOutputLength = MAX_COMMENT_LENGTH - FAILURE_HEADER.length;
    const longMessage = "E".repeat(maxOutputLength + 1);

    await postFailureComment("nonz250/example-app", 20, longMessage);

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.length).toBeLessThanOrEqual(MAX_COMMENT_LENGTH);
    expect(postedBody.endsWith(FAILURE_TRUNCATED_SUFFIX)).toBe(true);
  });

  it("ヘッダーとエラーメッセージの合計が正確に上限以内の場合、切り詰めは発生しない", async () => {
    mockedRunCommand.mockResolvedValue({
      success: true,
      stdout: "",
      stderr: "",
    });
    const maxOutputLength = MAX_COMMENT_LENGTH - FAILURE_HEADER.length;
    const exactMessage = "F".repeat(maxOutputLength);

    await postFailureComment("nonz250/example-app", 20, exactMessage);

    const [, , options] = mockedRunCommand.mock.calls[0];
    const postedBody = options!.input!;
    expect(postedBody.length).toBe(MAX_COMMENT_LENGTH);
    expect(postedBody).not.toContain(FAILURE_TRUNCATED_SUFFIX);
  });
});

// ---------------------------------------------------------------------------
// sanitizeOutput
// ---------------------------------------------------------------------------

describe("sanitizeOutput", () => {
  it("通常のテキストはマスキングされない", () => {
    const text = "Implementation completed successfully.\nAll tests passed.";
    expect(sanitizeOutput(text)).toBe(text);
  });

  it("AWS アクセスキーがマスキングされる", () => {
    const text = "Found key: AKIAIOSFODNN7EXAMPLE in config";
    expect(sanitizeOutput(text)).toBe("Found key: [REDACTED] in config");
  });

  it("AWS シークレットキーがマスキングされる", () => {
    const text = "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    expect(sanitizeOutput(text)).toBe("aws_secret_access_key = [REDACTED]");
  });

  it("GitHub Personal Access Token (ghp_) がマスキングされる", () => {
    const text = "TOKEN=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    expect(sanitizeOutput(text)).toBe("TOKEN=[REDACTED]");
  });

  it("GitHub Server Token (ghs_) がマスキングされる", () => {
    const text = "Using token ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    expect(sanitizeOutput(text)).toBe("Using token [REDACTED]");
  });

  it("GitHub fine-grained PAT (github_pat_) がマスキングされる", () => {
    const text = "github_pat_11ABCDEFGH0123456789_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";
    expect(sanitizeOutput(text)).toBe("[REDACTED]");
  });

  it("SSH 秘密鍵ブロックがマスキングされる", () => {
    const text = [
      "Found SSH key:",
      "-----BEGIN RSA PRIVATE KEY-----",
      "MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn/ygWep4PAtGoLFt0b",
      "-----END RSA PRIVATE KEY-----",
      "End of output",
    ].join("\n");
    const result = sanitizeOutput(text);
    expect(result).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(result).not.toContain("MIIEpAIBAAKCAQEA0Z3VS5JJcds3xfn");
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("Found SSH key:");
    expect(result).toContain("End of output");
  });

  it("ED25519 SSH 秘密鍵ブロックもマスキングされる", () => {
    const text = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "b3BlbnNzaC1rZXktdjEAAAAABG5vbmU",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n");
    const result = sanitizeOutput(text);
    expect(result).toBe("[REDACTED]");
  });

  it("Bearer トークンがマスキングされる", () => {
    const text = "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig";
    expect(sanitizeOutput(text)).toContain("[REDACTED]");
    expect(sanitizeOutput(text)).not.toContain("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("API_KEY=xxx 形式の行がマスキングされる", () => {
    const text = "Line before\nAPI_KEY=sk-1234567890abcdef\nLine after";
    const result = sanitizeOutput(text);
    expect(result).toContain("[REDACTED]");
    expect(result).not.toContain("sk-1234567890abcdef");
    expect(result).toContain("Line before");
    expect(result).toContain("Line after");
  });

  it("api-secret: xxx 形式の行がマスキングされる", () => {
    const text = 'api-secret: "my-super-secret-value"';
    expect(sanitizeOutput(text)).toBe("[REDACTED]");
  });

  it("access_token=xxx 形式の行がマスキングされる", () => {
    const text = "access_token=ya29.a0AfH6SMBXXXXXXXXXXXXXXXXXXXXXX";
    expect(sanitizeOutput(text)).toBe("[REDACTED]");
  });

  it("secret_key: xxx 形式の行がマスキングされる", () => {
    const text = "secret_key: abcdef123456";
    expect(sanitizeOutput(text)).toBe("[REDACTED]");
  });

  it("複数のシークレットが同時にマスキングされる", () => {
    const text = [
      "Config found:",
      "AKIAIOSFODNN7EXAMPLE",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl",
      "API_KEY=some-secret-value",
    ].join("\n");
    const result = sanitizeOutput(text);
    expect(result).toContain("Config found:");
    expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(result).not.toContain("some-secret-value");
  });

  it("連続して呼び出しても正しくマスキングされる (RegExp の lastIndex がリセットされる)", () => {
    const text1 = "Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const text2 = "Token: ghp_ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponm";

    const result1 = sanitizeOutput(text1);
    const result2 = sanitizeOutput(text2);

    expect(result1).toBe("Token: [REDACTED]");
    expect(result2).toBe("Token: [REDACTED]");
  });

  it("空文字列を渡しても正常に動作する", () => {
    expect(sanitizeOutput("")).toBe("");
  });
});
