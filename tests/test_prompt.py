from __future__ import annotations

import re
from pathlib import Path

import pytest

from models import (
    Issue,
    LabelsConfig,
    Phase,
    PhaseLabels,
    Priority,
    RepositoryConfig,
)
from prompt import (
    DEFAULT_PROMPTS_DIR,
    PromptTemplateError,
    _TEMPLATE_FILES,
    build_prompt,
)


# ---------------------------------------------------------------------------
# ヘルパー / Fixture
# ---------------------------------------------------------------------------

def _make_plan_labels() -> PhaseLabels:
    return PhaseLabels(
        trigger="claude/plan",
        in_progress="claude/plan:in-progress",
        done="claude/plan:done",
        failed="claude/plan:failed",
    )


def _make_impl_labels() -> PhaseLabels:
    return PhaseLabels(
        trigger="claude/impl",
        in_progress="claude/impl:in-progress",
        done="claude/impl:done",
        failed="claude/impl:failed",
    )


def _make_labels_config() -> LabelsConfig:
    return LabelsConfig(plan=_make_plan_labels(), impl=_make_impl_labels())


def _make_repo_config(
    owner: str = "testowner",
    repo: str = "testrepo",
) -> RepositoryConfig:
    return RepositoryConfig(
        owner=owner,
        repo=repo,
        local_path="/tmp/testowner/testrepo",
        labels=_make_labels_config(),
        priority_labels=["priority:high", "priority:low"],
    )


def _make_issue(
    phase: Phase = Phase.PLAN,
    number: int = 42,
    title: str = "Test Issue Title",
    body: str | None = "This is the issue body.",
    url: str = "https://github.com/testowner/testrepo/issues/42",
) -> Issue:
    return Issue(
        number=number,
        title=title,
        body=body,
        labels=["claude/plan"],
        url=url,
        phase=phase,
        priority=Priority.NONE,
    )


def _write_template(prompts_dir: Path, filename: str, content: str) -> Path:
    """一時ディレクトリにテンプレートファイルを書き出すヘルパー"""
    prompts_dir.mkdir(parents=True, exist_ok=True)
    template_path = prompts_dir / filename
    template_path.write_text(content, encoding="utf-8")
    return template_path


MINIMAL_PLAN_TEMPLATE = (
    "Repo: {repo_full_name}\n"
    "Owner: {repo_owner}\n"
    "Name: {repo_name}\n"
    "Issue #{issue_number}: {issue_title}\n"
    "URL: {issue_url}\n"
    "Body: {issue_body}\n"
)

MINIMAL_IMPL_TEMPLATE = (
    "Implement for {repo_full_name}\n"
    "Issue #{issue_number}: {issue_title}\n"
    "close {issue_url}\n"
    "Body: {issue_body}\n"
)


# ---------------------------------------------------------------------------
# 正常系テスト
# ---------------------------------------------------------------------------

