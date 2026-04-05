import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
}));

vi.mock("../../src/commands/helpers/repository-prompt.js", () => ({
  promptRepository: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    getConfigDir: vi.fn().mockReturnValue("/mock/config/dir"),
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
  };
});

import fs from "fs";
import { confirm, select } from "@inquirer/prompts";
import { promptRepository } from "../../src/commands/helpers/repository-prompt.js";
import type { RepositoryInput } from "../../src/commands/helpers/repository-prompt.js";
import { getConfigDir, getConfigPath } from "../../src/utils/paths.js";

const mockedFs = vi.mocked(fs);
const mockedConfirm = vi.mocked(confirm);
const mockedSelect = vi.mocked(select);
const mockedPromptRepository = vi.mocked(promptRepository);
const mockedGetConfigDir = vi.mocked(getConfigDir);
const mockedGetConfigPath = vi.mocked(getConfigPath);

// ---------- Helpers ----------

function makeRepoInput(overrides?: Partial<RepositoryInput>): RepositoryInput {
  return {
    owner: "test-owner",
    repo: "test-repo",
    local_path: "/tmp/test-owner/test-repo",
    auto_impl_after_plan: false,
    prompts_dir: null,
    ...overrides,
  };
}

function parseWrittenYaml(): Record<string, unknown> {
  const call = mockedFs.writeFileSync.mock.calls[0];
  return YAML.parse(call[1] as string) as Record<string, unknown>;
}

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  // paths のモック関数は restoreAllMocks でリセットされるため毎回再設定
  mockedGetConfigDir.mockReturnValue("/mock/config/dir");
  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");

  mockedSelect.mockResolvedValue("ja");

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runInitCommand(): Promise<void> {
  const { initCommand } = await import("../../src/commands/init.js");
  return initCommand();
}

// ---------- Tests ----------

describe("initCommand - config.yml が既に存在し、上書きを拒否した場合", () => {
  it("上書きせず終了する", async () => {
    mockedFs.existsSync.mockReturnValue(true);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith("中断しました。");
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("initCommand - config.yml が既に存在し、上書きを許可した場合", () => {
  it("正常に新しい config を書き込む", async () => {
    const repoInput = makeRepoInput();

    mockedFs.existsSync.mockReturnValue(true);
    // 上書き確認: Yes
    mockedConfirm.mockResolvedValueOnce(true);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    // 別リポジトリ追加: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/mock/config/dir/config.yml",
      expect.any(String),
      { encoding: "utf-8", mode: 0o600 },
    );
  });
});

describe("initCommand - config.yml が存在しない場合", () => {
  it("ディレクトリ作成と新規 config の書き込みを行う", async () => {
    const repoInput = makeRepoInput();

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    // 別リポジトリ追加: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    // config ディレクトリの作成
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/config/dir",
      { recursive: true, mode: 0o700 },
    );
    // config ファイルの書き込み
    expect(mockedFs.writeFileSync).toHaveBeenCalledTimes(1);
    expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
      "/mock/config/dir/config.yml",
      expect.any(String),
      { encoding: "utf-8", mode: 0o600 },
    );
  });
});

describe("initCommand - 正常完了時のメッセージ", () => {
  it("案内メッセージに `sabori-flow install` が含まれ npx が付かない", async () => {
    const repoInput = makeRepoInput();

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const installMessage = consoleSpy.log.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("install"),
    );
    expect(installMessage).toBeDefined();
    expect(installMessage![0]).toContain("sabori-flow install");
    expect(installMessage![0]).not.toContain("npx sabori-flow install");
  });
});

describe("initCommand - 書き込まれる YAML の内容", () => {
  it("repositories に owner, repo, local_path, labels, priority_labels が含まれる", async () => {
    const repoInput = makeRepoInput();

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();

    // language フィールドが書き込まれている
    expect(written.language).toBe("ja");

    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos).toHaveLength(1);

    const repo = repos[0];
    expect(repo.owner).toBe("test-owner");
    expect(repo.repo).toBe("test-repo");
    expect(repo.local_path).toBe("/tmp/test-owner/test-repo");

    // labels の構造
    const labels = repo.labels as Record<string, Record<string, string>>;
    expect(labels.plan.trigger).toBe("claude/plan");
    expect(labels.plan.in_progress).toBe("claude/plan:in-progress");
    expect(labels.plan.done).toBe("claude/plan:done");
    expect(labels.plan.failed).toBe("claude/plan:failed");
    expect(labels.impl.trigger).toBe("claude/impl");
    expect(labels.impl.in_progress).toBe("claude/impl:in-progress");
    expect(labels.impl.done).toBe("claude/impl:done");
    expect(labels.impl.failed).toBe("claude/impl:failed");

    // priority_labels の構造
    const priorityLabels = repo.priority_labels as string[];
    expect(priorityLabels).toEqual(["priority:high", "priority:low"]);
  });

  it("prompts_dir が null の場合、YAML に prompts_dir キーが含まれない", async () => {
    const repoInput = makeRepoInput({ prompts_dir: null });

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos[0]).not.toHaveProperty("prompts_dir");
  });

  it("prompts_dir が指定された場合、YAML に prompts_dir が含まれる", async () => {
    const repoInput = makeRepoInput({ prompts_dir: "/custom/prompts" });

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const repos = written.repositories as Array<Record<string, unknown>>;
    expect(repos[0].prompts_dir).toBe("/custom/prompts");
  });

  it("execution セクションに max_parallel, max_issues_per_repo が含まれ log_dir は含まれない", async () => {
    const repoInput = makeRepoInput();

    mockedFs.existsSync.mockReturnValue(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const execution = written.execution as Record<string, unknown>;
    expect(execution).not.toHaveProperty("log_dir");
    expect(execution.max_parallel).toBe(1);
    expect(execution.max_issues_per_repo).toBe(1);
  });
});
