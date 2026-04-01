from __future__ import annotations

import subprocess

from models import ExecutorResult


class ExecutorError(Exception):
    """Claude Code CLI の実行に関するエラー（タイムアウト等）"""

    pass


DEFAULT_TIMEOUT_SECONDS: int = 1800


def run_claude(
    prompt: str,
    cwd: str | None = None,
    timeout: int = DEFAULT_TIMEOUT_SECONDS,
) -> ExecutorResult:
    """Claude Code CLI を実行し、結果を返す。

    stdin 経由でプロンプトを渡す。

    Args:
        prompt: Claude Code CLI に渡すプロンプト文字列
        cwd: 作業ディレクトリ（指定時はそのディレクトリで実行）
        timeout: タイムアウト秒数

    Returns:
        ExecutorResult（success, stdout, stderr）

    Raises:
        ExecutorError: タイムアウトまたは予期しない実行エラーの場合
    """
    try:
        result = subprocess.run(
            ["claude", "-p", "--dangerously-skip-permissions"],
            input=prompt,
            shell=False,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
    except subprocess.TimeoutExpired as e:
        raise ExecutorError(
            f"Claude Code CLI timed out after {timeout} seconds"
        ) from e
    except FileNotFoundError as e:
        raise ExecutorError(
            "Claude Code CLI binary not found: 'claude' is not installed or not in PATH"
        ) from e

    return ExecutorResult(
        success=result.returncode == 0,
        stdout=result.stdout,
        stderr=result.stderr,
    )
