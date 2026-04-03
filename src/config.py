from __future__ import annotations

import os
import re
from pathlib import Path

import yaml

from models import (
    AppConfig,
    ExecutionConfig,
    LabelsConfig,
    PhaseLabels,
    RepositoryConfig,
)


class ConfigValidationError(Exception):
    """設定ファイルのバリデーションエラー"""

    pass


_OWNER_REPO_PATTERN = re.compile(r"^[a-zA-Z0-9._-]+$")
_LABEL_PATTERN = re.compile(r"^[a-zA-Z0-9./:_ -]+$")
_PHASE_LABEL_KEYS = ("trigger", "in_progress", "done", "failed")


def load_config(config_path: Path) -> AppConfig:
    """config.yml を読み込み、バリデーション後に AppConfig を返す。

    Args:
        config_path: 設定ファイルのパス

    Returns:
        バリデーション済みの AppConfig

    Raises:
        FileNotFoundError: 設定ファイルが存在しない場合
        ConfigValidationError: 設定内容が不正な場合
    """
    if not config_path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")

    raw_text = config_path.read_text(encoding="utf-8")

    try:
        data = yaml.safe_load(raw_text)
    except yaml.YAMLError as e:
        raise ConfigValidationError(f"Failed to parse YAML: {e}") from e

    if not isinstance(data, dict):
        raise ConfigValidationError("Config must be a YAML mapping")

    if "repositories" not in data:
        raise ConfigValidationError("'repositories' key is required")

    repositories = _parse_repositories(data["repositories"])
    execution = _parse_execution(data.get("execution"))

    return AppConfig(repositories=repositories, execution=execution)


def _parse_repositories(raw: list) -> list[RepositoryConfig]:
    """repositories セクションをパースする。

    Args:
        raw: YAML から読み込んだ repositories のリスト

    Returns:
        RepositoryConfig のリスト

    Raises:
        ConfigValidationError: バリデーションエラー
    """
    if not isinstance(raw, list):
        raise ConfigValidationError("'repositories' must be a list")

    if len(raw) == 0:
        raise ConfigValidationError("'repositories' must have at least one entry")

    configs: list[RepositoryConfig] = []
    for i, entry in enumerate(raw):
        prefix = f"repositories[{i}]"

        if not isinstance(entry, dict):
            raise ConfigValidationError(f"{prefix}: must be a mapping")

        owner = _validate_owner_repo(entry, "owner", prefix)
        repo = _validate_owner_repo(entry, "repo", prefix)

        # local_path バリデーション
        if "local_path" not in entry:
            raise ConfigValidationError(f"{prefix}: 'local_path' is required")

        local_path = entry["local_path"]
        if not isinstance(local_path, str) or local_path == "":
            raise ConfigValidationError(f"{prefix}.local_path: must be a non-empty string")

        local_path = os.path.expanduser(local_path)

        if not os.path.isabs(local_path):
            raise ConfigValidationError(f"{prefix}.local_path: must be an absolute path, got '{local_path}'")

        if "labels" not in entry:
            raise ConfigValidationError(f"{prefix}: 'labels' is required")

        labels_raw = entry["labels"]
        if not isinstance(labels_raw, dict):
            raise ConfigValidationError(f"{prefix}.labels: must be a mapping")

        if "plan" not in labels_raw:
            raise ConfigValidationError(f"{prefix}.labels: 'plan' key is required")
        if "impl" not in labels_raw:
            raise ConfigValidationError(f"{prefix}.labels: 'impl' key is required")

        plan = _parse_phase_labels(labels_raw["plan"], f"{prefix}.labels.plan")
        impl = _parse_phase_labels(labels_raw["impl"], f"{prefix}.labels.impl")

        if "priority_labels" not in entry:
            raise ConfigValidationError(f"{prefix}: 'priority_labels' is required")

        priority_raw = entry["priority_labels"]
        if not isinstance(priority_raw, list):
            raise ConfigValidationError(f"{prefix}.priority_labels: must be a list")

        for j, item in enumerate(priority_raw):
            if not isinstance(item, str):
                raise ConfigValidationError(
                    f"{prefix}.priority_labels[{j}]: must be a string"
                )
            if not _LABEL_PATTERN.match(item):
                raise ConfigValidationError(
                    f"{prefix}.priority_labels[{j}]: invalid characters in '{item}' "
                    f"(must match {_LABEL_PATTERN.pattern})"
                )

        configs.append(
            RepositoryConfig(
                owner=owner,
                repo=repo,
                local_path=local_path,
                labels=LabelsConfig(plan=plan, impl=impl),
                priority_labels=priority_raw,
            )
        )

    return configs


