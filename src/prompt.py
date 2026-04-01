from __future__ import annotations

from pathlib import Path

from models import Issue, Phase, RepositoryConfig


class PromptTemplateError(Exception):
    """テンプレート関連のエラー"""

    pass


DEFAULT_PROMPTS_DIR: Path = Path(__file__).resolve().parent.parent / "prompts"

_TEMPLATE_FILES: dict[Phase, str] = {
    Phase.PLAN: "plan.md",
    Phase.IMPL: "impl.md",
}


def build_prompt(
    issue: Issue,
    repo_config: RepositoryConfig,
    prompts_dir: Path = DEFAULT_PROMPTS_DIR,
) -> str:
    """Issue とリポジトリ設定からプロンプト文字列を組み立てる。

    テンプレートファイルを読み込み、プレースホルダを展開して返す。

    Args:
        issue: 対象の Issue
        repo_config: リポジトリ設定
        prompts_dir: テンプレートディレクトリのパス

    Returns:
        プレースホルダ展開済みのプロンプト文字列

    Raises:
        PromptTemplateError: テンプレートの読み込みまたは展開に失敗した場合
    """
    template = _load_template(issue.phase, prompts_dir)
    variables = _build_variables(issue, repo_config)
    return _render(template, variables)


def _load_template(phase: Phase, prompts_dir: Path) -> str:
    """テンプレートファイルを読み込む。

    Args:
        phase: 処理フェーズ
        prompts_dir: テンプレートディレクトリのパス

    Returns:
        テンプレートファイルの内容

    Raises:
        PromptTemplateError: フェーズが未定義またはファイルの読み込みに失敗した場合
    """
    if phase not in _TEMPLATE_FILES:
        raise PromptTemplateError(f"Unknown phase: {phase}")

    template_path = prompts_dir / _TEMPLATE_FILES[phase]

    if not template_path.exists():
        raise PromptTemplateError(
            f"Template file not found: {template_path}"
        )

    try:
        return template_path.read_text(encoding="utf-8")
    except OSError as e:
        raise PromptTemplateError(
            f"Failed to read template file: {template_path}"
        ) from e


def _build_variables(issue: Issue, repo_config: RepositoryConfig) -> dict[str, str]:
    """プレースホルダに対応する変数辞書を構築する。

    Args:
        issue: 対象の Issue
        repo_config: リポジトリ設定

    Returns:
        プレースホルダ名をキー、展開後の値をバリューとする辞書
    """
    return {
        "repo_full_name": repo_config.full_name,
        "repo_owner": repo_config.owner,
        "repo_name": repo_config.repo,
        "issue_number": str(issue.number),
        "issue_title": issue.title,
        "issue_url": issue.url,
        "issue_body": issue.body or "",
    }


_USER_INPUT_KEYS = frozenset({"issue_body", "issue_title"})


def _render(template: str, variables: dict[str, str]) -> str:
    """テンプレート内のプレースホルダを変数で展開する。

    各プレースホルダ ``{key}`` を対応する値で置換する。
    ``str.replace()`` を使用し、Issue 本文中の ``{`` による
    意図しない展開やエラーを防ぐ。

    ユーザー入力由来の変数（``issue_body``, ``issue_title``）は
    最後に展開する。これにより、ユーザー入力に ``{repo_full_name}``
    のようなプレースホルダ風文字列が含まれていた場合でも、
    先に安全な変数で展開済みのテンプレートに対してユーザー入力を
    埋め込むため、二重展開（意図しない値の注入）を防止できる。

    Args:
        template: プレースホルダを含むテンプレート文字列
        variables: プレースホルダ名と値の辞書

    Returns:
        プレースホルダ展開済みの文字列
    """
    result = template
    user_input_vars: dict[str, str] = {}
    for key, value in variables.items():
        if key in _USER_INPUT_KEYS:
            user_input_vars[key] = value
        else:
            result = result.replace(f"{{{key}}}", value)
    for key, value in user_input_vars.items():
        result = result.replace(f"{{{key}}}", value)
    return result
