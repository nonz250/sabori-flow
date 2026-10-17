import { homedir } from "node:os";
import { join } from "node:path";

import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";
import type { FailureDiagnostics } from "./models.js";
import { FailureCategory } from "./models.js";

import { formatMarker } from "./spec-thread.js";

const GH_TIMEOUT_MS = 120_000;

const MAX_COMMENT_LENGTH = 64_000;

const WORKER_COMMENT_MARKER = "<!-- sabori-flow -->";
const WORKER_COMMENT_MARKER_PREFIX = "<!-- sabori-flow";

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

  // Anthropic OAuth token
  /sk-ant-(?:oat|ort|sid)[0-9]{2}-[A-Za-z0-9_\-]{20,}/g,

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

const MIN_HOMEDIR_LENGTH_FOR_MASKING = 5;
const HOMEDIR_REDACTION_PLACEHOLDER = "[REDACTED_HOME]";

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
  const home = homedir();
  if (home.length >= MIN_HOMEDIR_LENGTH_FOR_MASKING) {
    const escaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), HOMEDIR_REDACTION_PLACEHOLDER);
  }
  return result;
}

const SUCCESS_HEADER = "## ✅ Claude Code 実行結果: 成功\n\n";
const SUCCESS_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

const FAILURE_HEADER = "## ❌ Claude Code 実行結果: 失敗\n\n";

const REVIEW_HEADER = "## 🔍 AI レビュー結果\n\n";

/**
 * gh の --attach は本文中の `./<file>` をアップロード先 URL に書き換え、
 * 参照されていない添付は末尾に追記する。どちらでも本文は伸びるため、
 * 切り詰めの上限から 1 枚あたりこの文字数を差し引いておく。
 */
const ATTACHMENT_URL_RESERVE = 200;

/** 添付のアップロードを含むため、通常のコメント投稿より長く待つ */
const REVIEW_COMMENT_TIMEOUT_MS = 300_000;

/** コメント URL が見つからなかったときにエラーへ含める gh 出力の長さ */
const UNEXPECTED_OUTPUT_PREVIEW_LENGTH = 200;

const COMMENT_URL_PATTERN = /https?:\/\/\S+#issuecomment-\d+/;

const UNATTACHED_IMAGE_PATTERN = /!\[([^\]]*)\]\((?![a-z][a-z0-9+.-]*:)([^)\s]+\.png)\)/gi;
const FAILURE_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

export {
  REVIEW_HEADER,
  ATTACHMENT_URL_RESERVE,
  REVIEW_COMMENT_TIMEOUT_MS,
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
  [FailureCategory.IMPL_NO_LINKED_PR]: "No Linked Pull Request",
  [FailureCategory.IMPL_NO_CHANGE_REQUIRED]: "No Change Required (reported by Claude)",
  [FailureCategory.WORKTREE_CREATION]: "Worktree Creation Error",
  [FailureCategory.GIT_FETCH]: "Git Fetch Error",
  [FailureCategory.SPEC_PROPOSAL_COMMENT]: "Spec Proposal Comment Error",
  [FailureCategory.AGENT_USAGE_LIMIT]: "Agent Usage Limit Reached",
  [FailureCategory.REVIEW_UNSUPPORTED_PR]: "Unsupported Pull Request",
  [FailureCategory.REVIEW_EMPTY_OUTPUT]: "Empty Review Output",
  [FailureCategory.REVIEW_COMMENT]: "Review Comment Not Posted",
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
  const markerSuffix = "\n\n" + WORKER_COMMENT_MARKER;
  const maxOutputLength =
    MAX_COMMENT_LENGTH - SUCCESS_HEADER.length - markerSuffix.length;

  // Worker comments are read back by deriveSpecThread, so a spec marker
  // appearing in claude's output would make this comment parse as a proposal.
  let output = escapeWorkerMarkers(claudeOutput);
  if (output.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - SUCCESS_TRUNCATED_SUFFIX.length;
    output = output.slice(0, truncatedLength) + SUCCESS_TRUNCATED_SUFFIX;
  }

  const body = SUCCESS_HEADER + output + markerSuffix;
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
  target: CommentTarget = "issue",
): Promise<void> {
  const markerSuffix = "\n\n" + WORKER_COMMENT_MARKER;
  const maxOutputLength =
    MAX_COMMENT_LENGTH - FAILURE_HEADER.length - markerSuffix.length;

  let message = escapeWorkerMarkers(errorMessage);
  if (message.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - FAILURE_TRUNCATED_SUFFIX.length;
    message = message.slice(0, truncatedLength) + FAILURE_TRUNCATED_SUFFIX;
  }

  const body = FAILURE_HEADER + message + markerSuffix;
  await postComment(repoFullName, issueNumber, body, target);
}

/**
 * spec 提案コメントを投稿する。
 *
 * sanitize を関数の内側で行う。truncate とマーカー付与を内包しており
 * 順序に意味がある（sanitize → マーカー列の無害化 → truncate → マーカー付与）。
 * truncate の後に marker を付けるのは、切り落とすと状態が失われるため。
 *
 * @throws {CommentError} コメント投稿に失敗した場合
 */
