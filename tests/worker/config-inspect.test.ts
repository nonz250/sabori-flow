import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs");

import { readFileSync } from "node:fs";
import {
  inspectConfig,
  readRawConfigDocument,
} from "../../src/worker/config-inspect.js";
import type {
  AppConfig,
  RepositoryConfig,
  ExecutionConfig,
  LabelsConfig,
} from "../../src/worker/models.js";
import { getDefaultPriorityLabels } from "../../src/utils/config-defaults.js";
import { DEFAULT_LABELS } from "../../src/worker/config.js";

const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.restoreAllMocks();
});

// ---------- Helpers ----------

function makeRepo(overrides?: Partial<RepositoryConfig>): RepositoryConfig {
  return {
    owner: "test-org",
    repo: "test-repo",
    localPath: "/resolved/repos/test-repo",
    defaultBranch: "main",
    labels: DEFAULT_LABELS,
    priorityLabels: getDefaultPriorityLabels(),
    autoImplAfterPlan: false,
    ...overrides,
  };
}

function makeExecution(
  overrides?: Partial<Omit<ExecutionConfig, "language">>,
): ExecutionConfig {
  return {
    maxParallel: 1,
    maxIssuesPerRepo: 1,
    autonomy: "interactive" as const,
    intervalMinutes: 60,
    timeoutMinutes: 60,
    language: "ja" as const,
    ...overrides,
  };
}

function makeConfig(overrides?: {
  repositories?: RepositoryConfig[];
  execution?: ExecutionConfig;
  language?: "ja" | "en";
}): AppConfig {
  return {
    language: overrides?.language ?? ("ja" as const),
    repositories: overrides?.repositories ?? [makeRepo()],
    execution: overrides?.execution ?? makeExecution(),
  };
}

function makeRawRepo(
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    owner: "test-org",
    repo: "test-repo",
    local_path: "/resolved/repos/test-repo",
    ...overrides,
  };
}

// ---------- Tests: default_branch source detection ----------

describe("inspectConfig - default_branch source detection", () => {
  it("written in raw produces source 'file'", () => {
    const config = makeConfig({
      repositories: [makeRepo({ defaultBranch: "develop" })],
    });
    const raw = {
      repositories: [makeRawRepo({ default_branch: "develop" })],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].defaultBranch.source).toBe("file");
    expect(result.repositories[0].defaultBranch.value).toBe("develop");
  });

  it("omitted in raw produces source 'default' with effective value 'main'", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].defaultBranch.source).toBe("default");
    expect(result.repositories[0].defaultBranch.value).toBe("main");
  });

  it("explicitly writing 'main' (same as default) produces source 'file'", () => {
    const config = makeConfig();
    const raw = {
      repositories: [makeRawRepo({ default_branch: "main" })],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].defaultBranch.source).toBe("file");
    expect(result.repositories[0].defaultBranch.value).toBe("main");
  });
});

// ---------- Tests: auto_impl_after_plan source detection ----------

describe("inspectConfig - auto_impl_after_plan source detection", () => {
  it("auto_impl_after_plan: true written in raw produces source 'file'", () => {
    const config = makeConfig({
      repositories: [makeRepo({ autoImplAfterPlan: true })],
    });
    const raw = {
      repositories: [makeRawRepo({ auto_impl_after_plan: true })],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].autoImplAfterPlan.source).toBe("file");
    expect(result.repositories[0].autoImplAfterPlan.value).toBe(true);
  });

  it("auto_impl_after_plan: false written in raw produces source 'file'", () => {
    const config = makeConfig({
      repositories: [makeRepo({ autoImplAfterPlan: false })],
    });
    const raw = {
      repositories: [makeRawRepo({ auto_impl_after_plan: false })],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].autoImplAfterPlan.source).toBe("file");
    expect(result.repositories[0].autoImplAfterPlan.value).toBe(false);
  });

  it("auto_impl_after_plan omitted in raw produces source 'default'", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].autoImplAfterPlan.source).toBe("default");
    expect(result.repositories[0].autoImplAfterPlan.value).toBe(false);
  });
});

