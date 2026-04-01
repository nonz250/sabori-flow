from __future__ import annotations

import subprocess


class CommentError(Exception):
    """コメント投稿のエラー"""

    pass


_GH_TIMEOUT_SECONDS: int = 120


_MAX_COMMENT_LENGTH: int = 64000

_SUCCESS_HEADER: str = "## ✅ Claude Code 実行結果: 成功\n\n"
_SUCCESS_TRUNCATED_SUFFIX: str = "\n\n---\n⚠️ 出力が長すぎるため省略されました。"

_FAILURE_HEADER: str = "## ❌ Claude Code 実行結果: 失敗\n\n"
_FAILURE_TRUNCATED_SUFFIX: str = "\n\n---\n⚠️ 出力が長すぎるため省略されました。"


def post_success_comment(
    repo_full_name: str,
    issue_number: int,
    claude_output: str,
) -> None:
    """成功時のコメントを Issue に投稿する。

    claude_output がコメント上限を超える場合は切り詰めて省略メッセージを付与する。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        claude_output: Claude Code の出力テキスト

    Raises:
        CommentError: コメント投稿に失敗した場合
    """
    max_output_length = _MAX_COMMENT_LENGTH - len(_SUCCESS_HEADER)

    if len(claude_output) > max_output_length:
        truncated_length = (
            max_output_length - len(_SUCCESS_TRUNCATED_SUFFIX)
        )
        claude_output = claude_output[:truncated_length] + _SUCCESS_TRUNCATED_SUFFIX

    body = _SUCCESS_HEADER + claude_output
    _post_comment(repo_full_name, issue_number, body)


def post_failure_comment(
    repo_full_name: str,
    issue_number: int,
    error_message: str,
) -> None:
    """失敗時のコメントを Issue に投稿する。

    error_message がコメント上限を超える場合は切り詰めて省略メッセージを付与する。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        error_message: エラーメッセージ

    Raises:
        CommentError: コメント投稿に失敗した場合
    """
    max_output_length = _MAX_COMMENT_LENGTH - len(_FAILURE_HEADER)

    if len(error_message) > max_output_length:
        truncated_length = (
            max_output_length - len(_FAILURE_TRUNCATED_SUFFIX)
        )
        error_message = error_message[:truncated_length] + _FAILURE_TRUNCATED_SUFFIX

    body = _FAILURE_HEADER + error_message
    _post_comment(repo_full_name, issue_number, body)


def _post_comment(
    repo_full_name: str,
    issue_number: int,
    body: str,
) -> None:
    """gh issue comment で Issue にコメントを投稿する。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        body: コメント本文

    Raises:
        CommentError: コマンドの終了コードが 0 でない場合
    """
    try:
        result = subprocess.run(
            [
                "gh",
                "issue",
                "comment",
                str(issue_number),
                "--repo",
                repo_full_name,
                "--body-file",
                "-",
            ],
            input=body,
            shell=False,
            capture_output=True,
            text=True,
            timeout=_GH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as e:
        raise CommentError(
            f"gh issue comment timed out after {_GH_TIMEOUT_SECONDS} seconds"
        ) from e

    if result.returncode != 0:
        raise CommentError(result.stderr)
