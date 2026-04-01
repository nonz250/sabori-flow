from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from comment import CommentError
from executor import ExecutorError
from label import LabelError
from models import (
    ExecutorResult,
    Issue,
    LabelsConfig,
    Phase,
    PhaseLabels,
    Priority,
    RepositoryConfig,
)
from pipeline import _handle_failure, process_issue
from prompt import PromptTemplateError


# ---------------------------------------------------------------------------
# テストデータ ヘルパー
# ---------------------------------------------------------------------------

PLAN_LABELS = PhaseLabels(
    trigger="claude/plan",
    in_progress="claude/plan:in-progress",
    done="claude/plan:done",
    failed="claude/plan:failed",
)

IMPL_LABELS = PhaseLabels(
    trigger="claude/impl",
    in_progress="claude/impl:in-progress",
    done="claude/impl:done",
    failed="claude/impl:failed",
)

LABELS_CONFIG = LabelsConfig(plan=PLAN_LABELS, impl=IMPL_LABELS)


def _make_repo_config(
    owner: str = "testowner",
    repo: str = "testrepo",
) -> RepositoryConfig:
    """テスト用の RepositoryConfig を生成するヘルパー"""
    return RepositoryConfig(
        owner=owner,
        repo=repo,
        labels=LABELS_CONFIG,
        priority_labels=["priority:high", "priority:low"],
    )


def _make_issue(
    number: int = 42,
    title: str = "Test Issue",
    body: str | None = "Issue body",
    phase: Phase = Phase.PLAN,
    priority: Priority = Priority.HIGH,
) -> Issue:
    """テスト用の Issue を生成するヘルパー"""
    trigger_label = "claude/plan" if phase == Phase.PLAN else "claude/impl"
    return Issue(
        number=number,
        title=title,
        body=body,
        labels=[trigger_label],
        url=f"https://github.com/testowner/testrepo/issues/{number}",
        phase=phase,
        priority=priority,
    )


def _make_success_result(stdout: str = "Claude output") -> ExecutorResult:
    """成功の ExecutorResult を生成するヘルパー"""
    return ExecutorResult(success=True, stdout=stdout, stderr="")


def _make_failure_result(
    stderr: str = "error details",
    stdout: str = "",
) -> ExecutorResult:
    """失敗の ExecutorResult を生成するヘルパー"""
    return ExecutorResult(success=False, stdout=stdout, stderr=stderr)


# ---------------------------------------------------------------------------
# 正常系テスト
# ---------------------------------------------------------------------------