// ---------- Tests: execution source detection ----------

describe("inspectConfig - execution source detection", () => {
  it("execution key omitted in raw makes all 5 items 'default'", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.execution.maxParallel.source).toBe("default");
    expect(result.execution.maxIssuesPerRepo.source).toBe("default");
    expect(result.execution.autonomy.source).toBe("default");
    expect(result.execution.intervalMinutes.source).toBe("default");
    expect(result.execution.timeoutMinutes.source).toBe("default");
  });

  it("partially specified execution marks only written keys as 'file'", () => {
    const config = makeConfig({
      execution: makeExecution({
        maxParallel: 4,
        autonomy: "full" as const,
      }),
    });
    const raw = {
      repositories: [makeRawRepo()],
      execution: { max_parallel: 4, autonomy: "full" },
    };

    const result = inspectConfig(config, raw);

    expect(result.execution.maxParallel.source).toBe("file");
    expect(result.execution.maxParallel.value).toBe(4);
    expect(result.execution.maxIssuesPerRepo.source).toBe("default");
    expect(result.execution.autonomy.source).toBe("file");
    expect(result.execution.autonomy.value).toBe("full");
    expect(result.execution.intervalMinutes.source).toBe("default");
    expect(result.execution.timeoutMinutes.source).toBe("default");
  });
});

// ---------- Tests: language source detection ----------

describe("inspectConfig - language source detection", () => {
  it("language present in raw produces source 'file'", () => {
    const config = makeConfig({ language: "en" });
    const raw = {
      repositories: [makeRawRepo()],
      language: "en",
    };

    const result = inspectConfig(config, raw);

    expect(result.language.source).toBe("file");
    expect(result.language.value).toBe("en");
  });

  it("language absent in raw produces source 'default'", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.language.source).toBe("default");
    expect(result.language.value).toBe("ja");
  });

  it("language written with no value (null) in raw produces source 'default'", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()], language: null };

    const result = inspectConfig(config, raw);

    expect(result.language.source).toBe("default");
    expect(result.language.value).toBe("ja");
  });
});

// ---------- Tests: labels comparison ----------

describe("inspectConfig - labels comparison", () => {
  it("default labels produce matchesDefault === true", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].labels.matchesDefault).toBe(true);
  });

  it("different impl.failed label produces matchesDefault === false", () => {
    const modified: LabelsConfig = {
      ...DEFAULT_LABELS,
      impl: { ...DEFAULT_LABELS.impl, failed: "custom/impl:failed" },
    };
    const config = makeConfig({
      repositories: [makeRepo({ labels: modified })],
    });
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].labels.matchesDefault).toBe(false);
  });

  it("different spec.needs_human label produces matchesDefault === false", () => {
    const modified: LabelsConfig = {
      ...DEFAULT_LABELS,
      spec: { ...DEFAULT_LABELS.spec, needsHuman: "custom/spec:needs-human" },
    };
    const config = makeConfig({
      repositories: [makeRepo({ labels: modified })],
    });
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].labels.matchesDefault).toBe(false);
  });
});

// ---------- Tests: priority_labels comparison ----------

describe("inspectConfig - priority_labels comparison", () => {
  it("default priority labels produce matchesDefault === true", () => {
    const config = makeConfig();
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].priorityLabels.matchesDefault).toBe(true);
  });

  it("reversed order produces matchesDefault === false", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({ priorityLabels: ["priority:low", "priority:high"] }),
      ],
    });
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].priorityLabels.matchesDefault).toBe(false);
  });

  it("different count produces matchesDefault === false", () => {
    const config = makeConfig({
      repositories: [makeRepo({ priorityLabels: ["priority:high"] })],
    });
    const raw = { repositories: [makeRawRepo()] };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].priorityLabels.matchesDefault).toBe(false);
  });
});

// ---------- Tests: local_path ----------

