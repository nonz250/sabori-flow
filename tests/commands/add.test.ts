import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

// ---------- Mocks ----------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("../../src/commands/helpers/repository-prompt.js", () => ({
  promptRepository: vi.fn(),
}));

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import { promptRepository } from "../../src/commands/helpers/repository-prompt.js";
import type { RepositoryInput } from "../../src/commands/helpers/repository-prompt.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedConfirm = vi.mocked(confirm);
const mockedPromptRepository = vi.mocked(promptRepository);

// ---------- Helpers ----------

function makeRepoInput(overrides?: Partial<RepositoryInput>): RepositoryInput {
  return {
    owner: "test-owner",
    repo: "test-repo",
    local_path: "/tmp/test-owner/test-repo",
    ...overrides,
  };
}

function makeValidConfig(
  repositories: Array<Record<string, unknown>> = [],
  execution?: Record<string, unknown>,
): string {
  const config: Record<string, unknown> = { repositories };
  if (execution) {
    config.execution = execution;
  }
  return YAML.stringify(config);
}

function parseWrittenYaml(): unknown {
  const call = mockedWriteFileSync.mock.calls[0];
  return YAML.parse(call[1] as string);
}

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();
  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runAddCommand(): Promise<void> {
  const { addCommand } = await import("../../src/commands/add.js");
  return addCommand();
}

// ---------- Tests ----------

