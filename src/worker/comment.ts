import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { FailureDiagnostics } from "./models.js";
import { FailureCategory } from "./models.js";

const GH_TIMEOUT_MS = 120_000;

const MAX_COMMENT_LENGTH = 64_000;

const PARTIAL_STDOUT_TAIL_LENGTH = 2_000;
const PARTIAL_STDERR_TAIL_LENGTH = 4_000;

/**
 * Prefix prepended to stdout/stderr when they have been truncated
 * to signal explicitly that earlier content was dropped.
 */
const TRUNCATION_PREFIX = "...(truncated)\n";

/**
 * Warning note inserted into CLI_TIMEOUT failure comments to signal
 * that the captured output may be partial or incomplete because the
 * process was terminated by SIGTERM/SIGKILL on timeout.
 */
const CLI_TIMEOUT_WARNING_NOTE =
  "> :warning: **Output reliability is limited.** The process was terminated by SIGTERM/SIGKILL on timeout, so the following output may be partial or incomplete.";

// ---------- Secret pattern masking ----------

/**
 * Claude CLI の出力に含まれ得る機密情報パターン。
 * マッチした部分はコメント投稿前に [REDACTED] へ置換される。
 */
const SECRET_PATTERNS: RegExp[] = [
  // AWS access key id
  /AKIA[0-9A-Z]{16}/g,

  // AWS secret access key (preceded by an assignment to a known identifier)
  /(?<=(?:aws_secret_access_key|SecretAccessKey|secret_access_key)\s*[=:]\s*['"]?)[A-Za-z0-9/+=]{40}/gi,

  // GitHub personal / server token
  /gh[ps]_[A-Za-z0-9_]{36,}/g,

  // GitHub fine-grained PAT
  /github_pat_[A-Za-z0-9_]{22,}/g,

  // SSH private key block
  /-----BEGIN [A-Z ]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+ PRIVATE KEY-----/g,

  // Bearer token
  /Bearer [A-Za-z0-9\-._~+/]+=*/g,

  // Anthropic API key
  /sk-ant-api03-[A-Za-z0-9_\-]{64,}/g,

  // OpenAI API key (sk-... or sk-proj-...), upper-bounded to avoid over-matching
  /sk-(?:proj-)?[A-Za-z0-9_\-]{20,200}/g,

  // Slack token (bot, app, personal, refresh, session)
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,

  // Google API key
  /AIza[0-9A-Za-z_\-]{35}/g,

  // JSON Web Token (header.payload.signature, each base64url segment at least 10 chars)
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/g,

  // npm access token
  /npm_[A-Za-z0-9]{36}/g,

  // Generic API key / token assignment (key=value line)
  /^.*(?:api[_-]?key|api[_-]?secret|access[_-]?token|secret[_-]?key)\s*[=:].*$/gim,
];

/**
 * Filesystem paths that point to credential material. The filename
 * alone is enough of a pointer to a secret that we redact it before
 * posting diagnostics publicly. These patterns complement SECRET_PATTERNS
 * (which target credential *values*) and are especially relevant when
 * autonomy=auto's classifier surfaces blocked read attempts in stderr.
 *
 * Matches are intentionally anchored to path-like contexts (path
 * separator, whitespace, quote, assignment) to reduce false positives
 * on ordinary prose.
 */
const SECRET_FILE_PATH_PATTERNS: RegExp[] = [
  // SSH private keys, known_hosts, authorized_keys (with optional leading path).
  // Public keys (`id_rsa.pub`, `id_ed25519.pub`) are intentionally excluded —
  // they are non-sensitive and redaction would hide useful triage context.
  // The `\b(?!\.pub\b)` prevents the engine from backtracking to a shorter
  // match inside a `.pub` suffix.
  /(?:[/~][\w\-./]*)?\.ssh\/(?:id_[A-Za-z0-9_]+\b(?!\.pub\b)|known_hosts|authorized_keys)/g,

  // AWS credentials / config
  /(?:[/~][\w\-./]*)?\.aws\/(?:credentials|config)\b/g,

  // .env family (.env, .env.local, .env.production, ...).
  // Dummy/template variants that are typically committed publicly are excluded
  // so diagnostic output remains readable when tools touch those files.
  /(?<=^|[\s"'`/=(])\.env(?!\.(?:example|sample|template|dist)\b)(?:\.[A-Za-z0-9_\-]+)?\b/g,

  // kubeconfig (user + common system paths)
  /(?:[/~][\w\-./]*)?\.kube\/config\b/g,
  /\/etc\/kubernetes\/(?:admin|kubelet)\.conf\b/g,

  // GitHub CLI host file (contains oauth tokens)
  /(?:[/~][\w\-./]*)?\.config\/gh\/hosts\.yml\b/g,

  // npm auth file
  /(?<=^|[\s"'`/=(])\.npmrc\b/g,

  // git-credentials store
  /(?<=^|[\s"'`/=(])\.git-credentials\b/g,

  // Docker auth config
  /(?:[/~][\w\-./]*)?\.docker\/config\.json\b/g,

  // .netrc (curl / HTTP basic auth credentials)
  /(?<=^|[\s"'`/=(])\.netrc\b/g,

  // PyPI token / pip index credentials
  /(?<=^|[\s"'`/=(])\.pypirc\b/g,

  // Terraform CLI / state (often contains plaintext secrets)
  /(?<=^|[\s"'`/=(])\.terraformrc\b/g,
  /(?<=^|[\s"'`/=(])terraform\.tfstate(?:\.backup)?\b/g,
];

/**
 * Detect credential patterns and redact them.
 *
 * Claude CLI の stdout をそのまま Issue コメントに投稿すると、
 * .env や SSH 鍵等の機密情報が公開リポジトリ上に露出するリスクがある。
 * Credential *values* are replaced with [REDACTED]; credential *file
 * paths* are replaced with [REDACTED_PATH] so operators can still tell
 * roughly what was masked while not leaking the sensitive material.
 *
 * Best-effort only: exotic quoting / escaping can bypass the patterns.
 */
export function sanitizeOutput(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  for (const pattern of SECRET_FILE_PATH_PATTERNS) {
    result = result.replace(pattern, "[REDACTED_PATH]");
  }
  return result;
}

const SUCCESS_HEADER = "## ✅ Claude Code 実行結果: 成功\n\n";
const SUCCESS_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

const FAILURE_HEADER = "## ❌ Claude Code 実行結果: 失敗\n\n";
const FAILURE_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

export {
  MAX_COMMENT_LENGTH,
  PARTIAL_STDOUT_TAIL_LENGTH,
  PARTIAL_STDERR_TAIL_LENGTH,
  TRUNCATION_PREFIX,
  CLI_TIMEOUT_WARNING_NOTE,
  SUCCESS_HEADER,
  SUCCESS_TRUNCATED_SUFFIX,
  FAILURE_HEADER,
  FAILURE_TRUNCATED_SUFFIX,
};

// ---------- Failure category labels ----------

const FAILURE_CATEGORY_LABELS: Record<FailureCategory, string> = {
  [FailureCategory.PROMPT_GENERATION]: "Prompt Generation Error",
  [FailureCategory.CLI_EXECUTION_ERROR]: "CLI Execution Error",
  [FailureCategory.CLI_NON_ZERO_EXIT]: "CLI Non-zero Exit",
  [FailureCategory.CLI_TIMEOUT]: "CLI Timeout",
  [FailureCategory.CLI_PERMISSION_DENIED]: "CLI Permission Denied (auto mode classifier)",
  [FailureCategory.WORKTREE_CREATION]: "Worktree Creation Error",
  [FailureCategory.GIT_FETCH]: "Git Fetch Error",
};

// ---------- Output section labels ----------

const STDOUT_SUMMARY_LABEL = "stdout (partial)";
const STDERR_SUMMARY_LABEL = "stderr";
const TIMEOUT_OUTPUT_SUMMARY_SUFFIX = "(partial, before timeout)";

/**
 * Resolve the <summary> label for a stdout/stderr section based on
 * the failure category. CLI_TIMEOUT uses a dedicated label to signal
 * that the output was interrupted by the timeout.
 */
function buildOutputSummaryLabel(
  stream: "stdout" | "stderr",
  category: FailureCategory,
): string {
  if (category === FailureCategory.CLI_TIMEOUT) {
    return `${stream} ${TIMEOUT_OUTPUT_SUMMARY_SUFFIX}`;
  }
  return stream === "stdout" ? STDOUT_SUMMARY_LABEL : STDERR_SUMMARY_LABEL;
}

// ---------- Failure diagnostics formatting ----------

/**
 * Escape sequences of 3+ backticks to prevent breaking out of fenced code blocks.
 * Inserts a zero-width space after each backtick in the sequence.
 */
function escapeCodeBlock(text: string): string {
  return text.replace(/`{3,}/g, (match) => match.split("").join("\u200B"));
}

/**
 * Format a FailureDiagnostics object into a structured Markdown body
 * suitable for posting as a GitHub Issue comment.
 *
 * - stderr/stdout are sanitized via sanitizeOutput() before inclusion
 * - errorMessage is also sanitized to prevent credential leakage
 * - stdout is truncated to the last PARTIAL_STDOUT_TAIL_LENGTH characters
 * - stderr is truncated to the last PARTIAL_STDERR_TAIL_LENGTH characters
 * - Content is wrapped in code blocks inside collapsible <details> to prevent Markdown injection
 * - Backtick sequences are escaped to prevent code block breakout
 */
export function formatFailureDiagnostics(diag: FailureDiagnostics): string {
  const sections: string[] = [];

  const categoryLabel = FAILURE_CATEGORY_LABELS[diag.category];
  sections.push(`**Category:** ${categoryLabel}`);
  sections.push(`**Summary:** ${diag.summary}`);

  if (diag.exitCode !== undefined && diag.exitCode !== null) {
    sections.push(`**Exit Code:** ${diag.exitCode}`);
  }

  if (diag.timeoutMs !== undefined) {
    const timeoutSeconds = diag.timeoutMs / 1_000;
    sections.push(`**Timeout:** ${timeoutSeconds}s`);
  }

  if (diag.errorMessage) {
    const sanitized = sanitizeOutput(diag.errorMessage);
    sections.push(`**Error:** \`${escapeCodeBlock(sanitized)}\``);
  }

  if (
    diag.category === FailureCategory.CLI_TIMEOUT &&
    (diag.stdout || diag.stderr)
  ) {
    sections.push(CLI_TIMEOUT_WARNING_NOTE);
  }

  if (diag.stderr) {
    let output = diag.stderr;
    if (output.length > PARTIAL_STDERR_TAIL_LENGTH) {
      output = TRUNCATION_PREFIX + output.slice(-PARTIAL_STDERR_TAIL_LENGTH);
    }
    const sanitized = escapeCodeBlock(sanitizeOutput(output));
    const label = buildOutputSummaryLabel("stderr", diag.category);
    sections.push(
      [
        "<details>",
        `<summary>${label}</summary>`,
        "",
        "```",
        sanitized,
        "```",
        "",
        "</details>",
      ].join("\n"),
    );
  }

  if (diag.stdout) {
    let output = diag.stdout;
    if (output.length > PARTIAL_STDOUT_TAIL_LENGTH) {
      output = TRUNCATION_PREFIX + output.slice(-PARTIAL_STDOUT_TAIL_LENGTH);
    }
    const sanitized = escapeCodeBlock(sanitizeOutput(output));
    const label = buildOutputSummaryLabel("stdout", diag.category);
    sections.push(
      [
        "<details>",
        `<summary>${label}</summary>`,
        "",
        "```",
        sanitized,
        "```",
        "",
        "</details>",
      ].join("\n"),
    );
  }

  return sections.join("\n\n");
}

export class CommentError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, CommentError.prototype);
  }
}

/**
 * 成功時のコメントを Issue に投稿する。
 * claudeOutput がコメント上限を超える場合は切り詰めて省略メッセージを付与する。
 *
 * @throws {CommentError} コメント投稿に失敗した場合
 */
export async function postSuccessComment(
  repoFullName: string,
  issueNumber: number,
  claudeOutput: string,
): Promise<void> {
  const maxOutputLength = MAX_COMMENT_LENGTH - SUCCESS_HEADER.length;

  let output = claudeOutput;
  if (output.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - SUCCESS_TRUNCATED_SUFFIX.length;
    output = output.slice(0, truncatedLength) + SUCCESS_TRUNCATED_SUFFIX;
  }

  const body = SUCCESS_HEADER + output;
  await postComment(repoFullName, issueNumber, body);
}

/**
 * 失敗時のコメントを Issue に投稿する。
 * errorMessage がコメント上限を超える場合は切り詰めて省略メッセージを付与する。
 *
 * @throws {CommentError} コメント投稿に失敗した場合
 */
export async function postFailureComment(
  repoFullName: string,
  issueNumber: number,
  errorMessage: string,
): Promise<void> {
  const maxOutputLength = MAX_COMMENT_LENGTH - FAILURE_HEADER.length;

  let message = errorMessage;
  if (message.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - FAILURE_TRUNCATED_SUFFIX.length;
    message = message.slice(0, truncatedLength) + FAILURE_TRUNCATED_SUFFIX;
  }

  const body = FAILURE_HEADER + message;
  await postComment(repoFullName, issueNumber, body);
}

/**
 * gh issue comment で Issue にコメントを投稿する。
 *
 * @throws {CommentError} コマンドがタイムアウトまたは非0終了した場合
 */
async function postComment(
  repoFullName: string,
  issueNumber: number,
  body: string,
): Promise<void> {
  try {
    const result = await runCommand(
      "gh",
      [
        "issue",
        "comment",
        String(issueNumber),
        "--repo",
        repoFullName,
        "--body-file",
        "-",
      ],
      { input: body, timeoutMs: GH_TIMEOUT_MS },
    );

    if (!result.success) {
      throw new CommentError(result.stderr);
    }
  } catch (error: unknown) {
    if (error instanceof CommentError) {
      throw error;
    }
    if (error instanceof ProcessTimeoutError) {
      throw new CommentError(
        `gh issue comment timed out after ${GH_TIMEOUT_MS / 1_000} seconds`,
      );
    }
    if (error instanceof ProcessExecutionError) {
      throw new CommentError(error.message);
    }
    throw error;
  }
}
