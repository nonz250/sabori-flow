from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from fetcher import (
    GitHubCLIError,
    IssueParseError,
    _determine_priority,
    _parse_issues,
    _run_gh_command,
    _sort_by_priority,
    fetch_issues,
)
from models import (
    Issue,
    LabelsConfig,
    Phase,
    PhaseLabels,
    Priority,
    RepositoryConfig,
)


@pytest.fixture()
def repo_config() -> RepositoryConfig:
    return RepositoryConfig(
        owner="nonz250",
        repo="example-app",
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


def _make_gh_json(issues: list[dict]) -> str:
    """テスト用の gh コマンド JSON 出力を生成するヘルパー"""
    return json.dumps(issues)


class TestRunGhCommand:
    """_run_gh_command のテスト"""

    @patch("fetcher.subprocess.run")
    def test_returns_stdout_on_success(self, mock_run) -> None:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = '{"result": "ok"}'

        result = _run_gh_command(["gh", "issue", "list"])

        assert result == '{"result": "ok"}'
        mock_run.assert_called_once_with(
            ["gh", "issue", "list"], shell=False, capture_output=True, text=True
        )

    @patch("fetcher.subprocess.run")
    def test_raises_github_cli_error_on_failure(self, mock_run) -> None:
        mock_run.return_value.returncode = 1
        mock_run.return_value.stderr = "gh: not found"

        with pytest.raises(GitHubCLIError, match="gh: not found"):
            _run_gh_command(["gh", "issue", "list"])


class TestDeterminePriority:
    """_determine_priority のテスト"""

    def test_high_priority_label_matched(self) -> None:
        labels = ["bug", "priority:high"]
        result = _determine_priority(labels, ["priority:high", "priority:low"])
        assert result == Priority.HIGH

    def test_low_priority_label_matched(self) -> None:
        labels = ["bug", "priority:low"]
        result = _determine_priority(labels, ["priority:high", "priority:low"])
        assert result == Priority.LOW

    def test_no_priority_label_matched(self) -> None:
        labels = ["bug", "enhancement"]
        result = _determine_priority(labels, ["priority:high", "priority:low"])
        assert result == Priority.NONE

    def test_multiple_match_returns_highest_priority(self) -> None:
        labels = ["priority:high", "priority:low"]
        result = _determine_priority(labels, ["priority:high", "priority:low"])
        assert result == Priority.HIGH

    def test_empty_priority_labels(self) -> None:
        labels = ["bug", "priority:high"]
        result = _determine_priority(labels, [])
        assert result == Priority.NONE


class TestParseIssues:
    """_parse_issues のテスト"""

    def test_parses_valid_json(self, repo_config: RepositoryConfig) -> None:
        raw_json = _make_gh_json(
            [
                {
                    "number": 1,
                    "title": "First issue",
                    "body": "Body text",
                    "labels": [{"name": "claude/plan"}, {"name": "priority:high"}],
                    "url": "https://github.com/nonz250/example-app/issues/1",
                },
            ]
        )

        issues = _parse_issues(raw_json, Phase.PLAN, repo_config)

        assert len(issues) == 1
        issue = issues[0]
        assert issue.number == 1
        assert issue.title == "First issue"
        assert issue.body == "Body text"
        assert issue.labels == ["claude/plan", "priority:high"]
        assert issue.url == "https://github.com/nonz250/example-app/issues/1"
        assert issue.phase == Phase.PLAN
        assert issue.priority == Priority.HIGH

    def test_labels_converted_from_dict_to_list(
        self, repo_config: RepositoryConfig
    ) -> None:
        raw_json = _make_gh_json(
            [
                {
                    "number": 2,
                    "title": "Label test",
                    "body": "body",
                    "labels": [
                        {"name": "bug"},
                        {"name": "enhancement"},
                        {"name": "priority:low"},
                    ],
                    "url": "https://github.com/nonz250/example-app/issues/2",
                },
            ]
        )

        issues = _parse_issues(raw_json, Phase.IMPL, repo_config)

        assert issues[0].labels == ["bug", "enhancement", "priority:low"]

    def test_null_body_becomes_none(self, repo_config: RepositoryConfig) -> None:
        raw_json = _make_gh_json(
            [
                {
                    "number": 3,
                    "title": "No body",
                    "body": None,
                    "labels": [],
                    "url": "https://github.com/nonz250/example-app/issues/3",
                },
            ]
        )

        issues = _parse_issues(raw_json, Phase.PLAN, repo_config)

        assert issues[0].body is None

    def test_invalid_json_raises_issue_parse_error(
        self, repo_config: RepositoryConfig
    ) -> None:
        with pytest.raises(IssueParseError, match="Failed to parse JSON"):
            _parse_issues("not valid json", Phase.PLAN, repo_config)

    def test_empty_json_array_returns_empty_list(
        self, repo_config: RepositoryConfig
    ) -> None:
        issues = _parse_issues("[]", Phase.PLAN, repo_config)
        assert issues == []


class TestSortByPriority:
    """_sort_by_priority のテスト"""

    def _make_issue(self, number: int, priority: Priority) -> Issue:
        return Issue(
            number=number,
            title=f"Issue #{number}",
            body=None,
            labels=[],
            url=f"https://github.com/owner/repo/issues/{number}",
            phase=Phase.PLAN,
            priority=priority,
        )

    def test_sorts_by_priority_then_number(self) -> None:
        issues = [
            self._make_issue(10, Priority.NONE),
            self._make_issue(1, Priority.LOW),
            self._make_issue(5, Priority.HIGH),
        ]

        result = _sort_by_priority(issues)

        assert result[0].number == 5
        assert result[0].priority == Priority.HIGH
        assert result[1].number == 1
        assert result[1].priority == Priority.LOW
        assert result[2].number == 10
        assert result[2].priority == Priority.NONE

    def test_same_priority_sorted_by_number_ascending(self) -> None:
        issues = [
            self._make_issue(30, Priority.LOW),
            self._make_issue(10, Priority.LOW),
            self._make_issue(20, Priority.LOW),
        ]

        result = _sort_by_priority(issues)

        assert [i.number for i in result] == [10, 20, 30]


class TestFetchIssues:
    """fetch_issues のテスト"""

    def _make_raw_json(self) -> str:
        return _make_gh_json(
            [
                {
                    "number": 5,
                    "title": "Low priority",
                    "body": "body",
                    "labels": [{"name": "claude/plan"}, {"name": "priority:low"}],
                    "url": "https://github.com/nonz250/example-app/issues/5",
                },
                {
                    "number": 3,
                    "title": "High priority",
                    "body": "body",
                    "labels": [{"name": "claude/plan"}, {"name": "priority:high"}],
                    "url": "https://github.com/nonz250/example-app/issues/3",
                },
            ]
        )

    @patch("fetcher._run_gh_command")
    def test_calls_gh_with_correct_args(
        self, mock_run_gh: object, repo_config: RepositoryConfig
    ) -> None:
        mock_run_gh.return_value = "[]"  # type: ignore[union-attr]

        fetch_issues(repo_config, Phase.PLAN)

        mock_run_gh.assert_called_once_with(  # type: ignore[union-attr]
            [
                "gh",
                "issue",
                "list",
                "--repo",
                "nonz250/example-app",
                "--label",
                "claude/plan",
                "--state",
                "open",
                "--json",
                "number,title,body,labels,url",
                "--limit",
                "100",
            ]
        )

    @patch("fetcher._run_gh_command")
    def test_plan_phase_uses_plan_trigger_label(
        self, mock_run_gh: object, repo_config: RepositoryConfig
    ) -> None:
        mock_run_gh.return_value = "[]"  # type: ignore[union-attr]

        fetch_issues(repo_config, Phase.PLAN)

        call_args = mock_run_gh.call_args[0][0]  # type: ignore[union-attr]
        label_index = call_args.index("--label")
        assert call_args[label_index + 1] == "claude/plan"

    @patch("fetcher._run_gh_command")
    def test_impl_phase_uses_impl_trigger_label(
        self, mock_run_gh: object, repo_config: RepositoryConfig
    ) -> None:
        mock_run_gh.return_value = "[]"  # type: ignore[union-attr]

        fetch_issues(repo_config, Phase.IMPL)

        call_args = mock_run_gh.call_args[0][0]  # type: ignore[union-attr]
        label_index = call_args.index("--label")
        assert call_args[label_index + 1] == "claude/impl"

    @patch("fetcher._run_gh_command")
    def test_returns_parsed_and_sorted_issues(
        self, mock_run_gh: object, repo_config: RepositoryConfig
    ) -> None:
        mock_run_gh.return_value = self._make_raw_json()  # type: ignore[union-attr]

        result = fetch_issues(repo_config, Phase.PLAN)

        assert len(result) == 2
        assert result[0].number == 3
        assert result[0].priority == Priority.HIGH
        assert result[1].number == 5
        assert result[1].priority == Priority.LOW
