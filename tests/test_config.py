from pathlib import Path

import pytest

from config import ConfigValidationError, load_config
from models import AppConfig, ExecutionConfig, LabelsConfig, PhaseLabels, RepositoryConfig


def _write_yaml(tmp_path: Path, content: str) -> Path:
    """一時ファイルに YAML を書き出すヘルパー"""
    config_file = tmp_path / "config.yml"
    config_file.write_text(content)
    return config_file


VALID_YAML = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels:
      - "priority:high"
      - "priority:low"
execution:
  max_parallel: 4
"""

VALID_YAML_NO_EXECUTION = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels:
      - "priority:high"
"""

VALID_YAML_EMPTY_PRIORITY = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels: []
"""


class TestLoadConfigNormal:
    """正常系テスト"""

    def test_complete_config(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, VALID_YAML)
        result = load_config(config_file)

        assert isinstance(result, AppConfig)
        assert len(result.repositories) == 1

        repo = result.repositories[0]
        assert repo.owner == "my-org"
        assert repo.repo == "my-repo"
        assert repo.labels.plan.trigger == "plan"
        assert repo.labels.plan.in_progress == "plan:in-progress"
        assert repo.labels.plan.done == "plan:done"
        assert repo.labels.plan.failed == "plan:failed"
        assert repo.labels.impl.trigger == "impl"
        assert repo.labels.impl.in_progress == "impl:in-progress"
        assert repo.labels.impl.done == "impl:done"
        assert repo.labels.impl.failed == "impl:failed"
        assert repo.priority_labels == ["priority:high", "priority:low"]
        assert result.execution.max_parallel == 4

    def test_execution_default(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, VALID_YAML_NO_EXECUTION)
        result = load_config(config_file)

        assert result.execution.max_parallel == 1

    def test_empty_priority_labels(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, VALID_YAML_EMPTY_PRIORITY)
        result = load_config(config_file)

        assert result.repositories[0].priority_labels == []


class TestLoadConfigFileErrors:
    """ファイル関連のエラーテスト"""

    def test_file_not_found(self, tmp_path: Path) -> None:
        non_existent = tmp_path / "non_existent.yml"
        with pytest.raises(FileNotFoundError):
            load_config(non_existent)

    def test_invalid_yaml(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, ":\n  :\n  - [invalid yaml\n")
        with pytest.raises(ConfigValidationError):
            load_config(config_file)


class TestLoadConfigRepositoriesValidation:
    """repositories セクションのバリデーションテスト"""

    def test_missing_repositories_key(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, "execution:\n  max_parallel: 1\n")
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_repositories_not_list(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, "repositories: not_a_list\n")
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_repositories_empty_list(self, tmp_path: Path) -> None:
        config_file = _write_yaml(tmp_path, "repositories: []\n")
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_owner_empty_string(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace('owner: my-org', 'owner: ""')
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_owner_invalid_characters(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace('owner: my-org', 'owner: "owner;rm"')
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_repo_invalid_characters(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace('repo: my-repo', 'repo: "repo;rm"')
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)


class TestLoadConfigPriorityLabelsValidation:
    """priority_labels 要素のバリデーションテスト"""

    def test_non_string_element_rejected(self, tmp_path: Path) -> None:
        yaml_content = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels:
      - 123
"""
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError, match="priority_labels\\[0\\]: must be a string"):
            load_config(config_file)

    def test_invalid_characters_rejected(self, tmp_path: Path) -> None:
        yaml_content = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels:
      - "priority<script>"
"""
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError, match="priority_labels\\[0\\]: invalid characters"):
            load_config(config_file)

    def test_second_element_invalid(self, tmp_path: Path) -> None:
        yaml_content = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        trigger: "plan"
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels:
      - "priority:high"
      - true
"""
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError, match="priority_labels\\[1\\]: must be a string"):
            load_config(config_file)


class TestLoadConfigLabelsValidation:
    """labels セクションのバリデーションテスト"""

    def test_missing_plan_key(self, tmp_path: Path) -> None:
        yaml_content = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels: []
"""
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_missing_trigger_key(self, tmp_path: Path) -> None:
        yaml_content = """\
repositories:
  - owner: my-org
    repo: my-repo
    local_path: /tmp/my-org/my-repo
    labels:
      plan:
        in_progress: "plan:in-progress"
        done: "plan:done"
        failed: "plan:failed"
      impl:
        trigger: "impl"
        in_progress: "impl:in-progress"
        done: "impl:done"
        failed: "impl:failed"
    priority_labels: []
"""
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_invalid_label_characters(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace('trigger: "plan"', 'trigger: "plan<script>"')
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)


class TestLoadConfigExecutionValidation:
    """execution セクションのバリデーションテスト"""

    def test_max_parallel_zero(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace("max_parallel: 4", "max_parallel: 0")
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_max_parallel_negative(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace("max_parallel: 4", "max_parallel: -1")
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)

    def test_max_parallel_string(self, tmp_path: Path) -> None:
        yaml_content = VALID_YAML.replace("max_parallel: 4", 'max_parallel: "four"')
        config_file = _write_yaml(tmp_path, yaml_content)
        with pytest.raises(ConfigValidationError):
            load_config(config_file)
