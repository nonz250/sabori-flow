import { describe, it, expect, vi, beforeEach } from "vitest";
import YAML from "yaml";

// ---------- Mocks ----------

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  realpathSync: vi.fn(),
}));

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  input: vi.fn(),
}));

vi.mock("../../src/utils/paths.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/utils/paths.js")>();
  return {
    ...original,
    getBaseDir: vi.fn().mockReturnValue("/mock/config/dir"),
    getConfigPath: vi.fn().mockReturnValue("/mock/config/dir/config.yml"),
    getConfigBackupPath: vi.fn().mockImplementation(
      (ts: string) => `/mock/config/dir/config.yml.bak-${ts}`,
    ),
  };
});

import { existsSync, readFileSync, writeFileSync, realpathSync } from "node:fs";
import { confirm, select, input } from "@inquirer/prompts";
import { getConfigPath, getConfigBackupPath } from "../../src/utils/paths.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedRealpathSync = vi.mocked(realpathSync);
const mockedConfirm = vi.mocked(confirm);
const mockedSelect = vi.mocked(select);
const mockedInput = vi.mocked(input);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetConfigBackupPath = vi.mocked(getConfigBackupPath);

// ---------- Fixtures ----------

const MISSING_PATH = "/tmp/acme/missing";

const FULL_CONFIG = `\
schema_version: 1
language: ja
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    default_branch: main
    auto_impl_after_plan: false
    labels:
      plan:
        trigger: "claude/plan"
        in_progress: "claude/plan:in-progress"
        done: "claude/plan:done"
        failed: "claude/plan:failed"
    priority_labels:
      - "priority:high"
      - "priority:low"
execution:
  max_parallel: 2
  max_issues_per_repo: 3
  agent: codex
  autonomy: auto
  interval_minutes: 60
  timeout_minutes: 120
`;

const MINIMAL_CONFIG = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    priority_labels: []
`;

const TWO_REPOS_CONFIG = `\
schema_version: 1
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
    priority_labels: []
  - owner: acme
    repo: web
    local_path: /tmp/acme/web
    priority_labels: []