def _validate_owner_repo(entry: dict, key: str, prefix: str) -> str:
    """owner / repo フィールドのバリデーションを行う。

    Args:
        entry: リポジトリエントリの辞書
        key: バリデーション対象のキー名
        prefix: エラーメッセージ用のプレフィックス

    Returns:
        バリデーション済みの文字列

    Raises:
        ConfigValidationError: バリデーションエラー
    """
    if key not in entry:
        raise ConfigValidationError(f"{prefix}: '{key}' is required")

    value = entry[key]
    if not isinstance(value, str) or value == "":
        raise ConfigValidationError(f"{prefix}.{key}: must be a non-empty string")

    if not _OWNER_REPO_PATTERN.match(value):
        raise ConfigValidationError(
            f"{prefix}.{key}: invalid characters in '{value}' "
            f"(must match {_OWNER_REPO_PATTERN.pattern})"
        )

    return value


def _parse_phase_labels(raw: dict, phase_name: str) -> PhaseLabels:
    """1 フェーズ分のラベル定義をパースする。

    Args:
        raw: YAML から読み込んだフェーズラベルの辞書
        phase_name: エラーメッセージ用のフェーズ名

    Returns:
        PhaseLabels

    Raises:
        ConfigValidationError: バリデーションエラー
    """
    if not isinstance(raw, dict):
        raise ConfigValidationError(f"{phase_name}: must be a mapping")

    values: dict[str, str] = {}
    for key in _PHASE_LABEL_KEYS:
        if key not in raw:
            raise ConfigValidationError(f"{phase_name}: '{key}' key is required")

        value = raw[key]
        if not isinstance(value, str):
            raise ConfigValidationError(f"{phase_name}.{key}: must be a string")

        if not _LABEL_PATTERN.match(value):
            raise ConfigValidationError(
                f"{phase_name}.{key}: invalid characters in '{value}' "
                f"(must match {_LABEL_PATTERN.pattern})"
            )

        values[key] = value

    return PhaseLabels(
        trigger=values["trigger"],
        in_progress=values["in_progress"],
        done=values["done"],
        failed=values["failed"],
    )


_DEFAULT_LOG_DIR: str = str(Path(__file__).resolve().parent.parent / "logs")


def _parse_execution(raw: dict | None) -> ExecutionConfig:
    """execution セクションをパースする。

    Args:
        raw: YAML から読み込んだ execution の辞書、または None

    Returns:
        ExecutionConfig（省略時はデフォルト max_parallel=1, log_dir=logs/）

    Raises:
        ConfigValidationError: バリデーションエラー
    """
    if raw is None:
        return ExecutionConfig(max_parallel=1, log_dir=_DEFAULT_LOG_DIR)

    if not isinstance(raw, dict):
        raise ConfigValidationError("'execution' must be a mapping")

    max_parallel = raw.get("max_parallel", 1)

    if not isinstance(max_parallel, int) or isinstance(max_parallel, bool):
        raise ConfigValidationError(
            f"execution.max_parallel: must be an integer, got {type(max_parallel).__name__}"
        )

    if max_parallel < 1:
        raise ConfigValidationError(
            f"execution.max_parallel: must be >= 1, got {max_parallel}"
        )

    log_dir = raw.get("log_dir", _DEFAULT_LOG_DIR)

    if not isinstance(log_dir, str) or log_dir == "":
        raise ConfigValidationError(
            "execution.log_dir: must be a non-empty string"
        )

    log_dir = os.path.expanduser(log_dir)

    if not os.path.isabs(log_dir):
        raise ConfigValidationError(
            f"execution.log_dir: must be an absolute path, got '{log_dir}'"
        )

    return ExecutionConfig(max_parallel=max_parallel, log_dir=log_dir)