class TestBuildPromptNormal:
    """build_prompt の正常系テスト"""

    def test_plan_phase_generates_prompt_with_all_placeholders_expanded(
        self, tmp_path: Path
    ) -> None:
        """Plan フェーズでプロンプトが正しく生成される"""
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(prompts_dir, "plan.md", MINIMAL_PLAN_TEMPLATE)
        issue = _make_issue(phase=Phase.PLAN)
        repo_config = _make_repo_config()

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        assert result == (
            "Repo: testowner/testrepo\n"
            "Owner: testowner\n"
            "Name: testrepo\n"
            "Issue #42: Test Issue Title\n"
            "URL: https://github.com/testowner/testrepo/issues/42\n"
            "Body: This is the issue body.\n"
        )

    def test_impl_phase_generates_prompt_with_all_placeholders_expanded(
        self, tmp_path: Path
    ) -> None:
        """Impl フェーズでプロンプトが正しく生成される"""
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(prompts_dir, "impl.md", MINIMAL_IMPL_TEMPLATE)
        issue = _make_issue(phase=Phase.IMPL, number=99, title="Implement feature")
        repo_config = _make_repo_config(owner="myorg", repo="myapp")

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        assert "Implement for myorg/myapp" in result
        assert "Issue #99: Implement feature" in result

    def test_issue_body_none_converted_to_empty_string(
        self, tmp_path: Path
    ) -> None:
        """issue.body が None の場合、空文字列に変換される"""
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(prompts_dir, "plan.md", "Body: {issue_body}")
        issue = _make_issue(body=None)
        repo_config = _make_repo_config()

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        assert result == "Body: "

    def test_extra_variables_in_template_do_not_cause_error(
        self, tmp_path: Path
    ) -> None:
        """テンプレートに含まれない追加の変数があっても問題なく動作する

        _build_variables が返す変数のうち、テンプレートで使われていないものが
        あってもエラーにならないことを確認する。
        """
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(prompts_dir, "plan.md", "Only title: {issue_title}")
        issue = _make_issue()
        repo_config = _make_repo_config()

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        assert result == "Only title: Test Issue Title"

    def test_issue_body_with_curly_braces_does_not_cause_error(
        self, tmp_path: Path
    ) -> None:
        """Issue 本文に { や } が含まれていてもエラーにならない"""
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(prompts_dir, "plan.md", "Body: {issue_body}")
        body_with_braces = "function() { return {key: value}; }"
        issue = _make_issue(body=body_with_braces)
        repo_config = _make_repo_config()

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        assert result == f"Body: {body_with_braces}"

    def test_issue_body_with_placeholder_like_string_not_double_expanded(
        self, tmp_path: Path
    ) -> None:
        """Issue 本文に {issue_url} のようなプレースホルダ風文字列が含まれていても二重展開されない

        str.replace による順次置換の仕組みにより、issue_body が先に展開された後、
        その展開結果に含まれるプレースホルダ風文字列は再展開されない。
        """
        # Arrange
        prompts_dir = tmp_path / "prompts"
        _write_template(
            prompts_dir,
            "plan.md",
            "Body: {issue_body}\nURL: {issue_url}",
        )
        malicious_body = "See {issue_url} for details"
        issue = _make_issue(body=malicious_body)
        repo_config = _make_repo_config()

        # Act
        result = build_prompt(issue, repo_config, prompts_dir=prompts_dir)

        # Assert
        lines = result.split("\n")
        assert lines[0] == "Body: See {issue_url} for details"
        assert lines[1] == "URL: https://github.com/testowner/testrepo/issues/42"


# ---------------------------------------------------------------------------
# 異常系テスト
# ---------------------------------------------------------------------------

class TestBuildPromptErrors:
    """build_prompt の異常系テスト"""

    def test_template_file_not_found_raises_prompt_template_error(
        self, tmp_path: Path
    ) -> None:
        """テンプレートファイルが存在しない場合、PromptTemplateError が発生する"""
        # Arrange
        prompts_dir = tmp_path / "prompts"
        prompts_dir.mkdir()
        issue = _make_issue(phase=Phase.PLAN)
        repo_config = _make_repo_config()

        # Act & Assert
        with pytest.raises(PromptTemplateError, match="Template file not found"):
            build_prompt(issue, repo_config, prompts_dir=prompts_dir)

    def test_prompts_directory_not_found_raises_prompt_template_error(
        self, tmp_path: Path
    ) -> None:
        """テンプレートディレクトリが存在しない場合、PromptTemplateError が発生する"""
        # Arrange
        non_existent_dir = tmp_path / "non_existent_prompts"
        issue = _make_issue(phase=Phase.PLAN)
        repo_config = _make_repo_config()

        # Act & Assert
        with pytest.raises(PromptTemplateError, match="Template file not found"):
            build_prompt(issue, repo_config, prompts_dir=non_existent_dir)


# ---------------------------------------------------------------------------
# インテグレーションテスト（実際のテンプレートファイルを使用）
# ---------------------------------------------------------------------------

# 全プレースホルダを検出するための正規表現パターン
# {key} 形式の未展開プレースホルダを検出する
# ただし Issue 本文由来の波括弧は対象外にするため、既知の変数名のみチェックする
_KNOWN_PLACEHOLDERS = [
    "repo_full_name",
    "repo_owner",
    "repo_name",
    "issue_number",
    "issue_title",
    "issue_url",
    "issue_body",
]


