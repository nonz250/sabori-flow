import { describe, it, expect, vi, beforeEach } from "vitest";
import { homedir } from "node:os";

vi.mock("node:fs");

import { readFileSync, realpathSync, statSync } from "node:fs";
import {
  loadConfig,
  ConfigValidationError,
} from "../../src/worker/config.js";

const mockedReadFileSync = vi.mocked(readFileSync);
const mockedRealpathSync = vi.mocked(realpathSync);
const mockedStatSync = vi.mocked(statSync);

// ---------- Helper ----------

function mockYaml(content: string): void {
  mockedReadFileSync.mockReturnValue(content);
  // realpathSync はデフォルトで受け取ったパスをそのまま返す
  mockedRealpathSync.mockImplementation((p) => p as string);
  // statSync はデフォルトでディレクトリとして返す
  mockedStatSync.mockReturnValue({
    isDirectory: () => true,
  } as ReturnType<typeof statSync>);
}

function mockFileNotFound(): void {
  const error = new Error("ENOENT: no such file or directory") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  mockedReadFileSync.mockImplementation(() => {
    throw error;
  });
}

// ---------- Fixtures ----------

const VALID_YAML = `\
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
`;

const VALID_YAML_NO_EXECUTION = `\
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
`;

const VALID_YAML_EMPTY_PRIORITY = `\
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
`;

// ---------- Tests ----------

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("loadConfig - normal", () => {
  it("complete config", () => {
    mockYaml(VALID_YAML);
    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories).toHaveLength(1);

    const repo = result.repositories[0];
    expect(repo.owner).toBe("my-org");
    expect(repo.repo).toBe("my-repo");
    expect(repo.localPath).toBe("/tmp/my-org/my-repo");
    expect(repo.promptsDir).toBeNull();
    expect(repo.labels.plan.trigger).toBe("plan");
    expect(repo.labels.plan.inProgress).toBe("plan:in-progress");
    expect(repo.labels.plan.done).toBe("plan:done");
    expect(repo.labels.plan.failed).toBe("plan:failed");
    expect(repo.labels.impl.trigger).toBe("impl");
    expect(repo.labels.impl.inProgress).toBe("impl:in-progress");
    expect(repo.labels.impl.done).toBe("impl:done");
    expect(repo.labels.impl.failed).toBe("impl:failed");
    expect(repo.priorityLabels).toEqual(["priority:high", "priority:low"]);
    expect(result.execution.maxParallel).toBe(4);
    expect(result.language).toBe("ja");
    expect(result.execution.autonomy).toBe("interactive");
  });

  it("execution default (max_parallel=1 when execution is omitted)", () => {
    mockYaml(VALID_YAML_NO_EXECUTION);
    const result = loadConfig("/path/to/config.yml");

    expect(result.execution.maxParallel).toBe(1);
    expect(result.execution.autonomy).toBe("interactive");
  });

  it("empty priority_labels", () => {
    mockYaml(VALID_YAML_EMPTY_PRIORITY);
    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories[0].priorityLabels).toEqual([]);
  });
});

describe("loadConfig - file errors", () => {
  it("file not found throws Error", () => {
    mockFileNotFound();

    expect(() => loadConfig("/path/to/nonexistent.yml")).toThrow(
      "Config file not found",
    );
  });

  it("invalid YAML throws ConfigValidationError", () => {
    mockYaml(":\n  :\n  - [invalid yaml\n");

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });
});

