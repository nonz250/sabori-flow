from __future__ import annotations

import subprocess

from models import PhaseLabels


class LabelError(Exception):
    """ラベル操作のエラー"""

    pass


_GH_TIMEOUT_SECONDS: int = 120


def transition_to_in_progress(
    repo_full_name: str,
    issue_number: int,
    phase_labels: PhaseLabels,
) -> None:
    """trigger ラベルを外し、in_progress ラベルを付ける。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        phase_labels: フェーズのラベル定義

    Raises:
        LabelError: ラベル操作に失敗した場合
    """
    _run_gh_edit([
        "gh",
        "issue",
        "edit",
        "--repo",
        repo_full_name,
        str(issue_number),
        "--add-label",
        phase_labels.in_progress,
        "--remove-label",
        phase_labels.trigger,
    ])


def transition_to_done(
    repo_full_name: str,
    issue_number: int,
    phase_labels: PhaseLabels,
) -> None:
    """in_progress ラベルを外し、done ラベルを付ける。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        phase_labels: フェーズのラベル定義

    Raises:
        LabelError: ラベル操作に失敗した場合
    """
    _run_gh_edit([
        "gh",
        "issue",
        "edit",
        "--repo",
        repo_full_name,
        str(issue_number),
        "--add-label",
        phase_labels.done,
        "--remove-label",
        phase_labels.in_progress,
    ])


def transition_to_failed(
    repo_full_name: str,
    issue_number: int,
    phase_labels: PhaseLabels,
) -> None:
    """in_progress ラベルを外し、failed ラベルを付ける。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        phase_labels: フェーズのラベル定義

    Raises:
        LabelError: ラベル操作に失敗した場合
    """
    _run_gh_edit([
        "gh",
        "issue",
        "edit",
        "--repo",
        repo_full_name,
        str(issue_number),
        "--add-label",
        phase_labels.failed,
        "--remove-label",
        phase_labels.in_progress,
    ])


def _run_gh_edit(args: list[str]) -> None:
    """gh issue edit コマンドを実行する。

    Args:
        args: コマンドライン引数のリスト

    Raises:
        LabelError: コマンドの終了コードが 0 でない場合
    """
    try:
        result = subprocess.run(
            args, shell=False, capture_output=True, text=True,
            timeout=_GH_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as e:
        raise LabelError(
            f"gh issue edit timed out after {_GH_TIMEOUT_SECONDS} seconds"
        ) from e

    if result.returncode != 0:
        raise LabelError(result.stderr)
