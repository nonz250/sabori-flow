from __future__ import annotations

import logging

from comment import CommentError, post_failure_comment, post_success_comment
from executor import ExecutorError, run_claude
from label import LabelError, transition_to_done, transition_to_failed, transition_to_in_progress
from models import Issue, Phase, PhaseLabels, RepositoryConfig
from prompt import PromptTemplateError, build_prompt

logger = logging.getLogger(__name__)


def process_issue(issue: Issue, repo_config: RepositoryConfig) -> bool:
    """1 Issue の処理パイプラインを実行する。

    処理フロー:
        1. PhaseLabels 解決: issue.phase から plan/impl のラベル定義を取得
        2. ラベル遷移 trigger -> in-progress
        3. プロンプト生成
        4. Claude CLI 実行
        5-A. 成功: done 遷移 + 成功コメント
        5-B. 失敗: failed 遷移 + 失敗コメント

    エラーハンドリング:
        - レベル 1: trigger->in-progress 失敗 -> return False（次回リトライ可能）
        - レベル 2: プロンプト生成/CLI 実行失敗 -> failed 遷移 + 失敗コメント + return False
        - レベル 3: 後処理失敗 -> ログ WARNING のみ、結果は変えない

    Args:
        issue: 対象の Issue
        repo_config: リポジトリ設定

    Returns:
        Claude 実行が成功した場合 True、それ以外 False
    """
    repo_full_name = repo_config.full_name

    # 1. PhaseLabels 解決
    if issue.phase == Phase.PLAN:
        phase_labels = repo_config.labels.plan
    else:
        phase_labels = repo_config.labels.impl

    logger.info(
        "Issue #%d (%s) の処理を開始します [repo=%s, phase=%s]",
        issue.number,
        issue.title,
        repo_full_name,
        issue.phase.value,
    )

    # 2. ラベル遷移 trigger -> in-progress（レベル 1）
    try:
        transition_to_in_progress(repo_full_name, issue.number, phase_labels)
    except LabelError as e:
        logger.error(
            "Issue #%d: trigger -> in-progress のラベル遷移に失敗しました [repo=%s]: %s",
            issue.number,
            repo_full_name,
            e,
        )
        return False

    # 3. プロンプト生成（レベル 2）
    try:
        prompt = build_prompt(issue, repo_config)
    except PromptTemplateError as e:
        logger.error(
            "Issue #%d: プロンプト生成に失敗しました [repo=%s]: %s",
            issue.number,
            repo_full_name,
            e,
        )
        _handle_failure(
            repo_full_name, issue.number, phase_labels,
            "プロンプトの生成に失敗しました",
        )
        return False

    # 4. Claude CLI 実行（レベル 2）
    try:
        result = run_claude(prompt)
    except ExecutorError as e:
        logger.error(
            "Issue #%d: Claude CLI の実行に失敗しました [repo=%s]: %s",
            issue.number,
            repo_full_name,
            e,
        )
        _handle_failure(
            repo_full_name, issue.number, phase_labels,
            "Claude Code CLI の実行に失敗しました",
        )
        return False

    if not result.success:
        logger.error(
            "Issue #%d: Claude CLI が失敗ステータスを返しました [repo=%s]",
            issue.number,
            repo_full_name,
        )
        _handle_failure(
            repo_full_name, issue.number, phase_labels,
            "Claude Code CLI がエラーを返しました",
        )
        return False

    # 5-A. 成功: done 遷移 + 成功コメント（レベル 3）
    try:
        transition_to_done(repo_full_name, issue.number, phase_labels)
    except LabelError as e:
        logger.warning(
            "Issue #%d: done ラベル遷移に失敗しました [repo=%s]: %s",
            issue.number,
            repo_full_name,
            e,
        )

    try:
        post_success_comment(repo_full_name, issue.number, result.stdout)
    except CommentError as e:
        logger.warning(
            "Issue #%d: 成功コメントの投稿に失敗しました [repo=%s]: %s",
            issue.number,
            repo_full_name,
            e,
        )

    logger.info(
        "Issue #%d の処理が正常に完了しました [repo=%s]",
        issue.number,
        repo_full_name,
    )
    return True


def _handle_failure(
    repo_full_name: str,
    issue_number: int,
    phase_labels: PhaseLabels,
    error_message: str,
) -> None:
    """失敗時の後処理を行う。

    failed ラベルへの遷移と失敗コメントの投稿を行う。
    いずれの操作もレベル 3 のエラーハンドリングとして、
    失敗してもログ WARNING のみで処理を継続する。

    Args:
        repo_full_name: リポジトリのフルネーム (owner/repo)
        issue_number: Issue 番号
        phase_labels: フェーズのラベル定義
        error_message: 失敗の原因を示すエラーメッセージ
    """
    try:
        transition_to_failed(repo_full_name, issue_number, phase_labels)
    except LabelError as e:
        logger.warning(
            "Issue #%d: failed ラベル遷移に失敗しました [repo=%s]: %s",
            issue_number,
            repo_full_name,
            e,
        )

    try:
        post_failure_comment(repo_full_name, issue_number, error_message)
    except CommentError as e:
        logger.warning(
            "Issue #%d: 失敗コメントの投稿に失敗しました [repo=%s]: %s",
            issue_number,
            repo_full_name,
            e,
        )
