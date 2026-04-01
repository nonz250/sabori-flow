from __future__ import annotations

import logging
import sys
from pathlib import Path

from config import ConfigValidationError, load_config
from fetcher import GitHubCLIError, IssueParseError, fetch_issues
from models import Phase, RepositoryConfig
from pipeline import process_issue

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yml"

logger = logging.getLogger(__name__)


def _setup_logging() -> None:
    """ロギングを初期化する。"""
    root_logger = logging.getLogger()
    if root_logger.handlers:
        return
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter("[%(asctime)s] %(levelname)s - %(message)s")
    )
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)


def _process_phase(repo_config: RepositoryConfig, phase: Phase) -> bool:
    """指定リポジトリ・フェーズの Issue を取得し、パイプラインを実行する。

    Args:
        repo_config: リポジトリ設定
        phase: 処理フェーズ

    Returns:
        1 件以上の Issue を正常に処理できた場合 True
    """
    phase_name = phase.value
    full_name = repo_config.full_name

    logger.info("[%s] %s フェーズの Issue を取得中...", full_name, phase_name)

    try:
        issues = fetch_issues(repo_config, phase)
    except (GitHubCLIError, IssueParseError) as e:
        logger.error(
            "[%s] %s フェーズの Issue 取得に失敗: %s",
            full_name,
            phase_name,
            e,
        )
        return False

    logger.info(
        "[%s] %s フェーズ: %d 件の Issue を取得",
        full_name,
        phase_name,
        len(issues),
    )

    if not issues:
        return True  # 0件は成功扱い

    any_success = False
    for issue in issues:
        logger.info(
            "  #%d [%s] %s の処理を開始",
            issue.number,
            issue.priority.name,
            issue.title,
        )
        if process_issue(issue, repo_config):
            any_success = True

    return any_success


def main() -> int:
    """アプリケーションのメインエントリポイント。

    Returns:
        終了コード（0: 成功、1: 失敗）
    """
    _setup_logging()

    try:
        app_config = load_config(DEFAULT_CONFIG_PATH)
    except FileNotFoundError:
        logger.error("設定ファイルが見つかりません: %s", DEFAULT_CONFIG_PATH)
        return 1
    except ConfigValidationError as e:
        logger.error("設定ファイルのバリデーションエラー: %s", e)
        return 1

    logger.info(
        "config.yml を読み込みました (リポジトリ数: %d)",
        len(app_config.repositories),
    )

    any_success = False

    for repo_config in app_config.repositories:
        for phase in (Phase.PLAN, Phase.IMPL):
            if _process_phase(repo_config, phase):
                any_success = True

    if not any_success:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