describe("loadConfig - repositories validation", () => {
  it("missing repositories key", () => {
    mockYaml("execution:\n  max_parallel: 1\n");

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("repositories is not a list", () => {
    mockYaml("repositories: not_a_list\n");

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("repositories is an empty list", () => {
    mockYaml("repositories: []\n");

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("owner is empty string", () => {
    const yaml = VALID_YAML.replace("owner: my-org", 'owner: ""');
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("owner has invalid characters", () => {
    const yaml = VALID_YAML.replace("owner: my-org", 'owner: "owner;rm"');
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("repo has invalid characters", () => {
    const yaml = VALID_YAML.replace("repo: my-repo", 'repo: "repo;rm"');
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });
});

describe("loadConfig - priority_labels validation", () => {
  it("non-string element is rejected", () => {
    const yaml = `\
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
`;
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /priority_labels\[0\]: must be a string/,
    );
  });

  it("invalid characters are rejected", () => {
    const yaml = `\
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
`;
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /priority_labels\[0\]: invalid characters/,
    );
  });

  it("second element invalid", () => {
    const yaml = `\
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
`;
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /priority_labels\[1\]: must be a string/,
    );
  });
});

describe("loadConfig - labels validation", () => {
  it("missing plan key", () => {
    const yaml = `\
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
`;
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("missing trigger key", () => {
    const yaml = `\
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
`;
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("invalid label characters", () => {
    const yaml = VALID_YAML.replace(
      'trigger: "plan"',
      'trigger: "plan<script>"',
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });
});

describe("loadConfig - execution validation", () => {
  it("max_parallel zero", () => {
    const yaml = VALID_YAML.replace("max_parallel: 4", "max_parallel: 0");
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("max_parallel negative", () => {
    const yaml = VALID_YAML.replace("max_parallel: 4", "max_parallel: -1");
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("max_parallel string", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: "four"',
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
  });

  it("max_issues_per_repo の指定値が正しくパースされる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: 3",
    );
    mockYaml(yaml);
    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.maxIssuesPerRepo).toBe(3);
  });

  it("max_issues_per_repo デフォルト値 (execution あり)", () => {
    mockYaml(VALID_YAML);
    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.maxIssuesPerRepo).toBe(1);
  });

  it("max_issues_per_repo デフォルト値 (execution 省略)", () => {
    mockYaml(VALID_YAML_NO_EXECUTION);
    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.maxIssuesPerRepo).toBe(1);
  });

  it("max_issues_per_repo zero", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: 0",
    );
    mockYaml(yaml);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(ConfigValidationError);
  });

  it("max_issues_per_repo negative", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: -1",
    );
    mockYaml(yaml);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(ConfigValidationError);
  });

  it("max_issues_per_repo string", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: 4\n  max_issues_per_repo: "five"',
    );
    mockYaml(yaml);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(ConfigValidationError);
  });

  it("max_issues_per_repo float", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: 1.5",
    );
    mockYaml(yaml);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(ConfigValidationError);
  });

  it("max_parallel が上限値 10 を超える場合にエラーになる", () => {
    const yaml = VALID_YAML.replace("max_parallel: 4", "max_parallel: 11");
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /max_parallel: must be <= 10/,
    );
  });

  it("max_parallel が上限値 10 ちょうどの場合は正常", () => {
    const yaml = VALID_YAML.replace("max_parallel: 4", "max_parallel: 10");
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.maxParallel).toBe(10);
  });

  it("max_issues_per_repo が上限値 20 を超える場合にエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: 21",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /max_issues_per_repo: must be <= 20/,
    );
  });

  it("max_issues_per_repo が上限値 20 ちょうどの場合は正常", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  max_issues_per_repo: 20",
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.maxIssuesPerRepo).toBe(20);
  });

  it("autonomy: 'full' が正しくパースされる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: 4\n  autonomy: "full"',
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.autonomy).toBe("full");
  });

  it("autonomy: 'sandboxed' が正しくパースされる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: 4\n  autonomy: "sandboxed"',
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.autonomy).toBe("sandboxed");
  });

  it("autonomy: 'interactive' が正しくパースされる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: 4\n  autonomy: "interactive"',
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.autonomy).toBe("interactive");
  });

  it("autonomy デフォルト値 (execution あり、autonomy 省略)", () => {
    mockYaml(VALID_YAML);
    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.autonomy).toBe("interactive");
  });

  it("autonomy デフォルト値 (execution 省略)", () => {
    mockYaml(VALID_YAML_NO_EXECUTION);
    const result = loadConfig("/path/to/config.yml");
    expect(result.execution.autonomy).toBe("interactive");
  });

  it("autonomy に不正な文字列を指定するとエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      'max_parallel: 4\n  autonomy: "invalid"',
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /execution.autonomy: must be one of: full, sandboxed, interactive/,
    );
  });

  it("autonomy に boolean を指定するとエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  autonomy: true",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /execution.autonomy: must be a string, got boolean/,
    );
  });

  it("autonomy に数値を指定するとエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "max_parallel: 4",
      "max_parallel: 4\n  autonomy: 1",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /execution.autonomy: must be a string, got number/,
    );
  });
});

