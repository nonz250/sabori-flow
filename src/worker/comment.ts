import {
  runCommand,
  ProcessTimeoutError,
  ProcessExecutionError,
} from "./process.js";

const GH_TIMEOUT_MS = 120_000;

const MAX_COMMENT_LENGTH = 64_000;

const SUCCESS_HEADER = "## ✅ Claude Code 実行結果: 成功\n\n";
const SUCCESS_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

const FAILURE_HEADER = "## ❌ Claude Code 実行結果: 失敗\n\n";
const FAILURE_TRUNCATED_SUFFIX = "\n\n---\n⚠️ 出力が長すぎるため省略されました。";

export {
  MAX_COMMENT_LENGTH,
  SUCCESS_HEADER,
  SUCCESS_TRUNCATED_SUFFIX,
  FAILURE_HEADER,
  FAILURE_TRUNCATED_SUFFIX,
};

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