describe("inspectConfig - local_path", () => {
  it("rawLocalPath contains the raw string and localPath has the resolved path", () => {
    const config = makeConfig({
      repositories: [makeRepo({ localPath: "/home/user/repos/x" })],
    });
    const raw = {
      repositories: [makeRawRepo({ local_path: "~/repos/x" })],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].rawLocalPath).toBe("~/repos/x");
    expect(result.repositories[0].localPath).toBe("/home/user/repos/x");
  });
});

// ---------- Tests: raw document fallback ----------

describe("inspectConfig - raw document fallback", () => {
  it("raw document null makes all fields 'default'", () => {
    const config = makeConfig();

    const result = inspectConfig(config, null);

    expect(result.repositories[0].defaultBranch.source).toBe("default");
    expect(result.repositories[0].autoImplAfterPlan.source).toBe("default");
    expect(result.repositories[0].rawLocalPath).toBeNull();
    expect(result.execution.maxParallel.source).toBe("default");
    expect(result.execution.maxIssuesPerRepo.source).toBe("default");
    expect(result.execution.autonomy.source).toBe("default");
    expect(result.execution.intervalMinutes.source).toBe("default");
    expect(result.execution.timeoutMinutes.source).toBe("default");
    expect(result.language.source).toBe("default");
  });

  it("raw document is a string makes all fields 'default'", () => {
    const config = makeConfig();

    const result = inspectConfig(config, "not an object");

    expect(result.repositories[0].defaultBranch.source).toBe("default");
    expect(result.execution.maxParallel.source).toBe("default");
    expect(result.language.source).toBe("default");
  });

  it("raw document is an array makes all fields 'default'", () => {
    const config = makeConfig();

    const result = inspectConfig(config, [1, 2, 3]);

    expect(result.repositories[0].defaultBranch.source).toBe("default");
    expect(result.execution.maxParallel.source).toBe("default");
    expect(result.language.source).toBe("default");
  });

  it("raw repositories shorter than config falls back to 'default' for out-of-bounds repo", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({ owner: "org-a", repo: "repo-a" }),
        makeRepo({
          owner: "org-b",
          repo: "repo-b",
          defaultBranch: "develop",
        }),
      ],
    });
    const raw = {
      repositories: [
        {
          owner: "org-a",
          repo: "repo-a",
          local_path: "/path/a",
          default_branch: "main",
        },
      ],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].defaultBranch.source).toBe("file");
    expect(result.repositories[1].defaultBranch.source).toBe("default");
    expect(result.repositories[1].defaultBranch.value).toBe("develop");
  });

  it("raw entry with mismatched owner/repo is treated as absent", () => {
    const config = makeConfig({
      repositories: [makeRepo({ owner: "real-org", repo: "real-repo" })],
    });
    const raw = {
      repositories: [
        {
          owner: "other-org",
          repo: "other-repo",
          local_path: "/other/path",
          default_branch: "other-branch",
        },
      ],
    };

    const result = inspectConfig(config, raw);

    expect(result.repositories[0].defaultBranch.source).toBe("default");
    expect(result.repositories[0].rawLocalPath).toBeNull();
  });
});

// ---------- Tests: readRawConfigDocument ----------

describe("readRawConfigDocument", () => {
  it("returns null for a nonexistent file", () => {
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    const result = readRawConfigDocument("/nonexistent/config.yml");

    expect(result).toBeNull();
  });

  it("returns null for broken YAML", () => {
    mockedReadFileSync.mockReturnValue(":\n  :\n  - [invalid yaml\n");

    const result = readRawConfigDocument("/path/to/broken.yml");

    expect(result).toBeNull();
  });

  it("returns parsed object for valid YAML", () => {
    mockedReadFileSync.mockReturnValue("key: value\nnested:\n  a: 1\n");

    const result = readRawConfigDocument("/path/to/valid.yml");

    expect(result).toEqual({ key: "value", nested: { a: 1 } });
  });
});
