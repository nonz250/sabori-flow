from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from comment import (
    CommentError,
    _FAILURE_HEADER,
    _MAX_COMMENT_LENGTH,
    _SUCCESS_HEADER,
    _SUCCESS_TRUNCATED_SUFFIX,
    post_failure_comment,
    post_success_comment,
)


class TestPostSuccessComment:
    """post_success_comment のテスト"""

    @patch("comment.subprocess.run")
    def test_posts_success_comment_with_correct_format(self, mock_run) -> None:
        """成功ヘッダー付きのコメントが投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_success_comment(
            "nonz250/example-app", 10, "Implementation completed successfully."
        )

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert posted_body.startswith(_SUCCESS_HEADER)
        assert "Implementation completed successfully." in posted_body

    @patch("comment.subprocess.run")
    def test_uses_body_file_stdin_for_posting(self, mock_run) -> None:
        """--body-file - で stdin 経由でコメント本文が投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_success_comment("nonz250/example-app", 10, "output text")

        mock_run.assert_called_once_with(
            [
                "gh",
                "issue",
                "comment",
                "10",
                "--repo",
                "nonz250/example-app",
                "--body-file",
                "-",
            ],
            input=_SUCCESS_HEADER + "output text",
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

    @patch("comment.subprocess.run")
    def test_empty_output_posts_header_only(self, mock_run) -> None:
        """空文字列の出力でもヘッダー付きで正常に投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_success_comment("nonz250/example-app", 5, "")

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert posted_body == _SUCCESS_HEADER

    @patch("comment.subprocess.run")
    def test_raises_comment_error_on_failure(self, mock_run) -> None:
        """gh コマンドが非0終了コードを返した場合 CommentError が発生する"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="API rate limit exceeded"
        )

        with pytest.raises(CommentError, match="API rate limit exceeded"):
            post_success_comment("nonz250/example-app", 10, "output")


class TestPostSuccessCommentTruncation:
    """post_success_comment の切り詰め処理のテスト"""

    @patch("comment.subprocess.run")
    def test_long_output_is_truncated(self, mock_run) -> None:
        """ヘッダーと出力の合計が上限を超える場合、出力が切り詰められ省略メッセージが付与される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        max_output_length = _MAX_COMMENT_LENGTH - len(_SUCCESS_HEADER)
        long_output = "A" * (max_output_length + 1)

        post_success_comment("nonz250/example-app", 10, long_output)

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert len(posted_body) <= _MAX_COMMENT_LENGTH
        assert posted_body.endswith(_SUCCESS_TRUNCATED_SUFFIX)

    @patch("comment.subprocess.run")
    def test_exact_max_length_output_is_not_truncated(self, mock_run) -> None:
        """ヘッダーと出力の合計が正確に上限以内の場合、切り詰めは発生しない"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )
        max_output_length = _MAX_COMMENT_LENGTH - len(_SUCCESS_HEADER)
        exact_output = "B" * max_output_length

        post_success_comment("nonz250/example-app", 10, exact_output)

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert len(posted_body) == _MAX_COMMENT_LENGTH
        assert _SUCCESS_TRUNCATED_SUFFIX not in posted_body


class TestPostFailureComment:
    """post_failure_comment のテスト"""

    @patch("comment.subprocess.run")
    def test_posts_failure_comment_with_correct_format(self, mock_run) -> None:
        """失敗ヘッダー付きのコメントが投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_failure_comment(
            "nonz250/example-app", 20, "Claude Code CLI timed out"
        )

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert posted_body.startswith(_FAILURE_HEADER)
        assert "Claude Code CLI timed out" in posted_body

    @patch("comment.subprocess.run")
    def test_uses_body_file_stdin_for_posting(self, mock_run) -> None:
        """--body-file - で stdin 経由でコメント本文が投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_failure_comment("nonz250/example-app", 20, "error message")

        mock_run.assert_called_once_with(
            [
                "gh",
                "issue",
                "comment",
                "20",
                "--repo",
                "nonz250/example-app",
                "--body-file",
                "-",
            ],
            input=_FAILURE_HEADER + "error message",
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

    @patch("comment.subprocess.run")
    def test_empty_error_message_posts_header_only(self, mock_run) -> None:
        """空文字列のエラーメッセージでもヘッダー付きで正常に投稿される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        post_failure_comment("nonz250/example-app", 20, "")

        _, kwargs = mock_run.call_args
        posted_body = kwargs["input"]
        assert posted_body == _FAILURE_HEADER

    @patch("comment.subprocess.run")
    def test_raises_comment_error_on_failure(self, mock_run) -> None:
        """gh コマンドが非0終了コードを返した場合 CommentError が発生する"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="not found"
        )

        with pytest.raises(CommentError, match="not found"):
            post_failure_comment("nonz250/example-app", 20, "error")
