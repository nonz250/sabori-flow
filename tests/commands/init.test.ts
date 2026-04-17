import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

// ---------- Mocks ----------

vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    chmodSync: vi.fn(),
  },
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  input: vi.fn(),
}));

vi.mock("../../src/commands/helpers/repository-prompt.js", () => ({
  promptRepository: vi.fn(),
}));

vi.mock("../../src/worker/prompt.js", () => ({
  TEMPLATE_FILES: {
    plan: "plan.md",
    impl: "impl.md",
  },
}));


vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    getBaseDir: vi.fn().mockReturnValue("/mock/config/dir"),
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getUserPromptsDir: vi.fn().mockReturnValue("/mock/config/dir/prompts"),
    getDefaultPromptsDir: vi.fn().mockReturnValue("/mock/package/prompts"),
  };
});

import fs from "fs";
import { confirm, select, input } from "@inquirer/prompts";
import { promptRepository } from "../../src/commands/helpers/repository-prompt.js";
import type { RepositoryInput } from "../../src/commands/helpers/repository-prompt.js";
import { getBaseDir, getConfigPath, getUserPromptsDir, getDefaultPromptsDir } from "../../src/utils/paths.js";
import { Autonomy } from "../../src/worker/models.js";
import type { Language } from "../../src/i18n/types.js";

const mockedFs = vi.mocked(fs);
const mockedConfirm = vi.mocked(confirm);
const mockedSelect = vi.mocked(select);
const mockedInput = vi.mocked(input);
const mockedPromptRepository = vi.mocked(promptRepository);
const mockedGetBaseDir = vi.mocked(getBaseDir);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetUserPromptsDir = vi.mocked(getUserPromptsDir);
const mockedGetDefaultPromptsDir = vi.mocked(getDefaultPromptsDir);

// ---------- Helpers ----------

function makeRepoInput(overrides?: Partial<RepositoryInput>): RepositoryInput {
  return {
    owner: "test-owner",
    repo: "test-repo",
    local_path: "/tmp/test-owner/test-repo",
    auto_impl_after_plan: false,
    ...overrides,
  };
}

interface InitPromptAnswers {
  language?: Language;
  autonomy?: Autonomy;
  intervalMinutes?: string;
}

/**
 * Route each inquirer `select` call to the right answer based on the
 * prompt message text, rather than relying on call order. Tests that
 * need different answers only set the fields they care about.
 */
function setupInitPrompts(answers: InitPromptAnswers = {}): void {
  const language: Language = answers.language ?? "ja";
  const autonomy: Autonomy = answers.autonomy ?? Autonomy.INTERACTIVE;
  const intervalMinutes = answers.intervalMinutes ?? "60";

  mockedSelect.mockImplementation(async (config: unknown) => {
    const msg = (config as { message?: unknown }).message;
    const msgStr = typeof msg === "string" ? msg : "";
    if (
      msgStr.includes("自律実行") ||
      msgStr.toLowerCase().includes("autonomy")
    ) {
      return autonomy;
    }
    return language;
  });

  mockedInput.mockResolvedValue(intervalMinutes);
}

function parseWrittenYaml(): Record<string, unknown> {
  const call = mockedFs.writeFileSync.mock.calls[0];
  return YAML.parse(call[1] as string) as Record<string, unknown>;
}

/**
 * existsSync のモック設定ヘルパー。
 * テンプレートファイルは常に「存在しない」として扱い、
 * config.yml の存在有無だけを制御する。
 */
function mockExistsSyncForConfig(configExists: boolean): void {
  mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
    const filePath = String(p);
    if (filePath === "/mock/config/dir/config.yml") {
      return configExists;
    }
    // テンプレートファイルのチェック: デフォルトでは存在しない
    return false;
  });
}

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();

  // paths のモック関数は restoreAllMocks でリセットされるため毎回再設定
  mockedGetBaseDir.mockReturnValue("/mock/config/dir");
  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetUserPromptsDir.mockReturnValue("/mock/config/dir/prompts");
  mockedGetDefaultPromptsDir.mockReturnValue("/mock/package/prompts");

  // 言語 / autonomy / interval_minutes のデフォルト応答
  setupInitPrompts();

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
    mockExistsSyncForConfig(true);
    // config 上書き確認: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith("中断しました。");
    expect(mockedFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe("initCommand - config.yml が既に存在し、上書きを許可した場合", () => {
  it("正常に新しい config を書き込む", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(true);
    // config 上書き確認: Yes
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

    mockExistsSyncForConfig(false);
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

    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const installMessage = consoleSpy.log.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].includes("sabori-flow install"),
    );
    expect(installMessage).toBeDefined();
    expect(installMessage![0]).toContain("sabori-flow install");
    expect(installMessage![0]).not.toContain("npx sabori-flow install");
  });
});

