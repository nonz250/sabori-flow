from __future__ import annotations

import json
import subprocess

from models import Issue, Phase, Priority, RepositoryConfig


class GitHubCLIError(Exception):
    """gh コマンドの実行エラー"""

    pass


class IssueParseError(Exception):
    """Issue の JSON パースエラー"""

    pass


def fetch_issues(repo_config: RepositoryConfig, phase: Phase) -> list[Issue]:
    """指定リポジトリ・フェーズの Issue を取得し、優先度順にソートして返す。

    Args:
        repo_config: リポジトリ設定
        phase: 処理フェーズ

    Returns:
        優先度順にソートされた Issue リスト

    Raises:
        GitHubCLIError: gh コマンドの実行に失敗した場合
        IssueParseError: JSON のパースに失敗した場合
    """
    if phase == Phase.PLAN:
        trigger_label = repo_config.labels.plan.trigger
    else:
        trigger_label = repo_config.labels.impl.trigger

    args = [
        "gh",
        "issue",
        "list",
        "--repo",
        repo_config.full_name,
        "--label",
        trigger_label,
        "--state",
        "open",
        "--json",
        "number,title,body,labels,url",
        "--limit",
        "100",
    ]

    raw_json = _run_gh_command(args)
    issues = _parse_issues(raw_json, phase, repo_config)
    return _sort_by_priority(issues)


def _run_gh_command(args: list[str]) -> str:
    """gh コマンドを実行し、stdout を返す。

    Args:
        args: コマンドライン引数のリスト

    Returns:
        コマンドの標準出力

    Raises:
        GitHubCLIError: コマンドの終了コードが 0 でない場合
    """
    result = subprocess.run(args, shell=False, capture_output=True, text=True)

    if result.returncode != 0:
        raise GitHubCLIError(result.stderr)

    return result.stdout


def _parse_issues(
    raw_json: str, phase: Phase, repo_config: RepositoryConfig
) -> list[Issue]:
    """JSON 文字列から Issue リストを生成する。

    Args:
        raw_json: gh コマンドの JSON 出力
        phase: 処理フェーズ
        repo_config: リポジトリ設定

    Returns:
        Issue のリスト

    Raises:
        IssueParseError: JSON のパースに失敗した場合
    """
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        raise IssueParseError(f"Failed to parse JSON: {e}") from e

    issues: list[Issue] = []
    for item in data:
        labels = [label["name"] for label in item.get("labels", [])]
        priority = _determine_priority(labels, repo_config.priority_labels)
        body = item.get("body")

        try:
            issues.append(
                Issue(
                    number=item["number"],
                    title=item["title"],
                    body=body,
                    labels=labels,
                    url=item["url"],
                    phase=phase,
                    priority=priority,
                )
            )
        except KeyError as e:
            raise IssueParseError(f"Missing required field in issue data: {e}") from e

    return issues


def _determine_priority(labels: list[str], priority_labels: list[str]) -> Priority:
    """ラベルから優先度を判定する。

    priority_labels のインデックスで判定:
      - index 0 のラベルが含まれる -> Priority.HIGH
      - index 1 のラベルが含まれる -> Priority.LOW
      - どちらも含まれない -> Priority.NONE

    複数マッチ時は最も優先度が高いもの（インデックスが小さい方）を採用する。

    Args:
        labels: Issue に付与されたラベルのリスト
        priority_labels: 優先度ラベルの定義リスト

    Returns:
        判定された優先度
    """
    priority_map = {
        0: Priority.HIGH,
        1: Priority.LOW,
    }

    for index, priority_label in enumerate(priority_labels):
        if priority_label in labels and index in priority_map:
            return priority_map[index]

    return Priority.NONE


def _sort_by_priority(issues: list[Issue]) -> list[Issue]:
    """Issue を優先度順にソートする。

    ソートキー: (priority.value, number) の昇順

    Args:
        issues: ソート対象の Issue リスト

    Returns:
        ソート済みの Issue リスト
    """
    return sorted(issues, key=lambda i: (i.priority.value, i.number))
