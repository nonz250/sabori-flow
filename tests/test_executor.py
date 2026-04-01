from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from executor import DEFAULT_TIMEOUT_SECONDS, ExecutorError, run_claude


class TestRunClaudeSuccess:
    """run_claude 成功時のテスト"""

    @patch("executor.subprocess.run")
    def test_returns_success_true_on_zero_exit_code(self, mock_run) -> None:
        """終了コード0の場合 ExecutorResult(success=True) が返る"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=["claude", "-p"],
            returncode=0,
            stdout="Claude output text",
            stderr="",
        )

        result = run_claude("Implement feature X")

        assert result.success is True
        assert result.stdout == "Claude output text"
        assert result.stderr == ""


class TestRunClaudeFailure:
    """run_claude 失敗時のテスト"""

    @patch("executor.subprocess.run")
    def test_returns_success_false_on_nonzero_exit_code(self, mock_run) -> None:
        """非0終了コードの場合 ExecutorResult(success=False) が返る"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=["claude", "-p"],
            returncode=1,
            stdout="",
            stderr="Error occurred",
        )

        result = run_claude("Implement feature X")

        assert result.success is False
        assert result.stdout == ""
        assert result.stderr == "Error occurred"


class TestRunClaudeStdin:
    """run_claude の stdin 経由プロンプト渡しのテスト"""

    @patch("executor.subprocess.run")
    def test_prompt_is_passed_via_stdin(self, mock_run) -> None:
        """プロンプト文字列が input 引数で subprocess.run に渡される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=["claude", "-p", "--dangerously-skip-permissions"],
            returncode=0, stdout="", stderr=""
        )

        run_claude("Fix the bug in module Y")

        mock_run.assert_called_once_with(
            ["claude", "-p", "--dangerously-skip-permissions"],
            input="Fix the bug in module Y",
            shell=False,
            capture_output=True,
            text=True,
            timeout=DEFAULT_TIMEOUT_SECONDS,
            cwd=None,
        )


class TestRunClaudeTimeout:
    """run_claude タイムアウト時のテスト"""

    @patch("executor.subprocess.run")
    def test_raises_executor_error_on_timeout(self, mock_run) -> None:
        """TimeoutExpired が発生した場合 ExecutorError が送出される"""
        mock_run.side_effect = subprocess.TimeoutExpired(
            cmd=["claude", "-p"], timeout=1800
        )

        with pytest.raises(ExecutorError, match="timed out after 1800 seconds"):
            run_claude("Long running task")

    @patch("executor.subprocess.run")
    def test_timeout_error_chains_original_exception(self, mock_run) -> None:
        """ExecutorError の __cause__ に元の TimeoutExpired が保持される"""
        original_error = subprocess.TimeoutExpired(
            cmd=["claude", "-p"], timeout=1800
        )
        mock_run.side_effect = original_error

        with pytest.raises(ExecutorError) as exc_info:
            run_claude("Long running task")

        assert exc_info.value.__cause__ is original_error


class TestRunClaudeBinaryNotFound:
    """run_claude で claude バイナリが見つからない場合のテスト"""

    @patch("executor.subprocess.run")
    def test_raises_executor_error_when_binary_not_found(self, mock_run) -> None:
        """FileNotFoundError が発生した場合 ExecutorError が送出される"""
        mock_run.side_effect = FileNotFoundError("No such file or directory: 'claude'")

        with pytest.raises(ExecutorError, match="binary not found"):
            run_claude("Some prompt")

    @patch("executor.subprocess.run")
    def test_binary_not_found_error_chains_original_exception(
        self, mock_run
    ) -> None:
        """ExecutorError の __cause__ に元の FileNotFoundError が保持される"""
        original_error = FileNotFoundError(
            "No such file or directory: 'claude'"
        )
        mock_run.side_effect = original_error

        with pytest.raises(ExecutorError) as exc_info:
            run_claude("Some prompt")

        assert exc_info.value.__cause__ is original_error


class TestRunClaudeDefaultTimeout:
    """run_claude のデフォルトタイムアウト値のテスト"""

    def test_default_timeout_is_1800_seconds(self) -> None:
        """デフォルトタイムアウトは 1800 秒（30 分）"""
        assert DEFAULT_TIMEOUT_SECONDS == 1800

    @patch("executor.subprocess.run")
    def test_default_timeout_is_passed_to_subprocess(self, mock_run) -> None:
        """タイムアウト未指定時にデフォルト値が subprocess.run に渡される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=["claude", "-p", "--dangerously-skip-permissions"],
            returncode=0, stdout="", stderr=""
        )

        run_claude("prompt text")

        _, kwargs = mock_run.call_args
        assert kwargs["timeout"] == 1800


class TestRunClaudeCustomTimeout:
    """run_claude のカスタムタイムアウト値のテスト"""

    @patch("executor.subprocess.run")
    def test_custom_timeout_is_passed_to_subprocess(self, mock_run) -> None:
        """指定したタイムアウト値が subprocess.run に渡される"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=["claude", "-p", "--dangerously-skip-permissions"],
            returncode=0, stdout="", stderr=""
        )

        run_claude("prompt text", timeout=600)

        _, kwargs = mock_run.call_args
        assert kwargs["timeout"] == 600
