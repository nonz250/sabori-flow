from __future__ import annotations

import subprocess
from unittest.mock import patch

import pytest

from label import (
    LabelError,
    transition_to_done,
    transition_to_failed,
    transition_to_in_progress,
)
from models import PhaseLabels


@pytest.fixture()
def phase_labels() -> PhaseLabels:
    return PhaseLabels(
        trigger="claude/plan",
        in_progress="claude/plan:in-progress",
        done="claude/plan:done",
        failed="claude/plan:failed",
    )


class TestTransitionToInProgress:
    """transition_to_in_progress のテスト"""

    @patch("label.subprocess.run")
    def test_calls_gh_with_correct_args(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """trigger ラベルを削除し、in_progress ラベルを追加する gh issue edit が呼ばれる"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        transition_to_in_progress("nonz250/example-app", 42, phase_labels)

        mock_run.assert_called_once_with(
            [
                "gh",
                "issue",
                "edit",
                "--repo",
                "nonz250/example-app",
                "42",
                "--add-label",
                "claude/plan:in-progress",
                "--remove-label",
                "claude/plan",
            ],
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

    @patch("label.subprocess.run")
    def test_raises_label_error_on_failure(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """gh コマンドが非0終了コードを返した場合 LabelError が発生する"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="label not found"
        )

        with pytest.raises(LabelError, match="label not found"):
            transition_to_in_progress("nonz250/example-app", 42, phase_labels)


class TestTransitionToDone:
    """transition_to_done のテスト"""

    @patch("label.subprocess.run")
    def test_calls_gh_with_correct_args(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """in_progress ラベルを削除し、done ラベルを追加する gh issue edit が呼ばれる"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        transition_to_done("nonz250/example-app", 7, phase_labels)

        mock_run.assert_called_once_with(
            [
                "gh",
                "issue",
                "edit",
                "--repo",
                "nonz250/example-app",
                "7",
                "--add-label",
                "claude/plan:done",
                "--remove-label",
                "claude/plan:in-progress",
            ],
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

    @patch("label.subprocess.run")
    def test_raises_label_error_on_failure(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """gh コマンドが非0終了コードを返した場合 LabelError が発生する"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="permission denied"
        )

        with pytest.raises(LabelError, match="permission denied"):
            transition_to_done("nonz250/example-app", 7, phase_labels)


class TestTransitionToFailed:
    """transition_to_failed のテスト"""

    @patch("label.subprocess.run")
    def test_calls_gh_with_correct_args(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """in_progress ラベルを削除し、failed ラベルを追加する gh issue edit が呼ばれる"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="", stderr=""
        )

        transition_to_failed("nonz250/example-app", 15, phase_labels)

        mock_run.assert_called_once_with(
            [
                "gh",
                "issue",
                "edit",
                "--repo",
                "nonz250/example-app",
                "15",
                "--add-label",
                "claude/plan:failed",
                "--remove-label",
                "claude/plan:in-progress",
            ],
            shell=False,
            capture_output=True,
            text=True,
            timeout=120,
        )

    @patch("label.subprocess.run")
    def test_raises_label_error_on_failure(
        self, mock_run, phase_labels: PhaseLabels
    ) -> None:
        """gh コマンドが非0終了コードを返した場合 LabelError が発生する"""
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="network error"
        )

        with pytest.raises(LabelError, match="network error"):
            transition_to_failed("nonz250/example-app", 15, phase_labels)
