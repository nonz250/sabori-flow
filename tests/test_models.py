from dataclasses import FrozenInstanceError

import pytest

from models import (
    AppConfig,
    ExecutionConfig,
    ExecutorResult,
    Issue,
    LabelsConfig,
    Phase,
    PhaseLabels,
    Priority,
    RepositoryConfig,
)


class TestPhase:
    """Phase Enum のテスト"""

    def test_plan_value(self) -> None:
        assert Phase.PLAN.value == "plan"

    def test_impl_value(self) -> None:
        assert Phase.IMPL.value == "impl"


class TestPriority:
    """Priority Enum のテスト"""

    def test_high_value(self) -> None:
        assert Priority.HIGH.value == 0

    def test_low_value(self) -> None:
        assert Priority.LOW.value == 1

    def test_none_value(self) -> None:
        assert Priority.NONE.value == 2

    def test_value_comparison(self) -> None:
        assert Priority.HIGH.value < Priority.LOW.value
        assert Priority.LOW.value < Priority.NONE.value
        assert Priority.HIGH.value < Priority.NONE.value


class TestIssue:
    """Issue dataclass のテスト"""

    @pytest.fixture()
    def issue(self) -> Issue:
        return Issue(
            number=42,
            title="Test issue",
            body="Issue body",
            labels=["bug", "urgent"],
            url="https://github.com/owner/repo/issues/42",
            phase=Phase.PLAN,
            priority=Priority.HIGH,
        )

    def test_fields_are_preserved(self, issue: Issue) -> None:
        assert issue.number == 42
        assert issue.title == "Test issue"
        assert issue.body == "Issue body"
        assert issue.labels == ["bug", "urgent"]
        assert issue.url == "https://github.com/owner/repo/issues/42"
        assert issue.phase == Phase.PLAN
        assert issue.priority == Priority.HIGH

    def test_frozen(self, issue: Issue) -> None:
        with pytest.raises(FrozenInstanceError):
            issue.number = 99  # type: ignore[misc]

    def test_body_accepts_none(self) -> None:
        issue = Issue(
            number=1,
            title="No body",
            body=None,
            labels=[],
            url="https://github.com/owner/repo/issues/1",
            phase=Phase.IMPL,
            priority=Priority.NONE,
        )
        assert issue.body is None


class TestPhaseLabels:
    """PhaseLabels dataclass のテスト"""

    def test_frozen(self) -> None:
        phase_labels = PhaseLabels(
            trigger="plan",
            in_progress="plan:in-progress",
            done="plan:done",
            failed="plan:failed",
        )
        with pytest.raises(FrozenInstanceError):
            phase_labels.trigger = "changed"  # type: ignore[misc]


class TestLabelsConfig:
    """LabelsConfig dataclass のテスト"""

    def test_frozen(self) -> None:
        plan = PhaseLabels(
            trigger="plan",
            in_progress="plan:in-progress",
            done="plan:done",
            failed="plan:failed",
        )
        impl = PhaseLabels(
            trigger="impl",
            in_progress="impl:in-progress",
            done="impl:done",
            failed="impl:failed",
        )
        labels_config = LabelsConfig(plan=plan, impl=impl)
        with pytest.raises(FrozenInstanceError):
            labels_config.plan = plan  # type: ignore[misc]


class TestRepositoryConfig:
    """RepositoryConfig dataclass のテスト"""

    @pytest.fixture()
    def repo_config(self) -> RepositoryConfig:
        plan = PhaseLabels(
            trigger="plan",
            in_progress="plan:in-progress",
            done="plan:done",
            failed="plan:failed",
        )
        impl = PhaseLabels(
            trigger="impl",
            in_progress="impl:in-progress",
            done="impl:done",
            failed="impl:failed",
        )
        return RepositoryConfig(
            owner="my-org",
            repo="my-repo",
            local_path="/tmp/my-org/my-repo",
            labels=LabelsConfig(plan=plan, impl=impl),
            priority_labels=["priority:high", "priority:low"],
        )

    def test_frozen(self, repo_config: RepositoryConfig) -> None:
        with pytest.raises(FrozenInstanceError):
            repo_config.owner = "other"  # type: ignore[misc]

    def test_full_name(self, repo_config: RepositoryConfig) -> None:
        assert repo_config.full_name == "my-org/my-repo"


class TestExecutionConfig:
    """ExecutionConfig dataclass のテスト"""

    def test_frozen(self) -> None:
        config = ExecutionConfig(max_parallel=4, log_dir="/tmp/test-logs")
        with pytest.raises(FrozenInstanceError):
            config.max_parallel = 8  # type: ignore[misc]


class TestExecutorResult:
    """ExecutorResult dataclass のテスト"""

    @pytest.fixture()
    def executor_result(self) -> ExecutorResult:
        return ExecutorResult(
            success=True,
            stdout="Claude output",
            stderr="",
        )

    def test_fields_are_preserved(self, executor_result: ExecutorResult) -> None:
        assert executor_result.success is True
        assert executor_result.stdout == "Claude output"
        assert executor_result.stderr == ""

    def test_frozen(self, executor_result: ExecutorResult) -> None:
        with pytest.raises(FrozenInstanceError):
            executor_result.success = False  # type: ignore[misc]

    def test_failure_fields_are_preserved(self) -> None:
        result = ExecutorResult(
            success=False,
            stdout="",
            stderr="Error: something went wrong",
        )
        assert result.success is False
        assert result.stdout == ""
        assert result.stderr == "Error: something went wrong"


class TestAppConfig:
    """AppConfig dataclass のテスト"""

    def test_frozen(self) -> None:
        config = AppConfig(
            repositories=[],
            execution=ExecutionConfig(max_parallel=2, log_dir="/tmp/test-logs"),
        )
        with pytest.raises(FrozenInstanceError):
            config.repositories = []  # type: ignore[misc]
