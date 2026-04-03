from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Phase(Enum):
    """処理フェーズ"""

    PLAN = "plan"
    IMPL = "impl"


class Priority(Enum):
    """優先度（ソート順序を数値で表現）"""

    HIGH = 0
    LOW = 1
    NONE = 2


@dataclass(frozen=True)
class Issue:
    """GitHub Issue"""

    number: int
    title: str
    body: str | None
    labels: list[str]
    url: str
    phase: Phase
    priority: Priority


@dataclass(frozen=True)
class PhaseLabels:
    """1 フェーズ分のラベル定義"""

    trigger: str
    in_progress: str
    done: str
    failed: str


@dataclass(frozen=True)
class LabelsConfig:
    """plan/impl 両フェーズのラベル定義"""

    plan: PhaseLabels
    impl: PhaseLabels


@dataclass(frozen=True)
class RepositoryConfig:
    """1 リポジトリの設定"""

    owner: str
    repo: str
    local_path: str
    labels: LabelsConfig
    priority_labels: list[str]

    @property
    def full_name(self) -> str:
        return f"{self.owner}/{self.repo}"


@dataclass(frozen=True)
class ExecutionConfig:
    """実行設定"""

    max_parallel: int
    log_dir: str


@dataclass(frozen=True)
class AppConfig:
    """アプリケーション全体の設定"""

    repositories: list[RepositoryConfig]
    execution: ExecutionConfig


@dataclass(frozen=True)
class ExecutorResult:
    """Claude Code CLI の実行結果"""

    success: bool
    stdout: str
    stderr: str