describe("initCommand - 書き込まれる YAML の内容", () => {
  it("repositories に owner, repo, local_path, labels, priority_labels が含まれる", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(false);
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

  it("execution セクションに max_parallel, max_issues_per_repo が含まれ log_dir は含まれない", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(false);
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

describe("initCommand - autonomy 選択", () => {
  it("interactive を選択した場合 execution.autonomy が 'interactive' になる", async () => {
    setupInitPrompts({ autonomy: Autonomy.INTERACTIVE });
    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(makeRepoInput());
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const execution = written.execution as Record<string, unknown>;
    expect(execution.autonomy).toBe("interactive");
  });

  it("auto を選択した場合 execution.autonomy が 'auto' になる", async () => {
    setupInitPrompts({ autonomy: Autonomy.AUTO });
    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(makeRepoInput());
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const execution = written.execution as Record<string, unknown>;
    expect(execution.autonomy).toBe("auto");
  });

  it("full を選択した場合 execution.autonomy が 'full' になる", async () => {
    setupInitPrompts({ autonomy: Autonomy.FULL });
    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(makeRepoInput());
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    const execution = written.execution as Record<string, unknown>;
    expect(execution.autonomy).toBe("full");
  });

  it("autonomy 選択 UI には sandboxed が含まれない (choices)", async () => {
    setupInitPrompts();
    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(makeRepoInput());
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const autonomyCall = mockedSelect.mock.calls.find((call) => {
      const msg = (call[0] as { message?: unknown }).message;
      return typeof msg === "string" && msg.includes("自律実行");
    });
    expect(autonomyCall).toBeDefined();

    const choices = (autonomyCall?.[0] as { choices: Array<{ value: string }> })
      .choices;
    const values = choices.map((c) => c.value);
    expect(values).toEqual(["interactive", "auto", "full"]);
    expect(values).not.toContain("sandboxed");
  });

  it("英語モードでは autonomy プロンプトに 'autonomy' が含まれる", async () => {
    setupInitPrompts({ language: "en", autonomy: Autonomy.AUTO });
    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(makeRepoInput());
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    const written = parseWrittenYaml();
    expect(written.language).toBe("en");
    const execution = written.execution as Record<string, unknown>;
    expect(execution.autonomy).toBe("auto");
  });
});

describe("initCommand - テンプレートコピー", () => {
  it("言語選択後にテンプレートがコピーされる", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    // 別リポジトリ追加: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    // prompts ディレクトリが作成される
    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/config/dir/prompts",
      { recursive: true, mode: 0o700 },
    );
    // テンプレートファイルがコピーされる（plan.md, impl.md）
    expect(mockedFs.copyFileSync).toHaveBeenCalledTimes(2);
    expect(mockedFs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining("plan.md"),
      expect.stringContaining("plan.md"),
    );
    expect(mockedFs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining("impl.md"),
      expect.stringContaining("impl.md"),
    );
  });

  it("コピーされたファイルに chmodSync で 0o600 が設定される", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    expect(mockedFs.chmodSync).toHaveBeenCalledTimes(2);
    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining("plan.md"),
      0o600,
    );
    expect(mockedFs.chmodSync).toHaveBeenCalledWith(
      expect.stringContaining("impl.md"),
      0o600,
    );
  });

  it("既存テンプレートがある場合に上書き確認が表示される", async () => {
    const repoInput = makeRepoInput();

    // テンプレートファイルが既に存在する設定
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = String(p);
      if (filePath === "/mock/config/dir/config.yml") {
        return false;
      }
      // テンプレートファイルは存在する
      if (filePath.endsWith("plan.md") || filePath.endsWith("impl.md")) {
        return true;
      }
      return false;
    });
    // テンプレート上書き確認: plan.md Yes, impl.md Yes
    mockedConfirm.mockResolvedValueOnce(true);
    mockedConfirm.mockResolvedValueOnce(true);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    // 別リポジトリ追加: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    // 上書き確認が2回呼ばれる（plan.md, impl.md）
    expect(mockedConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("plan.md"),
      }),
    );
    expect(mockedConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("impl.md"),
      }),
    );
    // 上書きが許可されたのでコピーされる
    expect(mockedFs.copyFileSync).toHaveBeenCalledTimes(2);
  });

  it("上書きを拒否した場合、該当ファイルはスキップされる", async () => {
    const repoInput = makeRepoInput();

    // テンプレートファイルが既に存在する設定
    mockedFs.existsSync.mockImplementation((p: fs.PathLike) => {
      const filePath = String(p);
      if (filePath === "/mock/config/dir/config.yml") {
        return false;
      }
      if (filePath.endsWith("plan.md") || filePath.endsWith("impl.md")) {
        return true;
      }
      return false;
    });
    // テンプレート上書き確認: plan.md No, impl.md No
    mockedConfirm.mockResolvedValueOnce(false);
    mockedConfirm.mockResolvedValueOnce(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    // 別リポジトリ追加: No
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    // スキップされたのでコピーされない
    expect(mockedFs.copyFileSync).not.toHaveBeenCalled();
    // スキップメッセージが表示される
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("plan.md"),
    );
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("impl.md"),
    );
  });

  it("destDir が mkdirSync で作成される", async () => {
    const repoInput = makeRepoInput();

    mockExistsSyncForConfig(false);
    mockedPromptRepository.mockResolvedValueOnce(repoInput);
    mockedConfirm.mockResolvedValueOnce(false);

    await runInitCommand();

    expect(mockedFs.mkdirSync).toHaveBeenCalledWith(
      "/mock/config/dir/prompts",
      { recursive: true, mode: 0o700 },
    );
  });
});
