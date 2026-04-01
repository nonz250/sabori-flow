from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from config import ConfigValidationError
from fetcher import GitHubCLIError, IssueParseError
from main import _process_phase, main
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

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_successful_fetch_and_process_returns_0(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue 取得成功かつ process_issue 成功時に 0 が返る"""
        mock_load_config.return_value = _make_app_config()
        # plan フェーズで 1 件取得、impl フェーズは 0 件
        mock_fetch_issues.side_effect = [
            [_make_issue(number=42, title="Feature request", priority=Priority.HIGH)],
            [],
        ]
        mock_process_issue.return_value = True

        result = main()

        assert result == 0
        mock_process_issue.assert_called_once()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_successful_fetch_and_process_failure_returns_1(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue 取得成功だが process_issue が全件失敗すると 1 が返る"""
        mock_load_config.return_value = _make_app_config()
        # 両フェーズで Issue を取得し、全件 process_issue が失敗
        mock_fetch_issues.side_effect = [
            [_make_issue(number=42, title="Feature request", priority=Priority.HIGH)],
            [_make_issue(number=43, title="Another issue", phase=Phase.IMPL)],
        ]
        mock_process_issue.return_value = False

        result = main()

        assert result == 1
        assert mock_process_issue.call_count == 2

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_zero_issues_returns_0_without_calling_process_issue(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue 0 件の場合は process_issue が呼ばれず 0 が返る"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = []

        result = main()

        assert result == 0
        mock_process_issue.assert_not_called()


class TestErrorHandling:
    """エラーハンドリングのテスト"""

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_github_cli_error_skips_phase_and_returns_0_if_other_succeeds(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """plan フェーズで GitHubCLIError が発生しても
        impl フェーズで成功すれば 0 が返る"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = [
            GitHubCLIError("gh failed"),
            [_make_issue(phase=Phase.IMPL)],
        ]
        mock_process_issue.return_value = True

        result = main()

        assert result == 0

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_issue_parse_error_skips_phase_and_continues(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """plan フェーズで IssueParseError が発生しても
        impl フェーズで成功すれば 0 が返る"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = [
            IssueParseError("parse failed"),
            [_make_issue(phase=Phase.IMPL)],
        ]
        mock_process_issue.return_value = True

        result = main()

        assert result == 0

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_all_phases_fail_returns_1(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """全フェーズで Issue 取得に失敗すると 1 が返る"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.side_effect = GitHubCLIError("gh failed")

        result = main()

        assert result == 1
        mock_process_issue.assert_not_called()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_all_repos_all_phases_fail_returns_1(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """複数リポジトリの全フェーズで Issue 取得に失敗すると 1 が返る"""
        repo1 = _make_repo_config(owner="org1", repo="repo1")
        repo2 = _make_repo_config(owner="org2", repo="repo2")
        mock_load_config.return_value = _make_app_config(
            repo_configs=[repo1, repo2]
        )
        mock_fetch_issues.side_effect = GitHubCLIError("gh failed")

        result = main()

        assert result == 1
        mock_process_issue.assert_not_called()


class TestLogOutput:
    """ログ出力のテスト"""

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_config_loaded_log(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """config 読み込み成功時にリポジトリ数がログ出力される"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = []

        with caplog.at_level(logging.INFO):
            main()

        assert "config.yml を読み込みました (リポジトリ数: 1)" in caplog.text

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    @patch("main.load_config")
    def test_issue_count_in_log(
        self,
        mock_load_config: MagicMock,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """取得した Issue 件数がログ出力される"""
        mock_load_config.return_value = _make_app_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=1),
            _make_issue(number=2),
        ]
        mock_process_issue.return_value = True

        with caplog.at_level(logging.INFO):
            main()

        assert "2 件の Issue を取得" in caplog.text


class TestProcessPhase:
    """_process_phase の単体テスト"""

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_issues_found_and_processed_returns_true(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue が取得されて process_issue が成功すると True が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=10, phase=Phase.PLAN),
        ]
        mock_process_issue.return_value = True

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is True
        mock_process_issue.assert_called_once()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_issues_found_but_all_process_fail_returns_false(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue が取得されたが process_issue が全件失敗すると False が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=10, phase=Phase.PLAN),
        ]
        mock_process_issue.return_value = False

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is False

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_zero_issues_returns_true_without_calling_process_issue(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """Issue 0 件は成功扱いで True が返り process_issue は呼ばれない"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.return_value = []

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is True
        mock_process_issue.assert_not_called()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_github_cli_error_returns_false(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """fetch_issues が GitHubCLIError を送出すると False が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.side_effect = GitHubCLIError("gh failed")

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is False
        mock_process_issue.assert_not_called()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_issue_parse_error_returns_false(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """fetch_issues が IssueParseError を送出すると False が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.side_effect = IssueParseError("parse failed")

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is False
        mock_process_issue.assert_not_called()

    @patch("main.process_issue")
    @patch("main.fetch_issues")
    def test_multiple_issues_partial_success_returns_true(
        self,
        mock_fetch_issues: MagicMock,
        mock_process_issue: MagicMock,
    ) -> None:
        """複数 Issue のうち 1 件でも process_issue が成功すれば True が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_fetch_issues.return_value = [
            _make_issue(number=10, phase=Phase.PLAN),
            _make_issue(number=20, phase=Phase.PLAN),
        ]
        mock_process_issue.side_effect = [False, True]

        # Act
        result = _process_phase(repo_config, Phase.PLAN)

        # Assert
        assert result is True
        assert mock_process_issue.call_count == 2
