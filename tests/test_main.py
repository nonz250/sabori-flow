from __future__ import annotations

import logging
from unittest.mock import patch

import pytest

from config import ConfigValidationError
from fetcher import GitHubCLIError, IssueParseError
from main import main
from models import (
    AppConfig,
    ExecutionConfig,
    Issue,
    LabelsConfig,
    Phase,
    PhaseLabels,
    Priority,
    RepositoryConfig,
)


def _make_repo_config(owner: str = "my-org", repo: str = "my-repo") -> RepositoryConfig:
    """テスト用の RepositoryConfig を生成するヘルパー"""
    return RepositoryConfig(
        owner=owner,
        repo=repo,
        labels=LabelsConfig(
            plan=PhaseLabels(
                trigger="claude/plan",
                in_progress="claude/plan:in-progress",
                done="claude/plan:done",
                failed="claude/plan:failed",
            ),
            impl=PhaseLabels(
                trigger="claude/impl",
                in_progress="claude/impl:in-progress",
                done="claude/impl:done",
                failed="claude/impl:failed",
            ),
        ),
        priority_labels=["priority:high", "priority:low"],
    )


def _make_app_config(
    repo_configs: list[RepositoryConfig] | None = None,
) -> AppConfig:
    """テスト用の AppConfig を生成するヘルパー"""
    if repo_configs is None:
        repo_configs = [_make_repo_config()]
    return AppConfig(
        repositories=repo_configs,
        execution=ExecutionConfig(max_parallel=1),
    )


def _make_issue(
    number: int = 1,
    title: str = "Test issue",
    phase: Phase = Phase.PLAN,
    priority: Priority = Priority.HIGH,
) -> Issue:
    """テスト用の Issue を生成するヘルパー"""
    return Issue(
        number=number,
        title=title,
        body=None,
        labels=[],
        url=f"https://github.com/my-org/my-repo/issues/{number}",
        phase=phase,
        priority=priority,
    )


@pytest.fixture(autouse=True)
def _reset_logging():
    """各テストでロギングの状態をリセットする。"""
    root_logger = logging.getLogger()
    original_handlers = root_logger.handlers[:]
    original_level = root_logger.level
    yield
    root_logger.handlers = original_handlers
    root_logger.level = original_level


class TestConfigLoadFailure:
    """config 読み込み失敗時のテスト"""

    @patch("main.load_config")
    def test_file_not_found_returns_1(self, mock_load_config) -> None:
        mock_load_config.side_effect = FileNotFoundError("not found")

        result = main()

        assert result == 1

    @patch("main.load_config")
    def test_config_validation_error_returns_1(self, mock_load_config) -> None:
        mock_load_config.side_effect = ConfigValidationError("invalid config")

        result = main()

        assert result == 1


class TestIssueFetch:
    """Issue 取得のテスト"""

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_successful_fetch_returns_0(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=42, title="Feature request", priority=Priority.HIGH),
        ]

        result = main()

        assert result == 0

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_zero_issues_returns_0(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = []

        result = main()

        assert result == 0


class TestErrorHandling:
    """エラーハンドリングのテスト"""

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_github_cli_error_skips_phase_and_returns_0_if_other_succeeds(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = [
            GitHubCLIError("gh failed"),
            [_make_issue(phase=Phase.IMPL)],
        ]

        result = main()

        assert result == 0

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_issue_parse_error_skips_phase_and_continues(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = [
            IssueParseError("parse failed"),
            [_make_issue(phase=Phase.IMPL)],
        ]

        result = main()

        assert result == 0

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_all_phases_fail_returns_1(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = GitHubCLIError("gh failed")

        result = main()

        assert result == 1

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_all_repos_all_phases_fail_returns_1(
        self, mock_load_config, mock_fetch_issues
    ) -> None:
        repo1 = _make_repo_config(owner="org1", repo="repo1")
        repo2 = _make_repo_config(owner="org2", repo="repo2")
        mock_load_config.return_value = _make_app_config(
            repo_configs=[repo1, repo2]
        )
        mock_fetch_issues.side_effect = GitHubCLIError("gh failed")

        result = main()

        assert result == 1


class TestLogOutput:
    """ログ出力のテスト"""

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_config_loaded_log(
        self, mock_load_config, mock_fetch_issues, caplog
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = []

        with caplog.at_level(logging.INFO):
            main()

        assert "config.yml を読み込みました (リポジトリ数: 1)" in caplog.text

    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_issue_count_in_log(
        self, mock_load_config, mock_fetch_issues, caplog
    ) -> None:
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=1),
            _make_issue(number=2),
        ]

        with caplog.at_level(logging.INFO):
            main()

        assert "2 件の Issue を取得" in caplog.text