describe("addCommand - config.yml が存在しない", () => {
  it("エラーメッセージを出力し、writeFileSync は呼ばれない", async () => {
    mockedExistsSync.mockReturnValue(false);

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml が見つかりません"),
    );
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("init"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("addCommand - config.yml が不正", () => {
  it("YAML として不正な場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(":\n  :\n  - [invalid yaml\n");

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("読み込みに失敗しました"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("parse 結果が null の場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    // 空ファイル → YAML.parse("") = null
    mockedReadFileSync.mockReturnValue("");

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("形式が不正です"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("parse 結果が string の場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("just a string");

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("形式が不正です"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("addCommand - repositories キーの問題", () => {
  it("repositories キーがない場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(YAML.stringify({ execution: { max_parallel: 1 } }));

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("repositories"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("repositories が配列でない場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(YAML.stringify({ repositories: "not_array" }));

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("repositories"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("addCommand - 正常系: 新規追加", () => {
  it("新規リポジトリが追加され、デフォルト labels/priority_labels が付与される", async () => {
    const repoInput = makeRepoInput();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      makeValidConfig([], { max_parallel: 2 }),
    );
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("test-owner");
    expect(repos[0].repo).toBe("test-repo");
    expect(repos[0].local_path).toBe("/tmp/test-owner/test-repo");

    // デフォルト labels が付与されている
    const labels = repos[0].labels as Record<string, Record<string, string>>;
    expect(labels.plan.trigger).toBe("claude/plan");
    expect(labels.impl.trigger).toBe("claude/impl");

    // デフォルト priority_labels が付与されている
    const priorityLabels = repos[0].priority_labels as string[];
    expect(priorityLabels).toEqual(["priority:high", "priority:low"]);

    // execution セクションが保持されている
    const execution = written.execution as Record<string, unknown>;
    expect(execution.max_parallel).toBe(2);

    // 成功メッセージ
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("test-owner/test-repo"),
    );
  });
});

describe("addCommand - 正常系: 既存リポジトリがある状態での新規追加", () => {
  it("既存エントリを保持したまま新しいリポジトリが追加される", async () => {
    const existingRepo = {
      owner: "existing-owner",
      repo: "existing-repo",
      local_path: "/tmp/existing-owner/existing-repo",
      labels: {
        plan: { trigger: "claude/plan" },
        impl: { trigger: "claude/impl" },
      },
      priority_labels: ["priority:high"],
    };
    const repoInput = makeRepoInput();

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([existingRepo]));
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(2);

    // 既存エントリが保持されている
    expect(repos[0].owner).toBe("existing-owner");
    expect(repos[0].repo).toBe("existing-repo");
    expect(repos[0].local_path).toBe("/tmp/existing-owner/existing-repo");

    // 新規エントリが追加されている
    expect(repos[1].owner).toBe("test-owner");
    expect(repos[1].repo).toBe("test-repo");
  });
});

describe("addCommand - 正常系: execution セクションがない config への追加", () => {
  it("execution なしでも正常に追加され、余計なキーが生成されない", async () => {
    const repoInput = makeRepoInput();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([]));
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(1);
    expect(repos[0].owner).toBe("test-owner");

    // execution キーが勝手に追加されていない
    expect(written).not.toHaveProperty("execution");
  });
});

describe("addCommand - 重複チェック: owner のみ一致は重複としない", () => {
  it("同じ owner で異なる repo なら confirm なしで追加される", async () => {
    const existingRepo = {
      owner: "test-owner",
      repo: "different-repo",
      local_path: "/tmp/test-owner/different-repo",
    };
    const repoInput = makeRepoInput();

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([existingRepo]));
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    // confirm が呼ばれていない（重複扱いされていない）
    expect(mockedConfirm).not.toHaveBeenCalled();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(2);
  });
});

describe("addCommand - 重複チェック: repo のみ一致は重複としない", () => {
  it("異なる owner で同じ repo なら confirm なしで追加される", async () => {
    const existingRepo = {
      owner: "different-owner",
      repo: "test-repo",
      local_path: "/tmp/different-owner/test-repo",
    };
    const repoInput = makeRepoInput();

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([existingRepo]));
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    // confirm が呼ばれていない（重複扱いされていない）
    expect(mockedConfirm).not.toHaveBeenCalled();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(2);
  });
});

describe("addCommand - 正常系: writeFileSync の引数検証", () => {
  it("CONFIG_PATH に utf-8 エンコーディングで書き込まれる", async () => {
    const repoInput = makeRepoInput();
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([]));
    mockedPromptRepository.mockResolvedValue(repoInput);

    await runAddCommand();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);
    const [filePath, , options] = mockedWriteFileSync.mock.calls[0];
    expect(filePath).toContain("config.yml");
    expect(options).toEqual({ encoding: "utf-8", mode: 0o600 });
  });
});

describe("addCommand - config.yml が不正: repositories が数値", () => {
  it("repositories が数値の場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(YAML.stringify({ repositories: 42 }));

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("repositories"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("repositories がオブジェクトの場合エラーメッセージを出力する", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(
      YAML.stringify({ repositories: { key: "value" } }),
    );

    await runAddCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("repositories"),
    );
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

describe("addCommand - 重複: 上書き Yes", () => {
  it("既存エントリが置き換えられる", async () => {
    const existingRepo = {
      owner: "test-owner",
      repo: "test-repo",
      local_path: "/old/path",
      labels: { plan: { trigger: "old" }, impl: { trigger: "old" } },
    };
    const repoInput = makeRepoInput({ local_path: "/new/path" });

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([existingRepo]));
    mockedPromptRepository.mockResolvedValue(repoInput);
    mockedConfirm.mockResolvedValue(true);

    await runAddCommand();

    expect(mockedWriteFileSync).toHaveBeenCalledTimes(1);

    const written = parseWrittenYaml() as Record<string, unknown>;
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(1);
    expect(repos[0].local_path).toBe("/new/path");

    // デフォルト labels が新しいエントリに付与されている
    const labels = repos[0].labels as Record<string, Record<string, string>>;
    expect(labels.plan.trigger).toBe("claude/plan");
  });
});

describe("addCommand - 重複: 上書き No", () => {
  it("ファイル書き込みが行われない", async () => {
    const existingRepo = {
      owner: "test-owner",
      repo: "test-repo",
      local_path: "/old/path",
    };
    const repoInput = makeRepoInput();

    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(makeValidConfig([existingRepo]));
    mockedPromptRepository.mockResolvedValue(repoInput);
    mockedConfirm.mockResolvedValue(false);

    await runAddCommand();

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
    expect(consoleSpy.log).toHaveBeenCalledWith("中断しました。");
  });
});
