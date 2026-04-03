from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from config import ConfigValidationError
from fetcher import GitHubCLIError, IssueParseError
from main import _process_phase, _process_repository, main
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
        local_path=f"/tmp/{owner}/{repo}",
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
        execution=ExecutionConfig(max_parallel=1, log_dir="/tmp/test-logs"),
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


class TestProcessRepository:
    """_process_repository の単体テスト"""

    @patch("main._process_phase")
    def test_both_phases_called(
        self,
        mock_process_phase: MagicMock,
    ) -> None:
        """plan と impl の両フェーズが呼ばれる"""
        # Arrange
        repo_config = _make_repo_config()
        mock_process_phase.return_value = True

        # Act
        _process_repository(repo_config)

        # Assert
        assert mock_process_phase.call_count == 2
        mock_process_phase.assert_any_call(repo_config, Phase.PLAN)
        mock_process_phase.assert_any_call(repo_config, Phase.IMPL)

    @patch("main._process_phase")
    def test_plan_succeeds_impl_fails_returns_true(
        self,
        mock_process_phase: MagicMock,
    ) -> None:
        """plan が成功し impl が失敗しても True が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_process_phase.side_effect = [True, False]

        # Act
        result = _process_repository(repo_config)

        # Assert
        assert result is True

    @patch("main._process_phase")
    def test_plan_fails_impl_succeeds_returns_true(
        self,
        mock_process_phase: MagicMock,
    ) -> None:
        """plan が失敗し impl が成功しても True が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_process_phase.side_effect = [False, True]

        # Act
        result = _process_repository(repo_config)

        # Assert
        assert result is True

    @patch("main._process_phase")
    def test_both_phases_succeed_returns_true(
        self,
        mock_process_phase: MagicMock,
    ) -> None:
        """両フェーズが成功すると True が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_process_phase.return_value = True

        # Act
        result = _process_repository(repo_config)

        # Assert
        assert result is True

    @patch("main._process_phase")
    def test_both_phases_fail_returns_false(
        self,
        mock_process_phase: MagicMock,
    ) -> None:
        """両フェーズが失敗すると False が返る"""
        # Arrange
        repo_config = _make_repo_config()
        mock_process_phase.return_value = False

        # Act
        result = _process_repository(repo_config)

        # Assert
        assert result is False


class TestMainThreadPoolExecutor:
    """main() の ThreadPoolExecutor 関連テスト"""

    @patch("main._process_repository")
    @patch("main.ThreadPoolExecutor")
    @patch("main.load_config")
    def test_max_parallel_passed_to_thread_pool(
        self,
        mock_load_config: MagicMock,
        mock_executor_cls: MagicMock,
        mock_process_repo: MagicMock,
    ) -> None:
        """max_parallel の値が ThreadPoolExecutor に渡される"""
        # Arrange
        max_parallel = 4
        mock_load_config.return_value = AppConfig(
            repositories=[_make_repo_config()],
            execution=ExecutionConfig(max_parallel=max_parallel, log_dir="/tmp/test-logs"),
        )
        mock_pool = MagicMock()
        mock_executor_cls.return_value.__enter__ = MagicMock(return_value=mock_pool)
        mock_executor_cls.return_value.__exit__ = MagicMock(return_value=False)
        mock_pool.submit.return_value = MagicMock()
        # as_completed が空を返す（submit 結果を直接検証するため）
        mock_pool.submit.return_value.result.return_value = True

        # Act
        with patch("main.as_completed", return_value=[mock_pool.submit.return_value]):
            main()

        # Assert
        mock_executor_cls.assert_called_once_with(max_workers=max_parallel)

    @patch("main._process_repository")
    @patch("main.ThreadPoolExecutor")
    @patch("main.load_config")
    def test_multiple_repos_submitted_to_pool(
        self,
        mock_load_config: MagicMock,
        mock_executor_cls: MagicMock,
        mock_process_repo: MagicMock,
    ) -> None:
        """複数リポジトリが ThreadPoolExecutor に submit される"""
        # Arrange
        repo1 = _make_repo_config(owner="org1", repo="repo1")
        repo2 = _make_repo_config(owner="org2", repo="repo2")
        repo3 = _make_repo_config(owner="org3", repo="repo3")
        mock_load_config.return_value = AppConfig(
            repositories=[repo1, repo2, repo3],
            execution=ExecutionConfig(max_parallel=3, log_dir="/tmp/test-logs"),
        )
        mock_pool = MagicMock()
        mock_executor_cls.return_value.__enter__ = MagicMock(return_value=mock_pool)
        mock_executor_cls.return_value.__exit__ = MagicMock(return_value=False)

        future1 = MagicMock()
        future2 = MagicMock()
        future3 = MagicMock()
        future1.result.return_value = True
        future2.result.return_value = True
        future3.result.return_value = True
        mock_pool.submit.side_effect = [future1, future2, future3]

        # Act
        with patch("main.as_completed", return_value=[future1, future2, future3]):
            main()

        # Assert: submit が 3 回呼ばれる
        assert mock_pool.submit.call_count == 3
        mock_pool.submit.assert_any_call(mock_process_repo, repo1)
        mock_pool.submit.assert_any_call(mock_process_repo, repo2)
        mock_pool.submit.assert_any_call(mock_process_repo, repo3)

    @patch("main._process_repository")
    @patch("main.ThreadPoolExecutor")
    @patch("main.load_config")
    def test_future_exception_logs_error_and_continues(
        self,
        mock_load_config: MagicMock,
        mock_executor_cls: MagicMock,
        mock_process_repo: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """future.result() が例外を送出するとログ出力され、処理は継続する"""
        # Arrange
        repo1 = _make_repo_config(owner="org1", repo="repo1")
        repo2 = _make_repo_config(owner="org2", repo="repo2")
        mock_load_config.return_value = AppConfig(
            repositories=[repo1, repo2],
            execution=ExecutionConfig(max_parallel=2, log_dir="/tmp/test-logs"),
        )
        mock_pool = MagicMock()
        mock_executor_cls.return_value.__enter__ = MagicMock(return_value=mock_pool)
        mock_executor_cls.return_value.__exit__ = MagicMock(return_value=False)

        future_error = MagicMock()
        future_success = MagicMock()
        future_error.result.side_effect = RuntimeError("unexpected crash")
        future_success.result.return_value = True
        mock_pool.submit.side_effect = [future_error, future_success]

        # as_completed の戻り値で futures -> repo_config マッピングを再現するため
        # main() 内の futures dict のキーと一致させる
        with patch("main.as_completed", return_value=[future_error, future_success]):
            with caplog.at_level(logging.ERROR):
                result = main()

        # Assert: エラーがログ出力され、成功した方があるので 0 が返る
        assert result == 0
        assert "予期しないエラー" in caplog.text
