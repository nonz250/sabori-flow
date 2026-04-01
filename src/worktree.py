from __future__ import annotations

import logging
import subprocess
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Generator


class WorktreeError(Exception):
    """git worktree 操作のエラー"""

    pass


_GIT_TIMEOUT_SECONDS: int = 120
_WORKTREES_DIR_NAME: str = ".claude-worker-worktrees"


@contextmanager
def worktree_context(
    local_path: str,
    issue_number: int,
    timestamp_fn: callable = None,  # type: ignore[assignment]
) -> Generator[str, None, None]:
    """git worktree を作成し、yield 後に削除するコンテキストマネージャ。

    Args:
        local_path: クローン済みリポジトリの絶対パス
        issue_number: Issue 番号
        timestamp_fn: タイムスタンプ生成関数（テスト用）

    Yields:
        worktree の絶対パス

    Raises:
        WorktreeError: worktree の作成に失敗した場合
    """
    if timestamp_fn is None:
        timestamp_fn = lambda: time.strftime("%Y%m%d%H%M%S")

    ts = timestamp_fn()
    branch_name = f"claude-worker/{issue_number}-{ts}"
    worktrees_dir = Path(local_path).parent / _WORKTREES_DIR_NAME
    worktree_path = worktrees_dir / f"issue-{issue_number}-{ts}"

    # worktree ディレクトリの親を作成
    worktrees_dir.mkdir(parents=True, exist_ok=True)

    # worktree 作成
    _run_git(
        local_path,
        ["git", "-C", local_path, "worktree", "add", str(worktree_path), "-b", branch_name],
        f"worktree の作成に失敗しました: {worktree_path}",
    )

    try:
        yield str(worktree_path)
    finally:
        # worktree 削除（失敗してもログ警告のみ）
        try:
            _run_git(
                local_path,
                ["git", "-C", local_path, "worktree", "remove", str(worktree_path), "--force"],
                f"worktree の削除に失敗しました: {worktree_path}",
            )
        except WorktreeError:
            logging.getLogger(__name__).warning(
                "worktree の削除に失敗しました: %s", worktree_path
            )


def _run_git(local_path: str, args: list[str], error_message: str) -> None:
    """git コマンドを実行する。

    Args:
        local_path: リポジトリパス（エラーメッセージ用）
        args: コマンドライン引数
        error_message: エラー時のメッセージ

    Raises:
        WorktreeError: コマンド失敗時
    """
    try:
        result = subprocess.run(
            args,
            shell=False,
            capture_output=True,
            text=True,
            timeout=_GIT_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as e:
        raise WorktreeError("git コマンドがタイムアウトしました") from e

    if result.returncode != 0:
        raise WorktreeError(f"{error_message}: {result.stderr}")
