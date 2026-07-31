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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { confirm, select, input } from "@inquirer/prompts";
import { getConfigPath, getConfigBackupPath } from "../../src/utils/paths.js";

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedConfirm = vi.mocked(confirm);
const mockedSelect = vi.mocked(select);
const mockedInput = vi.mocked(input);
const mockedGetConfigPath = vi.mocked(getConfigPath);
const mockedGetConfigBackupPath = vi.mocked(getConfigBackupPath);

// ---------- Fixtures ----------

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
      impl:
        trigger: "claude/impl"
        in_progress: "claude/impl:in-progress"
        done: "claude/impl:done"
        failed: "claude/impl:failed"
    priority_labels:
      - "priority:high"
      - "priority:low"
execution:
  max_parallel: 2
  max_issues_per_repo: 3
  autonomy: auto
  interval_minutes: 60
  timeout_minutes: 120
`;

const MINIMAL_CONFIG = `\
repositories:
  - owner: acme
    repo: app
    local_path: /tmp/acme/app
`;

// ---------- Helpers ----------

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

function setupDefaults(): void {
  mockedSelect.mockImplementation(async (cfg: unknown) => {
    const config = cfg as { default?: unknown };
    return config.default ?? "";
  });
  mockedInput.mockImplementation(async (cfg: unknown) => {
    const config = cfg as { default?: string };
    return config.default ?? "";
  });
  mockedConfirm.mockImplementation(async (cfg: unknown) => {
    const config = cfg as { default?: boolean; message?: string };
    return config.default ?? true;
  });
}

// ---------- Setup ----------

let consoleSpy: { log: ReturnType<typeof vi.spyOn>; error: ReturnType<typeof vi.spyOn> };

beforeEach(() => {
  vi.restoreAllMocks();
  mockedConfirm.mockReset();
  mockedSelect.mockReset();
  mockedInput.mockReset();
  mockedWriteFileSync.mockReset();

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

async function runMigrateCommand(): Promise<void> {
  const { migrateCommand } = await import("../../src/commands/migrate.js");
  return migrateCommand();
}

// ---------- Tests: abort cases ----------

describe("migrateCommand - config.yml not found", () => {
  it("shows error and does not write", async () => {
    mockedExistsSync.mockReturnValue(false);

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(expect.stringContaining("config.yml"));
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

describe("migrateCommand - YAML parse failure", () => {
  it("shows parse error and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(":\n  :\n  - [bad yaml\n");

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

describe("migrateCommand - not-a-mapping", () => {
  it("shows format error and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("- item1\n- item2\n");

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

describe("migrateCommand - repositories-invalid", () => {
  it("shows repositories error and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("language: ja\n");

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringContaining("repositories"),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

describe("migrateCommand - schema-version-newer", () => {
  it("shows schema version error and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue("schema_version: 99\nrepositories: []\n");

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringMatching(/99/),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

describe("migrateCommand - user declines final confirmation", () => {
  it("shows aborted message and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();
    // Override: final confirm = No
    mockedConfirm.mockResolvedValue(false);

    await runMigrateCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
    const bw = backupWriteCall();
    expect(bw).toBeUndefined();
  });
});

describe("migrateCommand - backup write failure", () => {
  it("shows backup error and does not write config", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();
    mockedWriteFileSync.mockImplementation(((path: string) => {
      if ((path as string).includes(".bak-")) {
        throw new Error("EEXIST");
      }
    }) as typeof writeFileSync);

    await runMigrateCommand();

    expect(consoleSpy.error).toHaveBeenCalledWith(
      expect.stringMatching(/backup|バックアップ/),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

// ---------- Tests: already up to date ----------

describe("migrateCommand - already up to date", () => {
  it("shows up-to-date message and does not write", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(FULL_CONFIG);

    await runMigrateCommand();

    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining("config.yml"),
    );
    const cw = configWriteCall();
    expect(cw).toBeUndefined();
  });
});

// ---------- Tests: schema_version only (steps=0 but version missing) ----------

describe("migrateCommand - zero steps but schema_version missing", () => {
  it("writes only schema_version without changing other keys", async () => {
    const yaml = FULL_CONFIG.replace("schema_version: 1\n", "");
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(yaml);
    setupDefaults();

    await runMigrateCommand();

    const cw = configWriteCall();
    expect(cw).toBeDefined();
    const parsed = YAML.parse(cw!.content) as Record<string, unknown>;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.language).toBe("ja");
    expect((parsed.execution as Record<string, unknown>).interval_minutes).toBe(60);
  });
});

// ---------- Tests: normal migration ----------

describe("migrateCommand - normal migration with prompts", () => {
  it("fills in missing keys and writes config", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();

    await runMigrateCommand();

    const cw = configWriteCall();
    expect(cw).toBeDefined();
    const parsed = YAML.parse(cw!.content) as Record<string, unknown>;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.language).toBe("ja");
    const exec = parsed.execution as Record<string, unknown>;
    expect(exec.max_parallel).toBe(1);
    expect(exec.max_issues_per_repo).toBe(1);
    expect(exec.interval_minutes).toBe(60);
    expect(exec.timeout_minutes).toBe(60);
    const repos = parsed.repositories as Array<Record<string, unknown>>;
    expect(repos[0].default_branch).toBe("main");
    expect(repos[0].auto_impl_after_plan).toBe(false);
    expect(repos[0].labels).toBeDefined();
    expect(repos[0].priority_labels).toBeDefined();
  });

  it("writes backup before config", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();

    await runMigrateCommand();

    const bw = backupWriteCall();
    expect(bw).toBeDefined();
    expect(bw!.content).toBe(MINIMAL_CONFIG);
    expect(bw!.options).toEqual({ encoding: "utf-8", mode: 0o600, flag: "wx" });
  });

  it("writes config with mode 0o600", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();

    await runMigrateCommand();

    const cw = configWriteCall();
    expect(cw).toBeDefined();
    expect(cw!.options).toEqual({ encoding: "utf-8", mode: 0o600 });
  });
});

// ---------- Tests: comment preservation ----------

describe("migrateCommand - comment preservation", () => {
  it("preserves YAML comments after migration", async () => {
    const commentedConfig = `\