def _find_unexpanded_placeholders(text: str) -> list[str]:
    """既知のプレースホルダが未展開のまま残っていないかチェックする"""
    unexpanded = []
    for placeholder in _KNOWN_PLACEHOLDERS:
        pattern = r"\{" + re.escape(placeholder) + r"\}"
        if re.search(pattern, text):
            unexpanded.append(placeholder)
    return unexpanded


class TestBuildPromptIntegration:
    """実際のテンプレートファイルを使ったインテグレーションテスト"""

    @pytest.fixture()
    def integration_issue_plan(self) -> Issue:
        return _make_issue(
            phase=Phase.PLAN,
            number=101,
            title="Add new feature",
            body="Please add a search feature to the application.",
            url="https://github.com/testowner/testrepo/issues/101",
        )

    @pytest.fixture()
    def integration_issue_impl(self) -> Issue:
        return _make_issue(
            phase=Phase.IMPL,
            number=202,
            title="Implement search feature",
            body="Implement the search feature as described in the plan.",
            url="https://github.com/testowner/testrepo/issues/202",
        )

    @pytest.fixture()
    def integration_repo_config(self) -> RepositoryConfig:
        return _make_repo_config(owner="testowner", repo="testrepo")

    def test_plan_template_renders_without_error_and_all_placeholders_expanded(
        self,
        integration_issue_plan: Issue,
        integration_repo_config: RepositoryConfig,
    ) -> None:
        """実際の plan.md テンプレートで build_prompt がエラーなく完了し、
        全プレースホルダが展開済みであること"""
        # Act
        result = build_prompt(
            integration_issue_plan,
            integration_repo_config,
            prompts_dir=DEFAULT_PROMPTS_DIR,
        )

        # Assert
        unexpanded = _find_unexpanded_placeholders(result)
        assert unexpanded == [], (
            f"以下のプレースホルダが未展開です: {unexpanded}"
        )
        assert "testowner/testrepo" in result
        assert "#101" in result
        assert "Add new feature" in result

    def test_impl_template_renders_without_error_and_all_placeholders_expanded(
        self,
        integration_issue_impl: Issue,
        integration_repo_config: RepositoryConfig,
    ) -> None:
        """実際の impl.md テンプレートで build_prompt がエラーなく完了し、
        全プレースホルダが展開済みであること"""
        # Act
        result = build_prompt(
            integration_issue_impl,
            integration_repo_config,
            prompts_dir=DEFAULT_PROMPTS_DIR,
        )

        # Assert
        unexpanded = _find_unexpanded_placeholders(result)
        assert unexpanded == [], (
            f"以下のプレースホルダが未展開です: {unexpanded}"
        )
        assert "testowner/testrepo" in result
        assert "#202" in result
        assert "Implement search feature" in result

    def test_impl_template_contains_close_issue_url(
        self,
        integration_issue_impl: Issue,
        integration_repo_config: RepositoryConfig,
    ) -> None:
        """impl.md のプロンプトに close {issue_url} の展開結果が含まれる"""
        # Act
        result = build_prompt(
            integration_issue_impl,
            integration_repo_config,
            prompts_dir=DEFAULT_PROMPTS_DIR,
        )

        # Assert
        expected_close = (
            "close https://github.com/testowner/testrepo/issues/202"
        )
        assert expected_close in result


# ---------------------------------------------------------------------------
# Phase 網羅性テスト
# ---------------------------------------------------------------------------

class TestTemplateFilesCoverage:
    """_TEMPLATE_FILES が Phase の全メンバーをカバーしていることの検証"""

    def test_template_files_keys_match_all_phase_members(self) -> None:
        """_TEMPLATE_FILES のキーが Phase の全メンバーと一致する"""
        # Arrange
        phase_members = set(Phase)
        template_keys = set(_TEMPLATE_FILES.keys())

        # Assert
        assert template_keys == phase_members, (
            f"Phase メンバーとテンプレートキーが一致しません。"
            f" 不足: {phase_members - template_keys},"
            f" 余剰: {template_keys - phase_members}"
        )