describe("loadConfig - local_path validation", () => {
  it("local_path is empty string", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      'local_path: ""',
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /local_path: must be a non-empty string/,
    );
  });

  it("local_path is a relative path", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      "local_path: relative/path",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /local_path: must be an absolute path/,
    );
  });

  it("local_path が存在しないパスの場合にエラーになる", () => {
    mockYaml(VALID_YAML);
    mockedRealpathSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /local_path: path does not exist/,
    );
  });

  it("local_path のシンボリックリンクが解決される", () => {
    mockYaml(VALID_YAML);
    mockedRealpathSync.mockReturnValue("/resolved/real/path");

    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories[0].localPath).toBe("/resolved/real/path");
  });
});

describe("loadConfig - tilde expansion", () => {
  it("local_path with tilde is expanded", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      "local_path: ~/projects/my-repo",
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    const expected = `${homedir()}/projects/my-repo`;

    expect(result.repositories[0].localPath).toBe(expected);
  });
});

// ---------- prompts_dir validation ----------

const VALID_YAML_WITH_PROMPTS_DIR = VALID_YAML.replace(
  "local_path: /tmp/my-org/my-repo",
  "local_path: /tmp/my-org/my-repo\n    prompts_dir: /tmp/my-org/prompts",
);

describe("loadConfig - prompts_dir validation", () => {
  it("prompts_dir が指定されている場合、正しくパースされる", () => {
    mockYaml(VALID_YAML_WITH_PROMPTS_DIR);

    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories[0].promptsDir).toBe("/tmp/my-org/prompts");
  });

  it("prompts_dir が省略されている場合、null になる", () => {
    mockYaml(VALID_YAML);

    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories[0].promptsDir).toBeNull();
  });

  it("prompts_dir が空文字列の場合にエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      'local_path: /tmp/my-org/my-repo\n    prompts_dir: ""',
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /prompts_dir: must be a non-empty string/,
    );
  });

  it("prompts_dir が相対パスの場合にエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      "local_path: /tmp/my-org/my-repo\n    prompts_dir: relative/path",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /prompts_dir: must be an absolute path/,
    );
  });

  it("prompts_dir が存在しないパスの場合にエラーになる", () => {
    const yaml = VALID_YAML_WITH_PROMPTS_DIR;
    mockedReadFileSync.mockReturnValue(yaml);
    mockedRealpathSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/my-org/prompts") {
        throw new Error("ENOENT");
      }
      return path;
    });
    mockedStatSync.mockReturnValue({
      isDirectory: () => true,
    } as ReturnType<typeof statSync>);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /prompts_dir: path does not exist/,
    );
  });

  it("prompts_dir がディレクトリでない場合にエラーになる", () => {
    const yaml = VALID_YAML_WITH_PROMPTS_DIR;
    mockedReadFileSync.mockReturnValue(yaml);
    mockedRealpathSync.mockImplementation((p) => String(p));
    mockedStatSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/my-org/prompts") {
        return { isDirectory: () => false } as ReturnType<typeof statSync>;
      }
      return { isDirectory: () => true } as ReturnType<typeof statSync>;
    });

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /prompts_dir: path is not a directory/,
    );
  });

  it("prompts_dir のシンボリックリンクが解決される", () => {
    mockYaml(VALID_YAML_WITH_PROMPTS_DIR);
    mockedRealpathSync.mockImplementation((p) => {
      const path = String(p);
      if (path === "/tmp/my-org/prompts") return "/resolved/prompts";
      return path;
    });

    const result = loadConfig("/path/to/config.yml");

    expect(result.repositories[0].promptsDir).toBe("/resolved/prompts");
  });

  it("prompts_dir にチルダが使える", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      "local_path: /tmp/my-org/my-repo\n    prompts_dir: ~/prompts/my-repo",
    );
    mockYaml(yaml);

    const result = loadConfig("/path/to/config.yml");
    const expected = `${homedir()}/prompts/my-repo`;

    expect(result.repositories[0].promptsDir).toBe(expected);
  });

  it("prompts_dir が数値の場合にエラーになる", () => {
    const yaml = VALID_YAML.replace(
      "local_path: /tmp/my-org/my-repo",
      "local_path: /tmp/my-org/my-repo\n    prompts_dir: 123",
    );
    mockYaml(yaml);

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /prompts_dir: must be a non-empty string/,
    );
  });
});