export async function postSpecProposalComment(
  repoFullName: string,
  issueNumber: number,
  rawOutput: string,
  round: number,
): Promise<void> {
  let output = sanitizeOutput(rawOutput);
  output = escapeWorkerMarkers(output);

  const marker = formatMarker(round);
  const markerSuffix = "\n\n" + marker;
  const maxOutputLength = MAX_COMMENT_LENGTH - markerSuffix.length;

  if (output.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - SUCCESS_TRUNCATED_SUFFIX.length;
    output = output.slice(0, truncatedLength) + SUCCESS_TRUNCATED_SUFFIX;
  }

  const body = output + markerSuffix;
  await postComment(repoFullName, issueNumber, body);
}

export interface ReviewCommentOptions {
  readonly reviewedSha: string;
  readonly screenshotDir: string;
  /** screenshotDir 直下のファイル名 */
  readonly screenshots: readonly string[];
  readonly note: string | null;
}

/**
 * レビュー結果を Pull Request に投稿し、投稿したコメントの URL を返す。
 *
 * レビューではコメントそのものが成果物なので、gh が成功を返しても
 * コメント URL を出力しなかった場合は投稿を確認できなかったとして失敗にする。
 *
 * @throws {CommentError} 投稿に失敗した、または投稿を確認できなかった場合
 */
export async function postReviewComment(
  repoFullName: string,
  prNumber: number,
  rawOutput: string,
  options: ReviewCommentOptions,
): Promise<string> {
  // Rewritten before sanitizing: the screenshot directory lives under the
  // home directory, which sanitizeOutput masks.
  let output = rawOutput;
  for (const name of options.screenshots) {
    output = output
      .replaceAll(`](${name})`, `](./${name})`)
      .replaceAll(`](${join(options.screenshotDir, name)})`, `](./${name})`);
  }
  output = escapeWorkerMarkers(sanitizeOutput(output));
  // Anything still pointing at a local PNG was dropped by the screenshot
  // checks and would render as a broken image on GitHub.
  output = output.replace(
    UNATTACHED_IMAGE_PATTERN,
    (match: string, alt: string, path: string) =>
      options.screenshots.some((name) => path === `./${name}`)
        ? match
        : `_(screenshot not attached: ${alt}, ${path})_`,
  );

  const notePart = options.note === null ? "" : `> ${options.note}\n\n`;
  const prefix = `${REVIEW_HEADER}${notePart}レビュー対象のコミット: \`${options.reviewedSha}\`\n\n`;
  const markerSuffix = "\n\n" + WORKER_COMMENT_MARKER;
  const maxOutputLength =
    MAX_COMMENT_LENGTH -
    options.screenshots.length * ATTACHMENT_URL_RESERVE -
    prefix.length -
    markerSuffix.length;
  if (output.length > maxOutputLength) {
    const truncatedLength = maxOutputLength - SUCCESS_TRUNCATED_SUFFIX.length;
    output = output.slice(0, truncatedLength) + SUCCESS_TRUNCATED_SUFFIX;
  }

  const args = [
    "pr",
    "comment",
    String(prNumber),
    "--repo",
    repoFullName,
    "--body-file",
    "-",
    ...options.screenshots.flatMap((name) => ["--attach", `./${name}`]),
  ];

  let stdout: string;
  try {
    const result = await runCommand("gh", args, {
      input: prefix + output + markerSuffix,
      timeoutMs: REVIEW_COMMENT_TIMEOUT_MS,
      // Without screenshots the directory may not exist, and spawn fails on a missing cwd.
      cwd: options.screenshots.length > 0 ? options.screenshotDir : undefined,
    });
    if (!result.success) {
      throw new CommentError(result.stderr);
    }
    stdout = result.stdout;
  } catch (error: unknown) {
    throw toCommentError(error, "gh pr comment", REVIEW_COMMENT_TIMEOUT_MS);
  }

  const url = stdout.match(COMMENT_URL_PATTERN);
  if (url === null) {
    throw new CommentError(
      `gh pr comment exited successfully but did not print a comment URL: ${stdout.slice(0, UNEXPECTED_OUTPUT_PREVIEW_LENGTH)}`,
    );
  }
  return url[0];
}

/**
 * Neutralize worker marker sequences in text to prevent marker spoofing.
 * Inserts a zero-width space after "<!--" in any sabori-flow marker prefix.
 */
function escapeWorkerMarkers(text: string): string {
  return text.replaceAll(WORKER_COMMENT_MARKER_PREFIX, "<!--​ sabori-flow");
}

export type CommentTarget = "issue" | "pr";

/**
 * gh issue comment / gh pr comment でコメントを投稿する。
 *
 * @throws {CommentError} コマンドがタイムアウトまたは非0終了した場合
 */
async function postComment(
  repoFullName: string,
  issueNumber: number,
  body: string,
  target: CommentTarget = "issue",
): Promise<void> {
  try {
    const result = await runCommand(
      "gh",
      [
        target,
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
    throw toCommentError(error, `gh ${target} comment`, GH_TIMEOUT_MS);
  }
}

function toCommentError(error: unknown, command: string, timeoutMs: number): unknown {
  if (error instanceof ProcessTimeoutError) {
    return new CommentError(`${command} timed out after ${timeoutMs / 1_000} seconds`);
  }
  if (error instanceof ProcessExecutionError) {
    return new CommentError(error.message);
  }
  return error;
}