# My custom config
repositories:
  - owner: acme # org name
    repo: app
    local_path: /tmp/acme/app
`;
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(commentedConfig);
    setupDefaults();

    await runMigrateCommand();

    const cw = configWriteCall();
    expect(cw).toBeDefined();
    expect(cw!.content).toContain("# My custom config");
    expect(cw!.content).toContain("# org name");
  });
});

// ---------- Tests: reinstall guidance ----------

describe("migrateCommand - reinstall guidance", () => {
  it("no guidance when interval_minutes key absent and user enters default 60", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();

    await runMigrateCommand();

    const logCalls = consoleSpy.log.mock.calls.map((c) => c[0] as string);
    const hasReinstallRequired = logCalls.some((m) => m.includes("reinstall"));
    const hasNotRequired = logCalls.some(
      (m) => m.includes("reinstall") && (m.includes("不要") || m.includes("not changed") || m.includes("No reinstall")),
    );
    expect(hasReinstallRequired).toBe(true);
    expect(hasNotRequired).toBe(true);
  });

  it("shows reinstall needed when interval_minutes key absent and user enters 90", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();
    mockedInput.mockImplementation(async (cfg: unknown) => {
      const config = cfg as { message?: string; default?: string };
      const msg = config.message ?? "";
      if (msg.includes("間隔") || msg.toLowerCase().includes("interval")) {
        return "90";
      }
      return config.default ?? "";
    });

    await runMigrateCommand();

    const logCalls = consoleSpy.log.mock.calls.map((c) => c[0] as string);
    const hasReinstallRequired = logCalls.some(
      (m) => m.includes("reinstall") && !m.includes("不要") && !m.includes("No reinstall"),
    );
    expect(hasReinstallRequired).toBe(true);
  });

  it("no reinstall needed when existing interval_minutes is 60 and stays 60", async () => {
    const yaml = `\
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
      impl:
        trigger: "claude/impl"
        in_progress: "claude/impl:in-progress"
        done: "claude/impl:done"
        failed: "claude/impl:failed"
    priority_labels:
      - "priority:high"
execution:
  max_parallel: 1
  max_issues_per_repo: 1
  autonomy: interactive
  interval_minutes: 60
`;
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(yaml);
    setupDefaults();

    await runMigrateCommand();

    const logCalls = consoleSpy.log.mock.calls.map((c) => c[0] as string);
    const hasNotRequired = logCalls.some(
      (m) => m.includes("reinstall") && (m.includes("不要") || m.includes("not changed") || m.includes("No reinstall")),
    );
    expect(hasNotRequired).toBe(true);
  });

  it("shows reinstall needed when interval_minutes absent and default changes to 90", async () => {
    const yaml = `\
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
      impl:
        trigger: "claude/impl"
        in_progress: "claude/impl:in-progress"
        done: "claude/impl:done"
        failed: "claude/impl:failed"
    priority_labels:
      - "priority:high"
execution:
  max_parallel: 1
  max_issues_per_repo: 1
  autonomy: interactive
  timeout_minutes: 60
`;
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(yaml);
    setupDefaults();
    mockedInput.mockImplementation(async (cfg: unknown) => {
      const config = cfg as { message?: string; default?: string };
      const msg = config.message ?? "";
      if (msg.includes("間隔") || msg.toLowerCase().includes("interval")) {
        return "90";
      }
      return config.default ?? "";
    });

    await runMigrateCommand();

    const logCalls = consoleSpy.log.mock.calls.map((c) => c[0] as string);
    const hasReinstallRequired = logCalls.some(
      (m) => m.includes("reinstall") && !m.includes("不要") && !m.includes("No reinstall"),
    );
    expect(hasReinstallRequired).toBe(true);
  });
});

// ---------- Tests: writeFileSync failure ----------

describe("migrateCommand - config write failure", () => {
  it("shows error containing backup path", async () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReadFileSync.mockReturnValue(MINIMAL_CONFIG);
    setupDefaults();
    mockedWriteFileSync.mockImplementation(((path: string) => {
      if ((path as string).endsWith("config.yml")) {
        throw new Error("EACCES");
      }
    }) as typeof writeFileSync);

    await runMigrateCommand();

    const errorCalls = consoleSpy.error.mock.calls.map((c) => c[0] as string);
    const writeError = errorCalls.find(
      (m) => m.includes("config.yml") && m.includes(".bak-"),
    );
    expect(writeError).toBeDefined();
  });
});
