from __future__ import annotations

import logging
import subprocess
from unittest.mock import MagicMock, call, patch

import pytest

from worktree import WorktreeError, worktree_context


_FIXED_TIMESTAMP = "20260331100000"
_REPO_PATH = "/path/to/repo"


def _fixed_timestamp_fn() -> str:
    """テスト用の固定タイムスタンプを返す関数"""
    return _FIXED_TIMESTAMP


def _success_result() -> subprocess.CompletedProcess[str]:
    """成功した subprocess.CompletedProcess を生成するヘルパー"""
    return subprocess.CompletedProcess(
        args=[], returncode=0, stdout="", stderr=""
    )


def _failure_result(stderr: str = "error") -> subprocess.CompletedProcess[str]:
    """失敗した subprocess.CompletedProcess を生成するヘルパー"""
    return subprocess.CompletedProcess(
        args=[], returncode=1, stdout="", stderr=stderr
    )


class TestWorktreeContextNormal:
    """worktree_context の正常系テスト"""

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_worktree_created_and_removed(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """worktree が作成され、yield 後に削除される"""
        # Arrange
        mock_run.return_value = _success_result()

        # Act
        with worktree_context(
            _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
        ) as path:
            pass

        # Assert: git worktree add と git worktree remove が呼ばれる
        assert mock_run.call_count == 2

        add_call = mock_run.call_args_list[0]
        add_args = add_call.args[0] if add_call.args else add_call.kwargs["args"]
        assert "worktree" in add_args
        assert "add" in add_args

        remove_call = mock_run.call_args_list[1]
        remove_args = remove_call.args[0] if remove_call.args else remove_call.kwargs["args"]
        assert "worktree" in remove_args
        assert "remove" in remove_args

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_custom_timestamp_fn_is_used(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """カスタム timestamp_fn が呼ばれ、パスに反映される"""
        # Arrange
        custom_ts = "99991231235959"
        mock_run.return_value = _success_result()

        # Act
        with worktree_context(
            _REPO_PATH, 7, timestamp_fn=lambda: custom_ts
        ) as path:
            yielded_path = path

        # Assert
        assert custom_ts in yielded_path

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_yielded_path_format(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """yield されるパスが issue-{number}-{timestamp} のフォーマットになっている"""
        # Arrange
        mock_run.return_value = _success_result()
        issue_number = 42

        # Act
        with worktree_context(
            _REPO_PATH, issue_number, timestamp_fn=_fixed_timestamp_fn
        ) as path:
            yielded_path = path

        # Assert
        expected_suffix = f"issue-{issue_number}-{_FIXED_TIMESTAMP}"
        assert yielded_path.endswith(expected_suffix)
        expected_path = (
            "/path/to/.claude-worker-worktrees/"
            f"issue-{issue_number}-{_FIXED_TIMESTAMP}"
        )
        assert yielded_path == expected_path

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_branch_name_contains_issue_number_and_timestamp(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """作成されるブランチ名に Issue 番号とタイムスタンプが含まれる"""
        # Arrange
        mock_run.return_value = _success_result()

        # Act
        with worktree_context(
            _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
        ) as path:
            pass

        # Assert
        add_call = mock_run.call_args_list[0]
        add_args = add_call.args[0] if add_call.args else add_call.kwargs["args"]
        expected_branch = f"claude-worker/42-{_FIXED_TIMESTAMP}"
        assert expected_branch in add_args


class TestWorktreeContextError:
    """worktree_context の異常系テスト"""

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_worktree_add_failure_raises_worktree_error(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """worktree 作成の git コマンドが失敗すると WorktreeError が発生する"""
        # Arrange
        mock_run.return_value = _failure_result(
            stderr="fatal: branch already exists"
        )

        # Act & Assert
        with pytest.raises(WorktreeError, match="worktree の作成に失敗しました"):
            with worktree_context(
                _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
            ) as path:
                pass

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_worktree_add_timeout_raises_worktree_error(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """worktree 作成がタイムアウトすると WorktreeError が発生する"""
        # Arrange
        mock_run.side_effect = subprocess.TimeoutExpired(
            cmd="git worktree add", timeout=120
        )

        # Act & Assert
        with pytest.raises(WorktreeError, match="タイムアウト"):
            with worktree_context(
                _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
            ) as path:
                pass

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_exception_during_yield_still_removes_worktree(
        self, mock_mkdir: MagicMock, mock_run: MagicMock
    ) -> None:
        """yield 中に例外が発生しても worktree 削除が呼ばれる"""
        # Arrange
        mock_run.return_value = _success_result()

        # Act & Assert
        with pytest.raises(RuntimeError, match="something went wrong"):
            with worktree_context(
                _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
            ) as path:
                raise RuntimeError("something went wrong")

        # Assert: 削除コマンド（2回目の呼び出し）が実行されている
        assert mock_run.call_count == 2
        remove_call = mock_run.call_args_list[1]
        remove_args = remove_call.args[0] if remove_call.args else remove_call.kwargs["args"]
        assert "remove" in remove_args

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_worktree_remove_failure_logs_warning_without_raising(
        self, mock_mkdir: MagicMock, mock_run: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        """worktree 削除が失敗しても例外は発生せずログ WARNING のみ出力される"""
        # Arrange: add は成功、remove は失敗
        mock_run.side_effect = [
            _success_result(),
            _failure_result(stderr="remove failed"),
        ]

        # Act: 例外が発生しないことを確認
        with caplog.at_level(logging.WARNING):
            with worktree_context(
                _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
            ) as path:
                pass

        # Assert
        assert "worktree の削除に失敗しました" in caplog.text

    @patch("worktree.subprocess.run")
    @patch("worktree.Path.mkdir")
    def test_worktree_remove_timeout_logs_warning_without_raising(
        self, mock_mkdir: MagicMock, mock_run: MagicMock, caplog: pytest.LogCaptureFixture
    ) -> None:
        """worktree 削除がタイムアウトしても例外は発生せずログ WARNING のみ出力される"""
        # Arrange: add は成功、remove はタイムアウト
        mock_run.side_effect = [
            _success_result(),
            subprocess.TimeoutExpired(cmd="git worktree remove", timeout=120),
        ]

        # Act: 例外が発生しないことを確認
        with caplog.at_level(logging.WARNING):
            with worktree_context(
                _REPO_PATH, 42, timestamp_fn=_fixed_timestamp_fn
            ) as path:
                pass

        # Assert
        assert "worktree の削除に失敗しました" in caplog.text
