from __future__ import annotations

import logging
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from config import ConfigValidationError, load_config
from fetcher import GitHubCLIError, IssueParseError, fetch_issues
from models import Phase, RepositoryConfig
from pipeline import process_issue

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.yml"
_LOG_FORMAT = "[%(asctime)s] %(levelname)s - %(message)s"

logger = logging.getLogger(__name__)


def _setup_logging() -> None:
    """stderr ハンドラのみでロギングを初期化する。

    ファイルハンドラは config 読み込み後に _add_file_handler で追加する。
    """
    root_logger = logging.getLogger()
    if root_logger.handlers:
        return
    root_logger.setLevel(logging.INFO)

    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    root_logger.addHandler(stderr_handler)


def _add_file_handler(log_dir: str) -> None:
    """ファイルハンドラをロガーに追加する。

    Args:
        log_dir: ログ出力先ディレクトリの絶対パス
    """
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    log_file = log_path / "worker.log"
    file_handler = TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        interval=1,
        backupCount=7,
        encoding="utf-8",
    )
    file_handler.suffix = "%Y-%m-%d"
    file_handler.setFormatter(logging.Formatter(_LOG_FORMAT))
    logging.getLogger().addHandler(file_handler)


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


def _process_repository(repo_config: RepositoryConfig) -> bool:
    """1 リポジトリの全フェーズを処理する。

    Args:
        repo_config: リポジトリ設定

    Returns:
        1 件以上の Issue を正常に処理できた場合 True
    """
    any_success = False
    for phase in (Phase.PLAN, Phase.IMPL):
        if _process_phase(repo_config, phase):
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

    _add_file_handler(app_config.execution.log_dir)

    logger.info(
        "config.yml を読み込みました (リポジトリ数: %d)",
        len(app_config.repositories),
    )

    any_success = False
    max_workers = app_config.execution.max_parallel

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {
            pool.submit(_process_repository, repo_config): repo_config
            for repo_config in app_config.repositories
        }
        for future in as_completed(futures):
            repo_config = futures[future]
            try:
                if future.result():
                    any_success = True
            except Exception as e:
                logger.error(
                    "[%s] 予期しないエラー: %s",
                    repo_config.full_name,
                    e,
                )

    if not any_success:
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
