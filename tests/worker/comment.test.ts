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

  it("Anthropic API キー (sk-ant-api03-...) がマスキングされる", () => {
    const secret =
      "sk-ant-api03-" + "A".repeat(64);
    const text = `ANTHROPIC_API_KEY=${secret}_and_more`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("sk-ant-api03- 以外の短い sk- で始まる文字列は誤検知されない", () => {
    // 先頭 sk- の後の文字数が 20 未満なので OpenAI パターンにもマッチしない
    const tooShort = "sk-short";
    const text = `something ${tooShort} else`;
    expect(sanitizeOutput(text)).toBe(text);
  });

  it("OpenAI API キー (sk-...) がマスキングされる", () => {
    const secret = "sk-" + "A".repeat(40);
    const text = `OPENAI_API_KEY=${secret}`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("OpenAI project-scoped API キー (sk-proj-...) がマスキングされる", () => {
    const secret = "sk-proj-" + "B".repeat(40);
    const text = `key: ${secret}`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("Slack トークン (xoxb-...) がマスキングされる", () => {
    const secret = "xoxb-" + "A".repeat(30);
    const text = `slack token: ${secret} end`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("Slack user トークン (xoxp-...) がマスキングされる", () => {
    const secret = "xoxp-" + "1".repeat(30);
    const text = `${secret}`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("短すぎる xox 文字列は誤検知されない", () => {
    const text = "xoxb-short";
    expect(sanitizeOutput(text)).toBe(text);
  });

  it("Google API キー (AIza...) がマスキングされる", () => {
    const secret = "AIza" + "A".repeat(35);
    const text = `key = "${secret}"`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("短すぎる AIza 文字列は誤検知されない", () => {
    const tooShort = "AIza" + "A".repeat(10);
    const text = `key = ${tooShort}`;
    expect(sanitizeOutput(text)).toBe(text);
  });

  it("JWT トークン (eyJ...) がマスキングされる", () => {
    const header = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
    const payload = "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ";
    const sig = "sig_abcDEFghiJKLmno123-_abc";
    const jwt = `${header}.${payload}.${sig}`;
    const text = `Authorization header has ${jwt} in it`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(jwt);
    expect(result).toContain("[REDACTED]");
  });

  it("JWT として形式が不完全な文字列は誤検知されない", () => {
    const text = "not-a-jwt eyJonlyheader end";
    expect(sanitizeOutput(text)).toBe(text);
  });

  it("npm トークン (npm_...) がマスキングされる", () => {
    const secret = "npm_" + "A".repeat(36);
    const text = `//registry.npmjs.org/:_authToken=${secret}`;
    const result = sanitizeOutput(text);
    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("npm トークンの桁数が 36 文字未満の場合は誤検知されない", () => {
    const tooShort = "npm_" + "A".repeat(10);
    const text = `authToken=${tooShort}`;
    expect(sanitizeOutput(text)).toBe(text);
  });

  // -------------------------------------------------------------------------
  // 個別 SECRET_PATTERNS の独立検証
  //
  // 汎用 key=value パターン (/^.*(?:api[_-]?key|api[_-]?secret|
  // access[_-]?token|secret[_-]?key)[=:].*$/gim) は行全体を [REDACTED] に
  // 置換するため、そのキーワードを含むコンテキスト (例: "OPENAI_API_KEY=...")
  // では個別パターンが壊れていても検出できない。
  // 以下のテストはキーワードを含まないコンテキストを用いて、個別パターンが
  // 独立して機能することを検証する。
  // -------------------------------------------------------------------------

  it("Anthropic API キー (sk-ant-api03-...) が汎用キーワードなしでも独立してマスキングされる", () => {
    // 長さを 250 文字にすることで、OpenAI パターンの 200 文字上限を超える。
    // Anthropic 専用パターンが機能していない場合、OpenAI パターンでは
    // 先頭 200 文字しかマスクされず末尾 A が残るため、本テストが失敗する。
    // これにより個別 Anthropic パターンの独立動作が保証される。
    const secretBody = "A".repeat(250);
    const secret = `sk-ant-api03-${secretBody}`;
    const text = `log line with token ${secret} embedded in trace`;
    // ガードレール: このテストデータは汎用 key=value パターンにマッチしないこと
    expect(text).not.toMatch(
      /api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key/i,
    );

    const result = sanitizeOutput(text);

    expect(result).not.toContain(secret);
    expect(result).not.toContain("sk-ant-api03-");
    // OpenAI パターンだけが効いた場合に残存し得る A 文字列の塊が残っていないこと
    expect(result).not.toContain("A".repeat(20));
    expect(result).toContain("[REDACTED]");
  });

  it("OpenAI API キー (sk-...) が汎用キーワードなしでも独立してマスキングされる", () => {
    const secret = "sk-" + "A".repeat(40);
    const text = `trace output contains ${secret} between other text`;
    // ガードレール: このテストデータは汎用 key=value パターンにマッチしないこと
    expect(text).not.toMatch(
      /api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key/i,
    );

    const result = sanitizeOutput(text);

    expect(result).not.toContain(secret);
    expect(result).toContain("[REDACTED]");
  });

  it("OpenAI project-scoped API キー (sk-proj-...) が汎用キーワードなしでも独立してマスキングされる", () => {
    const secret = "sk-proj-" + "B".repeat(40);
    const text = `diagnostic dump ${secret} end of line`;
    // ガードレール: このテストデータは汎用 key=value パターンにマッチしないこと
    expect(text).not.toMatch(
      /api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key/i,
    );

    const result = sanitizeOutput(text);

    expect(result).not.toContain(secret);
    expect(result).not.toContain("sk-proj-");
    expect(result).toContain("[REDACTED]");
  });
});

// ---------------------------------------------------------------------------
// formatFailureDiagnostics
// ---------------------------------------------------------------------------

import {
  formatFailureDiagnostics,
  PARTIAL_STDOUT_TAIL_LENGTH,
  PARTIAL_STDERR_TAIL_LENGTH,
  TRUNCATION_PREFIX,
  CLI_TIMEOUT_WARNING_NOTE,
} from "../../src/worker/comment.js";
import { FailureCategory } from "../../src/worker/models.js";
import type { FailureDiagnostics } from "../../src/worker/models.js";

describe("formatFailureDiagnostics", () => {
  it("PROMPT_GENERATION カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.PROMPT_GENERATION,
      summary: "Template not found",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** Prompt Generation Error");
  });

  it("CLI_EXECUTION_ERROR カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "Command failed",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** CLI Execution Error");
  });

  it("CLI_NON_ZERO_EXIT カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Exited with error",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** CLI Non-zero Exit");
  });

  it("CLI_TIMEOUT カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "Execution timed out",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** CLI Timeout");
  });

  it("WORKTREE_CREATION カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.WORKTREE_CREATION,
      summary: "Worktree setup failed",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** Worktree Creation Error");
  });

  it("GIT_FETCH カテゴリが正しいラベルで表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.GIT_FETCH,
      summary: "Git fetch failed",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** Git Fetch Error");
  });

  it("全フィールドが設定されている場合、すべてのセクションが出力に含まれる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Process exited with code 1",
      stderr: "Error: module not found",
      stdout: "Building project...\nCompiling...",
      exitCode: 1,
      timeoutMs: 300_000,
      errorMessage: "CLI returned non-zero exit code",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:** CLI Non-zero Exit");
    expect(result).toContain("**Summary:** Process exited with code 1");
    expect(result).toContain("**Exit Code:** 1");
    expect(result).toContain("**Timeout:** 300s");
    expect(result).toContain("**Error:** `CLI returned non-zero exit code`");
    expect(result).toContain("<summary>stderr</summary>");
    expect(result).toContain("Error: module not found");
    expect(result).toContain("<summary>stdout (partial)</summary>");
    expect(result).toContain("Building project...\nCompiling...");
  });

  it("オプショナルフィールドが未設定の場合、該当セクションは出力に含まれない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.PROMPT_GENERATION,
      summary: "Template file missing",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Category:**");
    expect(result).toContain("**Summary:**");
    expect(result).not.toContain("**Exit Code:**");
    expect(result).not.toContain("**Timeout:**");
    expect(result).not.toContain("**Error:**");
    expect(result).not.toContain("<details>");
    expect(result).not.toContain("stderr");
    expect(result).not.toContain("stdout");
  });

  it("stderr に含まれる GitHub トークンがサニタイズされる", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "Auth failed",
      stderr: `fatal: could not authenticate with token ${token}`,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("<summary>stderr</summary>");
  });

  it("stdout に含まれる機密情報がサニタイズされる", () => {
    const token = "ghs_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "Unexpected output",
      stdout: `Deploying with token ${token}`,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
    expect(result).toContain("<summary>stdout (partial)</summary>");
  });

  it("stdout が 2000 文字を超える場合、末尾 2000 文字に切り詰められる", () => {
    const prefix = "A".repeat(PARTIAL_STDOUT_TAIL_LENGTH + 500);
    const tail = "B".repeat(PARTIAL_STDOUT_TAIL_LENGTH);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Long output",
      stdout: prefix + tail,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("B".repeat(PARTIAL_STDOUT_TAIL_LENGTH));
    expect(result).not.toContain("A".repeat(PARTIAL_STDOUT_TAIL_LENGTH + 500));
  });

  it("空文字列の stderr は出力に含まれない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "No stderr",
      stderr: "",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("<summary>stderr</summary>");
    expect(result).not.toContain("<details>");
  });

  it("空文字列の stdout は出力に含まれない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "No stdout",
      stdout: "",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("<summary>stdout (partial)</summary>");
    expect(result).not.toContain("<details>");
  });

  it("exitCode が 0 の場合は表示される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Unexpected",
      exitCode: 0,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Exit Code:** 0");
  });

  it("exitCode が null の場合は表示されない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "Signal killed",
      exitCode: null,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("**Exit Code:**");
  });

  it("exitCode が undefined の場合は表示されない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "No exit code",
      exitCode: undefined,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("**Exit Code:**");
  });

  it("セクション間が二重改行で結合される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Failed",
      exitCode: 1,
    };

    const result = formatFailureDiagnostics(diag);

    const sections = result.split("\n\n");
    expect(sections[0]).toBe("**Category:** CLI Non-zero Exit");
    expect(sections[1]).toBe("**Summary:** Failed");
    expect(sections[2]).toBe("**Exit Code:** 1");
  });

  it("errorMessage に含まれるシークレットがサニタイズされる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "CLI failed",
      errorMessage:
        "Auth failed with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    expect(result).toContain("[REDACTED]");
  });

  it("errorMessage がインラインコードとしてフォーマットされる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "CLI failed",
      errorMessage: "spawn claude ENOENT",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("**Error:** `spawn claude ENOENT`");
  });

  it("stderr 内のトリプルバッククォートがエスケープされる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Non-zero exit",
      stderr: "before ```injected markdown``` after",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("before ```injected");
  });

  it("stderr が PARTIAL_STDERR_TAIL_LENGTH を超える場合、末尾のみが含まれる", () => {
    const prefix = "X".repeat(5000);
    const suffix = "Y".repeat(PARTIAL_STDERR_TAIL_LENGTH);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Non-zero exit",
      stderr: prefix + suffix,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain("X".repeat(100));
    expect(result).toContain("Y".repeat(100));
  });

  it("stdout が閾値超過時はトランケートプレフィックスが付与される", () => {
    const stdout = "Z".repeat(PARTIAL_STDOUT_TAIL_LENGTH + 500);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Truncated",
      stdout,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain(TRUNCATION_PREFIX);
    expect(result).toContain("Z".repeat(PARTIAL_STDOUT_TAIL_LENGTH));
  });

  it("stderr が閾値超過時はトランケートプレフィックスが付与される", () => {
    const stderr = "E".repeat(PARTIAL_STDERR_TAIL_LENGTH + 500);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Truncated",
      stderr,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain(TRUNCATION_PREFIX);
    expect(result).toContain("E".repeat(PARTIAL_STDERR_TAIL_LENGTH));
  });

  it("stdout が閾値以下の場合はトランケートプレフィックスが付与されない", () => {
    const stdout = "Z".repeat(PARTIAL_STDOUT_TAIL_LENGTH);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "At threshold",
      stdout,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(TRUNCATION_PREFIX);
    expect(result).toContain(stdout);
  });

  it("stderr が閾値以下の場合はトランケートプレフィックスが付与されない", () => {
    const stderr = "E".repeat(PARTIAL_STDERR_TAIL_LENGTH);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "At threshold",
      stderr,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(TRUNCATION_PREFIX);
    expect(result).toContain(stderr);
  });

  it("トランケート後の出力にシークレットが含まれる場合も [REDACTED] に置換される", () => {
    const token = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl";
    const padded = "x".repeat(PARTIAL_STDOUT_TAIL_LENGTH);
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "Trunc with secret",
      stdout: padded + `token=${token}`,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain(TRUNCATION_PREFIX);
    expect(result).not.toContain(token);
    expect(result).toContain("[REDACTED]");
  });

  it("CLI_TIMEOUT カテゴリで stdout ラベルが 'partial, before timeout' になる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      stdout: "some stdout",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("<summary>stdout (partial, before timeout)</summary>");
    expect(result).not.toContain("<summary>stdout (partial)</summary>");
  });

  it("CLI_TIMEOUT カテゴリで stderr ラベルが 'partial, before timeout' になる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      stderr: "some stderr",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("<summary>stderr (partial, before timeout)</summary>");
    expect(result).not.toContain("<summary>stderr</summary>");
  });

  it("CLI_NON_ZERO_EXIT カテゴリでは従来の stdout ラベルが使われる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "non-zero",
      stdout: "some stdout",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("<summary>stdout (partial)</summary>");
    expect(result).not.toContain("partial, before timeout");
  });

  it("CLI_NON_ZERO_EXIT カテゴリでは従来の stderr ラベルが使われる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "non-zero",
      stderr: "some stderr",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("<summary>stderr</summary>");
    expect(result).not.toContain("partial, before timeout");
  });

  it("CLI_EXECUTION_ERROR でも従来の stderr ラベルが使われる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_EXECUTION_ERROR,
      summary: "exec error",
      stderr: "some stderr",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain("<summary>stderr</summary>");
    expect(result).not.toContain("partial, before timeout");
  });

  it("CLI_TIMEOUT で stderr がある場合、信頼性警告注記が含まれる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      stderr: "some stderr",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain(CLI_TIMEOUT_WARNING_NOTE);
  });

  it("CLI_TIMEOUT で stdout だけの場合も信頼性警告注記が含まれる", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      stdout: "some stdout",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).toContain(CLI_TIMEOUT_WARNING_NOTE);
  });

  it("CLI_TIMEOUT で partial 出力がない場合は警告注記が含まれない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      timeoutMs: 600_000,
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(CLI_TIMEOUT_WARNING_NOTE);
  });

  it("CLI_NON_ZERO_EXIT では信頼性警告注記が含まれない", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_NON_ZERO_EXIT,
      summary: "non-zero",
      stdout: "some stdout",
      stderr: "some stderr",
    };

    const result = formatFailureDiagnostics(diag);

    expect(result).not.toContain(CLI_TIMEOUT_WARNING_NOTE);
  });

  it("CLI_TIMEOUT で警告注記は stderr セクションの前に挿入される", () => {
    const diag: FailureDiagnostics = {
      category: FailureCategory.CLI_TIMEOUT,
      summary: "timed out",
      stderr: "some stderr content",
      stdout: "some stdout content",
    };

    const result = formatFailureDiagnostics(diag);

    const noteIndex = result.indexOf(CLI_TIMEOUT_WARNING_NOTE);
    const stderrIndex = result.indexOf("<summary>stderr");
    const stdoutIndex = result.indexOf("<summary>stdout");

    expect(noteIndex).toBeGreaterThanOrEqual(0);
    expect(stderrIndex).toBeGreaterThanOrEqual(0);
    expect(stdoutIndex).toBeGreaterThanOrEqual(0);
    expect(noteIndex).toBeLessThan(stderrIndex);
    expect(noteIndex).toBeLessThan(stdoutIndex);
  });
});