`;

// ---------- Helpers ----------

interface PromptConfig {
  message: string;
  default?: unknown;
  choices?: { value: unknown; name: string }[];
  validate?: (text: string) => true | string | Promise<true | string>;
}

function configWriteCall(): { path: string; content: string; options: unknown } | undefined {
  const call = mockedWriteFileSync.mock.calls.find(
    (c) => (c[0] as string).endsWith("config.yml"),
  );
  if (!call) return undefined;
  return { path: call[0] as string, content: call[1] as string, options: call[2] };
}

function backupWriteCall(): { path: string; content: string; options: unknown } | undefined {
  const call = mockedWriteFileSync.mock.calls.find(
    (c) => (c[0] as string).includes(".bak-"),
  );
  if (!call) return undefined;
  return { path: call[0] as string, content: call[1] as string, options: call[2] };
}

function written(): Record<string, unknown> {
  const cw = configWriteCall();
  expect(cw).toBeDefined();
  return YAML.parse(cw!.content) as Record<string, unknown>;
}

/** A prompt's key is the part of its message before the hints. */
function keyOf(cfg: PromptConfig): string {
  return cfg.message.replace(/( \(.*\))?:$/, "");
}

function promptConfigs(): PromptConfig[] {
  return [...mockedInput.mock.calls, ...mockedSelect.mock.calls].map(
    ([cfg]) => cfg as unknown as PromptConfig,
  );
}

function promptFor(key: string): PromptConfig {
  const found = promptConfigs().find((cfg) => keyOf(cfg) === key);
  expect(found, `prompt for ${key}`).toBeDefined();
  return found!;
}

/**
 * Answers prompts by key. Unlisted prompts behave like pressing Enter:
 * input returns its initial value (or ""), select its default choice.
 */
function answer(byKey: Record<string, unknown> = {}): void {
  mockedInput.mockImplementation(async (cfg: unknown) => {
    const config = cfg as PromptConfig;
    const key = keyOf(config);
    if (key in byKey) {
      return byKey[key] as string;
    }
    return (config.default as string | undefined) ?? "";
  });
  mockedSelect.mockImplementation(async (cfg: unknown) => {
    const config = cfg as PromptConfig;
    const key = keyOf(config);
    if (key in byKey) {
      return byKey[key];
    }
    return config.default;
  });
  mockedConfirm.mockImplementation(async (cfg: unknown) => {
    const config = cfg as { default?: boolean };
    return config.default ?? true;
  });
}

function logged(): string[] {
  return consoleSpy.log.mock.calls.map((c) => String(c[0]));
}

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();
  mockedConfirm.mockReset();
  mockedSelect.mockReset();
  mockedInput.mockReset();
  mockedWriteFileSync.mockReset();
  mockedExistsSync.mockReset();
  mockedExistsSync.mockReturnValue(true);
  mockedRealpathSync.mockReset();
  mockedRealpathSync.mockImplementation(((p: string) => {
    if (p === MISSING_PATH) {
      throw new Error("ENOENT");
    }
    return p;
  }) as unknown as typeof realpathSync);

  mockedGetConfigPath.mockReturnValue("/mock/config/dir/config.yml");
  mockedGetConfigBackupPath.mockImplementation(
    (ts: string) => `/mock/config/dir/config.yml.bak-${ts}`,
  );

  consoleSpy = {
    log: vi.spyOn(console, "log").mockImplementation(() => {}),
    error: vi.spyOn(console, "error").mockImplementation(() => {}),
  };
});

// ---------- Lazy import (after mocks) ----------

async function runMigrateCommand(options: { repo?: string } = {}): Promise<void> {
  const { migrateCommand } = await import("../../src/commands/migrate.js");
  return migrateCommand(options);
}

async function run(config: string, options: { repo?: string } = {}): Promise<void> {
  mockedReadFileSync.mockReturnValue(config);
  await runMigrateCommand(options);
}

// ---------- Tests: abort cases ----------

describe("migrateCommand - aborts without writing", () => {
  it("when config.yml does not exist", async () => {
    mockedExistsSync.mockReturnValue(false);
    await runMigrateCommand();
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("config.yml"));
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when the YAML cannot be parsed", async () => {
    await run("repositories: [\n");
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("YAML"));
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when the top level is not a mapping", async () => {
    await run("- a\n");
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("トップレベル"));
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when repositories is missing", async () => {
    await run("language: ja\n");
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("repositories"));
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when a section is not a mapping, naming the section", async () => {
    await run(`${MINIMAL_CONFIG}execution: [1]\n`);
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("execution"));
    expect(mockedInput).not.toHaveBeenCalled();
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when schema_version is newer than supported", async () => {
    await run(FULL_CONFIG.replace("schema_version: 1", "schema_version: 99"));
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("99"));
    expect(mockedInput).not.toHaveBeenCalled();
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when --repo names a repository that is not configured", async () => {
    await run(TWO_REPOS_CONFIG, { repo: "acme/missing" });
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("acme/missing"));
    expect(mockedInput).not.toHaveBeenCalled();
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("when the user declines the final confirmation", async () => {
    answer({ "execution.interval_minutes": "90" });
    mockedConfirm.mockResolvedValue(false);
    await run(FULL_CONFIG);
    expect(logged()).toContain("中断しました。config.yml は変更されていません。");
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

// ---------- Tests: interruption and unexpected errors ----------

describe("migrateCommand - interruption and unexpected errors", () => {
  it("exits quietly when the user presses Ctrl+C", async () => {
    mockedSelect.mockRejectedValue(Object.assign(new Error("closed"), { name: "ExitPromptError" }));
    await run(FULL_CONFIG);
    expect(consoleSpy.error).not.toHaveBeenCalled();
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("reports an unexpected error instead of exiting silently", async () => {
    const previousExitCode = process.exitCode;
    mockedSelect.mockRejectedValue(new TypeError("boom"));
    await run(FULL_CONFIG);
    expect(consoleSpy.error).toHaveBeenCalledWith("予期しないエラーが発生しました:", expect.any(TypeError));
    expect(process.exitCode).toBe(1);
    process.exitCode = previousExitCode;
  });
});

// ---------- Tests: every key is reviewed ----------

describe("migrateCommand - reviews every key", () => {
  it("asks about every root, repository and label key", async () => {
    answer();
    await run(MINIMAL_CONFIG);
    const keys = promptConfigs().map(keyOf);
    expect(keys).toHaveLength(28);
    expect(keys).toContain("language");
    expect(keys).toContain("execution.agent");
    expect(keys).toContain("[acme/app] owner");
    expect(keys).toContain("[acme/app] local_path");
    expect(keys).toContain("[acme/app] labels.spec.needs_human");
    expect(keys).toContain("[acme/app] labels.impl.failed");
  });

  it("asks about existing keys too, offering the current value", async () => {
    answer();
    await run(FULL_CONFIG);
    expect(promptFor("execution.interval_minutes").default).toBe("60");
    expect(promptFor("execution.agent").default).toBe("codex");
    expect(promptFor("[acme/app] priority_labels").default).toBe("priority:high, priority:low");
    expect(promptFor("execution.autonomy").default).toBe("auto");
    expect(promptFor("[acme/app] auto_impl_after_plan").default).toBe(false);
  });
});

// ---------- Tests: autonomy choices ----------

describe("migrateCommand - autonomy choices", () => {
  it("offers the same autonomy choices as init", async () => {
    answer();
    await run(MINIMAL_CONFIG);
    const values = promptFor("execution.autonomy").choices!.slice(1).map((c) => c.value);
    expect(values).toEqual(["interactive", "auto", "full"]);
  });

  it("keeps a hand-written sandboxed value selectable and unchanged on Enter", async () => {
    answer();
    await run(FULL_CONFIG.replace("autonomy: auto", "autonomy: sandboxed"));
    const prompt = promptFor("execution.autonomy");
    expect(prompt.choices!.map((c) => c.value)).toContain("sandboxed");
    expect(prompt.default).toBe("sandboxed");
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});

// ---------- Tests: Enter keeps the current state ----------

describe("migrateCommand - pressing Enter everywhere", () => {
  it("changes nothing on an up-to-date config and does not write", async () => {
    answer();
    await run(FULL_CONFIG);
    expect(logged()).toContain("変更はありません。config.yml は更新しません。");
    expect(mockedConfirm).not.toHaveBeenCalled();
    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("leaves omitted keys omitted and only records schema_version", async () => {
    answer();
    await run(MINIMAL_CONFIG);
    const parsed = written();
    expect(parsed.schema_version).toBe(1);
    expect(parsed).not.toHaveProperty("language");
    expect(parsed).not.toHaveProperty("execution");
    const repo = (parsed.repositories as Record<string, unknown>[])[0];
    expect(repo).not.toHaveProperty("default_branch");
    expect(repo).not.toHaveProperty("auto_impl_after_plan");
    expect(repo).not.toHaveProperty("labels");
  });

  it("offers 'leave unset' as the preselected choice for an omitted select key", async () => {
    answer();
    await run(MINIMAL_CONFIG);
    const language = promptFor("language");
    expect(language.choices![0].name).toBe("未設定のまま (デフォルト: ja)");
    expect(language.default).toBe(language.choices![0].value);
  });

  it("shows the default of an omitted text key without prefilling it", async () => {
    answer();
    await run(MINIMAL_CONFIG);
    const branch = promptFor("[acme/app] default_branch");
    expect(branch.default).toBeUndefined();
    expect(branch.message).toContain("未設定。Enter でデフォルト (main) のまま");
  });
});

// ---------- Tests: entered values are written ----------

describe("migrateCommand - entered values", () => {
  it("updates an existing value", async () => {
    answer({ "execution.timeout_minutes": "240" });
    await run(FULL_CONFIG);
    expect((written().execution as Record<string, unknown>).timeout_minutes).toBe(240);
  });

  it("sets an omitted key", async () => {
    answer({ "[acme/app] default_branch": "develop" });
    await run(MINIMAL_CONFIG);
    const repo = (written().repositories as Record<string, unknown>[])[0];
    expect(repo.default_branch).toBe("develop");
  });

  it("sets an omitted select key when a value is chosen", async () => {
    answer({ language: "en", "[acme/app] auto_impl_after_plan": true });
    await run(MINIMAL_CONFIG);
    const parsed = written();
    expect(parsed.language).toBe("en");
    expect((parsed.repositories as Record<string, unknown>[])[0].auto_impl_after_plan).toBe(true);
  });

  it("writes an agent priority list", async () => {
    answer({ "execution.agent": "claude, codex" });
    await run(FULL_CONFIG);
    expect((written().execution as Record<string, unknown>).agent).toEqual(["claude", "codex"]);
  });

  it("writes the rest of an omitted label phase with defaults", async () => {
    answer({ "[acme/app] labels.impl.trigger": "my/impl" });
    await run(MINIMAL_CONFIG);
    const repo = (written().repositories as Record<string, unknown>[])[0];
    expect(repo.labels).toEqual({
      impl: {
        trigger: "my/impl",
        in_progress: "ai/impl/in-progress",
        done: "ai/impl/done",
        failed: "ai/impl/failed",
      },
    });
  });

  it("lists each change before asking for confirmation", async () => {
    answer({ "execution.interval_minutes": "90" });
    await run(FULL_CONFIG);
    expect(logged()).toContain("  - execution.interval_minutes: 60 → 90");
  });

  it("lists a newly set key as previously unset", async () => {
    answer({ "[acme/app] default_branch": "develop" });
    await run(MINIMAL_CONFIG);
    expect(logged()).toContain("  - [acme/app] default_branch: (未設定) → develop");
  });
});

// ---------- Tests: invalid values must be corrected ----------

describe("migrateCommand - invalid values", () => {
  const invalidInterval = FULL_CONFIG.replace("interval_minutes: 60", "interval_minutes: 5");

  it("offers the invalid value for editing and explains why", async () => {
    answer({ "execution.interval_minutes": "30" });
    await run(invalidInterval);
    const prompt = promptFor("execution.interval_minutes");
    expect(prompt.default).toBe("5");
    expect(await prompt.validate!("5")).toBe("execution.interval_minutes: must be >= 10, got 5");
    expect(prompt.message).toContain("must be >= 10, got 5");
  });

  it("refuses an empty answer and another invalid value", async () => {
    answer({ "execution.interval_minutes": "30" });
    await run(invalidInterval);
    const validate = promptFor("execution.interval_minutes").validate!;
    expect(await validate("")).toBe("値を入力してください。");
    expect(await validate("9")).toBe("execution.interval_minutes: must be >= 10, got 9");
    expect(await validate("10")).toBe(true);
  });

  it("writes the corrected value", async () => {
    answer({ "execution.interval_minutes": "30" });
    await run(invalidInterval);
    expect((written().execution as Record<string, unknown>).interval_minutes).toBe(30);
  });

  it("requires a missing required key", async () => {
    const noOwner = MINIMAL_CONFIG.replace("  - owner: acme\n    repo: app", "  - repo: app");
    answer({ "[repositories[0]] owner": "acme" });
    await run(noOwner);
    const prompt = promptFor("[repositories[0]] owner");
    expect(prompt.default).toBeUndefined();
    expect(await prompt.validate!("")).toBe("値を入力してください。");
    expect((written().repositories as Record<string, unknown>[])[0].owner).toBe("acme");
  });

  it("suggests the default priority labels for a missing priority_labels", async () => {
    answer();
    await run(MINIMAL_CONFIG.replace("    priority_labels: []\n", ""));
    expect(promptFor("[acme/app] priority_labels").default).toBe("priority:high, priority:low");
    const repo = (written().repositories as Record<string, unknown>[])[0];
    expect(repo.priority_labels).toEqual(["priority:high", "priority:low"]);
  });

  it("suggests the default for a label missing from an existing phase", async () => {
    answer();
    await run(FULL_CONFIG.replace('        failed: "claude/plan:failed"\n', ""));
    expect(promptFor("[acme/app] labels.plan.failed").default).toBe("ai/plan/failed");
  });

  it("treats a local_path that does not exist as invalid", async () => {
    answer({ "[acme/app] local_path": "/tmp/acme/app" });
    await run(MINIMAL_CONFIG.replace("/tmp/acme/app", MISSING_PATH));
    const prompt = promptFor("[acme/app] local_path");
    expect(prompt.default).toBe(MISSING_PATH);
    expect(prompt.message).toContain("path does not exist");
    expect((written().repositories as Record<string, unknown>[])[0].local_path).toBe("/tmp/acme/app");
  });

  it("validates entered values with loadConfig's rules", async () => {
    answer();
    await run(FULL_CONFIG);
    expect(await promptFor("execution.agent").validate!("claude, gemini")).not.toBe(true);
    expect(await promptFor("[acme/app] default_branch").validate!("-main")).not.toBe(true);
    expect(await promptFor("[acme/app] owner").validate!("")).not.toBe(true);
  });
});

// ---------- Tests: --repo ----------

describe("migrateCommand - --repo", () => {
  it("asks only about the named repository", async () => {
    answer();
    await run(TWO_REPOS_CONFIG, { repo: "acme/web" });
    const keys = promptConfigs().map(keyOf);
    expect(keys).toHaveLength(21);
    expect(keys.every((k) => k.startsWith("[acme/web] "))).toBe(true);
  });

  it("writes changes to the named repository only", async () => {
    answer({ "[acme/web] default_branch": "develop" });
    await run(TWO_REPOS_CONFIG, { repo: "acme/web" });
    const repos = written().repositories as Record<string, unknown>[];
    expect(repos[1].default_branch).toBe("develop");
    expect(repos[0]).not.toHaveProperty("default_branch");
  });
});

// ---------- Tests: preserving the file ----------

describe("migrateCommand - preserving the file", () => {
  it("keeps comments and unknown keys", async () => {
    answer({ "[acme/app] default_branch": "develop" });
    await run(`# My config\n${MINIMAL_CONFIG}custom_key: kept # note\n`);
    const content = configWriteCall()!.content;
    expect(content).toContain("# My config");
    expect(content).toContain("custom_key: kept # note");
  });

  it("writes the original content to a new backup before the config", async () => {
    answer({ "execution.interval_minutes": "90" });
    await run(FULL_CONFIG);
    const bw = backupWriteCall();
    expect(bw!.content).toBe(FULL_CONFIG);
    expect(bw!.options).toEqual({ encoding: "utf-8", mode: 0o600, flag: "wx" });
    const order = mockedWriteFileSync.mock.calls.map((c) => String(c[0]));
    expect(order.findIndex((p) => p.includes(".bak-"))).toBeLessThan(
      order.findIndex((p) => p.endsWith("config.yml")),
    );
  });

  it("writes config with mode 0o600", async () => {
    answer({ "execution.interval_minutes": "90" });
    await run(FULL_CONFIG);
    expect(configWriteCall()!.options).toEqual({ encoding: "utf-8", mode: 0o600 });
  });

  it("does not touch config when the backup cannot be written", async () => {
    answer({ "execution.interval_minutes": "90" });
    mockedWriteFileSync.mockImplementation((p) => {
      if (String(p).includes(".bak-")) {
        throw new Error("EEXIST");
      }
    });
    await run(FULL_CONFIG);
    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringMatching(/バックアップ/));
    expect(configWriteCall()).toBeUndefined();
  });

  it("names the backup when the config cannot be written", async () => {
    answer({ "execution.interval_minutes": "90" });
    mockedWriteFileSync.mockImplementation((p) => {
      if (String(p).endsWith("config.yml")) {
        throw new Error("EACCES");
      }
    });
    await run(FULL_CONFIG);
    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("/mock/config/dir/config.yml.bak-"),
    );
  });
});

// ---------- Tests: reinstall guidance ----------

describe("migrateCommand - reinstall guidance", () => {
  const REINSTALL_REQUIRED =
    "interval_minutes が変更されました。反映するには `sabori-flow reinstall` を実行してください。";
  const REINSTALL_NOT_REQUIRED = "interval_minutes は変更されていません。reinstall は不要です。";

  it("asks for reinstall when interval_minutes changes", async () => {
    answer({ "execution.interval_minutes": "90" });
    await run(FULL_CONFIG);
    expect(logged()).toContain(REINSTALL_REQUIRED);
  });

  it("does not ask for reinstall when other keys change", async () => {
    answer({ "execution.timeout_minutes": "90" });
    await run(FULL_CONFIG);
    expect(logged()).toContain(REINSTALL_NOT_REQUIRED);
  });

  it("does not ask for reinstall when an omitted interval is set to its default", async () => {
    answer({ "execution.interval_minutes": "10" });
    await run(MINIMAL_CONFIG);
    expect((written().execution as Record<string, unknown>).interval_minutes).toBe(10);
    expect(logged()).toContain(REINSTALL_NOT_REQUIRED);
  });
});