describe("loadConfig - language validation", () => {
  function makeYamlWithLanguage(language: unknown): string {
    if (typeof language === "string") {
      return `${VALID_YAML}\nlanguage: "${language}"\n`;
    }
    return `${VALID_YAML}\nlanguage: ${language}\n`;
  }

  it("language: 'ja' parses correctly", () => {
    mockYaml(makeYamlWithLanguage("ja"));
    const result = loadConfig("/path/to/config.yml");

    expect(result.language).toBe("ja");
  });

  it("language: 'en' parses correctly", () => {
    mockYaml(makeYamlWithLanguage("en"));
    const result = loadConfig("/path/to/config.yml");

    expect(result.language).toBe("en");
  });

  it("language omitted defaults to DEFAULT_LANGUAGE ('ja')", () => {
    mockYaml(VALID_YAML);
    const result = loadConfig("/path/to/config.yml");

    expect(result.language).toBe("ja");
  });

  it("language: 'fr' throws ConfigValidationError", () => {
    mockYaml(makeYamlWithLanguage("fr"));

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /must be one of: ja, en/,
    );
  });

  it("language: 123 throws ConfigValidationError", () => {
    mockYaml(makeYamlWithLanguage(123));

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /must be a string/,
    );
  });

  it("language: '' (empty string) throws ConfigValidationError", () => {
    mockYaml(makeYamlWithLanguage(""));

    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      ConfigValidationError,
    );
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /must be one of: ja, en/,
    );
  });
});

describe("loadConfig - auto_impl_after_plan", () => {
  it("auto_impl_after_plan: true is parsed correctly", () => {
    const yaml = VALID_YAML.replace(
      "priority_labels:",
      "auto_impl_after_plan: true\n    priority_labels:",
    );
    mockYaml(yaml);
    const result = loadConfig("/path/to/config.yml");
    expect(result.repositories[0].autoImplAfterPlan).toBe(true);
  });

  it("auto_impl_after_plan: false is parsed correctly", () => {
    const yaml = VALID_YAML.replace(
      "priority_labels:",
      "auto_impl_after_plan: false\n    priority_labels:",
    );
    mockYaml(yaml);
    const result = loadConfig("/path/to/config.yml");
    expect(result.repositories[0].autoImplAfterPlan).toBe(false);
  });

  it("auto_impl_after_plan defaults to false when omitted", () => {
    mockYaml(VALID_YAML);
    const result = loadConfig("/path/to/config.yml");
    expect(result.repositories[0].autoImplAfterPlan).toBe(false);
  });

  it("auto_impl_after_plan with non-boolean value throws ConfigValidationError", () => {
    const yaml = VALID_YAML.replace(
      "priority_labels:",
      'auto_impl_after_plan: "yes"\n    priority_labels:',
    );
    mockYaml(yaml);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(ConfigValidationError);
    expect(() => loadConfig("/path/to/config.yml")).toThrow(
      /auto_impl_after_plan: must be a boolean/,
    );
  });
});