class TestProcessIssueSuccess:
    """process_issue の正常系テスト"""

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_all_steps_success_returns_true(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """全ステップ成功時に True が返り、done 遷移と成功コメントが呼ばれる"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_success_result(stdout="Claude output")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is True
        mock_in_progress.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_build.assert_called_once_with(issue, repo_config)
        mock_run.assert_called_once_with("generated prompt")
        mock_done.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_success_comment.assert_called_once_with(
            "testowner/testrepo", 42, "Claude output"
        )
        mock_failed.assert_not_called()
        mock_fail_comment.assert_not_called()

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_plan_phase_uses_plan_labels(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """plan フェーズで正しい PhaseLabels が使われる"""
        # Arrange
        issue = _make_issue(phase=Phase.PLAN)
        repo_config = _make_repo_config()
        mock_build.return_value = "plan prompt"
        mock_run.return_value = _make_success_result()

        # Act
        process_issue(issue, repo_config)

        # Assert
        mock_in_progress.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_done.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_impl_phase_uses_impl_labels(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """impl フェーズで正しい PhaseLabels が使われる"""
        # Arrange
        issue = _make_issue(phase=Phase.IMPL)
        repo_config = _make_repo_config()
        mock_build.return_value = "impl prompt"
        mock_run.return_value = _make_success_result()

        # Act
        process_issue(issue, repo_config)

        # Assert
        mock_in_progress.assert_called_once_with(
            "testowner/testrepo", 42, IMPL_LABELS
        )
        mock_done.assert_called_once_with(
            "testowner/testrepo", 42, IMPL_LABELS
        )


# ---------------------------------------------------------------------------
# レベル 1 エラー: trigger -> in-progress 失敗
# ---------------------------------------------------------------------------


class TestLevel1Error:
    """trigger -> in-progress のラベル遷移失敗テスト"""

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_in_progress_label_error_returns_false(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """transition_to_in_progress が LabelError を送出すると False が返り、
        後続の関数は呼ばれない"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_in_progress.side_effect = LabelError("label operation failed")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_build.assert_not_called()
        mock_run.assert_not_called()
        mock_done.assert_not_called()
        mock_failed.assert_not_called()
        mock_success_comment.assert_not_called()
        mock_fail_comment.assert_not_called()


# ---------------------------------------------------------------------------
# レベル 2 エラー: プロンプト生成 / CLI 実行失敗
# ---------------------------------------------------------------------------


class TestLevel2Error:
    """プロンプト生成・Claude CLI 実行失敗のテスト"""

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_build_prompt_error_triggers_handle_failure(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """build_prompt が PromptTemplateError を送出すると
        _handle_failure が呼ばれ False が返る"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.side_effect = PromptTemplateError("template not found")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_run.assert_not_called()
        mock_done.assert_not_called()
        mock_success_comment.assert_not_called()
        mock_failed.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo", 42, "プロンプトの生成に失敗しました"
        )

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_run_claude_executor_error_triggers_handle_failure(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """run_claude が ExecutorError を送出すると
        _handle_failure が呼ばれ False が返る"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.side_effect = ExecutorError("timeout after 1800 seconds")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_done.assert_not_called()
        mock_success_comment.assert_not_called()
        mock_failed.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo", 42, "Claude Code CLI の実行に失敗しました"
        )

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_run_claude_returns_failure_result_triggers_handle_failure(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """run_claude が success=False の結果を返すと
        _handle_failure が呼ばれ False が返る"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_failure_result(stderr="CLI error output")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_done.assert_not_called()
        mock_success_comment.assert_not_called()
        mock_failed.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo", 42, "Claude Code CLI がエラーを返しました"
        )

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_run_claude_failure_uses_stdout_when_stderr_is_empty(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """run_claude が success=False かつ stderr が空の場合、
        stdout がエラーメッセージとして使われる"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_failure_result(stderr="", stdout="stdout error")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo", 42, "Claude Code CLI がエラーを返しました"
        )

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_run_claude_failure_uses_default_message_when_both_empty(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
    ) -> None:
        """run_claude が success=False かつ stderr/stdout ともに空の場合、
        デフォルトのエラーメッセージが使われる"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_failure_result(stderr="", stdout="")

        # Act
        result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo",
            42,
            "Claude Code CLI がエラーを返しました",
        )


# ---------------------------------------------------------------------------
# レベル 3 エラー: 後処理の失敗はログ WARNING のみ
# ---------------------------------------------------------------------------


class TestLevel3ErrorOnSuccess:
    """成功後の後処理失敗テスト（done 遷移 / 成功コメント投稿）"""

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_transition_to_done_label_error_returns_true_with_warning(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """成功後に transition_to_done が LabelError を送出しても
        True が返り WARNING ログが出力される"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_success_result()
        mock_done.side_effect = LabelError("done label failed")

        # Act
        with caplog.at_level(logging.WARNING):
            result = process_issue(issue, repo_config)

        # Assert
        assert result is True
        assert "done ラベル遷移に失敗しました" in caplog.text
        mock_success_comment.assert_called_once()

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_post_success_comment_error_returns_true_with_warning(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """成功後に post_success_comment が CommentError を送出しても
        True が返り WARNING ログが出力される"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.return_value = _make_success_result()
        mock_success_comment.side_effect = CommentError("comment post failed")

        # Act
        with caplog.at_level(logging.WARNING):
            result = process_issue(issue, repo_config)

        # Assert
        assert result is True
        assert "成功コメントの投稿に失敗しました" in caplog.text
        mock_done.assert_called_once()


class TestLevel3ErrorOnFailure:
    """失敗後の後処理失敗テスト（failed 遷移 / 失敗コメント投稿）"""

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_transition_to_failed_label_error_logs_warning(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """失敗後に transition_to_failed が LabelError を送出しても
        WARNING ログのみで処理が継続する"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.side_effect = ExecutorError("executor error")
        mock_failed.side_effect = LabelError("failed label error")

        # Act
        with caplog.at_level(logging.WARNING):
            result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        assert "failed ラベル遷移に失敗しました" in caplog.text
        mock_fail_comment.assert_called_once()

    @patch("pipeline.post_success_comment")
    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_done")
    @patch("pipeline.transition_to_failed")
    @patch("pipeline.transition_to_in_progress")
    @patch("pipeline.run_claude")
    @patch("pipeline.build_prompt")
    def test_post_failure_comment_error_logs_warning(
        self,
        mock_build: MagicMock,
        mock_run: MagicMock,
        mock_in_progress: MagicMock,
        mock_failed: MagicMock,
        mock_done: MagicMock,
        mock_fail_comment: MagicMock,
        mock_success_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """失敗後に post_failure_comment が CommentError を送出しても
        WARNING ログのみで処理が継続する"""
        # Arrange
        issue = _make_issue()
        repo_config = _make_repo_config()
        mock_build.return_value = "generated prompt"
        mock_run.side_effect = ExecutorError("executor error")
        mock_fail_comment.side_effect = CommentError("comment post failed")

        # Act
        with caplog.at_level(logging.WARNING):
            result = process_issue(issue, repo_config)

        # Assert
        assert result is False
        assert "失敗コメントの投稿に失敗しました" in caplog.text
        mock_failed.assert_called_once()


# ---------------------------------------------------------------------------
# _handle_failure のテスト
# ---------------------------------------------------------------------------


class TestHandleFailure:
    """_handle_failure の単体テスト"""

    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_failed")
    def test_calls_transition_and_comment(
        self,
        mock_failed: MagicMock,
        mock_fail_comment: MagicMock,
    ) -> None:
        """failed ラベル遷移と失敗コメント投稿が両方呼ばれる"""
        # Act
        _handle_failure(
            "testowner/testrepo", 42, PLAN_LABELS, "some error"
        )

        # Assert
        mock_failed.assert_called_once_with(
            "testowner/testrepo", 42, PLAN_LABELS
        )
        mock_fail_comment.assert_called_once_with(
            "testowner/testrepo", 42, "some error"
        )

    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_failed")
    def test_label_error_does_not_prevent_comment(
        self,
        mock_failed: MagicMock,
        mock_fail_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """transition_to_failed が LabelError でも
        post_failure_comment は呼ばれる"""
        # Arrange
        mock_failed.side_effect = LabelError("label error")

        # Act
        with caplog.at_level(logging.WARNING):
            _handle_failure(
                "testowner/testrepo", 42, PLAN_LABELS, "some error"
            )

        # Assert
        assert "failed ラベル遷移に失敗しました" in caplog.text
        mock_fail_comment.assert_called_once()

    @patch("pipeline.post_failure_comment")
    @patch("pipeline.transition_to_failed")
    def test_comment_error_logged_as_warning(
        self,
        mock_failed: MagicMock,
        mock_fail_comment: MagicMock,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """post_failure_comment が CommentError でも WARNING ログのみ"""
        # Arrange
        mock_fail_comment.side_effect = CommentError("comment error")

        # Act
        with caplog.at_level(logging.WARNING):
            _handle_failure(
                "testowner/testrepo", 42, PLAN_LABELS, "some error"
            )

        # Assert
        assert "失敗コメントの投稿に失敗しました" in caplog.text
        mock_failed.assert_called_once()
